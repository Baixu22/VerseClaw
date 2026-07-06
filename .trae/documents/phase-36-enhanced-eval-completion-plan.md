# Phase 36 增强评测系统 — 补齐剩余维度并深度重测

## Summary

继续执行已批准的 9 步增强评测计划。Steps 1-5 已完成（statistics 修复、helpers、chain-eval、utility-scorer、temporal-evolution-driver）。本计划覆盖剩余的 Steps 6-9：验证 topic-drift（已创建但未运行）、实现 budget-pressure-eval（维度 5）、实现 enhanced-report（聚合 6 维度报告）、添加 package.json 脚本并执行全量深度重测，最终输出量化结果和优化方案。

## Current State Analysis

### 已完成（Steps 1-5）
- `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts` — Cohen's d 零方差修复 ✅
- `tests/unit/helpers/runtime-memory-eval-helpers.ts` — 4 个新 helper 函数 ✅
- `openclaw_runtime/src/agents/runtime-memory-eval/chain-eval.ts` + test — 链式对话评测 ✅
- `openclaw_runtime/src/agents/runtime-memory-eval/utility-scorer.ts` + test — 效用评分 ✅
- `openclaw_runtime/src/agents/runtime-memory-eval/temporal-evolution-driver.ts` + test — 时间演化 ✅

### 待完成
- **Step 6**: `topic-drift-eval.ts` + test 已创建，但 test 尚未运行验证
- **Step 7**: `budget-pressure-eval.ts` + test — 完全未创建
- **Step 8**: `enhanced-report.ts` + test — 完全未创建
- **Step 9**: package.json 脚本 + 深度重测 + 量化结果 + 优化方案 — 完全未做

### 关键架构约束（从 Phase 1 探索确认）
1. **Consumer 冲突解决**: `selectConflictWinners` 使用 key `${taskId}\u0000${subject}\u0000${predicate}` — 同一 (taskId, subject, predicate) 的 facts 只保留一个 winner
2. **单查询最多 1 个 accepted fact**: 由于冲突解决 + predicate 精确匹配，单个 query 最多接受 1 个 fact
3. **Shadow 路径不读 invalidations**: `readRuntimeMemoryHydrationFactRows` 直接读 `runtime_memory_facts` 表，不 JOIN `runtime_memory_invalidations`。时间失效需通过 fact 自身的 `invalid_at` 字段
4. **tokenBudget 是 per-query**: 每个 query 独立处理，有自己的 tokenBudget 和 limit
5. **Diagnostics 类型**: `TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` 含 `queries[]`，每个 query result 有 `truePositiveCount`、`acceptedFacts`、`expectedFactIds`

## Proposed Changes

### Step 6: 验证 topic-drift-eval（已创建，仅需运行测试）

**文件**: `tests/unit/runtime-memory-eval-topic-drift.test.ts`（已存在，6 个测试用例）

**操作**: 运行 `pnpm exec vitest run tests/unit/runtime-memory-eval-topic-drift.test.ts --reporter=verbose`

**验证标准**: 6/6 测试通过。如有失败，根据错误修复 `topic-drift-eval.ts` 或 test 文件。

---

### Step 7: Budget Pressure Eval（维度 5 — 预算压力）

#### 7a. 创建 `openclaw_runtime/src/agents/runtime-memory-eval/budget-pressure-eval.ts`

**设计原理**: 由于单查询最多接受 1 个 fact（冲突解决约束），budget pressure 测试通过 N 个不同 subject 的 facts（避免冲突）配合多查询来测量。在每个 budget level，对所有 facts 各发一个查询，测量 recall 退化曲线。

**导出类型**:
```typescript
export type BudgetLevel = {
  tokenBudget: number;
  limit: number;
  label: string;
};

export type BudgetPressureScenario = {
  facts: readonly RuntimeMemoryTemporalFact[];
  levels: readonly BudgetLevel[];
  queries: readonly MultiTurnQueryPlan[]; // 每个 fact 一个 query
};

export type BudgetLevelResult = {
  tokenBudget: number;
  limit: number;
  label: string;
  recall: number;
  acceptedFactCount: number;
  rejectedByBudgetCount: number;
  rejectedByLimitCount: number;
  totalEstimatedTokens: number;
  tokenUtilization: number; // used / budget
};

export type BudgetPressureResult = {
  perLevel: ReadonlyArray<BudgetLevelResult>;
  budgetElasticity: number;   // recall 对 tokenBudget 的回归斜率
  kneePoint: number;          // recall 首次 < 0.5 时的 tokenBudget
  maxRecall: number;
  minRecall: number;
};
```

**导出函数**:
- `buildBudgetPressureScenario(options: { factCount, taskId, referenceTime, levels })` — 创建 N 个不同 subject 的 facts 和对应的 queries，配合多个 budget levels
- `evaluateBudgetPressure(scenario, diagnostics)` — 从 diagnostics 提取每个 budget level 的 recall/rejection/token 指标

**纯函数模式**: 与 chain-eval / topic-drift-eval 一致 — `buildBudgetPressureScenario` 只生成计划，`evaluateBudgetPressure` 只消费 diagnostics。Diagnostics 由 test helper 通过 `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` 生成。

**Budget levels 设计**: `[256, 128, 64, 32, 16, 8]` — 从宽裕到极端紧张，覆盖 fact token 估算约 20 tokens 的范围

**Budget elasticity 计算**: 对 (tokenBudget, recall) 数据点做线性回归斜率 — 正值表示 budget 越大 recall 越高

#### 7b. 创建 `tests/unit/runtime-memory-eval-budget-pressure.test.ts`

**7 个测试用例**:
1. `buildBudgetPressureScenario` 生成 N facts × M levels 的计划
2. 高 budget (256) 时 recall = 1
3. 极低 budget (8) 时 recall < 1
4. recall 随 budget 单调非递减
5. rejectedByBudgetCount 在低 budget 时 > 0
6. tokenUtilization 在高 budget 时较低，低 budget 时接近 1
7. kneePoint 在合理范围内

**Test helper 模式**（复用 topic-drift test 的 `runTopicDiagnostics` 模式）:
- 对每个 budget level，为每个 fact 发一个 query（设置该 level 的 tokenBudget/limit）
- 收集 diagnostics，调用 `evaluateBudgetPressure`

---

### Step 8: Enhanced Report（聚合 6 维度报告生成器）

#### 8a. 创建 `tests/unit/helpers/runtime-memory-eval-enhanced-report.ts`

**设计**: 纯函数报告生成器，聚合 6 个维度的结果，计算综合分数，输出结构化报告 + Markdown。

**导出类型**:
```typescript
export type EnhancedEvalReport = {
  generatedAt: number;
  dimensions: {
    longConversation?: { significant: boolean; cohensD: number; achieved: boolean };
    chain?: { aggregateChainRecall: number; maxDepth: number; meanGrowthRate: number };
    utility?: { meanUtility: number; meanCoverage: number; meanCompleteness: number };
    temporalEvolution?: { writeEffect: number; invalidateEffect: number };
    topicDrift?: { perTopicRecall: number[]; crossTopicInterference: number; driftRecoveryTime: number };
    budgetPressure?: { maxRecall: number; minRecall: number; kneePoint: number; budgetElasticity: number };
  };
  summary: {
    overallScore: number;          // 0-1, 各维度归一化分数的几何平均
    dimensionScores: Record<string, number>;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
};
```

**导出函数**:
- `generateEnhancedReport(inputs: Partial<EnhancedEvalReport["dimensions"]>, options?)` — 聚合各维度结果，计算综合分数
- `formatEnhancedReportAsMarkdown(report)` — 格式化为 Markdown 表格

**综合分数计算**:
- longConversation: `significant && achieved ? 1 : 0.3`
- chain: `aggregateChainRecall`
- utility: `meanUtility`
- temporalEvolution: `Math.max(0, writeEffect)` (writeEffect > 0 表示写入有效)
- topicDrift: `1 - crossTopicInterference` (干扰越低分数越高)
- budgetPressure: `maxRecall` (最高 recall 代表宽裕 budget 下的表现)
- overallScore: 所有可用维度分数的几何平均（确保任一维度极低会拉低总分）

**recommendations 规则**:
- chain recall < 0.8 → "链式召回不足，建议检查冲突解决逻辑"
- utility < 0.7 → "效用分数偏低，建议优化 fact 覆盖率和完整性"
- crossTopicInterference > 0.1 → "跨主题干扰较高，建议加强 subject 隔离"
- kneePoint > 64 → "预算拐点偏高，建议优化 fact token 估算"
- cohensD < 0.5 → "效应量偏小，建议增加样本量或改进 treatment"

#### 8b. 创建 `tests/unit/runtime-memory-eval-enhanced-report.test.ts`

**5 个测试用例**:
1. 全维度满分 → overallScore = 1，strengths 非空，weaknesses 空
2. 单维度低分 → overallScore 被拉低
3. 缺失维度 → 只用可用维度计算
4. recommendations 生成正确（低 utility → 推荐，低 chain recall → 推荐）
5. Markdown 格式包含所有维度表格

---

### Step 9: Package.json 脚本 + 深度重测 + 量化结果

#### 9a. 添加 package.json 脚本

在 `package.json` 的 `scripts` 中添加:
```json
"eval:runtime-memory:enhanced": "pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts tests/unit/runtime-memory-eval-chain-eval.test.ts tests/unit/runtime-memory-eval-utility-scorer.test.ts tests/unit/runtime-memory-eval-temporal-evolution.test.ts tests/unit/runtime-memory-eval-topic-drift.test.ts tests/unit/runtime-memory-eval-budget-pressure.test.ts tests/unit/runtime-memory-eval-enhanced-report.test.ts tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts --reporter=verbose"
```

#### 9b. 深度重测执行

按顺序运行:
1. `pnpm exec vitest run tests/unit/runtime-memory-eval-topic-drift.test.ts --reporter=verbose` — 验证 Step 6
2. `pnpm exec vitest run tests/unit/runtime-memory-eval-budget-pressure.test.ts --reporter=verbose` — 验证 Step 7
3. `pnpm exec vitest run tests/unit/runtime-memory-eval-enhanced-report.test.ts --reporter=verbose` — 验证 Step 8
4. `pnpm run eval:runtime-memory:enhanced` — 全量 8 文件深度重测
5. `pnpm run typecheck:node` — 类型检查

#### 9c. 量化结果输出

收集所有 8 个测试文件的通过率和关键指标，生成量化结果表格:

| 维度 | 测试文件 | 用例数 | 通过率 | 关键指标 |
|------|----------|--------|--------|----------|
| Statistics | runtime-memory-eval-statistics.test.ts | 15 | ? | Cohen's d, min sample size |
| Chain | runtime-memory-eval-chain-eval.test.ts | 6 | ? | aggregateChainRecall, maxDepth |
| Utility | runtime-memory-eval-utility-scorer.test.ts | 7 | ? | meanUtility, meanCoverage |
| Temporal | runtime-memory-eval-temporal-evolution.test.ts | 7 | ? | writeEffect, invalidateEffect |
| Topic Drift | runtime-memory-eval-topic-drift.test.ts | 6 | ? | crossTopicInterference, recoveryTime |
| Budget Pressure | runtime-memory-eval-budget-pressure.test.ts | 7 | ? | kneePoint, budgetElasticity |
| Enhanced Report | runtime-memory-eval-enhanced-report.test.ts | 5 | ? | overallScore |
| Long Conversation | runtime-memory-read-hydration-long-conversation-eval.test.ts | 6 | ? | paired t-test, Cohen's d |

#### 9d. 优化方案

基于量化结果，识别:
- **已达标维度**: 继续保持
- **薄弱维度**: 给出具体优化建议（如调整 token 估算、改进冲突解决、增加 fact 多样性）
- **缺失覆盖**: 识别未来需要补充的评测场景

## Assumptions & Decisions

1. **Budget pressure 单查询约束**: 由于冲突解决使单查询最多接受 1 fact，budget pressure 通过多查询 + 变化 budget level 实现，而非单查询多 fact
2. **纯函数模式**: 所有新模块遵循 chain-eval/topic-drift-eval 的纯函数模式 — build 生成计划，evaluate 消费 diagnostics
3. **Enhanced report 可选维度**: 报告接受 Partial<dimensions>，缺失维度不阻塞报告生成
4. **不修改现有文件**: Steps 6-8 不修改任何已完成的文件（statistics.ts, helpers.ts, chain-eval.ts, utility-scorer.ts, temporal-evolution-driver.ts, topic-drift-eval.ts），只添加新文件
5. **package.json 仅添加一行**: 不修改现有脚本

## Verification Steps

1. **Step 6**: topic-drift test 6/6 通过
2. **Step 7**: budget-pressure test 7/7 通过
3. **Step 8**: enhanced-report test 5/5 通过
4. **Step 9a**: `pnpm run eval:runtime-memory:enhanced` 全部通过（8 文件，共约 59 用例）
5. **Step 9b**: `pnpm run typecheck:node` 零类型错误
6. **Step 9c**: 量化结果表格完整输出
7. **Step 9d**: 优化方案覆盖所有 6 维度
