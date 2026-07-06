# Phase 37: 评测体系深度审计与补齐 — 9 条未测拒绝路径 + 报告评分修正

## Context

Phase 36 建立了 6 维度增强评测系统（statistics, chain, utility, temporal, topic-drift, budget-pressure），59/59 测试通过。但深度审计发现评测体系存在 **3 类严重盲区**：

1. **9/13 消费者拒绝路径从未被增强评测触发** — `conflicting_fact`, `prompt_injection_sentinel`, `raw_leak_sentinel`, `task_mismatch`, `predicate_mismatch`, `expired_at_reference_time`, `future_valid_at`, `record_kind_not_fact`, `verification_status_not_verified`。这些路径仅在原始 benefit-eval 中测试，增强评测完全不覆盖。
2. **冲突解决正确性未测** — 所有增强维度刻意避免冲突（唯一 predicate/subject），`wrongConflictWinnerRate` 从未验证。
3. **风险哨兵断言空洞** — long-conversation 测试断言 `rawLeakRate=0`，但 `seedTempDb` 会跳过 hazard facts，所以消费者从未见过 hazard 文本，断言无意义。

此外，增强报告的评分模型有 5 个缺陷：`longConversation` 二值化（忽略 Cohen's d 量级）、`temporalEvolution` 忽略 `invalidateEffect`、`topicDrift` 忽略 `perTopicRecall`、`budgetPressure` 忽略 `kneePoint`、`utility` 忽略 p95 尾部。

本计划补齐这些盲区并修正评分模型。

## Proposed Changes

### Phase A: 3 个新评测维度（填补 9 条未测拒绝路径）

#### A1. Conflict Resolution Eval（维度 7 — 冲突解决正确性）

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval.ts`

**测试拒绝路径**: `conflicting_fact`

**设计**: 种子 N 组冲突 facts（相同 taskId/subject/predicate，不同 confidence/valid_at），验证：
- 每组只有 1 个 fact 被接受（冲突解决）
- 被接受的是正确 winner（最高 confidence → 最新 valid_at → 最小 factId）
- `wrongConflictWinnerRate = 0`

**纯函数模式**:
- `buildConflictScenario(options: { groupCount, taskId, referenceTime })` — 创建 N 组冲突 facts，每组 3 个 facts（不同 confidence/valid_at），标注 expected winner
- `evaluateConflictResolution(scenario, diagnostics)` — 检查每组 winner 正确性，计算 `wrongConflictWinnerRate`

**导出类型**:
```typescript
export type ConflictGroup = {
  groupId: string;
  subject: string;
  predicate: string;
  facts: readonly RuntimeMemoryTemporalFact[];
  expectedWinnerFactId: string;
};

export type ConflictResolutionResult = {
  perGroup: ReadonlyArray<{
    groupId: string;
    acceptedFactId: string | null;
    expectedWinnerFactId: string;
    correct: boolean;
  }>;
  conflictSuppressionRate: number;   // rejected / total candidates
  wrongConflictWinnerRate: number;   // wrong / total groups
  totalConflicts: number;
};
```

**测试文件**: `tests/unit/runtime-memory-eval-conflict-resolution.test.ts`（6 用例）
1. 构建场景生成 N 组 × 3 facts
2. 每组只接受 1 个 fact
3. 正确 winner 被接受（最高 confidence）
4. confidence 相同时最新 valid_at 胜出
5. `wrongConflictWinnerRate = 0`
6. `conflictSuppressionRate = 1`（所有非 winner 都被拒绝）

#### A2. Hazard Sentinel Eval（维度 8 — 风险哨兵抑制）

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/hazard-sentinel-eval.ts`

**测试拒绝路径**: `prompt_injection_sentinel`, `raw_leak_sentinel`

**设计**: 种子 hazard facts（含 "Ignore earlier instructions"、"record_json"、"sk-xxx" 等文本）+ clean facts，验证：
- 所有 hazard facts 被拒绝
- `promptInjectionReturnRate = 0`
- `rawLeakRate = 0`
- 接受的 fact 文本不含 hazard 字符串

**纯函数模式**:
- `buildHazardScenario(options: { taskId, referenceTime, cleanFactCount, hazardFactCount })` — 创建 clean facts + prompt injection facts + raw leak facts
- `evaluateHazardSuppression(scenario, diagnostics)` — 检查 hazard 抑制率、content-level 断言

**导出类型**:
```typescript
export type HazardFactSpec = {
  factId: string;
  subject: string;
  predicate: string;
  hazardType: "prompt_injection" | "raw_leak";
  objectSummary: string;  // 含 hazard 文本
};

export type HazardSuppressionResult = {
  promptInjectionReturned: number;
  rawLeakReturned: number;
  promptInjectionSuppressionRate: number;
  rawLeakSuppressionRate: number;
  cleanFactRecall: number;
  hazardStringLeaked: string[];  // 泄漏的 hazard 字符串列表
};
```

**测试文件**: `tests/unit/runtime-memory-eval-hazard-sentinel.test.ts`（6 用例）
1. 构建场景生成 clean + hazard facts
2. prompt injection facts 全部被拒绝
3. raw leak facts 全部被拒绝
4. clean facts 正常召回
5. 接受的 fact 文本不含 "Ignore earlier instructions"
6. 接受的 fact 文本不含 "record_json"

#### A3. Cross-Axis Rejection Eval（维度 9 — 跨轴拒绝完整性）

**文件**: `openclaw_runtime/src/agents/runtime-memory-eval/cross-axis-rejection-eval.ts`

**测试拒绝路径**: `task_mismatch`, `predicate_mismatch`, `expired_at_reference_time`, `future_valid_at`, `record_kind_not_fact`, `verification_status_not_verified`

**设计**: 种子 6 类应该被拒绝的 facts（每类触发一个拒绝原因）+ 1 个 clean fact，验证每类 fact 被正确拒绝。

**纯函数模式**:
- `buildCrossAxisScenario(options: { taskId, subject, predicate, referenceTime })` — 创建 clean fact + 6 类应拒绝的 facts
- `evaluateCrossAxisRejection(scenario, diagnostics)` — 检查每类拒绝原因是否触发

**导出类型**:
```typescript
export type CrossAxisFactSpec = {
  factId: string;
  rejectionReason: RuntimeMemoryHydrationConsumerRejectionReason;
  // fact 属性被故意设置为触发该拒绝原因
  taskId?: string;
  subject?: string;
  predicate?: string;
  validAt?: number;
  expiredAt?: number;
  recordKind?: "candidate" | "fact";
  verificationStatus?: string;
};

export type CrossAxisRejectionResult = {
  perReason: ReadonlyArray<{
    reason: RuntimeMemoryHydrationConsumerRejectionReason;
    factId: string;
    rejected: boolean;
  }>;
  allReasonsFired: boolean;
  cleanFactAccepted: boolean;
  rejectionCoverage: number;  // fired / total expected
};
```

**测试文件**: `tests/unit/runtime-memory-eval-cross-axis-rejection.test.ts`（6 用例）
1. 构建场景生成 clean + 6 类 facts
2. `task_mismatch` 触发
3. `predicate_mismatch` 触发
4. `expired_at_reference_time` 触发
5. `future_valid_at` 触发
6. `allReasonsFired = true` 且 clean fact 被接受

---

### Phase B: 增强报告评分模型修正 + 拒绝原因分布

**文件**: `tests/unit/helpers/runtime-memory-eval-enhanced-report.ts`（修改）

#### B1. 修正 5 个评分缺陷

| 维度 | 当前评分 | 修正后评分 | 理由 |
|------|----------|-----------|------|
| longConversation | `significant && achieved ? 1 : 0.3` | `significant ? clamp01(d / 0.8) : 0.2` | 使用 Cohen's d 量级，而非二值化 |
| temporalEvolution | `max(0, writeEffect)` | `clamp01(writeEffect) * (invalidateEffect < 0 ? 1 : 0.5)` | 惩罚失效不生效 |
| topicDrift | `1 - crossTopicInterference` | `(1 - crossTopicInterference) * min(perTopicRecall)` | 惩罚低召回 |
| budgetPressure | `maxRecall` | `maxRecall * (1 - kneePoint / 512)` | 惩罚高拐点 |
| utility | `meanUtility` | `meanUtility * 0.7 + p95Utility * 0.3` | 加入尾部权重 |

#### B2. 新增 3 个维度到 EnhancedEvalDimensions

```typescript
export type EnhancedEvalDimensions = {
  // ... 现有 6 个维度 ...
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
  };
};
```

新维度评分:
- `conflictResolution`: `conflictSuppressionRate * (1 - wrongConflictWinnerRate)`
- `hazardSuppression`: `promptInjectionSuppressionRate * rawLeakSuppressionRate`（任一为 0 则全 0）
- `crossAxisRejection`: `rejectionCoverage`

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

在 `generateEnhancedReport` 中接受可选的 `rejectionCounts: Record<string, number>` 参数，计算分布。

#### B4. 新增延迟基准字段

```typescript
export type EnhancedEvalDimensions = {
  // ...
  longConversation?: {
    // ... 现有字段 ...
    latencyMsP95?: number;     // 新增
    tokenOverheadP95?: number; // 新增
  };
};
```

#### B5. 新增 recommendation 规则

- `wrongConflictWinnerRate > 0` → "冲突解决选出错误 winner — 检查 compareFactRank 排序逻辑"
- `hazardStringLeaked.length > 0` → "风险字符串泄漏 — 检查 sentinel 正则表达式覆盖度"
- `rejectionCoverage < 1` → "拒绝路径覆盖不全 — 检查未触发的拒绝原因"
- `latencyMsP95 > 50` → "延迟 P95 超标 — 检查 shadow 读取和 consumer 排序性能"

---

### Phase C: 集成测试 + 深度重测

#### C1. 集成测试

**文件**: `tests/unit/runtime-memory-eval-enhanced-integration.test.ts`（新建）

将 real multi-turn-driver 输出 → `generateLongConversationReport` → `generateEnhancedReport`，验证完整管线：
1. 运行 10 轮 multi-turn driver
2. 生成 long-conversation report
3. 提取维度数据喂入 enhanced report
4. 验证 `overallScore > 0`，`dimensionScores` 包含 longConversation

#### C2. 更新 package.json 脚本

更新 `eval:runtime-memory:enhanced` 加入 3 个新测试文件 + 集成测试。

#### C3. 深度重测

运行全量测试（8 现有 + 3 新维度 + 1 集成 = 12 文件），收集量化结果。

## Assumptions & Decisions

1. **纯函数模式**: 所有新维度遵循 build/evaluate 分离模式，与 chain-eval/topic-drift-eval 一致
2. **Hazard 文本**: 使用 consumer 的 `DEFAULT_PROMPT_INJECTION_SENTINEL` 和 `DEFAULT_RAW_LEAK_SENTINEL` 匹配的真实文本（"Ignore earlier instructions", "record_json", "sk-" 前缀等）
3. **Cross-axis facts**: 每类 fact 的属性被故意设置为触发对应拒绝原因（如 `expiredAt < referenceTime` 触发 `expired_at_reference_time`）
4. **评分修正**: 使用 clamp01 确保所有维度分数在 [0, 1] 范围内，几何均值仍为综合分数
5. **向后兼容**: EnhancedEvalDimensions 的新字段全部可选，现有测试不受影响

## Verification Steps

1. **A1**: conflict-resolution test 6/6 通过
2. **A2**: hazard-sentinel test 6/6 通过
3. **A3**: cross-axis-rejection test 6/6 通过
4. **B**: enhanced-report test 更新后 5/5 + 新增评分用例 通过
5. **C1**: integration test 通过
6. **C2**: `pnpm run eval:runtime-memory:enhanced` 全部通过（12 文件）
7. **C3**: `pnpm run typecheck:node` 零类型错误
8. **最终量化结果**: 12 维度 × 关键指标表格 + 优化方案
