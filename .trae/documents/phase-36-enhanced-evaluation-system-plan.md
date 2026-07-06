# Phase 36 Enhanced Evaluation System — Implementation Plan

## Summary

补齐现有 runtime-memory 评测体系缺失的 5 个维度的测评标准，修复 `cohensD` 零方差不一致 bug，构建增强版报告生成器，运行深度复测，并输出量化结果与优化方案。当前体系仅覆盖 "30 轮独立查询的 recall@k 统计显著性" 一个维度，对真实开发环境映射率仅约 30%；本计划完成后映射率预期提升至 ~70%。

## Current State Analysis

### 已有评测能力（Phase 35/36 baseline）

| 维度 | 文件 | 状态 |
|---|---|---|
| 单次 benefit-eval（guarded recall@k、precision、hazard suppression、token overhead、latency） | `tests/unit/runtime-memory-read-hydration-benefit-eval.test.ts` | ✅ 完整 |
| 30 轮 A/B 长对话统计显著性（paired t-test、bootstrap CI、Cohen's d、min sample size） | `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts` | ✅ 完整 |
| Breakthrough 注入边界（authority gate、token truncation） | `tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts` | ✅ 完整 |
| 统计学纯函数库 | `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts` | ⚠️ 含 bug |
| 30 轮 A/B 驱动器 | `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts` | ✅ 完整 |
| 报告生成器 | `tests/unit/helpers/runtime-memory-eval-report.ts` | ✅ 完整 |
| 共享 fixture（1460 facts / 120 queries / 8 categories） | `tests/fixtures/runtime-memory-benefit-eval/` | ⚠️ 全部 `referenceTime=1000`，无时序多样性 |

### 已识别的 5 个测评标准缺口

1. **无对话链（Conversation Chain）** — 30 轮是 30 个独立查询，turn N 不依赖 N-1，无法评测"memory hydration 是否让后续轮次更准确"
2. **无 LLM 效用评分（LLM Utility）** — `ScriptedLlmDriver` 内容无关、响应被丢弃，无法评测"召回的事实是否真的提升了回答质量"
3. **无时序演化（Temporal Evolution）** — 全部 fixture `referenceTime=1000` 固定，无法评测"事实写入/失效后召回率随时间变化"
4. **无主题漂移（Topic Drift）** — 无跨主题干扰度量，无法评测"主题切换时旧主题事实是否污染新主题召回"
5. **无 token 预算压力（Budget Pressure）** — 默认预算 512 tokens 永不触顶，无法评测"预算紧张时的截断/选择质量"

### Cohen's d 零方差不一致 bug（必须先修）

`statistics.ts`:
- L364: `if (pooledStd === 0) return 0;` — 即使 `m2 - m1 ≠ 0` 也返回 0
- L201-211: `pairedTTest` 在同样情况下返回 `t: Infinity, significant: true`

两者对"零方差 + 非零均值差"的判定完全相反，导致 `cohensD=0` 但 `tTest.significant=true` 的矛盾报告。`minimumSampleSize(0)` 返回 `Infinity`，又进一步导致 `achieved=false` 与 `significant=true` 二次矛盾。

## Proposed Changes

### Step 1 — 修复 `statistics.ts` 零方差不一致

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts`

**改动 1**（L364 `cohensD`）:
```typescript
// BEFORE:
if (pooledStd === 0) return 0;
// AFTER:
if (pooledStd === 0) return m2 - m1 === 0 ? 0 : Number.POSITIVE_INFINITY;
```

**改动 2**（L267 `minimumSampleSize`，在 `if (d <= 0)` 之后新增）:
```typescript
if (!Number.isFinite(d)) return 1;
```

**Why**: 让 `cohensD` 与 `pairedTTest` 对"零方差 + 非零均值差"的判定一致（都视为强显著），并让 `minimumSampleSize` 在 `d=Infinity` 时返回最小可检样本数 1。

**验证**: 同步更新 `tests/unit/runtime-memory-eval-statistics.test.ts`，新增 2 个用例：
- `cohensD` 在零方差 + 非零均值差时返回 `Infinity`
- `minimumSampleSize(Infinity, 0.05, 0.8)` 返回 `1`

---

### Step 2 — 扩展 `runtime-memory-eval-helpers.ts`

**文件**: `tests/unit/helpers/runtime-memory-eval-helpers.ts`

**新增导出函数**（pure functions，无 vitest 依赖）:

```typescript
// 在运行时追加事实到既有 SQLite（用于时序演化与对话链）
export function appendFactToDb(dbPath: string, fact: RuntimeMemoryTemporalFact): void;

// 标记既有事实为 invalidated（用于时序演化）
export function invalidateFactInDb(dbPath: string, factId: string, invalidAt: number): void;

// 从 spec 构造时序事实（统一不同 valid_at/invalid_at/expired_at 模式）
export function buildTemporalFactFromSpec(spec: {
  factId: string;
  taskId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  validAt: number;
  invalidAt?: number;
  expiredAt?: number;
  referenceTime?: number;
  confidence?: number;
}): RuntimeMemoryTemporalFact;

// 将 LoadedFact lite 投影转为 ShadowFactProjection（chain-eval 与 budget-pressure 共用）
export function toProjectionFromLite(fact: LoadedFact): RuntimeMemoryHydrationShadowFactProjection;
```

**Why**: 时序演化驱动器需要在评测过程中动态写入/失效事实；chain-eval 与 budget-pressure 需要在内存中构造投影以避免重复打开 SQLite。所有函数保持 pure（无 vitest import），与既有 helpers 风格一致。

**验证**: 在每个新维度测试文件中通过实际调用验证；不单独写 helpers 测试文件（避免文件膨胀）。

---

### Step 3 — 新增维度 1：对话链评测 `chain-eval.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/chain-eval.ts`（新建）

**设计**:
- 构造 N 轮链式场景：turn 0 写入 `fact_chain_0`，turn 1 查询依赖 `fact_chain_0`，turn 2 查询依赖 `fact_chain_0 + fact_chain_1`，依此类推
- 每轮查询的 `expectedFactIds` = 累计所有前序轮次写入的事实
- 度量：
  - `chainRecall@k` = 累计命中 / 累计期望
  - `chainDepth` = 命中事实跨越的最大链深度
  - `chainGrowthRate` = 每轮新增命中 / 每轮新增期望

**核心导出**:
```typescript
export type ChainTurnPlan = {
  turn: number;
  writeFact: RuntimeMemoryTemporalFact;
  query: MultiTurnQueryPlan;
  expectedCumulativeFactIds: readonly string[];
};

export function buildChainScenario(options: {
  turns: number;
  taskId: string;
  baseSubject: string;
  basePredicate: string;
  referenceTime: number;
}): readonly ChainTurnPlan[];

export type ChainEvalResult = {
  turns: number;
  perTurn: ReadonlyArray<{
    turn: number;
    recall: number;
    depth: number;
    growthRate: number;
  }>;
  aggregateChainRecall: number;
  maxDepth: number;
  meanGrowthRate: number;
};

export function evaluateChain(
  scenario: readonly ChainTurnPlan[],
  diagnostics: ReadonlyArray<ReturnType<typeof buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics>>,
): ChainEvalResult;
```

**Why**: 填补"turn N 不依赖 N-1"缺口，直接度量 memory hydration 在链式上下文中的累积价值。

**测试**: `tests/unit/runtime-memory-eval-chain-eval.test.ts`（新建，6 用例）
- 4 轮链式场景构造正确
- 基线（空 DB）chainRecall=0
- 处理组（前序事实全部 seed）chainRecall=1，maxDepth=3
- 部分缺失（仅 seed 偶数轮）chainRecall≈0.5
- chainDepth 单调不减
- growthRate 在新增期望非零时 ∈ [0, 1]

---

### Step 4 — 新增维度 2：LLM 效用评分 `utility-scorer.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/utility-scorer.ts`（新建）

**设计**:
- **确定性 LLM 效用代理**（不调用真实 LLM，避免 flaky 与成本）
- 输入：召回事实集合 + 参考答案（含 ground-truth 事实 ID 列表）
- 评分公式：`utilityScore = sqrt(factCoverage × answerCompleteness)`
  - `factCoverage` = 召回事实中出现在参考答案事实 ID 集合中的比例
  - `answerCompleteness` = 召回事实覆盖参考答案 fact-id 列表的比例
- 几何平均确保"召回很多但都不相关"和"召回正确但不完整"都受惩罚

**核心导出**:
```typescript
export type UtilityScoreInput = {
  recalledFactIds: readonly string[];
  referenceFactIds: readonly string[];
};

export type UtilityScoreResult = {
  factCoverage: number;
  answerCompleteness: number;
  utilityScore: number;
  matchedFactIds: readonly string[];
  missingFactIds: readonly string[];
  extraneousFactIds: readonly string[];
};

export function scoreUtility(input: UtilityScoreInput): UtilityScoreResult;

export type UtilityEvalResult = {
  perQuery: ReadonlyArray<UtilityScoreResult>;
  meanUtility: number;
  p50Utility: number;
  p95Utility: number;
  meanCoverage: number;
  meanCompleteness: number;
};

export function aggregateUtility(
  perQuery: ReadonlyArray<UtilityScoreResult>,
): UtilityEvalResult;
```

**Why**: 填补"ScriptedLlm 响应被丢弃，无法度量记忆效用"缺口。确定性代理避免真实 LLM 的 flaky 与成本，同时保留"召回正确性 → 回答效用"的因果映射。`qa-lab/character-eval.ts` 的 LLM-as-judge 模式留作后续真实 LLM 升级路径，本期不接入。

**测试**: `tests/unit/runtime-memory-eval-utility-scorer.test.ts`（新建，7 用例）
- 完全匹配：utilityScore=1
- 完全空召回：utilityScore=0
- 部分匹配：utilityScore = sqrt(0.5 × 0.5) = 0.5
- 召回正确但有多余：factCoverage=0.5（2/4），answerCompleteness=1.0（4/4）→ utilityScore = sqrt(0.5)
- 召回正确但不完整：factCoverage=1.0（4/4），answerCompleteness=0.5（4/8）→ utilityScore = sqrt(0.5)
- 几何平均惩罚：验证 sqrt 公式而非算术平均
- aggregateUtility 统计正确

---

### Step 5 — 新增维度 3：时序演化评测 `temporal-evolution-driver.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/temporal-evolution-driver.ts`（新建）

**设计**:
- 时钟随轮次移动：`referenceTime = turn × STEP`（STEP=100）
- 中途写入新事实（turn=2 时 `appendFactToDb`）
- 中途失效既有事实（turn=4 时 `invalidateFactInDb`）
- 每轮对同一组查询求 recall@k，观察 recall 随时间变化
- 度量：
  - `recallBeforeWrite`（turn 0-1 均值）
  - `recallAfterWrite`（turn 2-3 均值）
  - `recallAfterInvalidate`（turn 4+ 均值）
  - `writeEffect` = recallAfterWrite − recallBeforeWrite
  - `invalidateEffect` = recallAfterInvalidate − recallAfterWrite

**核心导出**:
```typescript
export type TemporalEvolutionOptions = {
  turns: number;
  stepMs: number;
  taskId: string;
  initialFacts: readonly RuntimeMemoryTemporalFact[];
  writeAtTurn: number;
  writeFact: RuntimeMemoryTemporalFact;
  invalidateAtTurn: number;
  invalidateFactId: string;
  query: MultiTurnQueryPlan;
  databasePath: string;
  config?: unknown;
};

export type TemporalEvolutionResult = {
  perTurn: ReadonlyArray<{ turn: number; referenceTime: number; recall: number }>;
  recallBeforeWrite: number;
  recallAfterWrite: number;
  recallAfterInvalidate: number;
  writeEffect: number;
  invalidateEffect: number;
};

export function runTemporalEvolution(options: TemporalEvolutionOptions): TemporalEvolutionResult;
```

**Why**: 填补"全部 fixture referenceTime=1000 固定，无时序变化"缺口。直接度量"写入是否生效、失效是否生效"的运行时语义。

**测试**: `tests/unit/runtime-memory-eval-temporal-evolution.test.ts`（新建，7 用例）
- 初始无事实：recallBeforeWrite=0
- 写入后召回提升：writeEffect > 0
- 失效后召回下降：invalidateEffect < 0
- referenceTime 单调递增
- writeAtTurn=2 时 turn 2 立即生效
- invalidateAtTurn=4 时 turn 4 立即生效
- 全程空 DB（无写入、无失效）recall 恒为 0

---

### Step 6 — 新增维度 4：主题漂移评测 `topic-drift-eval.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/topic-drift-eval.ts`（新建）

**设计**:
- 构造 K 个主题段（默认 K=3，每段 4 轮，共 12 轮）
- 每段对应独立 subject（subjectA、subjectB、subjectC）
- 每段第一轮写入该主题事实，后续轮次查询该主题
- 度量：
  - `perTopicRecall` = 每段 recall 均值
  - `crossTopicInterference` = 主题 A 的查询错误命中主题 B 事实的比例
  - `driftRecoveryTime` = 切换主题后召回率回到 ≥0.8 所需轮次

**核心导出**:
```typescript
export type TopicSegment = {
  topicId: string;
  subject: string;
  turns: number;
  writeFact: RuntimeMemoryTemporalFact;
  queries: readonly MultiTurnQueryPlan[];
};

export function buildTopicSegments(options: {
  topicCount: number;
  turnsPerTopic: number;
  taskId: string;
  referenceTime: number;
}): readonly TopicSegment[];

export type TopicDriftResult = {
  perTopicRecall: ReadonlyArray<{ topicId: string; recall: number }>;
  crossTopicInterference: number;
  driftRecoveryTime: number;
  totalTurns: number;
};

export function evaluateTopicDrift(
  segments: readonly TopicSegment[],
  diagnostics: ReadonlyArray<ReturnType<typeof buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics>>,
): TopicDriftResult;
```

**Why**: 填补"无跨主题干扰度量"缺口。直接度量 subject 过滤是否在主题切换时正确隔离旧主题事实。

**测试**: `tests/unit/runtime-memory-eval-topic-drift.test.ts`（新建，6 用例）
- 3 段场景构造正确（topicCount=3, turnsPerTopic=4）
- 每段独立 DB seed：perTopicRecall 全部 = 1
- 段间 DB 不共享：crossTopicInterference = 0
- 单段失败：人为删除主题 B 事实 → B 段 recall=0
- driftRecoveryTime 在切换后立即恢复时 = 1
- 段数与轮数一致性校验

---

### Step 7 — 新增维度 5：Token 预算压力评测 `budget-pressure-eval.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/budget-pressure-eval.ts`（新建）

**设计**:
- 构造 50 条事实，每条约 12 tokens（总 ~600 tokens）
- 三档预算：tight=64、medium=256、loose=1024
- 度量：
  - `budgetUtilization` = acceptedTokens / budget
  - `truncationRate` = rejectedByBudget / totalCandidates
  - `selectionQuality` = accepted 中期望事实占比（precision）
  - `budgetElasticity` = recall@k 增量 / 预算增量（跨档对比）

**核心导出**:
```typescript
export type BudgetTier = "tight" | "medium" | "loose";

export type BudgetPressureOptions = {
  factCount: number;
  tokensPerFact: number;
  tiers: readonly BudgetTier[];
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  expectedFactIds: readonly string[];
  databasePath: string;
  config?: unknown;
};

export type BudgetTierResult = {
  tier: BudgetTier;
  budget: number;
  acceptedFactCount: number;
  rejectedByBudgetCount: number;
  acceptedTokens: number;
  budgetUtilization: number;
  truncationRate: number;
  recall: number;
  precision: number;
};

export type BudgetPressureResult = {
  perTier: ReadonlyArray<BudgetTierResult>;
  budgetElasticity: ReadonlyArray<{ from: BudgetTier; to: BudgetTier; elasticity: number }>;
};

export function runBudgetPressure(options: BudgetPressureOptions): BudgetPressureResult;
```

**Why**: 填补"默认预算 512 永不触顶"缺口。直接度量"预算紧张时 consumer 的截断与选择质量"，验证 `token_budget_exceeded` 拒绝路径的正确性。

**测试**: `tests/unit/runtime-memory-eval-budget-pressure.test.ts`（新建，7 用例）
- tight=64 触发截断：truncationRate > 0
- loose=1024 不触发截断：truncationRate = 0
- budgetUtilization 随预算减小而上升
- recall 随预算增加而上升
- precision 在 tight 档 ≥ medium 档（截断保留高优先级）
- budgetElasticity 从 tight→loose 为正
- 三档全部接受 0 期望事实时 recall=0（边界）

---

### Step 8 — 增强版报告生成器 `enhanced-report.ts`

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/enhanced-report.ts`（新建）

**设计**:
- 包装 5 个维度的结果为统一 `EnhancedReport`
- 提供 `analyzeDimension(name, result)` 包装器，附加 `achieved` 判定
- Markdown 格式化输出所有维度对比表
- 保留与既有 `runtime-memory-eval-report.ts` 的兼容性（不修改原文件）

**核心导出**:
```typescript
export type DimensionName =
  | "longConversation"
  | "chain"
  | "utility"
  | "temporalEvolution"
  | "topicDrift"
  | "budgetPressure";

export type EnhancedReport = {
  generatedAt: number;
  dimensions: ReadonlyArray<{
    name: DimensionName;
    achieved: boolean;
    summary: string;
    metrics: Record<string, number>;
  }>;
  overallAchieved: number; // 0-1，达成维度数 / 总维度数
  overallMappingScore: number; // 0-1，对真实开发环境映射率
};

export function analyzeDimension(
  name: DimensionName,
  result: unknown,
): { achieved: boolean; summary: string; metrics: Record<string, number> };

export function buildEnhancedReport(
  dimensions: ReadonlyArray<{ name: DimensionName; result: unknown }>,
): EnhancedReport;

export function formatEnhancedReportAsMarkdown(report: EnhancedReport): string;
```

**Why**: 统一 5 维度结果格式，提供单一入口的量化对比与"映射率"评分。`overallMappingScore` 直接回应用户"是否能够一定程度上映射真实开发环境"的问题。

**测试**: `tests/unit/runtime-memory-eval-enhanced-report.test.ts`（新建，5 用例）
- 单维度达成：overallAchieved=1
- 单维度未达成：overallAchieved=0
- 6 维度部分达成：overallAchieved = 达成数/6
- Markdown 输出包含所有维度表格
- overallMappingScore 在所有维度达成时 ≥ 0.7

---

### Step 9 — 集成脚本与深度复测

**文件**: `package.json`

**改动**: 新增脚本（在既有 `eval:runtime-memory:long-conversation` 旁边）
```json
"eval:runtime-memory:enhanced": "pnpm exec vitest run tests/unit/runtime-memory-eval-*.test.ts --reporter=verbose"
```

**深度复测执行计划**（实现完成后运行）:
1. `pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts --reporter=verbose` — 验证 Step 1
2. 逐维度测试（5 个新测试文件）— 验证 Step 3-7
3. `pnpm exec vitest run tests/unit/runtime-memory-eval-enhanced-report.test.ts --reporter=verbose` — 验证 Step 8
4. `pnpm eval:runtime-memory:enhanced` — 全量 6 维度复测
5. `pnpm exec vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts --reporter=verbose` — 回归既有长对话测试
6. `pnpm run typecheck` — 类型检查（含 tsgo:core 路径）

**量化结果输出**:
- 每维度 mean/p50/p95 + achieved 标志
- 6 维度 overallAchieved 比例
- overallMappingScore（预期从 ~0.30 提升至 ~0.70）

**优化方案输出**:
- 基于复测结果识别未达成维度
- 针对 `rejectedFactCount=351/turn` 等 SQL 全表扫描问题给出"在 SQL 层加 WHERE task_id/subject/predicate 过滤"的具体优化建议
- 针对"utility-scorer 仅确定性代理"给出"接入 qa-lab LLM-as-judge 真实评分"的后续升级路径
- 针对"chain-eval 仅 4 轮"给出"扩展至 16 轮 + 跨 session 持久化"的后续优化方向

## Assumptions & Decisions

1. **确定性 LLM 效用代理 vs 真实 LLM-as-judge**: 本期选择确定性代理，避免 flaky 与 API 成本；`qa-lab/character-eval.ts` 的真实 LLM judge 模式留作后续升级路径。决策依据：评测体系本身需要可复现，真实 LLM 引入会破坏统计显著性的可重复性。
2. **不修改既有 `runtime-memory-eval-report.ts`**: 保持向后兼容，新增 `enhanced-report.ts` 并行存在。
3. **不修改 `multi-turn-driver.ts`**: 5 个新维度各自独立驱动器，避免污染既有 30 轮 A/B 路径。
4. **新维度全部使用 shadow diagnostics 路径**: 与 Phase 35/36 一致，不引入真实 prompt injection。
5. **helpers 扩展而非新建 helpers 文件**: 复用 `runtime-memory-eval-helpers.ts` 既有 `createTempDbPath`、`seedTempDb` 等函数。
6. **package.json 脚本路径用 glob `runtime-memory-eval-*.test.ts`**: 自动包含未来新增的同前缀测试文件。
7. **不写 harness spec**: 本期是评测体系增强，不引入新用户可见场景；harness spec 留待优化方案落地后再补。

## Verification Steps

实现完成后按顺序执行：

1. **Step 1 验证**:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts --reporter=verbose
   ```
   预期：原有用例全过 + 2 新用例全过

2. **Step 3-7 逐维度验证**（5 个新测试文件，并行可执行）:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-eval-chain-eval.test.ts --reporter=verbose
   pnpm exec vitest run tests/unit/runtime-memory-eval-utility-scorer.test.ts --reporter=verbose
   pnpm exec vitest run tests/unit/runtime-memory-eval-temporal-evolution.test.ts --reporter=verbose
   pnpm exec vitest run tests/unit/runtime-memory-eval-topic-drift.test.ts --reporter=verbose
   pnpm exec vitest run tests/unit/runtime-memory-eval-budget-pressure.test.ts --reporter=verbose
   ```
   预期：每文件 6-7 用例全过

3. **Step 8 验证**:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-eval-enhanced-report.test.ts --reporter=verbose
   ```
   预期：5 用例全过

4. **全量复测**:
   ```
   pnpm eval:runtime-memory:enhanced
   ```
   预期：所有 6 维度测试 + 既有长对话测试全过

5. **回归检查**:
   ```
   pnpm exec vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts tests/unit/runtime-memory-read-hydration-benefit-eval.test.ts --reporter=verbose
   ```
   预期：39 既有用例 + 新增用例全过

6. **类型检查**:
   ```
   pnpm run typecheck
   ```
   预期：0 错误（含 tsgo:core 路径）

7. **量化结果与优化方案输出**:
   - 收集 6 维度测试输出中的 metric 数值
   - 计算 overallAchieved 与 overallMappingScore
   - 在最终响应中给出量化对比表 + 优化方案

## Implementation Sequence（执行顺序）

1. Step 1: `statistics.ts` 修复 + 测试更新
2. Step 2: `runtime-memory-eval-helpers.ts` 新增 4 个 helper
3. Step 3: `chain-eval.ts` + 测试
4. Step 4: `utility-scorer.ts` + 测试
5. Step 5: `temporal-evolution-driver.ts` + 测试
6. Step 6: `topic-drift-eval.ts` + 测试
7. Step 7: `budget-pressure-eval.ts` + 测试
8. Step 8: `enhanced-report.ts` + 测试
9. Step 9: `package.json` 脚本 + 全量深度复测 + 量化结果 + 优化方案

每步独立可验证，前后依赖关系：Step 2 依赖 Step 1（helpers 不依赖 statistics 修复，但时序上先做 statistics 修复更安全）；Step 3-7 依赖 Step 2（使用新 helpers）；Step 8 依赖 Step 3-7（包装 5 维度结果）；Step 9 依赖 Step 8（运行全量复测）。
