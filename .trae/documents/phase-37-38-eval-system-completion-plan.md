# Phase 37 + 38: 评测体系深度审计、补齐与完整性闭环

## Summary

本计划分两部分：
- **Part 1（Phase 37 收尾）**：完成已批准但未实现的 Phase 37 工作 — A2 修复、A3 跨轴拒绝、B 报告评分修正、C 集成测试 + 深度重测。
- **Part 2（Phase 38 新增）**：基于深度审计发现的 3 个新缺口 — 拒绝路径覆盖闸门、延迟基准维度、聚合评测报告产物。

最终目标：12 维度增强评测体系，全部 13 条消费者拒绝路径在增强评测中有专属断言，单条命令产出聚合报告。

---

## Part 0: 深度审计结论（评测体系完善性判断）

### 当前状态

| 维度 | 来源 | 状态 | 测试数 |
|------|------|------|--------|
| statistics | Phase 36 | ✅ | 通过 |
| chain | Phase 36 | ✅ | 通过 |
| utility | Phase 36 | ✅ | 通过 |
| temporal-evolution | Phase 36 | ✅ | 通过 |
| topic-drift | Phase 36 | ✅ | 6/6 |
| budget-pressure | Phase 36 | ✅ | 7/7 |
| conflict-resolution | Phase 37 A1 | ✅ | 6/6 |
| hazard-sentinel | Phase 37 A2 | 🔄 模块完成，测试 2 处待修 | 0/6 |
| cross-axis-rejection | Phase 37 A3 | ⬜ 未开始 | 0/0 |
| enhanced-report 评分修正 | Phase 37 B | ⬜ 未开始 | — |
| 集成测试 | Phase 37 C1 | ⬜ 未开始 | 0/0 |

### 13 条消费者拒绝路径覆盖矩阵

消费者有 13 条拒绝路径（`RuntimeMemoryHydrationConsumerRejectionReason`）。审计发现：

| 拒绝原因 | 增强评测维度 | legacy 测试 | Phase 37 计划 | 本计划 |
|----------|-------------|------------|--------------|--------|
| `record_kind_not_fact` | 无 | ✅ | A3 | A3 |
| `verification_status_not_verified` | 无 | ✅ | A3 | A3 |
| `future_valid_at` | 无 | ✅ | A3 | A3 |
| `invalidated_at_reference_time` | 无（temporal 隐式） | ✅ | **遗漏** | **A3 扩展** |
| `expired_at_reference_time` | 无 | ✅ | A3 | A3 |
| `task_mismatch` | 无 | ✅ | A3 | A3 |
| `subject_mismatch` | 无（topic-drift 隐式） | ✅ | **遗漏** | **A3 扩展** |
| `predicate_mismatch` | 无 | ✅ | A3 | A3 |
| `prompt_injection_sentinel` | 无 | ✅ | A2 | A2 |
| `raw_leak_sentinel` | 无 | ✅ | A2 | A2 |
| `conflicting_fact` | 无 | ✅ | A1 | A1 |
| `token_budget_exceeded` | 无（budget-pressure 隐式） | ✅ | **遗漏** | **A3 扩展** |
| `limit_exceeded` | 无 | ✅ | **遗漏** | **A3 扩展** |

**结论 1**：Phase 37 A3 原计划只覆盖 6 条，遗漏了 4 条（`subject_mismatch`、`invalidated_at_reference_time`、`token_budget_exceeded`、`limit_exceeded`）。这 4 条在 legacy 测试中有覆盖，所以不是逻辑回归风险，但增强评测体系结构性不完整。**本计划将 A3 扩展到 10 条**（所有非专属维度的拒绝路径）。

### 5 个增强报告评分缺陷（Phase 37 B，仍未修正）

| 维度 | 当前评分 | 缺陷 | 修正 |
|------|---------|------|------|
| longConversation | `significant && achieved ? 1 : 0.3` | 二值化，忽略 Cohen's d 量级 | `significant ? clamp01(d / 0.8) : 0.2` |
| temporalEvolution | `max(0, writeEffect)` | 忽略 invalidateEffect | `clamp01(writeEffect) * (invalidateEffect < 0 ? 1 : 0.5)` |
| topicDrift | `1 - crossTopicInterference` | 忽略 perTopicRecall | `(1 - crossTopicInterference) * min(perTopicRecall)` |
| budgetPressure | `maxRecall` | 忽略 kneePoint | `maxRecall * (1 - kneePoint / 512)` |
| utility | `meanUtility` | 忽略 p95 尾部 | `meanUtility * 0.7 + p95Utility * 0.3` |

### 3 个 Phase 38 新缺口（超出 Phase 37 范围）

**缺口 1：无拒绝路径覆盖闸门（meta-test）**
没有任何测试断言"全部 13 条拒绝路径在增强评测套件中至少触发一次"。一条拒绝路径可能被静默回归到无测试状态。

**缺口 2：无延迟基准维度**
`multi-turn-driver` 收集 `latencyMs` 和 `tokenOverhead`，但没有专门的延迟评测维度。没有阈值断言（如 p95 < 50ms）。

**缺口 3：无聚合评测报告产物**
每个测试文件独立运行。没有单一产物汇总所有维度结果。没有 `pnpm eval:runtime-memory:full` 产出合并报告。

---

## Part 1: Phase 37 收尾

### A2 修复：Hazard Sentinel Test（2 处内联循环替换）

**文件**: `tests/unit/runtime-memory-eval-hazard-sentinel.test.ts`

**问题**: 第 127-129 行和第 149-151 行仍使用内联 `appendFactToDb` 循环，会被持久化层 `sanitizeFactForPersistence` 拒绝 hazard 文本。

**修改**: 将两处：
```typescript
for (const entry of scenario) {
  appendFactToDb(dbPath, entry.fact);
}
```
替换为：
```typescript
seedHazardDb(dbPath, scenario);
```

**验证**: `pnpm exec vitest run tests/unit/runtime-memory-eval-hazard-sentinel.test.ts --reporter=verbose` → 6/6 通过

---

### A3 扩展：Cross-Axis Rejection Eval（10 条拒绝路径）

**文件（新建）**: `openclaw_runtime/src/agents/runtime-memory-eval/cross-axis-rejection-eval.ts`

**测试文件（新建）**: `tests/unit/runtime-memory-eval-cross-axis-rejection.test.ts`

**覆盖 10 条拒绝路径**（比原 Phase 37 多 4 条）:
1. `record_kind_not_fact` — `recordKind = "candidate"`
2. `verification_status_not_verified` — `verificationStatus = "unverified"`
3. `future_valid_at` — `valid_at > referenceTime`
4. `invalidated_at_reference_time` — `invalid_at <= referenceTime`（**新增**）
5. `expired_at_reference_time` — `expired_at <= referenceTime`
6. `task_mismatch` — `taskId !== query.taskId`
7. `subject_mismatch` — `subject !== query.subject`（**新增**）
8. `predicate_mismatch` — `predicate !== query.predicate`
9. `token_budget_exceeded` — `tokenBudget = 0`（**新增**）
10. `limit_exceeded` — `limit = 0`（**新增**）

**设计**:
- `buildCrossAxisScenario(options)` — 创建 1 个 clean fact + 10 个应拒绝 facts，每个标注 `expectedRejectionReason`
- `evaluateCrossAxisRejection(scenario, diagnostics)` — 检查每个 fact 的 `rejectedFacts[].reason` 是否匹配 `expectedRejectionReason`
- 利用 `TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult.rejectedFacts[].reason` 和 `metrics.rejectionCounts`

**导出类型**:
```typescript
export type CrossAxisFactSpec = {
  factId: string;
  expectedRejectionReason: RuntimeMemoryHydrationConsumerRejectionReason;
  fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate;
  query: MultiTurnQueryPlan;
  // token_budget_exceeded / limit_exceeded 用特殊 query 参数
  queryOverride?: Partial<MultiTurnQueryPlan>;
};

export type CrossAxisRejectionResult = {
  perReason: ReadonlyArray<{
    reason: RuntimeMemoryHydrationConsumerRejectionReason;
    factId: string;
    rejected: boolean;
    correctReason: boolean;
  }>;
  allReasonsFired: boolean;
  cleanFactAccepted: boolean;
  rejectionCoverage: number;   // fired / 10
  correctReasonRate: number;   // correctReason / 10
};
```

**关键实现细节**:
- `token_budget_exceeded`：clean fact + `query.tokenBudget = 0`（fact 本身合法，但预算为 0 → 全部因预算被拒）
- `limit_exceeded`：clean fact + `query.limit = 0`（fact 本身合法，但 limit 为 0 → 全部因 limit 被拒）
- 其余 8 条：fact 属性故意设置为触发对应拒绝原因
- clean fact 用正常 query 验证可被接受

**测试用例（8 用例）**:
1. 构建场景生成 clean + 10 类 facts
2. `allReasonsFired = true`
3. `rejectionCoverage = 1`
4. `correctReasonRate = 1`
5. `cleanFactAccepted = true`
6. `invalidated_at_reference_time` 触发（**新增覆盖**）
7. `subject_mismatch` 触发（**新增覆盖**）
8. `token_budget_exceeded` + `limit_exceeded` 触发（**新增覆盖**）

---

### B: 增强报告评分模型修正 + 3 新维度

**文件（修改）**: `tests/unit/helpers/runtime-memory-eval-enhanced-report.ts`

#### B1. 修正 5 个评分缺陷

```typescript
function computeDimensionScores(dims: EnhancedEvalDimensions): Record<string, number> {
  const scores: Record<string, number> = {};

  if (dims.longConversation) {
    // 修正：使用 Cohen's d 量级，而非二值化
    scores.longConversation = dims.longConversation.significant
      ? clamp01(dims.longConversation.cohensD / 0.8)
      : 0.2;
  }

  if (dims.chain) {
    scores.chain = clamp01(dims.chain.aggregateChainRecall);
  }

  if (dims.utility) {
    // 修正：加入 p95 尾部权重
    const p95 = dims.utility.p95Utility ?? dims.utility.meanUtility;
    scores.utility = clamp01(dims.utility.meanUtility * 0.7 + p95 * 0.3);
  }

  if (dims.temporalEvolution) {
    // 修正：惩罚失效不生效
    const invalidatePenalty = dims.temporalEvolution.invalidateEffect < 0 ? 1 : 0.5;
    scores.temporalEvolution = clamp01(Math.max(0, dims.temporalEvolution.writeEffect)) * invalidatePenalty;
  }

  if (dims.topicDrift) {
    // 修正：惩罚低召回
    const minRecall = Math.min(...dims.topicDrift.perTopicRecall);
    scores.topicDrift = clamp01(1 - dims.topicDrift.crossTopicInterference) * clamp01(minRecall);
  }

  if (dims.budgetPressure) {
    // 修正：惩罚高拐点
    scores.budgetPressure = clamp01(dims.budgetPressure.maxRecall) * (1 - clamp01(dims.budgetPressure.kneePoint / 512));
  }

  // ... 3 个新维度（见 B2）
  return scores;
}
```

#### B2. 新增 3 个维度到 EnhancedEvalDimensions

```typescript
export type EnhancedEvalDimensions = {
  // ... 现有 6 个维度 ...
  utility?: {
    meanUtility: number;
    meanCoverage: number;
    meanCompleteness: number;
    p95Utility?: number;  // 新增
  };
  conflictResolution?: {
    wrongConflictWinnerRate: number;
    conflictSuppressionRate: number;
  };
  hazardSuppression?: {
    promptInjectionSuppressionRate: number;
    rawLeakSuppressionRate: number;
    hazardStringLeaked: string[];
  };
  crossAxisRejection?: {
    rejectionCoverage: number;
    allReasonsFired: boolean;
    correctReasonRate: number;
  };
  // Phase 38 D2 新增：
  latencyBenchmark?: {
    latencyMsP50: number;
    latencyMsP95: number;
    tokenOverheadP50: number;
    tokenOverheadP95: number;
  };
};
```

新维度评分:
- `conflictResolution`: `conflictSuppressionRate * (1 - wrongConflictWinnerRate)`
- `hazardSuppression`: `promptInjectionSuppressionRate * rawLeakSuppressionRate`（任一为 0 则全 0）
- `crossAxisRejection`: `rejectionCoverage * correctReasonRate`
- `latencyBenchmark`: `clamp01(1 - latencyMsP95 / 50) * clamp01(1 - tokenOverheadP95 / 200)`

#### B3. 新增拒绝原因分布字段

```typescript
export type EnhancedEvalReport = {
  // ... 现有字段 ...
  rejectionReasonDistribution?: ReadonlyArray<{
    reason: string;
    count: number;
    percentage: number;
  }>;
};
```

`generateEnhancedReport` 新增可选参数 `rejectionCounts?: Record<string, number>`，计算分布。

#### B4. 新增 recommendation 规则

- `wrongConflictWinnerRate > 0` → "冲突解决选出错误 winner — 检查 compareFactRank 排序逻辑"
- `hazardStringLeaked.length > 0` → "风险字符串泄漏 — 检查 sentinel 正则表达式覆盖度"
- `correctReasonRate < 1` → "拒绝原因匹配错误 — 检查 rejectionReasonBeforeConflict 分支顺序"
- `rejectionCoverage < 1` → "拒绝路径覆盖不全 — 检查未触发的拒绝原因"
- `latencyMsP95 > 50` → "延迟 P95 超标 — 检查 shadow 读取和 consumer 排序性能"

#### B5. 更新 enhanced-report 测试

**文件（修改）**: `tests/unit/runtime-memory-eval-enhanced-report.test.ts`

新增用例:
- `longConversation` 评分使用 Cohen's d 量级（d=0.8 → score=1.0, d=0.4 → score=0.5）
- `temporalEvolution` 评分在 invalidateEffect >= 0 时减半
- `topicDrift` 评分受 perTopicRecall 影响
- `budgetPressure` 评分受 kneePoint 影响
- `utility` 评分加入 p95 权重
- 3 个新维度评分正确
- `rejectionReasonDistribution` 计算正确

---

### C: 集成测试 + 深度重测

#### C1. 集成测试

**文件（新建）**: `tests/unit/runtime-memory-eval-enhanced-integration.test.ts`

将 real `runMultiTurnDriver` 输出 → `generateLongConversationReport` → `generateEnhancedReport`，验证完整管线:
1. 运行 10 轮 multi-turn driver（baseline + treatment）
2. 生成 long-conversation report
3. 提取维度数据（longConversation, chain, utility, budgetPressure, latencyBenchmark）喂入 `generateEnhancedReport`
4. 验证 `overallScore > 0`，`dimensionScores` 包含至少 3 个维度
5. 验证 `rejectionReasonDistribution` 非空

#### C2. 更新 package.json 脚本

更新 `eval:runtime-memory:enhanced` 加入 4 个新测试文件:
```json
"eval:runtime-memory:enhanced": "pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts tests/unit/runtime-memory-eval-chain-eval.test.ts tests/unit/runtime-memory-eval-utility-scorer.test.ts tests/unit/runtime-memory-eval-temporal-evolution.test.ts tests/unit/runtime-memory-eval-topic-drift.test.ts tests/unit/runtime-memory-eval-budget-pressure.test.ts tests/unit/runtime-memory-eval-enhanced-report.test.ts tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts tests/unit/runtime-memory-eval-conflict-resolution.test.ts tests/unit/runtime-memory-eval-hazard-sentinel.test.ts tests/unit/runtime-memory-eval-cross-axis-rejection.test.ts tests/unit/runtime-memory-eval-enhanced-integration.test.ts --reporter=verbose"
```

#### C3. 深度重测

运行全量测试（12 文件），收集量化结果。

---

## Part 2: Phase 38 — 评测体系完整性闭环

### D1: 拒绝路径覆盖闸门（meta-test）

**文件（新建）**: `tests/unit/runtime-memory-eval-rejection-coverage-gate.test.ts`

**设计**: meta-test，运行所有 3 个拒绝维度（conflict-resolution, hazard-sentinel, cross-axis-rejection）的场景，收集所有 `rejectedFacts[].reason` 和 `metrics.rejectionCounts`，断言全部 13 条拒绝路径至少触发一次。

**用例（3 用例）**:
1. 13 条拒绝路径在增强评测套件中全部触发（coverage = 13/13）
2. 每条拒绝路径触发次数 >= 1
3. 拒绝原因分布非空且 count 总和 = 总 rejected facts

**实现**: 调用 `buildConflictScenario` + `buildHazardScenario` + `buildCrossAxisScenario`，运行 diagnostics，聚合 `rejectionCounts`。

---

### D2: 延迟基准维度

**文件（新建）**: `openclaw_runtime/src/agents/runtime-memory-eval/latency-benchmark-eval.ts`

**设计**: 利用 `multi-turn-driver` 的 `MultiTurnRunResult.aggregateBaseline/aggregateTreatment` 中的 `latencyMs` 和 `tokenOverhead` 统计，计算 p50/p95，与阈值对比。

**纯函数模式**:
- `evaluateLatencyBenchmark(runResult: MultiTurnRunResult)` — 从 `aggregateTreatment` 提取 `latencyMs.p50/p95` 和 `tokenOverhead.p50/p95`
- 返回 `LatencyBenchmarkResult` 含 p50/p95 值和达标率

**导出类型**:
```typescript
export type LatencyBenchmarkResult = {
  latencyMsP50: number;
  latencyMsP95: number;
  tokenOverheadP50: number;
  tokenOverheadP95: number;
  latencyBudgetMs: number;     // 阈值，默认 50
  tokenBudgetMax: number;      // 阈值，默认 200
  latencyPassRate: number;     // p95 <= budget ? 1 : 0
  tokenPassRate: number;
};
```

**测试文件（新建）**: `tests/unit/runtime-memory-eval-latency-benchmark.test.ts`（4 用例）
1. 从 MultiTurnRunResult 提取 p50/p95
2. p95 < 50ms 时 latencyPassRate = 1
3. p95 >= 50ms 时 latencyPassRate = 0
4. tokenOverhead p95 阈值检查

---

### D3: 聚合评测报告产物

**文件（新建）**: `openclaw_runtime/src/agents/runtime-memory-eval/aggregate-report.ts`

**设计**: 提供 `generateAggregateReport()` 函数，运行全部 12 维度评测，产出单一 JSON + markdown 报告。

**脚本（新建）**: `openclaw_runtime/scripts/run-runtime-memory-eval.mjs`

**package.json 新增**:
```json
"eval:runtime-memory:full": "node openclaw_runtime/scripts/run-runtime-memory-eval.mjs"
```

**产物路径**: `artifacts/runtime-memory-eval/report.json` + `artifacts/runtime-memory-eval/report.md`

**报告结构**:
```typescript
export type AggregateEvalReport = {
  generatedAt: number;
  dimensions: EnhancedEvalDimensions;
  enhancedReport: EnhancedEvalReport;
  rejectionCoverage: {
    totalReasons: 13;
    firedReasons: string[];
    missingReasons: string[];
    coverageRate: number;
  };
  testSuite: {
    totalFiles: number;
    passedFiles: number;
    failedFiles: string[];
  };
};
```

**测试文件（新建）**: `tests/unit/runtime-memory-eval-aggregate-report.test.ts`（3 用例）
1. `generateAggregateReport` 合并所有维度
2. `rejectionCoverage` 计算正确
3. markdown 格式化包含所有维度

---

## Assumptions & Decisions

1. **A3 扩展到 10 条**：原 Phase 37 A3 只覆盖 6 条，本计划扩展到 10 条（补齐 `subject_mismatch`、`invalidated_at_reference_time`、`token_budget_exceeded`、`limit_exceeded`）。这 4 条在 legacy 测试有覆盖，但增强评测结构性缺失。
2. **`token_budget_exceeded` / `limit_exceeded` 用 query 参数触发**：fact 本身合法，通过 `query.tokenBudget = 0` 或 `query.limit = 0` 触发，避免 fact 属性冲突。
3. **延迟基准维度**：阈值 latencyMsP95 <= 50ms、tokenOverheadP95 <= 200，基于 `multi-turn-driver` 现有数据，不需新 instrumentation。
4. **聚合报告**：`pnpm eval:runtime-memory:full` 产出到 `artifacts/runtime-memory-eval/`，与 `agent-dev` 产物目录风格一致。
5. **向后兼容**：`EnhancedEvalDimensions` 新字段全部可选，`generateEnhancedReport` 新参数可选，现有测试不受影响。
6. **纯函数模式**：所有新维度遵循 build/evaluate 分离模式，与 chain-eval/topic-drift-eval 一致。

---

## Verification Steps

1. **A2**: hazard-sentinel test 6/6 通过
2. **A3**: cross-axis-rejection test 8/8 通过，覆盖 10 条拒绝路径
3. **B**: enhanced-report test 更新后通过（原 5 + 新增 ~7 = ~12 用例）
4. **C1**: integration test 通过
5. **D1**: rejection-coverage-gate test 3/3 通过，13 条拒绝路径全部触发
6. **D2**: latency-benchmark test 4/4 通过
7. **D3**: aggregate-report test 3/3 通过
8. **C2**: `eval:runtime-memory:enhanced` 脚本包含 12 个测试文件
9. **C3**: `pnpm run eval:runtime-memory:enhanced` 全部通过（12 文件）
10. **D3 脚本**: `pnpm eval:runtime-memory:full` 产出 `artifacts/runtime-memory-eval/report.json` + `report.md`
11. **类型检查**: `pnpm run typecheck:node` 零类型错误
12. **最终量化结果**: 12 维度 × 关键指标表格 + 拒绝路径覆盖矩阵 + 优化方案

---

## 实施顺序

1. A2 修复（2 处替换，~5 分钟）
2. A3 实现（新建 eval + test，~30 分钟）
3. B 实现（修改 report + test，~25 分钟）
4. C1 集成测试（新建，~15 分钟）
5. D1 拒绝覆盖闸门（新建，~15 分钟）
6. D2 延迟基准（新建 eval + test，~20 分钟）
7. D3 聚合报告（新建 report + script + test，~25 分钟）
8. C2 更新 package.json 脚本
9. C3 + D3 脚本：全量重测 + 产出聚合报告
10. 类型检查 + 量化结果汇总
