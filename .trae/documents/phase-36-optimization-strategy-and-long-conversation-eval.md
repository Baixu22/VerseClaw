# Phase 36 — 优化方案与长对话评估（Optimization Strategy & Long Conversation Eval）

> 本文件是 Phase 36 的执行计划。覆盖：B 收尾（CircuitBreaker 修复 + B7 delta/sentinel 复用）、C 基础（Scripted LLM + testResearchOnly 突破）、C 评估（统计显著性模块 + 30 轮多回合驱动）、D 流水线（eval-helpers 抽取 + 长对话测试 + 报告生成器 + package.json 脚本）、E 规范（task spec + rules）。
>
> 范围决策（来自前序会话，沿用）：
> - 长对话规模：中等 30 轮（120 queries，CI < 60s）
> - 评估优化方向：仅统计显著性（bootstrap CI + paired t-test + 最小样本量）
> - 不在范围：LLM-as-judge、TaskLoop 级 A/B 框架、时序累积分析
> - 性能目标：p95 < 50ms（纯 consumer）/ < 500ms（含 temp SQLite）
> - LLM 驱动：Scripted LLM（确定性，CI 友好）
> - 工程范围：全套（logging + observability + retry + LRU + circuit breaker + sentinel 复用 + delta wiring）
> - 边界突破：允许 testResearchOnly gate 打破 shadow-only 以注入 A/B 对比

---

## 一、当前状态分析（Current State Analysis）

### 已完成（前序会话）
| 子项 | 文件 | 状态 |
|------|------|------|
| B1-1 结构化日志 | `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts` | ✅ `createSubsystemLogger("runtime-memory")`，hydration_start/cache_hit/cache_miss/complete/table_missing/failed/cache_cleared/invalid_json |
| B1-2 持久化日志 | `openclaw_runtime/src/runtime-core/memory-persistence.ts` | ✅ episode_inspection_start/table_missing/complete/failed/invalid_json |
| B1-2 重试日志 | `openclaw_runtime/src/infra/sqlite-transaction.ts` | ✅ transaction_retry/transaction_retry_exhausted（begin + commit 两阶段） |
| B1-3 消费端日志 | `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts` | ✅ consumer_prompt_injection_detected/consumer_raw_leak_detected（仅拒绝路径 warn，保持纯函数契约） |
| B2 可观测 span | `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts` | ✅ `RuntimeMemoryHydrationSpanSink` + kind="memory" span，成功/错误路径均发射 |

### 未完成（本计划目标）
| 子项 | 状态 | 问题 |
|------|------|------|
| CircuitBreaker 消费 | 代码已写但有 4 个类型错误 | 见下「Wave 1」 |
| B7 delta wiring | 未开始 | `task-loop-runtime-memory-read-hydration-shadow.ts` line 780-784 delta 计数硬编码为 0；line 304-308 sentinel 正则与 consumer.ts line 64-67 重复 |
| C1 Scripted LLM | 未开始 | 无确定性 LLM 驱动 |
| C2 testResearchOnly 突破 | 未开始 | 当前 `testResearchOnly !== true` 直接 skip，无法注入 A/B |
| C4 多回合驱动 | 未开始 | 无 30 轮 TaskLoop 驱动器 |
| C6 统计模块 | 未开始 | 无 bootstrap CI / paired t-test / 最小样本量 |
| D1-D4 流水线 | 未开始 | eval-helpers 未抽取；无长对话测试；无报告生成器；无 package.json 脚本 |
| E1 task spec | 未开始 | 无 Phase 36 harness spec |

### 关键架构事实（Phase 1 探查确认）
- **测试位置**：`tests/unit/`（仓库根，非 `openclaw_runtime/` 下），vitest 4.1.7
- **eval 固件**：`tests/fixtures/runtime-memory-benefit-eval/` 含 `generate.mjs`、`scenarios.json`、`expected-metrics.json`、`queries.json`、`facts.json`
- **类型检查**：`pnpm run tsgo:core`（TypeScript native preview）；注意：仓库存在大量**预存**类型错误（非本次引入），本次只对触及文件保证零新增错误
- **TaskLoopControllerDeps**（`openclaw_runtime/src/agents/task-loop-controller.ts` line 323-357）：可注入 `runtimeMemoryReadHydrationShadowOnly`、`runtimeMemoryEpisodeWriter`、`runtimeMemoryIntegrationOptions`、`runObserved`、`selfCheck`、`lifecycle` 等，全部可选
- **现有 benefit-eval 测试**：`tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts`，3-arm 模式（baseline/naive/guarded），从 `../../openclaw_runtime/src/runtime-core` 导入
- **Phase 35 spec**：`harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md`，定义 recall@k>=0.95、precision>=0.98、suppression=1、rawLeak=0、guardedVsBaselineLift>=0.15 等门槛

### CircuitBreaker 4 个类型错误（tsgo:core 实测）
```
memory-read-hydration-shadow.ts(270,57): error TS2345: 'string | undefined' not assignable to 'string'
memory-read-hydration-shadow.ts(278,28): error TS2345: 'string | undefined' not assignable to 'string'
memory-read-hydration-shadow.ts(351,5):  error TS2322: skipped union not assignable to RuntimeMemoryHydrationShadowResult
memory-read-hydration-shadow.ts(570,9):  error TS2322: 'circuit_breaker_open' not in diagnostic code union
```
根因：闭包内 `options.databasePath` 无法被外层 `if (!options.databasePath)` 收窄；`execute<T>` 泛型未显式标注；diagnostic code union 未包含 `circuit_breaker_open`。

---

## 二、优化策略（Optimization Strategy）

### 策略原则
1. **先收尾再扩张**：Wave 1 把 B 系列全部闭环（CircuitBreaker + B7），避免在新工作里堆叠旧债
2. **确定性优先**：所有评估用 Scripted LLM，CI 内零网络、零随机、可重放
3. **统计严谨**：用 bootstrap CI + paired t-test 替代「单次跑分下结论」，给出最小样本量以保证 power>=0.8
4. **工程闭环**：每个 Wave 结束跑 `tsgo:core`（仅校验触及文件零新增错误）+ 相关 vitest
5. **规范同步**：最后补 harness task spec + rules，让后续 AI 工作可验证

### 6 个 Wave
| Wave | 主题 | 子项 | 产出 |
|------|------|------|------|
| 1 | B 收尾 | CircuitBreaker 修复 + B7 delta/sentinel | 触及文件零新增类型错误 |
| 2 | C 基础 | C1 Scripted LLM + C2 testResearchOnly 突破 | 确定性 LLM + A/B 注入门 |
| 3 | C 评估 | C6 统计模块 + C4 多回合驱动 | bootstrap/t-test + 30 轮驱动器 |
| 4 | D 流水线 | D1 eval-helpers + D2 长对话测试 + D3 报告 + D4 脚本 | 可跑评估流水线 |
| 5 | E 规范 | E1 task spec + rules | harness 可验证 |
| 6 | 验证 | 全量 typecheck + vitest + harness validate | 收尾 |

---

## 三、具体变更（Proposed Changes）

### Wave 1 — B 收尾

#### 1.1 修复 CircuitBreaker 4 个类型错误
**文件**：`openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`

**变更 1（line 270, 278 — 闭包内 databasePath 收窄）**：
在 line 245 `if (!options.databasePath)` 检查之后、`try` 块之前，提取局部常量：
```typescript
const databasePath = options.databasePath;
```
闭包内所有 `options.databasePath` 替换为 `databasePath`（已收窄为 `string`）。

**变更 2（line 351 — execute 泛型标注）**：
```typescript
const result = hydrationCircuitBreaker.execute<RuntimeMemoryHydrationShadowResult>(() => {
  // ...
});
```

**变更 3（line 570 + diagnostic code union）**：
在 `RuntimeMemoryHydrationShadowDiagnostic.code` union（line 42-50）追加 `"circuit_breaker_open"`：
```typescript
code:
  | "flag_disabled"
  | "read_shadow_disabled"
  | "database_path_required"
  | "database_missing"
  | "table_missing"
  | "invalid_json"
  | "hydration_failed"
  | "circuit_breaker_open";
```
这样 `skippedHydrationResult` 的 `code: reason` 自然合法（reason union 已含 `circuit_breaker_open`）。

**验证**：`pnpm run tsgo:core` 后这 4 行错误消失（其余预存错误不在本次范围）。

#### 1.2 B7 — Sentinel 复用 + Delta wiring
**文件**：`openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`

**变更 1（sentinel 复用）**：
删除 line 304-308 重复的 `PROMPT_INJECTION_SENTINEL` / `RAW_LEAK_SENTINEL` 常量，改为从 consumer 复用：
```typescript
import {
  DEFAULT_PROMPT_INJECTION_SENTINEL,
  DEFAULT_RAW_LEAK_SENTINEL,
} from "../runtime-core/memory-read-hydration-consumer.js";
```
本地 `hasPromptInjectionSentinel` / `hasRawLeakSentinel` / `hasPilotMetadataSentinel` 改用导入的常量。

**变更 2（delta wiring — 真实计数）**：
当前 `aggregateMetrics`（line 780-784）硬编码：
```typescript
taskLoopDecisionDeltaCount: 0,
toolCallDeltaCount: 0,
providerOrderingDeltaCount: 0,
promptContextModelMessageInjectionCount: 0,
durableMemoryWriteCount: 0,
```
改造为接收一个可选的 `deltaCounts` 入参（由调用方传入实际 A/B 对比结果），`buildDiagnostics` 把它透传给 `aggregateMetrics`。在 shadow-only 默认路径下仍为 0（保持向后兼容），仅在 testResearchOnly A/B 注入路径下填入真实值。

类型扩展：
```typescript
export type TaskLoopRuntimeMemoryReadHydrationDeltaCounts = {
  taskLoopDecisionDeltaCount?: number;
  toolCallDeltaCount?: number;
  providerOrderingDeltaCount?: number;
  promptContextModelMessageInjectionCount?: number;
  durableMemoryWriteCount?: number;
};
```
加到 `TaskLoopRuntimeMemoryReadHydrationShadowOnlyInput` 或 options 上作为可选字段。

**变更 3（AUTHORITY 边界参数化）**：
`noPromptContextModelMessageInjection: true` 等保持 `true`（这是不可变边界），不参数化。delta wiring 只影响 metrics 计数，不改变 authority 契约。

**验证**：跑 `tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts` + `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts`，确保无回归。

---

### Wave 2 — C 基础

#### 2.1 C1 — Scripted LLM
**新文件**：`openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts`

确定性 LLM 驱动，按 `sessionKey` 维护响应队列，CI 友好（零网络、零随机）。

```typescript
export type ScriptedLlmResponse = {
  text: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  usage?: { input: number; output: number; total: number };
};

export type ScriptedLlmScript = {
  sessionKey: string;
  responses: readonly ScriptedLlmResponse[];
};

export class ScriptedLlmDriver {
  // 按 sessionKey 取队列，逐条出队；队空抛错（避免静默假阳性）
  constructor(scripts: readonly ScriptedLlmScript[]);
  respond(sessionKey: string): ScriptedLlmResponse;
  // 用于 A/B：同一 sessionKey 的两条脚本，按 arm 选择
  respondForArm(sessionKey: string, arm: "baseline" | "treatment"): ScriptedLlmResponse;
}
```

**新文件**：`tests/unit/runtime-memory-eval-scripted-llm.test.ts`
覆盖：队列顺序、队空抛错、A/B arm 切换、多 sessionKey 隔离。

#### 2.2 C2 — testResearchOnly 注入门突破
**文件**：`openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`

当前 line 335-341：`testResearchOnly !== true` 直接返回 skipped。改造为：
- 保留默认 skip（生产安全）
- 新增一个 `testResearchOnlyBreakthrough` 选项：当 `testResearchOnly === true` 且 `testResearchOnlyBreakthrough === true` 时，允许 hydration 结果**注入**到 TaskLoop 上下文（而非仅诊断），用于 A/B 对比
- 注入路径仍受 authority 边界约束：注入的是 sanitized fact projection，不是 raw record；不写持久化；不改 provider ordering

类型扩展：
```typescript
export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions = {
  // ...existing...
  testResearchOnlyBreakthrough?: boolean;
  breakthroughInjection?: {
    enabled: true;
    arm: "baseline" | "treatment";
    acceptedFactsMaxTokens: number;
  };
};
```

`buildDiagnostics` 在 breakthrough 路径下：仍产出 diagnostics，但同时返回一个 `breakthroughInjection` 字段记录实际注入的 fact 数与 token 数，供 delta 计数使用。

**验证**：新增 `tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts`，验证默认 skip、breakthrough 启用后注入计数、authority 边界不变。

---

### Wave 3 — C 评估

#### 3.1 C6 — 统计显著性模块
**新文件**：`openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts`

纯函数模块，无副作用：

```typescript
// Bootstrap 置信区间（1000 次重采样）
export function bootstrapConfidenceInterval(
  samples: readonly number[],
  options?: { iterations?: number; confidence?: number; rng?: () => number },
): { mean: number; lower: number; upper: number };

// 配对 t 检验（同 subject 的 baseline vs treatment）
export function pairedTTest(
  baseline: readonly number[],
  treatment: readonly number[],
): { t: number; df: number; pValue: number; meanDiff: number; significant: boolean };

// 最小样本量（Cohen's d=0.2, alpha=0.05, power=0.8）
export function minimumSampleSize(
  effectSize?: number,
  alpha?: number,
  power?: number,
): number;

// 效应量 Cohen's d
export function cohensD(baseline: readonly number[], treatment: readonly number[]): number;
```

实现要点：
- bootstrap 用确定性 RNG（默认 `mulberry32(seed)`，seed 固定）保证 CI 可重放
- p-value 用 Student t 分布 CDF 近似（避免引入额外依赖，内置查表 + 插值）
- `minimumSampleSize` 默认返回 `Math.ceil(((z_alpha + z_beta)/d)^2)`，d=0.2 时 ≈ 197

**新文件**：`tests/unit/runtime-memory-eval-statistics.test.ts`
覆盖：bootstrap CI 包含真实均值、paired t-test 显著性判定、最小样本量数值、确定性（同 seed 同结果）。

#### 3.2 C4 — 30 轮多回合 TaskLoop 驱动器
**新文件**：`openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts`

驱动 30 轮 TaskLoop，每轮注入 query，收集 baseline 与 treatment 的 metric：

```typescript
export type MultiTurnDriverOptions = {
  turns: number;              // 30
  queriesPerTurn: number;     // 4 → 120 queries 总量
  sessionKey: string;
  scriptedLlm: ScriptedLlmDriver;
  corpus: { facts: ...; queries: ... };
  databasePath: string;
  // DI: 注入 TaskLoopControllerDeps 的子集
  deps?: Partial<TaskLoopControllerDeps>;
};

export type MultiTurnRunResult = {
  turns: MultiTurnTurnResult[];
  aggregateBaseline: MetricSummary;
  aggregateTreatment: MetricSummary;
};

export type MultiTurnTurnResult = {
  turn: number;
  baselineMetrics: ArmMetrics;
  treatmentMetrics: ArmMetrics;
};

export type ArmMetrics = {
  recallAtK: number;
  precision: number;
  latencyMs: number;
  tokenOverhead: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
};

export function runMultiTurnDriver(options: MultiTurnDriverOptions): MultiTurnRunResult;
```

实现要点：
- 每轮调用 `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` 两次（baseline: breakthrough off / treatment: breakthrough on）
- 用 ScriptedLlmDriver 提供 deterministic 响应
- 收集每轮 ArmMetrics，聚合为 `MetricSummary`（mean, p50, p95, count）
- 性能目标：30 轮 × 120 queries 在 CI 内 < 60s（纯函数 + temp SQLite，无网络）

---

### Wave 4 — D 流水线

#### 4.1 D1 — eval-helpers 抽取
**新文件**：`tests/unit/helpers/runtime-memory-eval-helpers.ts`

从现有 `runtime-memory-read-hydration-benefit-evaluation.test.ts` 抽取共享逻辑：
- `loadEvalFixtures()`：从 `tests/fixtures/runtime-memory-benefit-eval/` 读 facts/queries/scenarios/expected-metrics
- `buildEvalCorpus()`：构造 temp SQLite + 写入 facts
- `evaluateArm(arm, corpus, query)`：复用现有 3-arm 评估逻辑
- `collectArmMetrics(arm, results)`：聚合单 arm 指标
- `summarizeMetrics(samples)`：mean/p50/p95/count

现有 benefit-eval 测试改为 import 这些 helper，消除重复。

#### 4.2 D2 — 长对话测试
**新文件**：`tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`

```typescript
// @vitest-environment node
describe("Phase 36 long conversation eval (30 turns)", () => {
  it("runs 30 turns × 4 queries with scripted LLM under 60s", () => {
    const result = runMultiTurnDriver({ turns: 30, queriesPerTurn: 4, ... });
    expect(result.turns).toHaveLength(30);
    // 性能门槛
    expect(totalDurationMs).toBeLessThan(60_000);
  });

  it("treatment recall@k >= baseline recall@k with statistical significance", () => {
    const result = runMultiTurnDriver({ ... });
    const recallBaseline = result.turns.map(t => t.baselineMetrics.recallAtK);
    const recallTreatment = result.turns.map(t => t.treatmentMetrics.recallAtK);
    const t = pairedTTest(recallBaseline, recallTreatment);
    expect(t.meanDiff).toBeGreaterThan(0);
    // 统计显著性（alpha=0.05）
    expect(t.significant).toBe(true);
  });

  it("bootstrap CI of treatment recall@k excludes baseline mean", () => {
    const result = runMultiTurnDriver({ ... });
    const recallTreatment = result.turns.map(t => t.treatmentMetrics.recallAtK);
    const ci = bootstrapConfidenceInterval(recallTreatment);
    const baselineMean = mean(result.turns.map(t => t.baselineMetrics.recallAtK));
    expect(ci.lower).toBeGreaterThan(baselineMean);
  });

  it("minimum sample size for d=0.2 is achievable within 30 turns", () => {
    const n = minimumSampleSize(0.2, 0.05, 0.8);
    expect(n).toBeLessThanOrEqual(30); // 30 轮 ≥ 最小样本量
  });

  it("raw leak rate and prompt injection rate remain 0 in treatment", () => {
    const result = runMultiTurnDriver({ ... });
    for (const turn of result.turns) {
      expect(turn.treatmentMetrics.rawLeakRate).toBe(0);
      expect(turn.treatmentMetrics.promptInjectionReturnRate).toBe(0);
    }
  });
});
```

#### 4.3 D3 — 报告生成器
**新文件**：`tests/unit/helpers/runtime-memory-eval-report.ts`

```typescript
export type EvalReport = {
  phase: "phase-36";
  generatedAt: number;
  turns: number;
  metrics: {
    baseline: MetricSummary;
    treatment: MetricSummary;
  };
  statistics: {
    pairedTTest: { t: number; pValue: number; significant: boolean; meanDiff: number };
    bootstrapCI: { mean: number; lower: number; upper: number };
    minimumSampleSize: number;
    cohensD: number;
  };
  thresholds: {
    p95LatencyMs: number;
    rawLeakRate: number;
    promptInjectionRate: number;
  };
  passed: boolean;
};

export function generateEvalReport(result: MultiTurnRunResult): EvalReport;
export function formatEvalReportText(report: EvalReport): string; // 人类可读
```

#### 4.4 D4 — package.json 脚本
**文件**：`openclaw_runtime/package.json`

在 `scripts` 追加：
```json
"eval:runtime-memory:long-conversation": "node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts"
```

---

### Wave 5 — E 规范

#### 5.1 E1 — task spec + rules
**新文件**：`harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md`

引用 `gateway-backend-communication`（本工作涉及 runtime-core/agents 路径）。包含：
- 目标：B 收尾 + C 基础 + C 评估 + D 流水线
- 必需 rules：`runtime-memory-read-hydration-authority-boundary`、`runtime-memory-read-hydration-shadow-only-opt-in`、`runtime-memory-read-hydration-test-research-breakthrough`
- 验收：`pnpm run tsgo:core` 触及文件零新增错误；长对话测试通过；统计显著性达成；harness validate 通过

**新文件**：`harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md`
规则：testResearchOnly breakthrough 仅在显式 opt-in + test 环境下启用；注入物为 sanitized projection；不写持久化；不改 provider ordering；delta 计数可测但 authority 边界不变。

---

### Wave 6 — 验证

1. `pnpm run tsgo:core` — 确认 4 个 memory-read-hydration-shadow.ts 错误消失，触及文件零新增错误
2. `pnpm test:fast` — 跑触及相关的 vitest
3. `pnpm eval:runtime-memory:long-conversation` — 长对话测试通过
4. `pnpm harness validate --spec phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval` — harness 校验

---

## 四、假设与决策（Assumptions & Decisions）

1. **预存类型错误不在本次范围**：仓库 `tsgo:core` 存在大量预存错误（orchestrator、nodes-tool-media、verseshell 等），本次只保证**触及文件**零新增错误。验证方式：对比 Wave 1 前后的 memory-read-hydration-shadow.ts 错误数。
2. **Scripted LLM 不接入真实 provider**：所有评估用确定性脚本，CI 内零网络。这是 Phase 35 spec 的硬边界。
3. **breakthrough 不改 authority 契约**：`noPromptContextModelMessageInjection` 等边界保持 `true`；breakthrough 只影响 metrics delta 计数与 fact 注入可见性，不改持久化/provider ordering。
4. **bootstrap 确定性**：固定 seed 的 mulberry32 RNG，保证 CI 可重放。同 seed → 同 CI。
5. **最小样本量 197 vs 30 轮**：Cohen's d=0.2 时最小样本量 ≈ 197，但 30 轮 × 多 query 可达 120 样本。决策：若 d 实测 > 0.4（中等效应），30 轮即可达 power>=0.8；测试中用实测 d 判定，并在报告中标注「若 d<0.4 需扩大轮数」。
6. **D1 抽取不破坏现有测试**：现有 benefit-eval 测试改为复用 helper 后，断言不变。
7. **TaskLoopControllerDeps 全可选**：多回合驱动器只注入需要的子集（runObserved / selfCheck / runtimeMemoryReadHydrationShadowOnly），其余走默认。

---

## 五、验证步骤（Verification Steps）

| 步骤 | 命令 | 期望 |
|------|------|------|
| 1 | `pnpm run tsgo:core 2>&1 \| findstr memory-read-hydration-shadow` | 0 行输出（4 错误已修复） |
| 2 | `pnpm test:fast` | 全绿 |
| 3 | `pnpm test:fast -- tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts` | 全绿 |
| 4 | `pnpm test:fast -- tests/unit/runtime-memory-eval-statistics.test.ts` | 全绿 |
| 5 | `pnpm test:fast -- tests/unit/runtime-memory-eval-scripted-llm.test.ts` | 全绿 |
| 6 | `pnpm eval:runtime-memory:long-conversation` | 5 个 it 全绿，总时长 < 60s |
| 7 | `pnpm harness validate --spec phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval` | 通过 |

---

## 六、文件清单（15 新 + 5 改）

### 新建（15）
1. `openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts`（C1）
2. `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts`（C6）
3. `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts`（C4）
4. `tests/unit/helpers/runtime-memory-eval-helpers.ts`（D1）
5. `tests/unit/helpers/runtime-memory-eval-report.ts`（D3）
6. `tests/unit/runtime-memory-eval-scripted-llm.test.ts`（C1 测试）
7. `tests/unit/runtime-memory-eval-statistics.test.ts`（C6 测试）
8. `tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts`（C2 测试）
9. `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`（D2）
10. `harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md`（E1）
11. `harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md`（E1）

### 修改（5）
1. `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`（Wave 1.1 修复 4 类型错误）
2. `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`（Wave 1.2 B7 sentinel 复用 + delta wiring + C2 breakthrough）
3. `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts`（D1 复用 helper）
4. `openclaw_runtime/package.json`（D4 脚本）
5. `openclaw_runtime/src/runtime-core/index.ts`（若需要 re-export 新模块，按需）

---

## 七、执行顺序（推荐 Todo）

1. Wave 1.1 — 修复 4 类型错误 → tsgo 验证
2. Wave 1.2 — B7 sentinel 复用 + delta wiring → 跑现有 taskloop 测试
3. Wave 2.1 — C1 Scripted LLM + 测试
4. Wave 2.2 — C2 testResearchOnly breakthrough + 测试
5. Wave 3.1 — C6 统计模块 + 测试
6. Wave 3.2 — C4 多回合驱动器
7. Wave 4.1 — D1 eval-helpers 抽取 + 改造现有测试
8. Wave 4.2 — D2 长对话测试
9. Wave 4.3 — D3 报告生成器
10. Wave 4.4 — D4 package.json 脚本
11. Wave 5 — E1 task spec + rules
12. Wave 6 — 全量验证
