# Phase 36 剩余 Waves 执行计划 (4.1验证 → 4.2 → 4.3 → 4.4 → 5 → 6)

## 概要

继续 Phase 36 "运行时内存读取水合 — 长对话统计显著性评估" 的剩余工作。前序已完成 Wave 3.1 (statistics.ts + 13 测试)、Wave 3.2 (multi-turn-driver.ts)、Wave 4.1 (runtime-memory-eval-helpers.ts + 重写 benefit-eval 测试)、Wave 2.2 (test-research-breakthrough 测试)。本计划覆盖剩余的 Wave 4.1 验证、4.2 长对话测试、4.3 报告生成器、4.4 package.json 脚本、5 任务规范、6 全面验证。

## 当前状态分析

### 已完成 (验证通过)
- `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts` — mulberry32、bootstrap CI、paired t-test、minimumSampleSize、cohensD
- `tests/unit/runtime-memory-eval-statistics.test.ts` — 13 测试用例,已验证通过
- `openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts` — ScriptedLlmDriver
- `tests/unit/runtime-memory-eval-scripted-llm.test.ts` — ScriptedLlm 驱动测试
- `tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts` — 突破注入门测试

### 已创建但需验证/修改
- `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts` — **需要修改**:当前两个 arm 共用单一 `databasePath`,且 `testResearchOnlyBreakthrough` 仅添加摘要不改变 metrics,导致 baseline 与 treatment 产生相同 recall@K,无法通过统计显著性断言
- `tests/unit/helpers/runtime-memory-eval-helpers.ts` — 已创建,需验证
- `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` — 已重写使用 helpers,需验证无回归

### 关键发现 (来自 Phase 1 探索)
阅读 `task-loop-runtime-memory-read-hydration-shadow.ts` 第 424-442 行确认:
- `consumeQuery` 调用 `consumeRuntimeMemoryHydrationFacts`,无论 `testResearchOnlyBreakthrough` 是否为 true,返回的 `acceptedFacts`/`truePositiveCount` 完全相同
- `summarizeBreakthroughInjection` (第 445-471 行) 仅在 `breakthroughEnabled && injection.enabled` 时生成摘要,不修改 queries 结果
- 因此 multi-turn-driver 当前的 baseline 与 treatment arm 的 recall@K/precision/latencyMs/tokenOverhead 完全相同,paired t-test 无法检测到显著差异

**修复方案**:将 `databasePath: string` 拆分为 `baselineDatabasePath` + `treatmentDatabasePath`。baseline DB 只 migrate 不 seed facts (模拟"无内存"),treatment DB seed 匹配查询的 facts (模拟"有内存")。两个 arm 都走完整 hydration 路径 (status="loaded"),保证 `diagnostics.queries` 均被填充,baseline recall=0、treatment recall>0,产生清晰统计信号。

## 提议变更

### Step 1 — Wave 4.1 验证 (无代码变更)

运行已重写的 benefit-eval 测试确认 helpers 提取无回归:

```
pnpm exec vitest run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts --reporter=verbose
```

**通过标准**:7 个 it 块全绿,包括 corpus 规模断言、三 arm 比较、hazard 抑制、纯消费者延迟 < 50ms、temp SQLite 延迟 < 50ms、空 no-op 安全、纯函数无副作用。

### Step 2 — Wave 4.2 修改 multi-turn-driver + 创建长对话测试

#### 2a. 修改 `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts`

**变更**: `MultiTurnDriverOptions` 类型与 `runArm` 函数

- 将 `databasePath: string` 替换为 `baselineDatabasePath: string` 和 `treatmentDatabasePath: string`
- `runArm` 中根据 arm 选择对应 DB 路径:
  ```typescript
  const databasePath = arm === "baseline"
    ? options.baselineDatabasePath
    : options.treatmentDatabasePath;
  ```
- 两个 arm 均设 `testResearchOnly: true`、`explicitOptIn: true`,treatment 额外设 `testResearchOnlyBreakthrough: true`
- 保持 `summarizeBreakthroughInjection` 行为不变 (仅 treatment 生成摘要)

**理由**: 使 baseline (空 DB) 与 treatment (seeded DB) 产生不同的 recall@K,为统计显著性测试提供真实信号。

#### 2b. 创建 `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`

**5 个测试用例**:

1. **"30 turns × 4 queries with scripted LLM completes under 60s"**
   - 创建 baseline 空 DB (仅 migrate)
   - 创建 treatment DB,seed 8 个 fact groups (复用 `pickMemoryDependentGroups(8, facts)`)
   - 构建 120 个 `MultiTurnQueryPlan` (30 turns × 4 queries),从 `queries` fixture 中取 memoryRelevant 子集,循环填充
   - 构建 `ScriptedLlmDriver`,为 baseline 和 treatment 各注册 120 个响应 (30 turns × 4 queries)
   - 调用 `runMultiTurnDriver`
   - 断言 `result.turnCount === 30`、`result.queriesPerTurn === 4`、`result.totalDurationMs < 60000`

2. **"treatment recall@k >= baseline recall@k with paired t-test significance"**
   - 提取 `result.turns.map(t => t.baseline.recallAtK)` 与 `t.treatment.recallAtK`
   - 调用 `pairedTTest(baselineRecalls, treatmentRecalls)`
   - 断言 `result.significant === true`、`result.pValue < 0.05`、`result.meanDiff > 0`
   - 断言 `mean(treatmentRecalls) > mean(baselineRecalls)`

3. **"bootstrap CI of treatment recall@k excludes baseline mean"**
   - 调用 `bootstrapConfidenceInterval(treatmentRecalls, { seed: 0x1a2b3c4d })`
   - 断言 `ci.lower > mean(baselineRecalls)` (CI 下界高于 baseline 均值)

4. **"minimum sample size for observed cohensD is achievable within 30 turns"**
   - 调用 `cohensD(baselineRecalls, treatmentRecalls)` 得到效应量 d
   - 调用 `minimumSampleSize(d, 0.05, 0.8)` 得到所需样本量
   - 断言 `minimumSampleSize <= 30` (30 轮足够检测到该效应)

5. **"raw leak rate and prompt injection rate remain 0 in treatment"**
   - 提取 treatment arm 的 `rawLeakRate` 与 `promptInjectionReturnRate` (每轮)
   - 断言所有轮次均为 0
   - 同时验证 `aggregateTreatment.rawLeakRate.mean === 0`、`aggregateTreatment.promptInjectionReturnRate.mean === 0`

**测试结构**:
- `afterEach` 关闭 DB 连接、清理 tempDirs (复用 helpers 模式)
- 使用 `loadEvalFixtures()` 加载 facts/queries
- 使用 `createTempDbPath` + `seedTempDb` 创建 treatment DB
- 使用 `createTempDbPath` + 仅 `createRuntimeMemoryPersistenceStore().migrate()` 创建 baseline 空 DB
- 复用 `toPersistenceRecord`、`pickMemoryDependentGroups` from helpers

### Step 3 — Wave 4.3 创建报告生成器

#### 创建 `tests/unit/helpers/runtime-memory-eval-report.ts`

纯函数模块,无 vitest 依赖。导出:

```typescript
export type LongConversationReport = {
  generatedAt: number;
  turns: number;
  queriesPerTurn: number;
  totalDurationMs: number;
  metrics: ReadonlyArray<{
    metric: string;
    baselineMean: number;
    baselineP50: number;
    baselineP95: number;
    treatmentMean: number;
    treatmentP50: number;
    treatmentP95: number;
    delta: number;
  }>;
  statistics: {
    pairedTTest: PairedTTestResult;
    bootstrapCI: BootstrapCIResult;
    cohensD: number;
    minimumSampleSize: number;
  };
  conclusion: {
    significant: boolean;
    effectSizeLabel: "negligible" | "small" | "medium" | "large";
    achieved: boolean;
  };
};

export function generateLongConversationReport(
  result: MultiTurnRunResult,
  options?: { now?: () => number; seed?: number },
): LongConversationReport;

export function formatReportAsMarkdown(report: LongConversationReport): string;
```

**实现要点**:
- `generateLongConversationReport`: 从 `result.turns` 提取 baseline/treatment 的 recallAtK 数组,运行 `pairedTTest`、`bootstrapConfidenceInterval`、`cohensD`、`minimumSampleSize`
- `formatReportAsMarkdown`: 生成 markdown 表格,包含 per-metric 对比、统计摘要、结论
- Cohen's d 效应量标签: <0.2 negligible、<0.5 small、<0.8 medium、>=0.8 large

### Step 4 — Wave 4.4 添加 package.json 脚本

#### 修改 `package.json` (repo root)

在 `scripts` 中添加 (在 `runtime:memory:hydrate-shadow` 之后):

```json
"eval:runtime-memory:long-conversation": "pnpm exec vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts --reporter=verbose"
```

**理由**: 复用 vitest 运行器,CI 友好,无需额外 TS 编译步骤。报告生成器在测试内部使用,测试通过即证明评估成功。

### Step 5 — Wave 5 创建 harness 任务规范

#### 创建 `harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md`

遵循 Phase 35 spec 格式,包含 frontmatter:
- `id: phase-36-runtime-memory-long-conversation-statistical-eval`
- `title: Phase 36 runtime memory long conversation statistical evaluation`
- `scenario: gateway-backend-communication`
- `taskType: runtime-bridge`
- `intent:` 描述 30 轮长对话 A/B 评估,统计显著性,无产品切换
- `ownedPaths:` 列出所有新增/修改文件
- `touchedAreas:` 列出所有触及路径
- `expectedUserBehavior:` 默认 TaskLoop 行为不变,Phase 36 仅是 mock 评估
- `requiredProfiles: [fast]`
- `requiredRules:` 引用现有相关规则
- `forbiddenPatterns:` 禁止默认运行时切换、真实 LLM 调用、产品切换
- `corpusGate:` controlled_fixture、sanitized、noUserRealData、reproducible
- `privacyRetentionGate:` 无原始材料、仅聚合指标、noUserRuntimeDbRead
- `rollbackGate:` 单一移除路径
- `metricsGate:` 统计显著性阈值 (paired t-test p<0.05、bootstrap CI 排除 baseline 均值、Cohen's d>0、minimumSampleSize<=30、rawLeakRate=0、promptInjectionReturnRate=0)
- `rollback:` 移除文件清单
- `requiredTests:` vitest 运行命令、tsgo 类型检查、harness validate

### Step 6 — Wave 6 全面验证

依次运行:

1. **Wave 4.1 验证**:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts --reporter=verbose
   ```

2. **Wave 4.2 验证** (修改 driver 后):
   ```
   pnpm exec vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts --reporter=verbose
   ```
   通过标准:5 个 it 块全绿,总时长 < 60s

3. **Wave 4.3 验证** (报告生成器):
   - 报告生成器作为纯函数,由 Wave 4.2 测试间接验证 (测试中使用 `generateLongConversationReport` 并断言关键字段)
   - 无独立测试文件

4. **回归验证**:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts tests/unit/runtime-memory-eval-scripted-llm.test.ts tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts --reporter=verbose
   ```
   通过标准:所有现有测试无回归

5. **类型检查**:
   ```
   cd openclaw_runtime && pnpm tsgo:core
   ```
   通过标准:无类型错误

6. **harness validate**:
   ```
   pnpm harness validate --spec harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md --no-diff
   ```
   通过标准:结构验证通过

## 假设与决策

1. **A/B 信号来源**: baseline 空 DB (recall=0) vs treatment seeded DB (recall>0)。不依赖 `testResearchOnlyBreakthrough` 改变 metrics,仅将其作为 treatment arm 的标记。

2. **ScriptedLlmDriver 响应**: 每轮每 arm 消费 1 个响应 (driver 在 `runArm` 开头调用 `respondForArm`)。30 turns × 1 response/turn = 30 responses/arm。响应内容不影响 hydration metrics (仅验证集成)。

3. **查询填充**: 120 个 `MultiTurnQueryPlan` 从 `queries` fixture 的 memoryRelevant 子集循环取用,确保 `expectedFactIds` 与 treatment DB 中的 facts 匹配。

4. **报告生成器位置**: 放在 `tests/unit/helpers/` 而非 `openclaw_runtime/src/agents/runtime-memory-eval/`,因为它是测试辅助工具,不进入运行时产物。

5. **package.json 脚本**: 使用 `pnpm exec vitest run` 而非独立 `.mjs` 脚本,避免 TS 编译复杂性,CI 友好。

6. **不更新 README**: Phase 36 是内部评估工具,无用户可见行为变化,不触发 doc sync 规则。harness 任务规范本身即为文档。

7. **统计显著性方向**: 单侧检验 (treatment > baseline),`pairedTTest` 返回 `significant` 基于 `pValue < alpha` 且 `meanDiff > 0`。

## 文件清单

### 新建文件 (4 个)
1. `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts` — 长对话评估测试 (5 cases)
2. `tests/unit/helpers/runtime-memory-eval-report.ts` — 报告生成器 (纯函数)
3. `harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md` — 任务规范

### 修改文件 (3 个)
1. `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts` — 拆分 per-arm DB 路径
2. `package.json` — 添加 `eval:runtime-memory:long-conversation` 脚本
3. (可选) `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts` 中使用报告生成器

## 验证步骤

按 Step 6 顺序执行,任一步骤失败则停止并修复。最终通过标准:
- Wave 4.1: benefit-eval 测试 7 个 it 全绿
- Wave 4.2: 长对话测试 5 个 it 全绿,总时长 < 60s
- Wave 4.3: 报告生成器被长对话测试间接验证
- Wave 4.4: `pnpm run eval:runtime-memory:long-conversation` 可执行
- Wave 5: harness validate 结构通过
- Wave 6: 所有现有测试无回归 + tsgo:core 类型检查通过
