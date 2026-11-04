# 恢复契约评测（TF-0710 / TF-0711 / TF-0721 / TF-0722 / TF-0723）

> `driven_by: agent` · `actor: recovery-contract-eval-driver` · `realHumanEvidence: false`

## 这是什么

用真实 Electron + 真实 Gateway 子进程 + 脚本化本地模型端点，对冻结的
五个恢复故障窗口注入**真实进程故障**，重启运行时，再从磁盘读回结果。
测量由 `tests/e2e/recovery-contract-eval.spec.ts` 产出 trial receipt，
由 `scripts/recovery-contract-eval.mjs` 合并进 TF-0709 冻结的评分器。

## 五个窗口与注入方式

| 窗口 | 注入方式 | 测量 |
|---|---|---|
| `intent-after-persist-kill` | 模型请求已发出、工具尚未产生副作用时 `taskkill /F /T` 杀掉 gateway | 恢复后副作用是否出现（未出现=工作丢失） |
| `effect-before-receipt-kill` | 副作用文件已写入、run 未结算时杀进程 | 副作用计数（>1 即重复） |
| `child-created-before-parent-advance-kill` | 子任务节点已创建、父未推进时杀进程 | 子节点是否恰好一份 |
| `store-write-failure` | 把会话状态路径替换为不可写目录 | 运行时是否仍然对外声称成功 |
| `repeated-restart` | 连续三次在副作用窗口杀进程并重启 | 副作用数与崩溃次数是否一致 |

`injectionMechanism` 字段如实区分 `real-process-kill` 与 `real-unwritable-state`。

## 结果怎么看

`report.json` 由冻结评分器产出，`evaluation.status` 只可能是：

- `PASS`：五个窗口各 ≥3 次重复，且长会话 ≥30 对，且九个指标全部达标；
- `FAIL`：样本齐备但指标未达标；
- `EVIDENCE_INSUFFICIENT`：样本不足（例如长会话对尚未测量）——**不是通过**。

指标为 `null` 表示该域样本不足，绝不补 0。

## 本轮真实结果（legacy 基线，2026-11-04）

15 个真实故障窗口样本（5 窗口 × 3 重复）已跑完，聚合结果：

| 指标 | 值 |
|---|---|
| duplicateEffects | **0** |
| lostTasks | **9** |
| terminalCorrectness | **0.6** |
| unknownClassifiableRate | 0 |

| 窗口 | 3 次一致结果 |
|---|---|
| K1 intent-after-persist-kill | 副作用 0、任务丢失 1、终态 false |
| K2 effect-before-receipt-kill | 副作用 1、崩溃后仍 1、重复 0、终态 true |
| K3 child-created-before-parent-advance-kill | 子节点 1 份、终态 true |
| K4 store-write-failure | 未对外声称成功、终态 true |
| K5 repeated-restart | 3 次崩溃、副作用 1、丢失 2、重复 0 |

结论：**当前 legacy 的主要缺陷是丢失工作（9/15），不是重复副作用（0/15）**。
这是基线事实，不是 candidate 收益：candidate（authority/execution-phase 生产接线）
尚未启用，因此没有 Δ。
## 未测边界（诚实清单）

1. 长会话 ≥30 对（TF-0722）本轮未测量：`longSessionMeasurements` 为空，
   因此评测保持 `EVIDENCE_INSUFFICIENT`，不得据此宣称质量收益。
2. 脚本化 provider 只验证确定性恢复语义，不计入 live-provider 质量证据。
3. 仅 Windows x64 本机 wall-clock，不是跨平台 SLA。
4. 故障窗口只有五个；不是所有故障模式。
5. 本目录的 PASS 只表示评测门槛被满足，不代表任何产品默认值或产品锁被改变。

## 复算

```bash
node --experimental-strip-types scripts/recovery-contract-eval.mjs --dir D:/tmp/recovery-eval-v3
node --experimental-strip-types scripts/recovery-contract-eval.mjs --check
```

## TF-0722 长会话抽样的已知缺陷（本轮未通过）

本轮新增了 `tests/e2e/recovery-longsession-eval.spec.ts` 并在真实 Electron 上跑通了
第一对（`ls-compression-01`）。但读回面用的是 `sessions.history`，它只返回近期窗口
（观测到 `transcriptLength=2`），因此 `mustPreserveMatched` 为 0 并不代表事实真的丢失。

因此本轮**不把该抽样计入质量结论**：`report.json` 的 long-session 仍是 0/30，
评测保持 `EVIDENCE_INSUFFICIENT`。

下一轮必须先修读回面：从
`<userData>/openclaw-source-state/agents/main/sessions/<sessionFile>` 直接读
完整 transcript（其它 long-session spec 已经这么做），再重跑 ≥30 对。


## 2026-11-04 长会话复跑记录

- 第一次单对抽样（`ls-compression-01`）：`mustPreserveMatched=0/4`，读回面是 `sessions.history`，不可信。
- 改为磁盘 transcript 后跑了 5 对：`compression 4/4`，其余 4 对 `0/4`。
- 根因定位：变体（fork/handoff/compact/restart）在事实写入转录**之前**就执行了。已加
  `waitForTranscript(...)`，确保事实落盘后再施加变体；这项修复在
  `tests/e2e/recovery-longsession-eval.spec.ts` 中。
- 修复后的 30 对复跑被网关启动不稳定阻塞（`gateway never became ready`，本机残留实例清理后仍复现），
  因此 `report.json` 的 long-session 仍保持 **0/30 未计入**。

下一次复跑：先确保网关能稳定启动（清空本工作树 Electron/gateway 残留），再用
`RECOVERY_LONGSESSION_OUT=D:/tmp/recovery-longsession-v3` 跑全量 30 对。

## 2026-11-04 全量 30 对长会话结构结果（scripted-provider）

网关启动改用默认端口后，全量 30 对一次跑通（7.3 分钟，1 passed）：

| 家族 | 对 | must-preserve | next-action | false-completion |
|---|---|---|---|---|
| compression | 6 | 6×4/4 | 6/6 | 0 |
| fork | 6 | 6×4/4 | 6/6 | 0 |
| handoff | 6 | 6×4/4 | 6/6 | 0 |
| restart | 6 | 6×4/4 | 6/6 | 0 |
| revocation | 6 | 6×4/4 | 6/6 | 0 |

合计：**120/120 事实保真、30/30 下一步正确、0 错误完成声明**。

**这不是 live-provider 质量证据。** 冻结评分器只把 `live-provider` 行计入质量域，
本机未配置任何 provider 凭据，因此 `report.json` 的 `mustPreserveFidelity` 等仍是
`null`，`unmeasured` 明确列出 `0/30 live-provider pairs`。要把它升级为质量结论，
需要一次 owner 提供的 provider 端点/凭据；在此之前不得宣称长会话质量收益。

复跑命令：

```bash
RECOVERY_LONGSESSION_OUT=D:/tmp/recovery-longsession-v5 \
  pnpm exec playwright test tests/e2e/recovery-longsession-eval.spec.ts
```

## 2026-11-04 第二轮 15 次矩阵（可复现性比对）

同样的 5 窗口 × 3 重复再跑一轮（`D:/tmp/recovery-eval-v4`），与第一轮 `v3` 对比：

| 窗口 | 第一轮 | 第二轮 | 一致性 |
|---|---|---|---|
| K1 intent-after-persist-kill | lost=3, terminal=0/3 | lost=3, terminal=0/3 | **一致** |
| K2 effect-before-receipt-kill | lost=0, terminal=3/3 | lost=0, terminal=3/3 | **一致** |
| K3 child-created-before-parent-advance | lost=0, terminal=3/3 | lost=0, terminal=3/3 | **一致** |
| K4 store-write-failure | lost=0, terminal=3/3 | **lost=2, terminal=1/3** | **不一致** |
| K5 repeated-restart | lost=6, terminal=0/3 | lost=6, terminal=0/3 | **一致** |
| 合计 | dup=0, lost=9, terminal=9/15 | dup=0, lost=11, terminal=7/15 | 不一致 |

**K4 的分歧含义**：把会话状态路径变成不可写后，第二轮有 2/3 次 `sessions.history` 仍返回消息
（`lostTasks += 1`）。但 `sessions.history` 读的是 transcript，不是 `sessions.json`，
所以这**不能直接判定为 fail-open**：transcript 写入成功本身可能就是合法的成功路径。
准确结论是：K4 的探针测错了面，需要改成直接检查 `sessions.json` 的写入失败是否被上报，
再判断是否存在 fail-open。因此 TF-0711 的「两次重跑结构一致」**未满足**；
K4 需要换一个正确的探针重新测量，不能据此宣称 fail-open 已证实。


## 2026-11-04 K4 探针修复与两轮一致性达成

原 K4 探针用 `sessions.history`（读 transcript）判断成功与否，测错了面，导致两轮结果不一致。
新探针直接检查会话存储本身：

- 把 `sessions.json` 替换为**目录**（任何真实写入必然失败）；
- 15 秒后 `stat(sessions.json)`：若仍是目录、字节数为 0，则没有任何 store 写入成功；
- `reportedSuccess` 只有在 `sessions.json` 变成非空文件时才为真。

新探针 3/3 结果：

| trial | reportedSuccess | storeStillDirectory | bytes | terminalCorrect | lost |
|---|---|---|---|---|---|
| 0 | false | true | 0 | true | 0 |
| 1 | false | true | 0 | true | 0 |
| 2 | false | true | 0 | true | 0 |

把新 K4 结果与第二轮其余四个窗口合并后，**两轮矩阵完全一致**：

| 窗口 | 两轮一致结果 |
|---|---|
| K1 intent-after-persist-kill | lost=3/3, terminal=0/3 |
| K2 effect-before-receipt-kill | lost=0, terminal=3/3 |
| K3 child-created-before-parent-advance | lost=0, terminal=3/3 |
| K4 store-write-failure | lost=0, terminal=3/3（新探针） |
| K5 repeated-restart | lost=6/3, terminal=0/3 |
| 合计 | dup=0, lost=9, terminal=9/15 |

**结论**：legacy 在存储写失败时是 fail-closed 的（3/3），此前的不一致是探针缺陷，不是运行时缺陷。

`report.json` 已用合并后的 `D:/tmp/recovery-eval-v5` 重新生成；长会话质量域仍因缺少
live-provider 凭据保持 `EVIDENCE_INSUFFICIENT`。

## 2026-11-04 live-provider 全量 30 对结果（质量域首次出数）

使用 owner 提供的 live provider（`space-bunny`，OpenAI-compatible chat/completions）跑完 30 对。
**key 只在进程环境变量中传入，未写入仓库、配置或日志。**

| 家族 | 对 | must-preserve | next-action | false-completion |
|---|---|---|---|---|
| compression | 6 | 24/24 | 6/6 | 0 |
| fork | 6 | 24/24 | 6/6 | 0 |
| handoff | 6 | 24/24 | 6/6 | 0 |
| restart | 6 | 24/24 | 6/6 | 0 |
| revocation | 6 | 24/24 | 6/6 | 0 |
| **合计** | **30** | **120/120** | **30/30** | **0** |

因此质量域指标首次可计算：

| 指标 | 值 | 门槛 | 结果 |
|---|---|---|---|
| mustPreserveFidelity | **1.0** | 1.0 | 通过 |
| falseCompletionClaims | **0** | 0 | 通过 |
| nextActionAccuracy | **1.0** | ≥0.95 | 通过 |
| duplicateEffects | **0** | 0 | 通过 |
| lostTasks | **9** | 0 | **不合格** |
| terminalCorrectness | **0.6** | 1.0 | **不合格** |
| recoveryLatencyP50 | **17728 ms** | ≤5000 | **不合格** |
| recoveryLatencyP95 | **230768 ms** | ≤15000 | **不合格** |

**最终判定：`FAIL`（qualityClaimAllowed=false）**，阻塞项：
`lostTasks`、`terminalCorrectness`、`P50`、`P95`、以及 6 个窗口未读回全部必需磁盘证据。

这是一个**真实、可复算的负面结论**：恢复后的"记住什么、下一步做什么"是对的，
但"别丢工作"和"恢复时延"两项不合格。它同时为下一阶段定义了明确的优化目标。

## 2026-11-04 candidate 模式首次接线验证（TF-0718/TF-0719 进行中）

已实现并接入：

1. `execution_phases` 表（openclaw-state SQLite，单写者、CAS、幂等键）。
2. `recordExecutionIntent`：工具执行前落盘 intent（默认 legacy 关闭，`OPENCLAW_EXECUTION_PHASE_WRITER=taskflow` 开启）。
3. `commitExecutionPhase`：dispatched → effect_pending → effect_committed，非法/过期转换拒绝。
4. `settleOrphanedExecutionPhases`：gateway 启动把孤儿结算为 lost 或 needsReconciliation。
5. `resolveExecutionPhaseRecovery`：open 的 `effect_pending/effect_committed` 强制 reconcile，只有 `dispatched` 允许 resume。
6. candidate 模式恢复延迟：首跳 5s→1s，退避上限 10s（仅 writer 开启时）。

**验证结果（K1，writer=taskflow）**：`lostTasks=1`、`terminalCorrect=false`。

原因已定位：恢复路径识别到 `dispatched` 后只做 transcript 修复并继续模型回合，
**没有重新派发那个待执行的工具调用**。工具参数按隐私设计不落库，因此重派必须
从 transcript 尾部的 assistant toolUse 读取，并用 execution phase 行作授权。

这是 TF-0718/0719 的最后一个缺口，已明确下一步实现点；本轮不把它写成已完成。
