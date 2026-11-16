**建议：checkout writer 从首次受管写入持续持有到该执行占用结束；工具返回只结清操作。canonical parent→child transfer 是一次有证据的换主，必须在旧写操作和进程排空后直接更换 writer epoch/token，不能等待父 run 退出，也不能先公开释放再让 child 竞争。** 当前四个 owner 已有足够基础，缺少实际入口的一致组合、资源换主原子操作和跨 owner 回执关联。

审查锚点：`D:/ClawX-work/session-task-unified-relay-20261109`，branch `codex/unified-effect-admission-20261109`，HEAD `dbe8f3e5c39ebef350705937dc05b9790c1d3b63`；已读当前 unified-effect-admission spec。下面源码行号以该基线为准。审查期间主代理已开始修改 WorktreeService/registry 映射，本报告不替代那部分实现复核。实际审查模型为宿主 GPT-6；本轮无法切换为所指定的 DeepSeek。未运行测试。

**已证实的调用关系及组合风险**

| 边界 | 当前实现证据 | 本叶必须处理 |
|---|---|---|
| wrapped / raw 工具 | [agent-tools.before-tool-call.ts:1335](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/agent-tools.before-tool-call.ts:1335) 为 withSessionTaskScope→executeTaskGuarded→execute；[agent-tool-definition-adapter.ts:439](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/agent-tool-definition-adapter.ts:439) 的 raw 分支只有 withSessionTaskScope→execute。 | **P1 组合缺口**：只增强 wrapped 分支会使 raw 缺少 Task operation/unknown 记录和 TaskCredential 复核。两条真实 execute 路径必须进入同一组合函数一次，沿用 beforeHookWrapped 判定，保留参数 finalization 后、实际 effect 前的检查。 |
| checkout writer | [worktree-writer.ts:105](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-writer.ts:105) 持久 claim；153 行 begin 拒绝任意未结清 operation；168 行 unknown 进入 draining；191 行 release 只查本表操作。 | writer 不知道 Task/process 是否排空，release 不能直接挂在工具 finally 或 run context 清理。每次重用必须保持原 credential；不能用每次 scope 请求的 randomUUID 重新 claim。 |
| canonical delegation | [store.ts:845](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:845) 仅允许当前 epoch 已 started 的 sessions_spawn/team_orchestrate 操作参与转交；899 行使 parent 成为 reference、child 获得新 epoch；[subagent-spawn.ts:1790](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/subagent-spawn.ts:1790) 在 dispatch 前执行。 | **P1 死锁风险**：父 run 仍 active、spawn 工具尚未返回是正常状态。把整个 spawn 当作未结清 checkout 文件写，或要求父 run quiescent，会堵住 child 第一次写。 |
| coordinator pause | [workspaces-api.ts:1287](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:1287) 允许 user-paused 前已授权的同 run/generation；1973 行 pause 增加 bindingRevision 而保留 writerClaim。 | **P1 合同冲突风险**：每次按最新 revision 重建 CheckoutWriterIdentity，会与已持有 credential 的 owner digest 不同；简单“revision 变了就拒绝”会中断既有已授权 run。 |
| background / unknown | [runtime.ts:281](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:281) 对 running/background 保留 unknown 和 process handle；[runtime.ts:252](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:252) 由 process poll/log/list 结果调用 reconcileProcessResult。 | **P1 提前释放风险**：工具 Promise 返回、effectsByRun 归零、Task active-run 删除都不证明 native process 结束。Task operation 和 checkout operation 必须分别结清。 |
| 收尾控制 | [worktree-writer.ts:85](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-writer.ts:85) draining 禁止 begin；[store.ts:1192](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1192) beginOperation 要求 doing；[runtime.ts:252](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:252) 仅 poll/log/list 有特殊分支。 | 把 process kill/cancel/close 一律作为新的普通写操作，会在 draining/cancelling 时拒绝用于排空的控制。只允许原 process owner 对原 handle 的取消、观测和 receipt reconcile 通路继续；stdin/send-keys/新命令仍属新效果。 |
| preflight 与 effect | [runtime.ts:275](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:275) execute 回调抛错即记 unknown。 | 把 checkout begin 放入这个回调后，纯准入失败也会变成 Task unknown。组合实现必须明确 raw execute 是否已调用，已证明未执行的失败走 not-applied 补偿。 |

**最小生命周期方案**

1. **首次实际效果，固定一组身份。** Main 继续通过既有 taskScope.admit 回读 live run、session generation、当前 binding、任务契约和执行环境；Runtime 使用返回的 TaskCredential，并与创建该执行时捕获的 guard 对照。主代理提供的 checkout 映射进入 WorktreeService，取得 root/incarnation/worktree generation。持久关联至少包含：TaskDomain、taskNodeId/epoch/contract revision、sessionKey/generation/runId、该 run 最初的 bindingRevision、checkout root/generation/incarnation/epoch。放入既有 writer payload 或既有 claim/delegation 记录的关联字段，不建另一个权威表。

   writer claim 的幂等键按这组执行身份稳定生成；effect operationId 沿用真实 `runId:toolCallId`，digest 覆盖最终执行参数和目标。scope RPC requestId 只关联一次通信，不能充当 run writer 的幂等键。没有 toolCallId 的受管 effect 必须先获得可持久关联的 ID。

2. **每个 effect 复核，工具间保留占用。** 在参数调整及取消检查完成后，组合层依次检查 Main admission、Task owner、checkout basis/credential，并在实际工具调用前持久登记 Task operation 与 checkout permit。只有两者成功才 dispatch。复用 [WorktreeService:411](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-service.ts:411) 的 claim/begin/settle/drain/release 和原 withWorktreeLock；锁只包短同步元数据操作，不跨 Gateway RPC、工具 Promise 或进程等待。

   工具已知完成只 settle 该 operation，不 release writer。begin 阶段失败且 raw execute 从未调用，使用组合层产生的确定性 preflight not-applied 回执补偿已经登记的 permit/Task operation；只可归还本次新取得且尚无消费者的空 reservation，不能释放已有 run 的占用。执行后异常、ack 丢失或持久结清失败都保留 pending/unknown，禁止重放。

3. **parent→child 采用受控换主。** 由现有 delegation seam 协调以下顺序：
   - 记录稳定 delegation intent，关闭旧 checkout 的新写准入，等待当前真正文件写结清。检查旧 owner 的 Task pending、checkout pending 与 process reservations。
   - 仅凭 canonical delegation 的精确 dispatchOperationIds，排除这次 spawn/team dispatch 控制操作。它是任务/调度效果，不应在整个 child 生命周期中伪装成父 checkout 的未完成文件写；若 spawn 的某个步骤确实修改父 checkout，那一步仍须独立登记并完成。不能仅凭工具名称豁免任意操作。
   - 调用现有 prepareWriterDelegation，核验持久 parent/child credential、worktree、childRunId 和 contract revision。Task epoch 先 fencing 父执行，随后在原 worktree mutex + SQLite 短事务内 **CAS 换 checkout owner、递增 epoch、换 token、保留退休 request 历史**，最后才 dispatch child。child grant 必须以这次持久 transfer 已完成为前提。
   - 两个 store 无共同事务，允许中断时保留“Task 已转交、checkout 仍由旧 token draining”的状态；重启按同 delegationId 读取两个 owner 补齐换主。这个窗口内新旧双方都不能产生 checkout effect。失去 dispatch ack 则保持 child 占用/unknown，不转回父、不开第二个 child。

   现有分离的 releaseWriter / claimWriter 两次调用存在第三任务插入窗口；本叶最少需要 WorktreeService 中一个可信 `transferWriter` 原子方法，或等价的内部组合，不能靠 Main 进程内锁封住跨进程竞争。相同 native root 必须直接换主；不同 root 按 canonical 顺序预取所有必要占用，在没有取得目标 checkout 时不 dispatch。源 checkout 何时归还由这次明确转交及其产物依赖决定，不能按单个 effect 自动释放。

   [taskScope.runState:196](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/session-task-scope.ts:196) 的 quiescent 明确要求 run 不 active；**保留此定义供会话切换使用**。转交需要 runtime owner 核验“除本次已识别 dispatch 外，实际效果和进程已排空”，可以在既有 owner 读取中补充此结果，不把父 run 假报为结束，也不临时减计数。

4. **返回父、暂停和普通终态分开。**
   - returnDelegatedWriter 继续凭 child registry 的 terminal receipt 与 Task pending 决定 returned/recovery_required（[store.ts:938](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:938)）。在它授予父新 Task epoch 前，组合层还需取得 child checkout/process 排空事实；不能只因 pendingOperations=0 就忽略仍存的 native reservation。checkout 再做同样的持久换主/归还。原父 guard 不自动升级：已有回归明确要求返回后旧父 guard 仍 STALE_OWNER，后续新执行重新 admission。
   - coordinator user-pause 只阻止新 run。保留原 writer credential 的捕获 revision；每次 effect 仍由 Main 用当前 binding 判定“是否同一已授权 run/claim/task/environment”。若 admission 需要表达此例外，可在现有 claim 中补固定的 admittedBindingRevision，把它与 UI/current bindingRevision 分开；不能无条件忽略所有 revision 差异，也不能重 claim 同一个 busy checkout。TaskSystemStore 的 task pause/cancel 改 epoch/状态，是另一合同，仍应 fencing 后续写。
   - 普通 run terminal 只发起 drain。待 Task operation、checkout operation 全部有可回读回执，且匹配 process reservation 已由 native owner 结清，才 release。finishPersistentTaskRun 只删 active-run、clearSessionTaskScopeRun 只清内存计数（[runtime.ts:68](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:68)、[session-task-scope.ts:35](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/session-task-scope.ts:35)），不能直接变成 checkout release 证据。
   - merge/freeze/cleanup 继续使用既有 maintenance claim。进入这些操作前显式交出或转换已排空的 run writer，不能因为 caller 是同一 parent 就绕过占用；未知状态保持拒绝，维护 owner 的 source/base 全部 claim 规则不变。

5. **后台/unknown 用原 owner 结清。** [managed-process-reservation.ts:11](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts:11) 已持久存 sessionKey/generation/runId；identity-only 也实际 reserve。沿用 native markDispatched/observe/markTerminal/release，原生终态和端口复核都由 governed-process 完成（[governed-process.ts:619](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/verseshell/governed-process.ts:619)）。

   最少把既有 reservationId/native handle 与 Task operationId、checkout operationId 显式关联，放进现有 operation/result/receipt 路径。后台返回后 checkout 保持 occupied/draining，poll/log 和原 handle cancel 能继续回读；settle 时消费同一 owner 事实，幂等推进两个 store。复用 [reconcilePersistentTaskEffect:250](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/persistent-task-acceptance.ts:250) 对 EffectReceiptStore 的身份与结果验证，或既有 process owner 的终态验证，不能接受模型填写的 ownerReceipt 字符串直接作为证明。

   两边之一落盘失败时保留未结清的一边；重启只重放 receipt，不重放 effect。reservation 消失或 PID 不在本身都不是某个写操作 applied/not-applied 的证明。现有自动 reconcile 仅接受 terminal，或 owner 已死且从未 dispatched 的 reserved（reservation 132 行）；unknown/dispatched/observed 保留。

   draining 在现有实现没有自动恢复 active 的接口。若结清后同一 run 确需继续，由新的 Main admission + 已结清回执，通过同一个 CAS 换主原语旋转到新 writer epoch；使用新的 continuation requestId，旧 request 永久退休。不要把旧 unknown claim 自动复活。

**最少复用/扩展的接口**

| 现有 owner | 必须复用 | 最小补口 |
|---|---|---|
| Main session/binding | taskScope.admit、admitSessionTaskEffect、现有 pause 规则 | 提供已验证 checkout locator、固定的 run 授权身份；当前 revision 检查继续由 Main 执行。 |
| Runtime 工具边界 | withSessionTaskScope、executeTaskGuarded、beforeHookWrapped、最终参数与 AbortSignal | 两个入口共用组合；带真实 toolCallId；区分 preflight 未执行与 dispatched 后未知。 |
| WorktreeService | writerBasis/claimWriter/beginWrite/settleWrite/drainWriter/releaseWriter/writer、withWorktreeLock、state_leases | 单个 CAS transfer/rotate 原语，携 canonical delegation/continuation 关联；同一 owner 持久保存 TaskCredential 关联。 |
| TaskSystemStore | assertOwner、begin/finishOperation、operation/reconcileOperation、prepare/record/return delegation、handoff | 在既有 delegation/receipt 中记录 checkout 转交关联及阶段；不复制 Task claim/acceptance 权威。 |
| Runtime/process | runState、managedProcessReservations、native handle controls、reconcileManagedProcessReservations | 给转交提供实际效果已排空的 owner 事实；把既有 reservationId 与 operationId 贯通，原 process owner 负责取消与终态。 |

**一个需精确处理的读模型差异：** 当前 runState 中，durable reservation 在默认 run scope 按三元组过滤；但内存 bash process/supervisor 只按 session + generation 过滤，没有按 runId 过滤（[session-task-scope.ts:143](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/session-task-scope.ts:143)）。不能把总 inFlightProcesses 当成精确旧 run 的证据；已有新 run 的内存进程可能保守地挡住旧 run 排空。只使用 owner 实际提供的关联字段，有歧义就保留。session scope 切换仍须覆盖同 session 的全部 generation；缺失/不完整 identity 的 durable 行继续全局阻止。

**可执行测试清单**

新增联合测试应通过真实 wrapped/raw execute 和真实 SQLite/临时 checkout 做文件回读，保留现有 owner 夹具。下表是验收用例，不是本次已执行结果。

| 用例 | 驱动与必须读回的结果 |
|---|---|
| 1. 两入口同合同 | wrapped/raw 各调用两次 write；同 run 复用一个 writer，两个独立 operation；旧 task epoch、session generation、binding、checkout incarnation 各拒绝且文件未变。wrapped 经 adapter 不得登记两次。 |
| 2. 工具间持续占用 | A 写第一段后暂停在工具间，独立进程 B/另一任务写同 root 被拒；A 第二次写可继续。独立 checkout 的 C 可同时写。 |
| 3. canonical 同根转交 | 父 run 和 spawn 调用仍 active，Task transfer 后 child 实际写成功；父旧 token/guard 被拒；第三任务在 drain→Task prepared→checkout rotated 每个断点都抢不到该 root。 |
| 4. 转交等待真实效果 | 父有正在写文件或后台 process 时转交拒绝/等待；只有当前 canonical dispatch 操作可排除。observer 仅获得 reference，不换 checkout writer、不阻断父写。 |
| 5. 转交 crash/ack | 在 drain、Task prepared、checkout rotated、dispatch ack 丢失处退出 fixture，重开两个真实 store；同 delegation 重试只补齐元数据，未知 child 不重复 dispatch。 |
| 6. 返回父与旧凭据 | child 终态但仍有 reservation 时不返还写权；真实排空后父取得新 task/writer epoch。旧父 run 与旧 child token 都拒绝；terminal receipt 重放幂等。 |
| 7. coordinator pause | admission 后 pause 使 UI revision+1；原 run/claim 后续 effect 仍成功且不重新争抢 writer，新 run 拒绝；改 task/environment/代次不能借 pause 例外通过。另测 Task pause/cancel 仍 fencing 写。 |
| 8. 后台与 cancel | exec 返回 running，工具计数归零但 writer 保留；process.poll/cancel 能走原 handle 控制，native terminal + 端口释放 + task receipt 后才可交出占用；stdin/新 exec 在 draining 被拒。 |
| 9. 未执行补偿 | 注入 checkout claim/begin、Task begin、admission ack 前取消失败；raw execute 次数为 0，已知未执行记录正确结清，只释放本次未用 reservation，原 run writer 不被误释放。 |
| 10. 未知/结清 crash | effect 已改变真实文件后抛错或 receipt 落盘失败，restart 后不可重放、不可 release；正确 owner receipt 依次结清两个 store；错 run/toolCallId/generation/冲突 receipt 拒绝。 |
| 11. process scope | 同 session 旧 generation reservation 阻止切换；同 generation 不同 run 不冒充旧 run 的已结清证明；legacy/incomplete identity、unknown、端口仍占用均阻止归还。 |
| 12. maintenance | 活跃/unknown writer 时原 merge/freeze/cleanup 仍拒绝；明确 drain+交接后成功。同路径替换使旧 credential 失效；cleanup 只可收回自己的 generation。 |

已有回归入口，可按本叶改动选择运行：

```powershell
Set-Location 'D:/ClawX-work/session-task-unified-relay-20261109'
$env:TEMP = 'D:/tmp'
$env:TMP = 'D:/tmp'
pnpm exec vitest run --config vitest.checkout-writer.config.ts
pnpm exec vitest run --config vitest.task-system.config.ts tests/unit/durable-task-delegation.test.ts tests/unit/durable-task-runtime.test.ts tests/unit/durable-task-session-scope.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run tests/unit/session-task-scope-completion.test.ts tests/unit/session-task-scope-bridge.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config vitest.terminal-resources.config.ts openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts openclaw_runtime/src/agents/verseshell/governed-process.test.ts --maxWorkers=1 --no-file-parallelism
```

spec 声明的 `vitest.unified-effect.config.ts` 在本次读取时尚未存在；主代理创建并包含上述联合用例后，再运行：

```powershell
pnpm exec vitest run --config vitest.unified-effect.config.ts
pnpm exec playwright test tests/e2e/unified-effect-admission.spec.ts --workers=1
```

本叶负责 owner 组合与真实 effect fencing。TaskSystemStore 保留任务验收权；WorktreeService 保留资源与 maintenance 权；native process 保留取消/退出证明权。checkout 映射、Mission/clone 身份进入同一准入后消费上述合同，不另建 shell、scheduler 或 RecoveryAuthority。
