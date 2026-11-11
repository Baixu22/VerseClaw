---
lifecycleStatus: active
id: recovery-contract-eval
title: 冻结恢复评测契约、故障窗口矩阵与量化门槛
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 在真实恢复测量之前冻结 TF-0709 的评测契约：五个故障窗口、每窗口至少三次重复、三十对长会话样例、九个指标与量化门槛，并提供纯函数评分器；本节点只写契约与纯函数，不改生产恢复行为、不翻转默认开关。
humanEvidence: not-required
diffBase: 99c142fef
touchedAreas:
  - harness/specs/tasks/recovery-contract-eval.md
  - shared/recovery-contract-eval.ts
  - tests/unit/recovery-contract-eval.test.ts
  - docs/dev/recovery-contract/EVAL-CONTRACT.zh-CN.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
expectedUserBehavior:
  - 维护者可以从一个冻结 manifest 读出恢复评测必须覆盖的五个故障窗口、每个窗口的证据要求与重复次数。
  - 后续测量不能悄悄缩小样本或放宽门槛；重新生成 manifest 会改变 hash，旧测量自动失效。
  - 样本不足、脚本化 provider 冒充质量证据或测量越过冻结 workload 时，结果明确为 EVIDENCE_INSUFFICIENT，而不是绿色通过。
  - 评测契约本身不改变任何运行时恢复行为、不改变产品默认值；PASS 只代表契约门槛被满足，不代表默认开关被翻转。
requiredTests:
  - pnpm exec vitest run tests/unit/recovery-contract-eval.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/recovery-contract-eval.md
  - pnpm run typecheck
acceptance:
  - shared/recovery-contract-eval.ts 冻结恰好五个窗口 intent-after-persist-kill、effect-before-receipt-kill、child-created-before-parent-advance-kill、store-write-failure、repeated-restart，且每个窗口包含注入点、预期可观察状态、禁止重跑区、允许重跑区、所需磁盘证据五个标注字段。
  - MIN_REPEATS_PER_WINDOW=3；manifest 的每个窗口 minRepeats 不低于 3。
  - MIN_LONG_SESSION_PAIRS=30；manifest 至少 30 对长会话样例，compression/handoff/fork/restart/revocation 每个 family 至少 6 对。
  - evaluateRecoveryContractEval 在任一窗口完整重复少于 3 次或 live-provider 长会话对少于 30 时返回 EVIDENCE_INSUFFICIENT；不完整域的指标为 null，绝不补 0。
  - 冻结 manifest hash 在重复生成时稳定；任何窗口标注、门槛或样本改动都会被 hash 校验或阈值校验拒绝。
  - 同一冻结 epoch 的窗口矩阵和长会话 workload 必须匹配 canonical manifest；重新计算输入 hash 和 manifest hash 后的变更仍被拒绝。
  - 每条已提交观测都进入完整性检查；达到完整样本配额后追加的不完整观测仍返回 EVIDENCE_INSUFFICIENT，所在证据域与共同延迟指标保持 null。
  - metrics 始终包含 duplicateEffects、lostTasks、terminalCorrectness、unknownClassifiableRate、mustPreserveFidelity、falseCompletionClaims、nextActionAccuracy、recoveryLatencyP50、recoveryLatencyP95 九个字段。
  - 只有九个指标门槛与磁盘证据/禁止重跑完整性全部通过时 status 才为 PASS 且 qualityClaimAllowed=true；否则为 FAIL 或 EVIDENCE_INSUFFICIENT。
  - scripted-provider 与 agent-derived 长会话行只记录、不计入 live-provider 质量证据。
  - docs/dev/recovery-contract/EVAL-CONTRACT.zh-CN.md 说明先冻结再测量的原因、矩阵表、指标定义、冻结流程与未测边界（脚本化 provider 不能当质量证据）。
  - 所有产物标注 driven_by: agent、actor: recovery-eval-agent，realHumanEvidence=false；不声称真人证据。
  - 不修改生产恢复行为、不翻转任何默认开关；本节点不做真实测量，只交付可执行的评测契约与纯函数。
docs:
  required: true
  files:
    - docs/dev/recovery-contract/EVAL-CONTRACT.zh-CN.md
readmeUpdates: not-required
---

# TF-0709 — 冻结恢复评测契约

本节点是 eval 构建节点，不是恢复实现节点。它只交付“怎么测、测到什么程度才算过”的冻结契约和纯评分函数，不接入生产恢复路径，也不改变任何默认开关。

## 为什么要先冻结

恢复类问题最容易在测量后被“解释掉”：样本少了就补几个、某个窗口失败就换注入点、延迟超标就换统计口径。这样得到的绿色没有可比性。TF-0709 因此在任何一次真实恢复测量之前冻结：

- 五个故障窗口及其五个标注字段；
- 每个窗口至少三次重复；
- 至少三十对长会话样例，五个 family 各至少六对；
- 九个指标与量化门槛；
- manifest hash 与 freeze epoch。

任何窗口、标注、样本或门槛的改动都会改变 manifest hash。旧测量必须作废，新测量必须使用新的 freeze epoch，并重新记录变更理由。

## 故障窗口

| 窗口 id | 注入点 | 预期可观察状态 | 禁止重跑区 | 允许重跑区 | 所需磁盘证据 |
|---|---|---|---|---|---|
| intent-after-persist-kill | intent 已写入并 fsync，provider 尚未 dispatch | 恰好一条持久化 intent；无 assistant 输出；turn 可恢复 | 不重新追加已持久化 intent；不重放已开始的 tool call | 从持久化 intent 调度尚未开始的 turn | turn-intent journal、transcript tail、recovery decision |
| effect-before-receipt-kill | 外部副作用已提交，effect receipt 尚未持久化 | effect 恰好一次；缺失 receipt 被标为 unknown，绝不静默重放 | 不重放可能已提交副作用的 tool invocation | 用 idempotency key 对账，或标记 unreceipted 并要求显式继续 | effect log/idempotency key、tool invocation record、receipt reconciliation |
| child-created-before-parent-advance-kill | child task 已持久化，parent 尚未 advance | child 恰好一次并已关联 parent；parent 保持 pre-advance | 不创建第二个 child；不重跑 child 初始化 | 校验 child identity 后重新关联并推进 parent | child task record、parent task journal、parent-child link |
| store-write-failure | store write 期间、写确认前 | 写失败被报告；不静默成功；旧持久化状态仍可读 | 不在未确认写入时报告成功或推进状态 | 重试同一幂等写，或回退到 append-only journal | store write error、last durable snapshot/journal offset、retry/fallback decision |
| repeated-restart | 同一恢复边界重启至少三次 | 每次重启收敛到同一 task state；无重复 effect、无 orphan child | 不重放已完成 effect；不重建已存活 child | 重扫 journal、重连存活 child、只恢复尚未提交的步骤 | restart counter、每次重启的 replay checkpoint、最终 task/effect/child state dump |

以上五个字段是 manifest 中的 `injectionPoint`、`expectedObservableState`、`forbiddenRerunRegion`、`allowedRerunRegion`、`requiredDiskEvidence`。测量时 `RecoveryWindowTrial.injectionPoint` 必须与冻结标注完全一致，否则该 trial 不计入完整重复。

## 长会话样例

`shared/recovery-contract-eval.ts` 生成 30 对确定性长会话样例，按 family 轮转分配，每个 family 6 对：

- `compression`：压缩后继续，必须保留目标、约束、决定、下一步。
- `handoff`：跨 session 交接，只从已接受事实继续。
- `fork`：分支恢复不得继承 sibling state。
- `restart`：进程重启后恢复 transcript tail 与 pending step。
- `revocation`：撤销后不得复活被撤销事实。

每对样例都带有 `mustPreserve`、`expectedNextAction`、`forbiddenCompletionClaims` 和输入 hash。测量结果必须引用冻结 workload 中存在的 pair id；不在 workload 中的 measurement 直接使证据无效。

## 指标与门槛

| 指标 | 定义 | 门槛 |
|---|---|---|
| duplicateEffects | 所有完整窗口 trial 的重复副作用计数之和 | = 0 |
| lostTasks | 所有完整窗口 trial 的丢失任务计数之和 | = 0 |
| terminalCorrectness | 正确终态的窗口 trial 数 / 完整窗口 trial 数 | = 1 |
| unknownClassifiableRate | 无法归类的窗口 trial 数 / 完整窗口 trial 数 | <= 0.02 |
| mustPreserveFidelity | live-provider 长会话中保留的 mustPreserve 事实数 / 应有事实数 | = 1 |
| falseCompletionClaims | live-provider 长会话中出现虚假完成声明的次数 | = 0 |
| nextActionAccuracy | live-provider 长会话中 next action 正确的比例 | >= 0.95 |
| recoveryLatencyP50 | 完整窗口 trial 与 live-provider 长会话恢复延迟的 P50 | <= 5000 ms |
| recoveryLatencyP95 | 同一延迟集合的 P95 | <= 15000 ms |

此外还有两条完整性门槛：每个完整窗口 trial 的 `diskEvidenceComplete` 必须为 true；`rerunOutsideAllowedRegion` 必须为 false。

指标在对应证据域不完整时为 `null`，不是 0。例如一个窗口只有两次完整重复时，窗口域指标全部为 `null`；只有脚本化 provider 长会话时，长会话域指标全部为 `null`。

## 评测流程

1. 运行 `buildRecoveryContractManifest()`，得到确定性 manifest 与 `manifestHash`。
2. 运行 `assertFrozenRecoveryContractManifest()`；只有 `ok=true` 的 manifest 才允许进入测量。
3. 按五个窗口执行故障注入，每个窗口至少三次完整重复；每次记录注入点、指标、延迟、磁盘证据读取结果和 evidenceRef。
4. 按冻结的 30 对长会话执行恢复测量；只有 `measurementBasis='live-provider'` 计入质量证据。
5. 运行 `evaluateRecoveryContractEval({ manifest, windowTrials, longSessionMeasurements })`。
6. 保存结果。`EVIDENCE_INSUFFICIENT` 表示样本不够或证据无效；`FAIL` 表示样本完整但门槛未过；`PASS` 才表示契约门槛满足。
7. 任何对窗口、标注、样本或门槛的改动都必须生成新 manifest、新 freeze epoch 和新的测量；不得复用旧数据。

## 不在本节点范围内

- 不执行真实恢复测量，不产生恢复延迟或收益数字；本节点只冻结口径。
- 不修改 `openclaw_runtime`、Electron Main、renderer 或任何生产恢复路径。
- 不翻转任何产品锁、默认开关或配置默认值。
- 不把脚本化 provider、agent-derived 输出或合成 transcript 当作长会话质量证据。
- 不声称真人证据；所有自动化产物标记 `driven_by: agent`、`actor: recovery-eval-agent`、`realHumanEvidence: false`。
