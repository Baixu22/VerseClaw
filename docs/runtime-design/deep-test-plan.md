# A1-A6 全量深度测试编排方案（Plan Mode）

**目标**：对 6 个模块做全量深度测试，输出量化结果（pass rate / p99 / 内存 / 覆盖率），定位短板，给出优化方案。

**执行边界**：仅新增测试文件，不修改源码（优化方案单独列出，由用户决策是否实施）。

---

## 测试编排架构

### 量化指标采集矩阵

| 指标 | 采集方式 | 目标 | 短板阈值 |
|------|----------|------|----------|
| Pass rate | vitest 报告 | 100% | < 100% 即短板 |
| 测试用例数 | describe/it 计数 | 每模块 ≥ 30 | < 20 即短板 |
| p99 延迟 | performance.now() 100 次采样 | ≤ Stage 4 预算 | > 预算即短板 |
| 内存增量 | process.memoryUsage().rss | ≤ 24MB 总量 | > 24MB 即短板 |
| API 覆盖率 | 导出函数被调用比例 | ≥ 90% | < 70% 即短板 |
| 错误路径覆盖 | 故障注入测试通过率 | 100% | < 100% 即短板 |
| 属性测试 | fast-check 不变量验证 | 100 次通过 | 任何失败即短板 |

### 8 个测试类别

1. **功能完整性** — 覆盖未测试的公开 API
2. **边界条件** — 空输入、零值、极值、MAX 常量边界
3. **错误路径** — 故障注入（git 失败、FS 错误、超时、race）
4. **属性测试** — fast-check 验证纯函数不变量
5. **并发测试** — 并行调用、竞争条件
6. **压力测试** — 大输入（1000+ 节点/文件/span）、内存压力
7. **集成测试** — 真实跨模块数据流
8. **真实工作负载** — 100-turn session 模拟

---

## Phase 1: 基线测量（执行已有测试，采集量化基线）

**目标**：建立"当前状态"量化基线，作为深度测试后的对比参照。

**动作**：
- 运行全部 18 个已有测试文件
- 采集：总 pass rate、每模块 pass rate、总测试数、总耗时
- 输出：`baseline-metrics.md`（量化基线表）

**预期输出**：
```
| 模块 | 已有测试数 | Pass rate | 总耗时 |
|------|-----------|-----------|--------|
| A1   | 74        | 100%      | ?ms    |
| A2   | 18        | 100%      | ?ms    |
| A3   | 52        | 100%      | ?ms    |
| A4   | 4         | 100%      | ?ms    |
| A5   | 72        | 100%      | ?ms    |
| A6   | 42        | 100%      | ?ms    |
| 跨领域| 55        | 100%      | ?ms    |
```

---

## Phase 2: 深度测试编写（按模块，每模块一个测试文件）

### A1 深度测试 — `tests/unit/deep/a1-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | `requiresFullFsDiff`/`requiresApproval` 各 kind 组合 | 4 |
| 边界条件 | 空 `writePaths`、`MAX_FINGERPRINT_BYTES=16MB` 边界、`declaredPaths > maxFilesForCopyOnWrite=1000` 回退 | 5 |
| 错误路径 | git 命令超时、`mkdir` 失败、`copyFile` stat 后删除 race、`stat` 抛 EACCES | 5 |
| 属性测试 | `detectUndeclaredWrites(declared, actual)` 满足 `result ⊆ (actual − declared)`；`validateWriteRiskProfile` 幂等 | 3 |
| 并发测试 | 并行 `recordActualWrites` 调用、并行 `beginSnapshot` | 3 |
| 压力测试 | 1000 个 declared paths、10000 个 actual writes | 2 |
| 集成测试 | 真实工具注册 → `assertWriteRiskProfileForTool` 触发 | 2 |
| **小计** | | **24** |

### A2 深度测试 — `tests/unit/deep/a2-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | `buildTaskGraph`、`buildRouteDiagnostics`、`buildRepairNodes`、`buildRerouteRecommendations`、`summarizeQuality`、`extractMemoryCandidates` | 8 |
| 边界条件 | 空 nodes 图、`maxWorkers=0`、`maxWorkers=1`、`maxWorkers >> tasks`、孤立节点 | 5 |
| 错误路径 | 图中有环（`ready.length === 0` 静默退出）、`makeTaskLedgerEntry` 缺失 `taskNodeId` | 3 |
| 属性测试 | `buildExecutionWaves` 确定性（同输入同输出）、拓扑顺序不变量（依赖在前）、wave 数 ≤ ⌈tasks/workers⌉ | 3 |
| 并发测试 | 并发 `rePlan` 调用、`startWave` 与 `rePlan` 同时调用 | 2 |
| 压力测试 | 100 个 task 节点、500 个节点 + 50 workers | 2 |
| 集成测试 | `scoreWorkerQuality` 超长 `resultText` 截断、`recommendRepairAction` 各 scenario | 3 |
| **小计** | | **26** |

### A3 深度测试 — `tests/unit/deep/a3-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | 5 种 anomaly kind × 各 severity 组合、`resolveAnomalyPatternForReviewer` 各 flag 状态 | 8 |
| 边界条件 | `tick=0`、`maxTicks=0`（除零）、`maxRepairTicks=0`、`tokenBudget=0`、`failures=undefined` + `recentToolFailureCount=undefined` | 6 |
| 错误路径 | `featureFlags` 为 `undefined`/`null`/结构异常时降级、`input` 为 `null` | 3 |
| 属性测试 | `classifyAnomalyPattern` 确定性（同输入同输出）、无 anomaly 输入永远返回 `null` | 2 |
| 压力测试 | 100 Mission ticks 连续分类（累积状态）、`failures` 数组 1000 元素 | 2 |
| 集成测试 | A3 → A6 rollback 真实触发 → `ResumeContractVerifier.requiresReverification=true` | 2 |
| **小计** | | **23** |

### A4 深度测试 — `tests/unit/deep/a4-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | `checkBudgetViolation('a4')` 各阈值边界、`reset()` 清除 A4 计数器 | 4 |
| 边界条件 | `auditedDecisions=0`（除零保护）、`lowQualityDecisions > auditedDecisions`（异常状态） | 3 |
| 错误路径 | `getArea('a4')` 返回正确形状、负数 delta（应禁止或 clamp） | 2 |
| 属性测试 | `checkBudgetViolation` 单调性（lowQuality 增加时 violation 从 false → true） | 2 |
| 集成测试 | A4 计数器与 Mission reviewer decisions 对接（占位接口验证） | 2 |
| **小计** | | **13** |

### A5 深度测试 — `tests/unit/deep/a5-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | `budgetPressureLevel` 各阈值（low/medium/high）、`ContextBudgetPlanner` 完整生命周期 | 6 |
| 边界条件 | `resumedMaxWorkers=0`、`resumedMaxWorkers=MAX_SAFE_INTEGER`、初始 `maxWorkers=0`、`estimatedTokens=0`/`totalTokens=0` | 5 |
| 错误路径 | `replanOnResume` 在 `plan()` 之前调用、`startWave` 未知 wave | 2 |
| 属性测试 | `replanOnResume` 多次调用 `resumeReexecutions` 单调递增、`hasReexecuted` 一旦 true 永不回 false | 2 |
| 并发测试 | 并发 `replanOnResume` 调用 | 1 |
| 压力测试 | 100-turn session 模拟（100 次 plan + resume） | 1 |
| 集成测试 | A5 plan adoption 计数器 increment 调用点验证 | 2 |
| **小计** | | **19** |

### A6 深度测试 — `tests/unit/deep/a6-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 功能完整性 | `computeCheckpointFileHashes`、`fingerprintToRecord`/`FromRecord` 往返、`isMutatingToolRequest` 各工具类型 | 6 |
| 边界条件 | `MAX_FINGERPRINT_BYTES=16MB` 边界（恰好等于/超过）、`MAX_FILES_PER_DIRECTORY=10_000` 边界、空目录、单文件目录、深度嵌套（10 层） | 6 |
| 错误路径 | symlink loop（ELOOP）、permission denied（EACCES）、stat-read race、文件在 diff 期间被修改 | 5 |
| 属性测试 | `getFileFingerprint` 确定性（同内容同哈希）、`diffFileFingerprints` 集合代数（`added ∪ removed ∪ modified ∪ touched = before Δ after`） | 3 |
| 并发测试 | 并发 `getFileFingerprint` 同文件、并行 `coordinatePause` 调用 | 2 |
| 跨平台 | Windows 反斜杠归一化（`relPath.split('\\').join('/')`）、混合分隔符 | 2 |
| 集成测试 | `ResumeContractVerifier` 真实 rollback 场景、`FingerprintLeaseCoordinator` lease-checkpoint 顺序 + 失败恢复 | 3 |
| **小计** | | **27** |

### 跨领域深度测试 — `tests/unit/deep/cross-area-deep.test.ts`

| 类别 | 测试用例 | 数量 |
|------|----------|------|
| 真实工作负载 | 100-turn session 模拟（A1 trace + A5 plan + A3 classify 累计）、内存增量测量 | 2 |
| 集成测试 | A1+A6 真实 fs-diff（写文件 → fingerprint → diff → 验证 undeclared 检测） | 2 |
| 属性测试 | trace truncation 在任意 span 数下保持 `spans.length ≤ threshold`、namespace rejection 在任意 area 组合下一致 | 2 |
| **小计** | | **6** |

---

## Phase 3: 执行深度测试，采集量化结果

**动作**：
- 运行全部深度测试文件
- 采集每模块：pass rate、测试数、p99、内存增量
- 输出：`deep-test-results.md`（量化结果表）

**预期输出格式**：
```
| 模块 | 深度测试数 | Pass rate | p99 | 内存增量 | 短板 |
|------|-----------|-----------|-----|---------|------|
| A1   | 24        | ?%        | ?ms | ?MB     | ?    |
| A2   | 26        | ?%        | ?ms | ?MB     | ?    |
| A3   | 23        | ?%        | ?ms | ?MB     | ?    |
| A4   | 13        | ?%        | ?ms | ?MB     | ?    |
| A5   | 19        | ?%        | ?ms | ?MB     | ?    |
| A6   | 27        | ?%        | ?ms | ?MB     | ?    |
| 跨领域| 6         | ?%        | ?ms | ?MB     | ?    |
```

---

## Phase 4: 短板分析与优化方案

**短板判定规则**：
1. Pass rate < 100% → **功能短板**（需修复）
2. p99 > Stage 4 预算 → **性能短板**（需优化）
3. API 覆盖率 < 70% → **覆盖短板**（需补测试）
4. 错误路径 pass rate < 100% → **健壮性短板**（需加固）
5. 属性测试失败 → **正确性短板**（需修复不变量）

**优化方案模板**（每模块独立）：
```
## {模块} 短板分析与优化方案

### 量化结果
- Pass rate: ?%
- p99: ?ms (预算: ?ms)
- 内存: ?MB
- API 覆盖率: ?%

### 短板定位
1. [短板 1]: {描述} — {量化数据}
2. [短板 2]: {描述} — {量化数据}

### 优化方案
1. [优化 1]: {方案} — 预期效果
2. [优化 2]: {方案} — 预期效果

### 优先级
- P0: {必须修复}
- P1: {应该修复}
- P2: {可以优化}
```

---

## 执行计划

| 步骤 | 内容 | 产出 |
|------|------|------|
| Step 1 | Phase 1 基线测量 | baseline 量化表 |
| Step 2 | Phase 2 编写 7 个深度测试文件 | 138 个新测试 |
| Step 3 | Phase 3 执行深度测试 | deep-test-results.md |
| Step 4 | Phase 4 短板分析 + 优化方案 | optimization-plan.md |
| Step 5 | 最终验证 typecheck + 全量 test | 验收报告 |

**总测试增量**：138 个新测试（24+26+23+13+19+27+6）

**不修改源码**：所有测试通过现有公开 API 编写；若发现 bug，记录到优化方案但不在线修复（保证测试结果纯净）。

**例外**：若深度测试发现源码有真实 bug（非测试编写错误），标记为 P0 短板，但仍不在本流程修复，由用户决策。
