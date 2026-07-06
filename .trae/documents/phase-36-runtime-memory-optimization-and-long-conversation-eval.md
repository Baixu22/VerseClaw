# Phase 36 — Runtime Memory 优化 + 工程化补齐 + 长对话 A/B 评估

> **状态**：Plan Mode 待批准
> **前置**：Phase 34 (limited production opt-in) ✅、Phase 35 (benefit evaluation design) ✅
> **范围**：性能优化 (< 50ms p95) + 工程化全套 (日志/可观测/重试/LRU/熔断/sentinel 插件) + Scripted LLM 长对话 A/B 评估 + 评估流水线 + 任务规范
> **预计工作量**：13-17 天（5 个子项目，部分可并行）
> **用户决策**（已确认）：
> - 性能目标：< 50ms p95（稳健）
> - LLM 驱动：Scripted LLM（确定性、CI 友好）
> - 工程化范围：全套补齐（日志 + 可观测 + 重试 + LRU + 熔断 + sentinel 插件）
> - 边界：允许 testResearchOnly gate 突破 shadow-only 进行 A/B 注入

---

## 一、当前状态分析

### 1.1 Phase 35 评估暴露的问题

基于 `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` 与 `runtime-research/handoffs/phase-35-.../deep-validation.md` 的实测数据：

| 维度 | 实测值 | 目标值 | 差距 |
|------|--------|--------|------|
| 纯 consumer 延迟 p95 | 0.289ms | < 50ms | ✅ 已达标 |
| SQLite hydration + consumer p95 | 155ms | < 50ms | ❌ 超标 3x |
| token 开销 p95 | 34 tokens | < 100 | ✅ 已达标 |
| guardedRecallAtK | 1.0 | ≥ 0.95 | ✅ 已达标 |
| guardedPrecision | 1.0 | ≥ 0.98 | ✅ 已达标 |
| 评估方法学 | 静态语料 | 真实多轮 | ❌ 缺长对话 |
| 工程化（日志/监控/重试/缓存/熔断） | 全部缺失 | 全套 | ❌ 全部缺失 |

### 1.2 性能瓶颈根因（已通过 Read 验证）

**瓶颈 1：每次调用打开两个新 DatabaseSync 连接**
- `memory-read-hydration-shadow.ts:251-254` `openRuntimeMemoryHydrationShadowDatabase` 每次 `new sqlite.DatabaseSync(pathname, { readOnly: true })`
- `memory-read-hydration-shadow.ts:188` 调用一次（DB#1）
- `memory-persistence.ts:432` `inspectRuntimeMemorySanitizedEpisodes` 内部再调用 `openReadOnlyDatabase(databasePath)` 开 DB#2（同一文件、同一次 hydration 内冗余）
- `finally` 块（`memory-read-hydration-shadow.ts:238-245` + `memory-persistence.ts:471-477`）每次都 `clearNodeSqliteKyselyCacheForDatabase(db)` + `db.close()`

**瓶颈 2：无 prepared statement 缓存**
- `kysely-sync.ts:39` `executeCompiledSqliteQuerySync` 每次都 `db.prepare(compiledQuery.sql)`，无缓存
- 同一查询在 20 次探针中重复 prepare 20 次

**瓶颈 3：shadow 路径绕过了已有的连接缓存**
- `openclaw-state-db.ts:92` `cachedDatabases = new Map<string, OpenClawStateDatabase>()` 已有缓存模式，但 shadow 路径完全独立，不复用

### 1.3 工程化缺失清单（已通过 Read 验证）

| 缺失项 | 现状 | 可复用基础设施 |
|--------|------|----------------|
| 结构化日志 | memory 子系统零日志 | `logging/subsystem.ts:365` `createSubsystemLogger("runtime-memory")` |
| 可观测 span | `"memory"` span kind 预留但从不发射 | `observability/types.ts:11` + `metrics.ts:37` |
| 重试 | `withWriteTransaction` (memory-persistence.ts:611-619) BEGIN IMMEDIATE 不重试 | `infra/retry.ts` `retryAsync`（异步）/ `infra/sqlite-transaction.ts:33-44` 只重试 COMMIT |
| LRU 缓存 | 无 | 需新建 `infra/lru-cache.ts` |
| 熔断 | 无 | 需新建 `infra/circuit-breaker.ts` |
| sentinel 插件化 | `memory-read-hydration-consumer.ts:51,54` 硬编码 regex | consumer 签名 `(facts, query)` 无 options 参数 |
| TaskLoop delta 计数 | `task-loop-runtime-memory-read-hydration-shadow.ts:179-186` 全部硬编码为 0 | DI 已就绪 (`task-loop-controller.ts:323-357`) |

### 1.4 评估方法学缺陷

- Phase 35 仅做单轮静态语料评估，无多轮长对话
- 无真实 LLM 驱动（无法测 memory 对模型决策的实际影响）
- 无统计显著性检验（无 bootstrap CI、无 paired t-test、无最小样本量）
- 无 A/B 注入对比（shadow-only 边界禁止注入，无法测 TaskLoop decision delta）

---

## 二、优化方案与策略

### 2.1 总体策略：分层 + 可并行 + 边界可控

```
第一波（并行）：B4 LRU 缓存 → A1 连接缓存 → A2 合并 DB#2 → B5 熔断 → C1 Scripted LLM
第二波（依赖 B4）：A3 prepared statement 缓存 → B1 日志 → B3 重试 → B6 sentinel 插件 → B7 delta 接线
第三波（依赖 A+B）：B2 可观测 span → C2 testResearchOnly 注入门 → C3 A/B 框架
第四波（依赖 C3）：C4 多轮驱动 → C5 LLM judge → C6 统计显著性
第五波（依赖 C）：D1 评估辅助 → D2 长对话测试 → D3 报告生成 → D4 脚本
第六波：E1 任务规范 → E2 深度验证
```

### 2.2 性能优化策略（Sub-Project A，目标 p95 < 50ms）

**策略**：消除重复连接 + 缓存 prepared statement + 复用已有缓存模式

**A1：只读连接缓存**
- 在 `memory-read-hydration-shadow.ts` 顶部新增 `cachedReadOnlyDatabases: Map<string, { db: DatabaseSync; lastUsedAt: number }>`
- `openRuntimeMemoryHydrationShadowDatabase` 改为先查缓存，命中则返回；未命中则 `new DatabaseSync` 并存入
- `finally` 块不再 `db.close()`，改为更新 `lastUsedAt`；新增 `closeRuntimeMemoryHydrationShadowDatabasesForTest()` 供测试清理
- LRU 淘汰：最多缓存 8 个连接，超过时淘汰最久未用（依赖 B4 LRU）
- 预期收益：消除每次 `new DatabaseSync` 的开销（~50ms on Windows）

**A2：合并 DB#2**
- 修改 `inspectRuntimeMemorySanitizedEpisodes` 签名，接受 `db: DatabaseSync` 参数（已开则复用）
- 修改 `hydrateRuntimeMemoryShadowContext` 在 line 196-202 直接传入已开的 `db`，不再让 inspection 内部重开
- 修改 `RuntimeMemoryInspectionOpenReadOnlyDatabase` 调用路径，当外部已传 db 时跳过
- 预期收益：消除 DB#2 的 open + close + Kysely cache clear（~30ms）

**A3：prepared statement 缓存**
- 在 `kysely-sync.ts` 新增 `preparedStatementsByDatabase: WeakMap<DatabaseSync, Map<string, StatementSync>>`
- `executeCompiledSqliteQuerySync` 改为先查 `Map<sql, StatementSync>`，命中则复用；未命中则 `db.prepare` 并存入
- `clearNodeSqliteKyselyCacheForDatabase` 同步清理 prepared statement 缓存
- 预期收益：消除 20 次探针中 19 次的重复 prepare（~20ms 累计）

**性能验证**：扩展 Phase 35 测试的 SQLite hydration p95 用例，从 20 次探针增加到 50 次，阈值从 500ms 收紧到 50ms

### 2.3 工程化补齐策略（Sub-Project B，全套）

**策略**：复用已有基础设施 + 新建通用组件 + 接线 memory 子系统

**B1：结构化日志**
- 在 `memory-read-hydration-shadow.ts`、`memory-persistence.ts`、`memory-read-hydration-consumer.ts` 顶部创建 `const logger = createSubsystemLogger("runtime-memory")`
- 关键事件打日志：
  - `debug`：hydration 开始（含 databasePath, factLimit）、hydration 完成（含 factsReturned, durationMs）
  - `warn`：table_missing、invalid_json、circuit breaker open
  - `error`：hydration_failed、inspection_failed
- 日志必须含 `redactSensitiveText`（已由 `subsystem.ts` 内置）

**B2：可观测 span**
- 在 `hydrateRuntimeMemoryShadowContext` 创建 `ObservabilitySpan` (kind="memory")
- span 属性：`databasePath`, `factCount`, `factsReturned`, `episodeCount`, `truncated`, `durationMs`
- 通过新增的 `runtimeMemorySpanSink?: (span: ObservabilitySpan) => void` 选项注入（保持纯函数边界）
- 在 TaskLoop 集成层把 sink 接到 `runtimeTraceSpanShadowSink`

**B3：BEGIN IMMEDIATE 重试**
- 扩展 `infra/sqlite-transaction.ts`，新增 `runSqliteImmediateTransactionWithRetrySync(db, operation, options)` 
- BEGIN IMMEDIATE 失败时（SQLITE_BUSY/SQLITE_LOCKED）重试，指数退避（1ms, 2ms, 4ms...，最多 8 次）
- 保留 `runSqliteImmediateTransactionSync` 原签名（向后兼容）
- `memory-persistence.ts:611-619` `withWriteTransaction` 改用带重试版本

**B4：通用 LRU 缓存**
- 新建 `openclaw_runtime/src/infra/lru-cache.ts`
- 导出 `class LruCache<K, V> { constructor(maxSize: number); get(key: K): V | undefined; set(key: K, value: V): void; delete(key: K): void; clear(): void; size(): number; entries(): IterableIterator<[K, V]> }`
- 使用 `Map` 的插入顺序天然维护 LRU（get/set 时先 delete再set移到末尾）
- 单元测试：`tests/unit/lru-cache.test.ts`

**B5：通用熔断器**
- 新建 `openclaw_runtime/src/infra/circuit-breaker.ts`
- 导出 `class CircuitBreaker { constructor(options: { failureThreshold: number; resetTimeoutMs: number; halfOpenMaxCalls: number }); execute<T>(fn: () => T): T; getState(): "closed" | "open" | "half-open"; reset(): void }`
- 三态：closed（正常）→ open（失败达阈值，拒绝所有调用）→ half-open（超时后允许有限探测）
- 单元测试：`tests/unit/circuit-breaker.test.ts`
- 在 `hydrateRuntimeMemoryShadowContext` 包裹 DB 操作：连续 5 次 `hydration_failed` 则 open 30s

**B6：consumer sentinel 插件化**
- 修改 `consumeRuntimeMemoryHydrationFacts` 签名：`(facts, query, options?)` 其中 `options?: { sentinels?: { promptInjection?: RegExp; rawLeak?: RegExp } }`
- 默认值保持现有 `PROMPT_INJECTION_SENTINEL` / `RAW_LEAK_SENTINEL`
- 新增导出 `DEFAULT_PROMPT_INJECTION_SENTINEL` 和 `DEFAULT_RAW_LEAK_SENTINEL` 常量
- `hasPromptInjectionSentinel` / `hasRawLeakSentinel` 改用 `options?.sentinels?.promptInjection ?? DEFAULT_PROMPT_INJECTION_SENTINEL`
- 向后兼容：不传 options 时行为完全一致（Phase 35 测试无需改动）

**B7：TaskLoop delta 接线**
- 修改 `task-loop-runtime-memory-read-hydration-shadow.ts:179-186`，从硬编码 0 改为实际计算
- 新增 `deltaWiring?: TaskLoopRuntimeMemoryDeltaWiring` 选项，包含：
  - `compareTaskLoopDecision?(baselineDecision, guardedDecision): boolean` → `taskLoopDecisionDeltaCount`
  - `compareToolCall?(baselineToolCall, guardedToolCall): boolean` → `toolCallDeltaCount`
  - `compareProviderOrdering?(baselineOrdering, guardedOrdering): boolean` → `providerOrderingDeltaCount`
- 仅当 `testResearchOnly === true` 且 `deltaWiring` 提供时才计算（保持 shadow-only 默认零权威）
- `TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics` 类型从 `0` 字面量改为 `number`

### 2.4 Scripted LLM + 长对话 A/B 评估策略（Sub-Project C）

**策略**：确定性 LLM + 受控注入门 + 多轮 TaskLoop 驱动 + LLM judge + 统计显著性

**C1：Scripted LLM**
- 新建 `openclaw_runtime/src/agents/embedded-agent-runner/test-helpers/scripted-llm.ts`
- 导出 `class ScriptedLlm { constructor(responses: ScriptedResponse[]); nextResponse(context: ScriptedLlmContext): ScriptedResponse; reset(): void; remainingResponses(): number }`
- `ScriptedResponse`：`{ text: string; referencedFactIds?: string[]; toolCalls?: ScriptedToolCall[]; finishReason: "stop" | "tool_use" }`
- `ScriptedLlmContext`：`{ turn: number; query: RuntimeMemoryHydrationConsumerQuery; availableFacts: RuntimeMemoryHydrationShadowFactProjection[] }`
- 响应选择策略：支持 `queue`（按顺序）和 `match`（按 context 匹配）两种模式
- 参考：`compact.hooks.harness.ts` 的 `resolveEmbeddedAgentStreamFnMock` 模式

**C2：testResearchOnly 注入门**
- 修改 `task-loop-runtime-memory-read-hydration-shadow.ts`，新增 `testResearchInjection?: TestResearchInjectionOptions`
- `TestResearchInjectionOptions`：`{ enabled: true; arms: Array<"baseline" | "naiveMemory" | "guardedMemory">; scriptedLlm: ScriptedLlm; deltaWiring: TaskLoopRuntimeMemoryDeltaWiring }`
- 当 `testResearchOnly === true && testResearchInjection?.enabled === true` 时：
  - 突破 `noPromptContextModelMessageInjection: true` 边界（仅限研究）
  - 在 AUTHORITY 边界新增 `testResearchInjectionActive: true` 标记
  - 仍然保持 `noDurableFactAuthority: true`（不写持久化）
  - 仍然保持 `noRuntimeAuthority: true`（不影响真实 TaskLoop 决策路径，仅注入到 scripted LLM 的 context）

**C3：3-arm A/B 框架**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation/ab-framework.ts`
- 导出 `runAbEvaluation(options: AbEvaluationOptions): AbEvaluationReport`
- 每个 arm 运行相同的多轮对话，但 memory 注入策略不同：
  - `baseline`：不注入任何 facts
  - `naiveMemory`：注入同 key 匹配的所有 facts（含 stale/conflict/hazard）
  - `guardedMemory`：注入 `consumeRuntimeMemoryHydrationFacts` 结果
- 每个 arm 使用独立的 `ScriptedLlm` 实例（相同响应队列，但 context 不同）

**C4：多轮 TaskLoop 驱动**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation/multi-turn-driver.ts`
- 导出 `runMultiTurnConversation(options: MultiTurnOptions): MultiTurnReport`
- 复用 `TaskLoopControllerDeps` DI（`task-loop-controller.ts:323-357`），注入 scripted LLM
- 参考 `tests/integration/loop-stability-check.test.ts` 的 callCount 闭包模式
- 每轮：构造 query → hydration → consumer → 注入 scripted LLM → 收集响应 → 检查 factId 引用

**C5：LLM judge（基于 factId 引用跟踪）**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation/llm-judge.ts`
- 导出 `judgeTurn(turn: TurnRecord, expectedFactIds: string[]): TurnJudgment`
- `TurnJudgment`：`{ referencedCorrectFacts: string[]; referencedWrongFacts: string[]; missedFacts: string[]; hallucinatedFacts: string[]; followedPolicy: boolean; injectedPromptContent: boolean }`
- 判定逻辑：
  - `referencedCorrectFacts`：响应中引用了 expected factId
  - `referencedWrongFacts`：响应中引用了非 expected factId（含 stale/conflict）
  - `hallucinatedFacts`：响应中引用了 corpus 中不存在的 factId
  - `injectedPromptContent`：响应中包含 prompt injection 内容（即使被注入了也不应遵循）

**C6：统计显著性**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation/statistics.ts`
- 导出 `bootstrapCi(samples: number[], confidenceLevel: number): { mean: number; lower: number; upper: number }`
- 导出 `pairedTTest(before: number[], after: number[]): { t: number; pValue: number; significant: boolean; df: number }`
- 导出 `minimumSampleSize(effectSize: number, alpha: number, power: number): number`
- 最小样本量：≥ 30 轮对话（满足中心极限定理），建议 50 轮

### 2.5 评估流水线策略（Sub-Project D）

**D1：评估辅助提取**
- 从 `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` 提取通用函数到 `tests/long-conversation/runtime-memory-ab-evaluation/eval-helpers.ts`
- 提取：`evaluate`, `evaluateQuery`, `naiveArm`, `toProjection`, `percentile`, `suppressionRate`, `expectThreshold`
- 保留 Phase 35 测试文件不变（向后兼容）

**D2：长对话评估测试**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation.test.ts`
- `// @vitest-environment node` 指令
- 测试用例：
  1. `runs 50-turn conversation across 3 arms and collects metrics`
  2. `proves guarded arm beats baseline on task success rate (p < 0.05)`
  3. `proves guarded arm beats naive on hazard suppression (p < 0.05)`
  4. `proves guarded arm has zero prompt injection compliance`
  5. `generates report.json and report.md artifacts`

**D3：报告生成**
- 新建 `tests/long-conversation/runtime-memory-ab-evaluation/report-generator.ts`
- 导出 `generateReport(report: AbEvaluationReport, outputPath: string): Promise<void>`
- 生成 `report.json`（机器可读）+ `report.md`（人类可读，中文）
- `report.md` 包含：执行摘要、3-arm 对比表、每轮详情、统计显著性、置信区间、结论

**D4：package.json 脚本**
- 新增 `"eval:long-conversation": "vitest run tests/long-conversation/runtime-memory-ab-evaluation.test.ts"`
- 新增 `"eval:long-conversation:report": "vitest run tests/long-conversation/runtime-memory-ab-evaluation.test.ts && node tests/long-conversation/runtime-memory-ab-evaluation/print-report.mjs"`

### 2.6 任务规范与深度验证（Sub-Project E）

**E1：Phase 36 任务规范**
- 新建 `harness/specs/tasks/phase-36-runtime-memory-optimization-and-long-conversation-eval.md`
- YAML frontmatter：`scenario: gateway-backend-communication`, `taskType: runtime-bridge`, `requiredProfiles: [fast, comms]`
- 必须引用的规则：`gateway-backend-communication`, `runtime-memory-shadow-only-authority`
- 验收标准：
  - A: SQLite hydration + consumer p95 < 50ms（50 次探针）
  - B: memory 子系统有结构化日志、可观测 span、重试、LRU、熔断、sentinel 插件化
  - C: 长对话 A/B 评估 50 轮，guarded 显著优于 baseline 和 naive (p < 0.05)
  - D: report.json + report.md 生成
  - E: harness validate 通过

**E2：深度验证 handoff**
- 新建 `runtime-research/handoffs/phase-36-runtime-memory-optimization-and-long-conversation-eval/deep-validation.md`
- 包含：优化前后对比、3-arm 长对话结果、统计显著性、置信区间、Phase 37 硬门

---

## 三、具体改动清单

### Sub-Project A：性能优化（3 个文件，预计 3 天）

#### A1. `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`
- 新增 `cachedReadOnlyDatabases: Map<string, { db: DatabaseSync; lastUsedAt: number }>`（模块级，最多 8 项）
- 修改 `openRuntimeMemoryHydrationShadowDatabase`：先查缓存，命中更新 lastUsedAt；未命中 new + 存入 + LRU 淘汰
- 修改 `hydrateRuntimeMemoryShadowContext` 的 `finally` 块：不 close，只更新 lastUsedAt
- 新增 `closeRuntimeMemoryHydrationShadowDatabasesForTest()`：供测试 afterEach 清理
- 新增 `runtimeMemoryHydrationSpanSink` 选项（为 B2 预留）

#### A2. `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- 修改 `inspectRuntimeMemorySanitizedEpisodes` 签名：新增可选 `db?: DatabaseSync` 参数
- 当 `db` 已传入时：跳过 `openReadOnlyDatabase` 调用（line 432）、跳过 finally 中的 close
- 修改 `RuntimeMemorySanitizedEpisodeInspectionOptions` 类型：新增 `db?: DatabaseSync`
- 修改 `hydrateRuntimeMemoryShadowContext` line 196-202：传入已开的 `db`

#### A3. `openclaw_runtime/src/infra/kysely-sync.ts`
- 新增 `preparedStatementsByDatabase: WeakMap<DatabaseSync, Map<string, StatementSync>>`
- 修改 `executeCompiledSqliteQuerySync`：先查 `preparedStatementsByDatabase.get(db)?.get(sql)`，命中复用；未命中 `db.prepare` + 存入
- 修改 `clearNodeSqliteKyselyCacheForDatabase`：同步清理 prepared statement 缓存
- 依赖 B4 的 LRU 限制单 DB 的 statement 缓存大小（最多 64 条）

### Sub-Project B：工程化（7 个改动，预计 5 天）

#### B1. 日志接线（3 个文件）
- `memory-read-hydration-shadow.ts`：顶部 `const logger = createSubsystemLogger("runtime-memory")`
- `memory-persistence.ts`：同上
- `memory-read-hydration-consumer.ts`：同上（仅 warn/error，保持纯函数无副作用）

#### B2. 可观测 span（1 个文件）
- `memory-read-hydration-shadow.ts`：创建 `ObservabilitySpan` (kind="memory")，通过 `runtimeMemorySpanSink` 回调发射

#### B3. BEGIN IMMEDIATE 重试（1 个文件）
- `infra/sqlite-transaction.ts`：新增 `runSqliteImmediateTransactionWithRetrySync`
- `memory-persistence.ts:611-619`：改用带重试版本

#### B4. 通用 LRU 缓存（2 个新文件）
- 新建 `openclaw_runtime/src/infra/lru-cache.ts`
- 新建 `tests/unit/lru-cache.test.ts`

#### B5. 通用熔断器（2 个新文件）
- 新建 `openclaw_runtime/src/infra/circuit-breaker.ts`
- 新建 `tests/unit/circuit-breaker.test.ts`
- `memory-read-hydration-shadow.ts`：包裹 DB 操作

#### B6. consumer sentinel 插件化（1 个文件）
- `memory-read-hydration-consumer.ts`：
  - 新增 `RuntimeMemoryHydrationConsumerOptions` 类型
  - 修改 `consumeRuntimeMemoryHydrationFacts` 签名加第三参数 `options?`
  - 导出 `DEFAULT_PROMPT_INJECTION_SENTINEL` / `DEFAULT_RAW_LEAK_SENTINEL`

#### B7. TaskLoop delta 接线（1 个文件）
- `task-loop-runtime-memory-read-hydration-shadow.ts`：
  - 新增 `TaskLoopRuntimeMemoryDeltaWiring` 类型
  - 修改 `TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions` 加 `deltaWiring?`
  - 修改 `aggregateMetrics`：当 deltaWiring 提供时计算真实 delta
  - 类型从 `0` 字面量改为 `number`

### Sub-Project C：Scripted LLM + A/B 评估（6 个新文件，预计 5 天）

#### C1. `openclaw_runtime/src/agents/embedded-agent-runner/test-helpers/scripted-llm.ts`（新建）
- `ScriptedLlm` 类、`ScriptedResponse` / `ScriptedLlmContext` 类型

#### C2. `task-loop-runtime-memory-read-hydration-shadow.ts`（修改）
- 新增 `TestResearchInjectionOptions` 类型
- 修改 `TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions` 加 `testResearchInjection?`
- 修改 `AUTHORITY`：当 testResearchInjection 启用时标记 `testResearchInjectionActive: true`
- 修改 `buildDiagnostics`：当注入启用时突破 shadow-only（仅研究路径）

#### C3. `tests/long-conversation/runtime-memory-ab-evaluation/ab-framework.ts`（新建）
- `runAbEvaluation` 函数、`AbEvaluationOptions` / `AbEvaluationReport` 类型

#### C4. `tests/long-conversation/runtime-memory-ab-evaluation/multi-turn-driver.ts`（新建）
- `runMultiTurnConversation` 函数、`MultiTurnOptions` / `MultiTurnReport` 类型

#### C5. `tests/long-conversation/runtime-memory-ab-evaluation/llm-judge.ts`（新建）
- `judgeTurn` 函数、`TurnRecord` / `TurnJudgment` 类型

#### C6. `tests/long-conversation/runtime-memory-ab-evaluation/statistics.ts`（新建）
- `bootstrapCi`、`pairedTTest`、`minimumSampleSize` 函数

### Sub-Project D：评估流水线（4 个改动，预计 2 天）

#### D1. `tests/long-conversation/runtime-memory-ab-evaluation/eval-helpers.ts`（新建）
- 从 Phase 35 测试提取通用函数

#### D2. `tests/long-conversation/runtime-memory-ab-evaluation.test.ts`（新建）
- 5 个 it 块（见 2.5 D2）

#### D3. `tests/long-conversation/runtime-memory-ab-evaluation/report-generator.ts`（新建）
- `generateReport` 函数

#### D4. `package.json`（修改）
- 新增 `eval:long-conversation` 和 `eval:long-conversation:report` 脚本

### Sub-Project E：任务规范与深度验证（2 个新文件，预计 1 天）

#### E1. `harness/specs/tasks/phase-36-runtime-memory-optimization-and-long-conversation-eval.md`（新建）
#### E2. `runtime-research/handoffs/phase-36-runtime-memory-optimization-and-long-conversation-eval/deep-validation.md`（新建）

---

## 四、依赖图与并行化

```
B4 LRU ─┬─→ A3 prepared statement 缓存
        └─→ A1 连接缓存（LRU 淘汰）

A1 连接缓存 ─→ A2 合并 DB#2（同一次调用内复用）

B5 熔断 ─→ B1 日志（熔断事件需日志）
B3 重试 ─→ B1 日志

A1+A2+A3 ─→ B2 可观测 span（性能优化后才能准确测）
B6 sentinel 插件 ─→ B7 delta 接线
C1 scripted LLM ─→ C2 testResearchOnly 注入门 ─→ C3 A/B 框架
B7 + C3 ─→ C4 多轮驱动 ─→ C5 LLM judge ─→ C6 统计显著性
C6 ─→ D1 评估辅助 ─→ D2 长对话测试 ─→ D3 报告生成 ─→ D4 脚本
D2 ─→ E1 任务规范 ─→ E2 深度验证
```

**并行窗口**：
- 第一波（无依赖）：B4、A1（不依赖 B4 的部分）、B5、C1、B3、B6
- 第二波：A2（依赖 A1）、A3（依赖 B4）、B1（依赖 B5/B3）、B7（依赖 B6）
- 第三波：B2（依赖 A1-A3）、C2（依赖 C1）、C3（依赖 C2、B7）
- 第四波：C4（依赖 C3）、C5（依赖 C4）、C6（依赖 C5）
- 第五波：D1-D4（依赖 C6）
- 第六波：E1-E2（依赖 D2）

---

## 五、假设与决策

### 5.1 关键假设
1. **node:sqlite `DatabaseSync` 只读连接可被多调用复用**：同一进程内同一文件的只读连接是线程安全的（Node.js 单线程事件循环，无并发竞争）
2. **prepared statement 在 connection 生命周期内有效**：只要不 `db.close()`，`StatementSync` 可复用
3. **Scripted LLM 的确定性**：响应队列按顺序消费，无 PRNG，无 wall-clock，CI 可重现
4. **50 轮对话满足中心极限定理**：每轮独立采样，n=50 足够做 t 检验

### 5.2 关键决策
1. **连接缓存上限 8**：典型用户场景不超过 8 个 agent DB，避免内存泄漏
2. **prepared statement 缓存上限 64/DB**：覆盖典型查询模式，避免无界增长
3. **熔断阈值 5 次失败 / 30s open**：平衡敏感度与误报
4. **BEGIN IMMEDIATE 重试 8 次 / 指数退避**：与现有 `MAX_COMMIT_ATTEMPTS = 8` 一致
5. **testResearchOnly 突破边界仅限研究路径**：保持 `noDurableFactAuthority` 和 `noRuntimeAuthority` 不变，仅突破 `noPromptContextModelMessageInjection`
6. **consumer options 向后兼容**：不传 options 时行为与 Phase 35 完全一致

### 5.3 边界保持
- ✅ `noDurableFactAuthority: true`（不写持久化）
- ✅ `noRuntimeAuthority: true`（不影响真实 TaskLoop 决策）
- ✅ `diagnosticsOnly: true`（仅诊断）
- ✅ `readonly: true`（只读）
- ⚠️ `noPromptContextModelMessageInjection: true` → 仅在 `testResearchOnly + testResearchInjection.enabled` 时突破（研究路径）

---

## 六、验证步骤

### 6.1 单元测试
```bash
# 现有测试不回归
pnpm test tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
pnpm test tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts

# 新增单元测试
pnpm test tests/unit/lru-cache.test.ts
pnpm test tests/unit/circuit-breaker.test.ts
```

### 6.2 性能验证
```bash
# Phase 35 测试中 SQLite hydration p95 从 500ms 收紧到 50ms
# 修改 tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts 第 314 行
# expect(p95).toBeLessThan(50)  // 原为 500
pnpm test tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
```

### 6.3 长对话评估
```bash
# 50 轮 × 3 arm = 150 轮对话
pnpm eval:long-conversation

# 检查报告
cat tests/long-conversation/runtime-memory-ab-evaluation/report.json
cat tests/long-conversation/runtime-memory-ab-evaluation/report.md
```

### 6.4 类型检查与 lint
```bash
pnpm run typecheck
pnpm run lint
```

### 6.5 Harness 验证
```bash
pnpm harness validate --spec phase-36-runtime-memory-optimization-and-long-conversation-eval
pnpm run harness:ci
```

### 6.6 Comms 回归（如有通信路径改动）
```bash
pnpm run comms:replay
pnpm run comms:compare
```

---

## 七、验收标准（Phase 36 完成定义）

| 标准 | 验证方法 | 阈值 |
|------|----------|------|
| SQLite hydration + consumer p95 | Phase 35 测试（50 次探针） | < 50ms |
| 纯 consumer p95 | Phase 35 测试 | < 50ms（已达标，保持） |
| memory 子系统日志覆盖 | grep `createSubsystemLogger("runtime-memory")` | ≥ 3 文件 |
| memory span 发射 | 单元测试 | ≥ 1 span/hydration |
| BEGIN IMMEDIATE 重试 | 单元测试 | 8 次重试 |
| LRU 缓存 | 单元测试 | 淘汰正确 |
| 熔断器 | 单元测试 | 三态切换正确 |
| sentinel 插件化 | 单元测试 | 自定义 regex 生效 |
| delta 接线 | 单元测试 | 非 0 计数 |
| 长对话 A/B 评估 | `pnpm eval:long-conversation` | 50 轮 × 3 arm 完成 |
| guarded vs baseline 显著性 | paired t-test | p < 0.05 |
| guarded vs naive hazard 抑制 | bootstrap CI | 下界 > 0.9 |
| report.json + report.md | 文件存在 | 生成成功 |
| harness validate | CLI | 通过 |
| 现有测试无回归 | `pnpm test` | 全部通过 |
| typecheck + lint | CLI | 通过 |

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 连接缓存导致测试间状态泄漏 | 中 | 高 | `closeRuntimeMemoryHydrationShadowDatabasesForTest()` 在 afterEach 调用 |
| prepared statement 缓存与 Kysely cache clear 冲突 | 低 | 中 | `clearNodeSqliteKyselyCacheForDatabase` 同步清理两者 |
| Scripted LLM 响应队列耗尽 | 中 | 中 | 队列末尾循环最后一项 + warn 日志 |
| testResearchOnly 注入门被误用到生产 | 低 | 高 | 类型系统强制 `testResearchOnly: true` + `testResearchInjection.enabled: true` 双门 |
| 50 轮对话 CI 时间过长 | 中 | 低 | 超时 60s，必要时降为 30 轮（统计功效仍足够） |
| 熔断器误报导致 hydration 失败 | 低 | 中 | 阈值 5 次 + 30s 自动 half-open + warn 日志 |

---

## 九、推荐实施顺序

**Day 1-2**：B4 (LRU) + B5 (熔断) + B6 (sentinel 插件) + B3 (重试) — 全部独立，并行
**Day 3-4**：A1 (连接缓存，依赖 B4) + A2 (合并 DB#2，依赖 A1) + B1 (日志，依赖 B5/B3)
**Day 5**：A3 (prepared statement 缓存，依赖 B4) + B7 (delta 接线，依赖 B6)
**Day 6**：B2 (可观测 span，依赖 A1-A3) + C1 (Scripted LLM)
**Day 7-8**：C2 (testResearchOnly 注入门) + C3 (A/B 框架)
**Day 9-10**：C4 (多轮驱动) + C5 (LLM judge)
**Day 11**：C6 (统计显著性)
**Day 12**：D1 (评估辅助) + D2 (长对话测试) + D3 (报告生成) + D4 (脚本)
**Day 13**：E1 (任务规范) + E2 (深度验证)
**Day 14-17**：缓冲（性能调优、统计功效不足时增加轮次、回归修复）

---

## 十、Phase 37 硬门（展望）

Phase 36 完成后，Phase 37 的硬门（需在 E2 handoff 中明确）：
1. **生产 cutover 仍禁止**：testResearchOnly 注入门不得用于生产
2. **真实 LLM 集成**：Phase 37 应支持真实 LLM（非 Scripted）做最终验收
3. **用户真实数据评估**：Phase 37 可考虑 sanitized internal sample
4. **多模型横评**：Phase 37 应测 ≥ 2 个模型供应商
5. **长时运行稳定性**：Phase 37 应测 ≥ 200 轮对话
