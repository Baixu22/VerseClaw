# 恢复评测契约（Recovery Contract Eval）

- 任务：TF-0709「冻结恢复评测契约、故障窗口矩阵与量化门槛」
- Schema：`RecoveryContractManifest/v1` / `RecoveryContractEval/v1`
- 冻结 epoch：`2026-11-03T00:00:00.000Z`
- 证据标签：`driven_by: agent`、`actor: recovery-eval-agent`、`realHumanEvidence: false`
- 边界：本文件与 `shared/recovery-contract-eval.ts` 只定义评测契约和纯评分函数，**不修改生产恢复行为，不翻转任何默认开关**。

## 1. 为什么先冻结再测量

恢复能力的评测很容易被事后解释：

- 某个窗口失败，就换一个更温和的注入点；
- 长会话样本不够，就补几个“看起来差不多”的样例；
- 延迟超了，就换一个统计口径；
- 只看成功案例，不看重复副作用、丢失任务和虚假完成声明。

这样得到的绿色结果无法比较，也无法证明恢复保证。TF-0709 采用“预注册（pre-registration）”顺序：先冻结窗口、样本、指标和门槛，再开始测量。冻结的 manifest 带 SHA-256 hash；任何字段改动都会改变 hash，旧测量自动失效，必须使用新的 freeze epoch 重测并在证据中记录改动理由。

这不是流程洁癖，而是恢复评测的核心信任来源：**测量结果的可信度首先来自测量前就固定了失败条件，而不是来自测量后对结果的解释。**

## 2. 冻结对象

`shared/recovery-contract-eval.ts` 中的 `buildRecoveryContractManifest()` 生成确定性 manifest，包含：

1. `frozenAt = 2026-11-03T00:00:00.000Z`，`frozenBeforeMeasurement = true`；
2. 恰好五个故障窗口，每个窗口带五个标注字段；
3. 至少 30 对长会话样例，五个 family 各至少 6 对；
4. 九个指标与量化门槛；
5. 由 manifest 内容计算的 `manifestHash`。

`assertFrozenRecoveryContractManifest()` 会拒绝以下情况：

- 窗口数量不是 5、窗口顺序变化、缺少某个窗口或出现未知窗口；
- 任一窗口缺少五个标注字段中的任何一个；
- 任一窗口 `minRepeats < 3`；
- 长会话少于 30 对，或任一 family 少于 6 对；
- 样例 id / pairIndex 重复，或样例输入 hash 不匹配；
- 九个门槛中的任何一个被修改；
- manifest hash 与内容不匹配。

## 3. 故障窗口矩阵

| 窗口 id | 注入点（injectionPoint） | 预期可观察状态（expectedObservableState） | 禁止重跑区（forbiddenRerunRegion） | 允许重跑区（allowedRerunRegion） | 所需磁盘证据（requiredDiskEvidence） |
|---|---|---|---|---|---|
| `intent-after-persist-kill` | intent 已追加并 fsync，provider 尚未 dispatch | 恰好一条持久化 intent；无 assistant 输出；turn 可恢复 | 不重新追加已持久化 intent；不重放已开始的 tool call | 从持久化 intent 调度尚未开始的 turn | turn-intent journal、session transcript tail、recovery decision |
| `effect-before-receipt-kill` | 外部副作用已提交，effect receipt 尚未持久化 | effect 恰好一次；缺失 receipt 标为 unknown，绝不静默重放 | 不重放可能已提交副作用的 tool invocation | 用 idempotency key 对账，或标记 unreceipted 并要求显式继续 | effect log / idempotency key、tool invocation record、receipt reconciliation |
| `child-created-before-parent-advance-kill` | child task 已持久化，parent 尚未 advance | child 恰好一次并已关联 parent；parent 保持 pre-advance | 不创建第二个 child；不重跑 child 初始化 | 校验 child identity 后重新关联并推进 parent | child task record、parent task journal、parent-child link |
| `store-write-failure` | store write 期间、写确认前（ENOSPC / EACCES / I/O 失败） | 写失败被报告；不静默成功；旧持久化状态仍可读 | 不在未确认写入时报告成功或推进状态 | 重试同一幂等写，或回退到 append-only journal | store write error、last durable snapshot / journal offset、retry/fallback decision |
| `repeated-restart` | 同一恢复边界重启至少三次 | 每次重启收敛到同一 task state；无重复 effect、无 orphan child | 不重放已完成 effect；不重建已存活 child | 重扫 journal、重连存活 child、只恢复尚未提交的步骤 | restart counter、每次重启的 replay checkpoint、最终 task/effect/child state dump |

测量时每个 `RecoveryWindowTrial.injectionPoint` 必须与冻结标注完全一致。不一致的 trial 不会计入完整重复，避免“把注入点挪到更容易的位置”后仍然拿到绿色。

## 4. 长会话样例矩阵

| family | 最少对数 | 关注点 | 恢复后必须保留 |
|---|---:|---|---|
| `compression` | 6 | 压缩后继续 | 目标、约束、决定、下一步 |
| `handoff` | 6 | 跨 session 交接 | 已接受事实、任务范围、未完成项、下一步 |
| `fork` | 6 | 分支恢复 | 分支身份、父任务关系、已接受事实、非 sibling 状态 |
| `restart` | 6 | 进程重启 | transcript tail、pending step、task ledger、下一步 |
| `revocation` | 6 | 撤销后继续 | 撤销事实、替代事实、不复活被撤销内容、下一步 |

总数下限：`MIN_LONG_SESSION_PAIRS = 30`。每个 family 至少 `MIN_LONG_SESSION_PAIRS_PER_FAMILY = 6` 对。样例带 `mustPreserve`、`expectedNextAction`、`forbiddenCompletionClaims` 和输入 hash；测量结果必须引用冻结 workload 中的 pair id，不能事后新增样例。

## 5. 指标定义

| 指标 | 定义 | 门槛 | 说明 |
|---|---|---:|---|
| `duplicateEffects` | 所有完整窗口 trial 的重复副作用计数之和 | = 0 | 同一副作用发生两次即失败 |
| `lostTasks` | 所有完整窗口 trial 的丢失任务计数之和 | = 0 | 恢复后任务从账本消失即失败 |
| `terminalCorrectness` | 正确终态的窗口 trial 数 / 完整窗口 trial 数 | = 1 | 终态必须明确且正确 |
| `unknownClassifiableRate` | 无法归类的窗口 trial 数 / 完整窗口 trial 数 | ≤ 0.02 | 未知状态必须可分类，不能靠“unknown”蒙混 |
| `mustPreserveFidelity` | live-provider 长会话中保留的 mustPreserve 事实数 / 应有事实数 | = 1 | 任何必备事实丢失都失败 |
| `falseCompletionClaims` | live-provider 长会话中出现虚假完成声明的次数 | = 0 | “全部完成”类声明必须可被证伪 |
| `nextActionAccuracy` | live-provider 长会话中 next action 正确的比例 | ≥ 0.95 | 恢复后要能继续做对下一步 |
| `recoveryLatencyP50` | 完整窗口 trial 与 live-provider 长会话恢复延迟的 P50 | ≤ 5000 ms | 本地 wall-clock，不是跨平台 SLA |
| `recoveryLatencyP95` | 同一延迟集合的 P95 | ≤ 15000 ms | 覆盖长尾恢复 |

另外两条完整性门槛：

- `diskEvidenceComplete`：每个完整窗口 trial 必须把该窗口的 `requiredDiskEvidence` 全部读回；缺失即失败。
- `rerunOutsideAllowedRegion`：任何 trial 在禁止重跑区执行了工作即失败。

### 指标缺失语义

`RecoveryContractEvalMetrics` 的九个字段都是 `number | null`。`null` 表示“该证据域没有完整测量”，**不是 0**。

- 任一窗口完整重复少于 3 次 → 窗口域指标保持 `null`；
- live-provider 长会话少于 30 对或任一 family 少于 6 对 → 长会话域指标保持 `null`；
- 两域都完整时才计算恢复延迟 P50/P95；
- 任何不完整样本都会让 `status = EVIDENCE_INSUFFICIENT`，绝不会用 0 补齐后误判 PASS。

## 6. 冻结流程

1. 生成 manifest：`buildRecoveryContractManifest()`。
2. 校验冻结：`assertFrozenRecoveryContractManifest(manifest)`，要求 `ok === true`。
3. 记录 manifest hash 与 freeze epoch 到测量计划。
4. 执行五个窗口的故障注入，每窗口至少 3 次完整重复；每次写清注入点、指标、延迟、磁盘证据读取结果和 evidenceRef。
5. 执行 30 对长会话测量；只有 `measurementBasis = 'live-provider'` 计入质量证据。
6. 调用 `evaluateRecoveryContractEval({ manifest, windowTrials, longSessionMeasurements })`。
7. 保存结果，按 `PASS` / `FAIL` / `EVIDENCE_INSUFFICIENT` 处理；不得把 `EVIDENCE_INSUFFICIENT` 解释成通过。
8. 如需修改窗口、标注、样本或门槛：生成新 manifest、新 freeze epoch，旧测量全部作废，不复用。

## 7. 未测边界

1. **脚本化 provider 不能当质量证据。** `scripted-provider` 与 `agent-derived` 的长会话行只用于结构演练、回归测试或流程验证，永远不计入 `live-provider` 质量证据。只有真实 provider 的测量才能支撑 `mustPreserveFidelity`、`nextActionAccuracy` 和 `falseCompletionClaims` 的质量结论。
2. **本节点不产生收益数字。** 本节点冻结的是测量口径；恢复收益（重复副作用下降、丢失任务下降、恢复延迟改善等）必须由后续真实测量按本契约产出，不能从契约本身推导。
3. **延迟是本地 wall-clock。** P50/P95 受机器、磁盘、负载和 provider 影响，不是跨平台 SLA；跨平台结论需要独立样本。
4. **磁盘证据只证明本机持久化产物存在且可读。** 它不等价于云端持久性、跨机器复制或灾难恢复保证。
5. **五个窗口不等于所有故障模式。** 本契约只覆盖已冻结的五类恢复边界；provider 长时间不可用、磁盘整体损坏、操作系统强制断电等场景不在本节点范围。
6. **不做真人验证。** 所有产物均为 agent 驱动；`realHumanEvidence=false`。需要人工判断的环节由自动化脚本/agent 等价执行并如实标注，不声称真人证据。
7. **不改变产品默认值。** 本契约的 PASS 只表示评测门槛满足，不代表任何产品锁、默认开关或发布决策被改变。

## 8. 与生产行为的关系

本节点只新增：

- `shared/recovery-contract-eval.ts`（纯类型、常量、manifest builder、纯评分函数）；
- `tests/unit/recovery-contract-eval.test.ts`（契约与评分器测试）；
- `harness/specs/tasks/recovery-contract-eval.md`（任务规格）；
- 本文件（设计说明）。

不修改 `openclaw_runtime`、Electron Main、renderer、Gateway 或任何生产恢复路径。任何后续接入必须另开节点，并单独评审生产行为、默认开关和发布决策。

## 9. 证据标签

所有本节点产物必须标记：

```yaml
driven_by: agent
actor: recovery-eval-agent
realHumanEvidence: false
```

`evaluateRecoveryContractEval()` 的返回值固定包含 `drivenBy: 'agent'`、`actor`、`realHumanEvidence: false`。不得改写成 `real-human` 或任何暗示真人验证的标签。
