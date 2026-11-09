TF0866 候选 `a5765222cf2563f55a18c5d4b92aa6e5fc372e83` 只读窄复核：**1 项 P1、2 项 P2**。三项均有现有 owner/API 可形成的触发顺序；未执行复现或测试，以下结论来自源码调用链。

工作树：`D:/ClawX-work/session-task-unified-relay-20261109`；分支：`codex/execution-environment-migration-20261109`。requested model route：`ccs-workbuddy/deepseek-v4.1-flash`，工具未确认实际执行模型。日期：2026-11-09。本次只写报告，未修改源码、Task Forest，未启动测试或干预两个 build，未发送其他会话消息。

**P1：target reservation 在 Main 发布前释放，中断后第三方可插入，原 op 无法恢复。**

位置：[execution-migration.ts:140](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/execution-migration.ts:140)，发布入口：[workspaces-api.ts:745](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:745)。

现有顺序为 runtime.confirm → releaseUnusedWriter → await owner.bind(active=true) → save(confirmed)。owner.bind 内还要异步读取 environment、追加 ledger link，最终才持久化 profiles。

可复现顺序：

1. 同 op 已到 binding-committed：目标 TaskCredential 为新 generation/epoch，target binding 仍 paused，target checkout 由 migration reservation 独占。
2. runtime.confirm 成功；第 140 行释放 reservation 后，Main 在第 141 行发布之前退出。持久 Main phase 仍为 binding-committed，checkout 已 released。
3. Main 重启后，目标 workspace 上另一正常会话 U 持有独立任务 claim，并先走现有 taskScope admission。它可 claim 同一 released checkout，取得新 epoch/token 并执行写入。该场景跨重启发生，不要求绕过 Main 的进程内 coordinator mutation lock。
4. 原 op 重试：前面阶段被跳过，runtime.confirm 幂等返回；第 140 行再次释放旧 reservation，底层 current() 因 token/epoch 已变化抛出 checkout_writer_stale_credential。即使 U 随后释放资源，旧 epoch/token 也不会重新有效，原 op 持续卡住。

影响：目标在迁移发布前已暴露给其他 writer；接收侧 readback 与实际继续执行之间可插入第三方写入，同时同 op 恢复失效。没有同时存在两个 active writer，也无需篡改 DB。

最小补口：至少让 target reservation 持有到 Main active binding 与 confirmed 发布事实持久化之后，将 unused release 作为可重入尾步骤；confirmed 重放也须收敛这个尾步骤，只释放仍精确匹配原 reservation 的 row，保留已经换主的 row。不要让恢复再依赖已失效的 target TaskCredential 或旧 reservation token 必然仍是当前 owner。如需保留到目标首次 effect，直接复用现有 canonical transfer；不要求两个 authority 共享事务。

定向回归：在 release 与 publish 的边界注入进程中断，重启后先让 U 走正常 admission，再重试原 op。修复后的发布前窗口应仍拒绝 U；confirmed 后重试应返回同一结果，且不释放后来合法取得的 writer。

**P2：Task 已完成而 checkout 尚未 settled 时，先 pause 会使补偿所需旧 credential 失效。**

位置：[execution-migration.ts:87](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/execution-migration.ts:87)、[execution-migration.ts:93](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/execution-migration.ts:93)。

可复现顺序：

1. 源运行一次 write 已完成真实文件效果；[runtime.ts:292](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:292) 将 Task operation 提交为 completed。
2. Gateway 在返回外层 [execution-checkout-tools.ts:170](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-checkout-tools.ts:170) 的 settleWrite 之前中断。持久状态合法地成为 Task pendingOperations=0、checkout operation=running。
3. Gateway 重启后启动迁移。源运行和进程已清空，Task 检查通过；control(pause) 将 Task claim 从 epoch e 推进为 paused/e+1。
4. 随后的 releaseWriter 拒绝未 settled 的 checkout operation，迁移留在 fenced。再次执行同 op 可识别 pausedReplay，但仍会在 releaseWriter 失败。
5. 原 reconcileExecutionCheckout 用 writer 携带的 epoch e 读取 Task 完成回执；[store.ts:1451](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1451) 的旧 epoch 豁免只适用于 cancelled，当前是 paused，因此 assertOwner 拒绝。组合层已经把可以消费的完成事实变成无法按原路径消费。

最小补口：在推进 Task pause epoch 之前，对精确 source writer 消费现有 Task completed/reconciled 回执并确认 checkout operations 全部 settled。真实 unknown 继续拒绝迁移。若需要恢复已经进入该窗口的旧 op，使用 op 记录的旧 credential 与精确 paused/e+1 关系开放只读回执恢复，不授予旧身份任何新写权限。

定向回归：用真实 beginWrite/beginOperation/finishOperation(completed) 构造中断边界，省略尚未发生的 settleWrite；关闭连接重开后同 op 迁移应完成，旧 TaskCredential/checkout credential 均不能再写。另保留 Task unknown 时继续阻断的负例。无需直接 SQL 改写。

**P2：相对 checkpoint artifact 路径按 Main cwd 读取，迁移在后期校验错误文件或永久失败。**

位置：[execution-migration.ts:132](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/execution-migration.ts:132)。

task_control 的 checkpoint 入口直接调用 store.checkpoint；[store.ts:1155](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/store.ts:1155) 接受非空 path，并未要求绝对路径或完成归一化。因此 `{path:'result.txt', sha256:<源 checkout 文件 hash>}` 是合法输入。

可复现顺序：sourceRoot/result.txt 有正确内容，Main cwd 与 sourceRoot 不同；保存上述相对 artifact 后启动迁移。session 已 prepared、Task 已 handoff、binding 已 paused，随后 `readFile(artifact.path)` 读取 Main cwd/result.txt。该文件不存在时得到 ENOENT，内容不同时得到 MIGRATION_ARTIFACT_CHANGED；即使 cwd 中恰有同 hash 文件，也未验证所引用的源 checkout 文件。同 op 重试继续读取同一错误位置。

最小补口：在 intent 捕获时将相对 artifact path 绑定到其来源 sourceRoot 并持久化明确路径，绝对引用保持原含义；后续使用该固定来源读回，避免随 Main cwd 或目标 checkout 改变。按本迁移契约保留原 artifact 引用，不自动把同名目标文件当作原证据。

定向回归：Main cwd、sourceRoot、targetRoot 各放同名且不同内容文件，checkpoint 使用相对路径，断言校验固定在 sourceRoot；中断后重试仍使用同一来源。

**持久步骤核对结果。**

| 步骤/窗口 | 本次核查 |
| --- | --- |
| intent 保存后重试 | Main requestDigest 约束原请求；目标 generation 来自保存的 operation，重试沿用。 |
| fence 已写、phase 尚未保存 | source binding 的 execution-migration:op invalidationReason 可幂等识别。 |
| Task pause 已提交、drained 尚未保存 | pausedReplay 识别 epoch+1；但源 checkout 回执落后时受上述 P2 阻断。 |
| target claim 已提交、reserved 尚未保存 | 固定 migration:op requestId 和 owner/basis 使同 reservation 可重放。 |
| runtime intent / copy / prepare 回复丢失 | 同 op 校验 requestDigest；copy 使用 COPYFILE_EXCL 并核对源/目标 transcript hash；session row 与 store_committed journal row 经 updateSessionStore 的 sqliteJournalRows 一起提交。 |
| Task handoff 已提交、task-committed 尚未保存 | 检查目标 session/generation/epoch，后续 assertOwner 再核对目标 worktree；原 TaskCredential 因 epoch 变化失效。 |
| binding-committed / runtime confirm 回复丢失 | target binding 仍 paused、reservation 仍持有；runtime 的 runtime_committed 回执可重放。 |
| reservation 已释放、Main 尚未发布 | 上述 P1。Main10 的阶段后故障点没有覆盖此窗口。 |
| Main 发布成功后，最终响应单纯丢失 | workspaces-api 在同一次 profiles 保存中发布 active target binding、移除 source binding并将 source operation 标 confirmed；同 op 读取 confirmed 后在 Main 第 34 行返回，不再 handoff 或释放旧 token。这条路径未发现需要另加分布式事务的问题。 |
| 第二次串行 migration | logical sessionKey 保持不变，新 operationId 和新 physical generation；runtime 允许上一 executionMigration=confirmed，既有测试覆盖二次迁移。未发现本次范围内的新增确证问题。 |

prepared 拦截已接到 createExecutionTaskGuard、task_control 的变更动作及 taskScope.assertLiveRun；target 在 runtime.prepare 后保持 prepared，confirm 要求匹配目标任务、root、generation、contract 和已结算状态。本次未发现能让旧/新 TaskCredential 同时通过写入 owner 校验的路径。上述发现涉及持久窗口的资源保留、恢复与文件来源，修复可留在现有组合层。

证据状态：已读 [migration-main-preflight2.tests.json](D:/tmp/unified-management-20261109/migration-main-preflight2.tests.json)，success=true、10/10；Runtime19、runtimejournal4、types/contract/i18n 通过为用户提供状态。本次读了对应 Main/runtime 测试源码：Main 的 7 个断点都在 owner.save(phase) 已保存之后，另外覆盖 prepare/confirm 回复丢失与请求冲突；未覆盖上述跨 owner 空档。build/E2E 状态不在此次复核中提升。

复核开始 HEAD 为目标候选且 status 干净；期间其他工作推进到 `1e1a1c1d4cdbd782f9af451d2570872b0cbf79d1`（补 lazy gateway handler map），结束观察 status 干净。本报告核心目标文件相对候选未变；所有源码定位均按候选读取。
