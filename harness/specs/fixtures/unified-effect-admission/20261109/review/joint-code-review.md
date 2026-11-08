2026-11-09 working 补口复核：**此前 P1 已在当前 working 中修复；此前取消回执 P2 保持修复。本次指定补口未发现新增 P1/P2。**

复核基线为 HEAD `a70bdacf059b88f0735ed5baebbf3c7ebeb3c93c` 加三份未提交 working 文件；本段替代下方旧结论，历史记录保留。requested model route 仍为 `ccs-workbuddy/deepseek-v4.1-flash`，实际模型未经工具确认。

- **第三方插入补口成立。** [execution-checkout-admission.ts:63](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-admission.ts:63) 在比较目标任务前读取 source delegation；writer delegation 的任务未 done/cancelled 时，retainedForDelegation 阻止通用 terminal 接管。因此 intruder 在 drain/release 前失败。canonical parent 分支仍验证 child credential、returned、父 session/generation、目标 epoch=child.epoch+1、quiescence，继续通过 transferWriter 原子换主。
- **task_control 终结清理成立。** [execution-checkout-tools.ts:125](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:125) 在 task_control 成功返回后读取当前 checkout，仅对已有 terminalReceipt 的 writer 触发 reconcile。释放仍要求所有 operation settled、无 pending process；delegated task 未终结时继续保留，done/cancelled 后可释放。此入口没有自行制造 terminalReceipt 或跳过回收条件。
- **延迟 canonical return 已有通过的回归。** 新用例使用真实 TaskSystemStore 和 managed process reservation，以合成 exec/poll 回执驱动：pending → recovery_required → reservation 释放 → poll → returned；读回父 claim 已恢复，checkout 保持 draining，未提前让出资源。

已读盘：[joint-return-retention.tests.json](D:/tmp/unified-management-20261109/joint-return-retention.tests.json) **21/21**；[joint-return-recovery.tests.json](D:/tmp/unified-management-20261109/joint-return-recovery.tests.json) **22/22**，均 success=true、0 failed、0 pending。后者已包含 returned child→intruder 拒绝→parent continuation 写入、延迟 canonical return，以及取消回执三个用例。新增 recovery 用例通过的是上述组合流程。

working 快照 SHA256：

| 文件 | SHA256 |
| --- | --- |
| execution-checkout-admission.ts | F68BD9B4ADB6B0E3895248F15D7E7A6FC52FD195234FD5954ECA015232F14394 |
| execution-checkout-tools.ts | A313E8550F5DB1E00520DCAF460FD2F9ED666546C3707FFE2DCA2B7852296F57 |
| unified-effect-admission.test.ts | 0ACAD74E2243CA54E80F12EB9AD2B2791A055C208FF6AFEE89B6A4394E025D36 |

本次只更新此报告，未修改 repo、运行测试、干预 build 或发送其他会话消息；working 修改与 Task Forest 状态保留。

—— 以下保留此前复核记录 ——

2026-11-09 修复复核更新，目标 `a70bdacf059b88f0735ed5baebbf3c7ebeb3c93c`。

**原取消回执 P2 已修复；execution state DB 绑定核查通过；child recovery 重试已接入，但“防第三方插入”尚余 1 项 P1。** 本段为当前结论，后面的原候选报告保留为历史记录。

requested model route：`ccs-workbuddy/deepseek-v4.1-flash`；实际执行模型未获工具确认。本次仅核查所述修复，未修改仓库、运行测试或干预正在进行的 build。

**P1 — 保留的 child checkout 仍可被无关任务经 terminal 分支接管。**

定位：[execution-checkout-admission.ts:84](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-admission.ts:84)、[execution-checkout-admission.ts:91](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-admission.ts:91)。相关修复：[execution-checkout-tools.ts:68](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:68)。

合法生产触发顺序：

1. 任务 T 的 parent P 将同一物理 checkout 的 writer 委派给 child C。C 结束时仍有 background process，因此 canonical delegation 进入 recovery_required，checkout 保留 terminalReceipt 和 unknown operation。
2. process 完成并经 poll/reconcile 结算。新逻辑读取 P 当前 session generation，调用 returnPersistentTaskWriter；TaskSystemStore 将 T 的 claim 归还 P，epoch=child.epoch+1，delegation.phase=returned。由于 T 非 terminal，reconcileExecutionCheckout 正确保留 C 的 draining checkout writer。
3. 在 P 下一次 grant 之前，同一 checkout 上另一个已获得自身任务 U claim 的正常运行 X 请求 write。任务 U 与 T 不同；当前架构允许不同任务分别拥有有效 task claim，checkout writer 再负责资源排他。
4. admission 对 U 的 assertTask 通过。因为 former.task.taskNodeId=T 与目标 U 不同，第 62 行跳过 source delegation 校验；此时 C 已 quiescent，effects/processes 都为零，previous.terminalReceipt 存在，因此第 84 行令 terminal=true。第 85 行放行，第 91、92 行直接 release C → claim X。X 随后可执行真实文件写入，P 的后续请求则被 X 占用的 writer 阻断。

该调用顺序只用现有 task、delegation、poll 和 admission 入口，无需 DB 篡改或外部 mapping 变更。它破坏本次修复声明的父子交接期间连续排他性，属于顺序上的第三方插入；单一 active writer 约束本身仍成立。

仅在 reconcile 中跳过 release 不足以完成保留语义，因为 admission 中仍有另一条主动 release 路径。当前代码的关键组合是：

```ts
const terminal = Boolean(previous.terminalReceipt && observed.quiescent
  && observed.inFlightEffects === 0);
// terminal 即可放行；不同 task 随后走 releaseWriter + claimWriter
```

最小补口：在允许通用 terminal 接管前，使用现有 TaskSystemStore 读取 **former 对应的 task 与 delegation**，不能只在 source/target task 相同时才读取。若 source 精确匹配非 terminal 任务的 writer delegation（child task/session/generation/epoch/runId 及 checkout 身份），将其视为交接保留；只允许现有 canonicalTransfer 校验通过的目标继续，否则返回 checkout_writer_busy。done/cancelled 任务仍走既有终结释放规则。继续使用已有 transferWriter 的 epoch/token CAS，不新增 mapping revision、第二 fence 或跨 authority 共享事务。

最小回归：在同一 checkout 构造 P→C、background、C terminal、recovery_required；通过实际 reconcileExecutionCheckout 路径完成 canonical return，然后在 P grant 前插入独立任务 U 的 admission。断言 U 的 effect spy 未调用，真实文件仍保留 C 的内容，C writer token/epoch 未因 U 改变；随后 P grant 成功 CAS 换主，旧 C credential 失效。另保留 T 真正 terminal 后可正常让出 checkout 的正例。该测试应覆盖组合 admission，而非仅在 writer primitive 层验证无中间空档。

**三项修复读回。**

| 修复 | 本次结论与依据 |
| --- | --- |
| 取消后 completed 回执 | 已解决原 P2。[store.ts:1450](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1450) 将 cancelledReplay 扩为 completed/reconciled，仍要求 cancelled、精确 epoch+1、同 sessionKey/generation/worktree；新写入继续受 assertOwner 约束。新增 background cancel/poll 用例断言任务 cancelled、旧 owner 失效、writer released。 |
| Main/sourceRuntime 共用 execution DB | [process-launcher.ts:164](D:/ClawX-work/session-task-unified-relay-20261109/electron/gateway/process-launcher.ts:164) 用 host process.env 解析路径并写入子进程 CLAWX_EXECUTION_STATE_PATH；原 forkEnv 的 OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH 保持原值。[execution-state-db.ts:6](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/state/execution-state-db.ts:6) 拒绝显式相对路径，读取与写事务均向原 openclaw-state-db 传入同一 path；底层按该 path 打开并缓存连接。registry、writer、domain、managed-process-reservation 四个 owner 均已改用此入口，未发现此次绑定遗漏。 |
| child recovery 自动 return | [execution-checkout-tools.ts:60](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:60) 先要求 terminalReceipt、全部 checkout operation settled、无 pending process，再对 recovery_required + terminalReceipt 重试既有 returnPersistentTaskWriter。getSessionEntry 按父 sessionKey 推导 agentId，从当前 runtime session store 读取 generation；父 generation 缺失或变更仍由 returnDelegatedWriter 保持 recovery_required。该恢复调用已接上；非 terminal delegated task 的 checkout 保留还需上述 admission 补口。 |

finishExecutionCheckoutRun 新增 finally 删除 runCheckouts 内存索引；durable writer 仍保存于共享 execution DB，terminal identity fallback 和 process-read reconciliation 的既有查找路径保留。

**已读盘的回归证据。**

| 产物 | 结果 |
| --- | --- |
| [joint-cancel-receipt.tests.json](D:/tmp/unified-management-20261109/joint-cancel-receipt.tests.json) | success=true，20/20 passed，0 failed，0 pending；含新增取消后 completed process 回执用例。实际数量为 20。 |
| [joint-state-sharing.tests.json](D:/tmp/unified-management-20261109/joint-state-sharing.tests.json) | success=true，36/36 passed，0 failed，0 pending；含切换隔离 stateDir、关闭连接重开后读取同一 writer token 并结算的用例。 |
| [joint-launch-state.tests.json](D:/tmp/unified-management-20261109/joint-launch-state.tests.json) | success=true，5/5 passed，0 failed，0 pending；含 host execution path 与 source session stateDir 并存的用例。 |

上述产物为已存在的定向测试结果，本次只读解析；P1 依据源码完整调用分支确认，未执行新复现。用户告知本轮 build 正在进行，未将前一轮 build/E2E 状态改写为本轮成功。开始及结束观察 HEAD 均为 a70bdacf0、git status 干净；Task Forest 保持原状态。

—— 以下保留 389ebfb23 的原始复核记录 ——

候选 `389ebfb23cfaab5dbd3c81c749841c9420105e39` 只读组合复核：新增 **1 项 P2**；本次指定路径内未确证额外 P1、旧身份绕过或提前释放 writer。P2 是取消后的已完成 process 回执无法被 checkout 结算，导致物理 checkout 持续占用。

- 工作树：`D:/ClawX-work/session-task-unified-relay-20261109`。
- requested model route：`ccs-workbuddy/deepseek-v4.1-flash`。本次工具没有确认实际执行模型；不根据角色文案推断。
- 复核日期：2026-11-09。源代码分析使用 `git show 389ebfb23:<path>`。
- 用户提供的验证状态：joint 18、writer 35、A4 63、durable 79、Mission 7、fence 4 已过；Node/runtime/desktop build 已过；actual E2E 正在运行。本次没有执行测试或构建。
- 用户已知的两项补口继续保留：child 因 process pending 进入 recovery_required 后自动重试 canonical return；adapted.execute 第五参数改用 ExtensionContext。以下发现不重复这两项。

**P2 — cancelling background 操作完成后，checkout 拒绝读取 completed 回执，永久保留 unknown 操作。**

主要位置：[store.ts:1450](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1450)，调用位置：[execution-checkout-tools.ts:48](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:48)。

正常生产调用顺序如下，无需直接修改数据库，也无需子任务委派：

1. 当前任务/运行通过 executeManagedTaskTool 执行 background exec，返回 `details.status='running'` 与 process sessionId。TaskSystemStore 将该 operation 记为 unknown；checkout 同样记为 unknown/draining。依据：[runtime.ts:283](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:283)、[execution-checkout-tools.ts:137](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:137)。
2. 经现有 task_control 或 Main task command 取消该任务。由于 pendingOperations 大于零，control(cancel) 只将 contract 置为 cancelling，保留原 claim epoch `e`，因此所属运行仍可执行 process.poll 以收取退出事实。依据：[store.ts:1087](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1087)、[runtime.ts:254](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:254)。
3. 进程正常退出，例如 exitCode=0。实际 process.poll 返回 `{status:'completed', sessionId, exitCode:0}`。reconcileProcessResult 将 Task operation 从 unknown 改为 **completed**，然后 settleCancellation 将 contract 改为 cancelled、claim 置 released 且 epoch 改为 `e+1`，删除 writer binding。依据：[bash-tools.process.ts:418](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/bash-tools.process.ts:418)、[store.ts:1506](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1506)、[store.ts:1427](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1427)。
4. 同一次 poll 接着调用 reconcileAfterProcessRead → reconcileExecutionCheckout。后者使用 checkout 中原 epoch `e` 的精确身份调用 store.operation。其 cancelledReplay 只接受 `row.state === 'reconciled'`，不接受本步骤产生的 **completed**；assertOwner 因 `e !== e+1` 抛出 TASK_STALE_OWNER。该错误被 `catch { continue; }` 吞掉，checkout operation 继续 unknown。
5. run terminal 再执行 endWriter/reconcile 仍遇到同一拒绝；即使 process reservation 已释放，writer.operations 尚未全部 settled，releaseWriter/transferWriter 都会阻断。后续任务对这个物理 checkout 的写入因此持续失败。

该错误是**已有权威完成事实未被消费导致的占用泄漏**，不是安全 guard 放行。它发生在普通任务取消路径，独立于已知的 child return 自动重试缺口。

最小补口：在 TaskSystemStore.operation 的取消后只读回执分支中，同时接受 completed 和 reconciled；保留现有所有身份限制：contract 必须 cancelled、当前 claim epoch 必须恰好为旧 credential 的 `e+1`、sessionKey/generation/worktree 必须相同。只让已完成回执可被读取，不放宽 assertOwner、beginOperation 或 beginWrite。

示意条件：

```ts
const cancelledReplay =
  ['completed', 'reconciled'].includes(row.state)
  && view.contract.state === 'cancelled'
  // 保留现有 epoch + 1、sessionKey、generation、worktree 全部匹配条件
```

定向回归建议：扩展现有 [unified-effect-admission.test.ts:109](D:/ClawX-work/session-task-unified-relay-20261109/tests/unit/unified-effect-admission.test.ts:109) 的 background 用例，在 poll 前执行真实 store.control(claim, 'cancel')，不注入 SQL。验证 Task operation=completed、Task contract=cancelled、claim.epoch=e+1，且 checkout operation 转为 settled；run terminal 且 reservation 释放后 writer 才变为 released。再由另一个任务写入真实临时文件，证明占用已解除。保留负例：进程仍活跃时继续持有；旧 credential 的新 write 仍失败；其他 generation/worktree/epoch 的旧回执不能通过此豁免。

**三条指定路径的其余结论。**

| 路径 | 读到的有效保护与结论 |
| --- | --- |
| 主/子换主及旧身份 | [execution-checkout-admission.ts:62](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-admission.ts:62) 对 outgoing 使用同 authority/task、精确 parent/child credential、childRunId 和允许的 delegation phase；在父 spawn 仍在途时，只豁免 canonical dispatchOperationIds。return 分支检查 returned、child credential、parent session/generation、目标 epoch=child.epoch+1，并要求 quiescent、零 effects/processes。观察前后及 grant 返回前重新 assertTask。底层 transfer 再验证 source credential、draining、全部 operations settled，原子轮换 epoch/token。未发现此次候选新增的旧身份写入路径。 |
| 工具两入口与 preflight | raw adapter 和 hook wrapper 都调用 executeManagedTaskTool，已包 hook 的 adapter 不再重复包装。write 在 beginWrite 后通过 executeTaskGuarded 的当前 Task owner 和 operation admission 才调用 raw effect。dispatch 前异常以 not_applied 补偿，dispatch 后异常保留 unknown；background 同样保留 unknown。process.kill 先校验 handle 的 canonical session/generation，并由 Task guard 再校验当前 task credential。未确证额外绕过。 |
| terminal 与释放 | [session-task-scope.ts:38](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/session-task-scope.ts:38) 将 terminal 清理延后至已登记 effects 归零，并保留 session/generation 供 durable writer 查找。finish/reconcile 先比对 writer epoch/token；正常释放还要求 terminalReceipt、全部 operations settled、无存活/保留的 process。releaseUnusedWriter 拒绝 operations 非空的 writer，底层 current() 再拒绝旧 token/epoch。未确证提前释放；上述 P2 是相反方向的漏释放。 |
| 显式注册 pin 与 TaskSystemStore access | [execution-task-authority.ts:37](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-task-authority.ts:37) pin local/authority/domain/database/worktree、registration/project revision 与 native identity；TaskSystemStore 构造、顶层读取、事务入口消费同一 access。task_control 自身也在构造时捕获 access，执行时 assertCurrent。Main 的 read/claim gap 传递 expectedAuthority；显式注册拒绝已有 local task、active writer，重注册还拒绝旧 authority 上的 worktree task references。此次范围未确证通过合法注册静默把旧 guard 重定向到另一个 authority 的路径。 |

相关边界定位：[agent-tool-definition-adapter.ts:370](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/agent-tool-definition-adapter.ts:370)、[agent-tools.before-tool-call.ts:1334](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/agent-tools.before-tool-call.ts:1334)、[worktree-writer.ts:159](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-writer.ts:159)、[execution-domain.ts:108](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-domain.ts:108)、[workspaces-api.ts:1359](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:1359)。

沿用此前 mapping 收敛结论：现有 create/cleanup/generation/native incarnation 路径未提供“已有 base root 在 instance/generation 不变时被合法重新登记为另一 managed mapping”的触发。本次不提出全局 mappingScopeKey/revision CAS 或第二 fence。TaskSystemStore 与 runtime writer 保持各自事务，补口应消费已有权威回执完成 fail-closed 前向恢复，无需共享事务。

本次只写此报告，未修改源代码、测试、Task Forest 或其他仓库内容，未发送其他会话消息。初始 HEAD 为目标候选、status 干净；复核期间其他工作推进至 `c3b31f3627306bd985b1d51ef97158454aecb436`，相对候选仅改变两份 unified-effect-admission 测试文件，末次观察 status 仍干净。以上行号与发现绑定目标候选；本次是源码调用链验证，未运行复现测试。
