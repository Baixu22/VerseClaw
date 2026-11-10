---
driven_by: agent
actor: u5-new-session-independent-review
requested_route: ccs-workbuddy/deepseek-v4.1-flash
reviewed_commit: 3168a9ebfeba1e05fdabbb59a3cb4f8f8a7b036b
reviewed_tree: 6335100e351190000161743d700b8e179717ef22
review_date: 2026-11-10
validation: source_and_existing_result_read_only
new_test_execution: not_run
---

发现两处仍影响本次验收的缺口：新建末端等待期间的同会话往返会绕过 visit 判断；`/new` 在 owner 拒绝前已经清空输入。以下结论来自指定版本源码和已落盘测试报告，本轮未执行动态复现。

Git 读取前已确认 `show-toplevel` 为 `D:/ClawX-work/session-task-unified-relay-20261109`，HEAD 为指定 `3168a9ebfeba1e05fdabbb59a3cb4f8f8a7b036b`。所读调用链文件相对此版本的 diff 为空。

**R1：最终 await 后遗漏 viewRevision，晚到新建仍可抢回会话。**

位置：[workspace-session.ts:156](D:/ClawX-work/session-task-unified-relay-20261109/src/lib/workspace-session.ts:156)。`createWorkspaceScopedNewSession` 在 `workspaces.update` 和工作组继承后使用 `isSourceCurrent()`，同时检查 intent、源 key 和 `sourceRevision`；随后又等待 `fetchWorkspaces()`、`clearWorkspaceActiveTopicMarker()`，最终第 159–160 行只判断 intent、workspace 和 source/new 两个 key，第 161 行直接 `resetSessionView(newKey)`。

这是可达调用链：`ChatInput.executeSlashCommand(resumeSession)` → [ChatInput.tsx:2636](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:2636) 的 `store.switchSession(target.key)` → [chat.ts:3189](D:/ClawX-work/session-task-unified-relay-20261109/src/stores/chat.ts:3189) → `buildSessionSwitchPatch` 在 [chat.ts:2102](D:/ClawX-work/session-task-unified-relay-20261109/src/stores/chat.ts:2102) 增加 `viewRevision`。该入口不经过 `activateWorkspaceScopedSession`，因此不会增加模块内 `navigationIntent`。slash 选择在 [ChatInput.tsx:2785](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:2785) 以 `void executeSlashCommand(...)` 启动，也没有把新建等待设置为禁止再次选择命令的状态。

精确时序：在工作区 W、已有会话 A 发起新建 N；owner update 成功并通过第 156 行；延迟后续文件写回；通过 `/resume B`、`/resume A` 回到 W/A；放行文件回包。此时 `currentSessionKey === A`、workspace 和 intent 都满足最终判断，但 `viewRevision` 已变化，旧操作仍重置到 N。若经 Chat 的 `onNewSession` 发起，非空返回还会触发 [Chat/index.tsx:1272](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:1272) 后续清草稿和局部状态。

最小修补建议：把 visit 条件保留到最后一次 await 之后、`resetSessionView` 之前。至少不能在 key 回到 source 时忽略 `sourceRevision`。若确需接受本操作触发的目标会话恢复，应核对那次恢复的 visit，不能只凭 source/new key 白名单放行。

建议在原 [workspace-session.test.ts](D:/ClawX-work/session-task-unified-relay-20261109/tests/unit/workspace-session.test.ts) 增补：延迟 `hostApi.files.writeText`，待其被调用后用现有 `chatState.switchSession` fixture 执行 B→A，再放行；断言新建返回 `null`、A 保持选中、`resetSessionView` 未被调用。现有第 165 行测试延迟的是 `workspaces.update`，并以 `activateWorkspaceScopedSession` 增加 intent，因此覆盖不到这个尾部窗口。该建议未执行。

**R2：`/new` 的失败分支仍丢失输入。**

位置：[ChatInput.tsx:2591](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:2591)。实际顺序是 `clearComposer()` → `await onNewSession()` → 返回 false 时退出。`clearComposer` 在第 2376 行调用 `updateInput('')`；[第 1306 行](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:1306) 同时清空组件 input 并调用 `onDraftChange('')`。父级 [Chat/index.tsx:1531](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:1531) 清空 `composerDraft`，并安排 250ms 后持久化空草稿。

随后 `Chat.handleCreateNewSession` → `persistCurrentWorkspaceSessionState` → `createWorkspaceScopedNewSession` → `hostApi.workspaces.update`。Host `ok:false` 经 [host-api-client.ts:278](D:/ClawX-work/session-task-unified-relay-20261109/src/lib/host-api-client.ts:278) 转成异常；[Chat/index.tsx:1270](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:1270) 在原 visit 中显示 `toastUserError` 并返回 false，但不会恢复已经清掉的输入。新增 false 返回值避免了成功 toast，却没有实现 slash 入口的失败草稿保留。

最小修补建议：`newSession` 分支在确认前仅关闭 slash 菜单，保留 input；成功清草稿交给已有 `Chat.handleCreateNewSession` 的第 1277 行。返回 false 或拒绝时不得调用 `updateInput('')`。

建议沿原 Host 拒绝 fixture 增补 `/new` 入口断言：转发 owner 前返回 `ok:false`，断言命令输入保持、错误可见、成功提示不存在、源会话不变；再放行重试并断言进入新 key。当前 [chat-workspace-header.spec.ts:383](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/chat-workspace-header.spec.ts:383) 是 Sidebar 按钮拒绝/重试定义，不走 slash 的 `clearComposer`。此增补未执行。

**已成立的调用链与现有证据。**

- Sidebar 按钮与 App `hostEvents.onNewChat` → [use-new-chat-action.ts:9](D:/ClawX-work/session-task-unified-relay-20261109/src/components/layout/use-new-chat-action.ts:9) → `navigate('/')` → `createWorkspaceScopedNewSession().catch(toastUserError)`。该 hook 没有在 owner 成功前清草稿，异常进入原翻译错误出口。
- Composer 工作区菜单 → [ChatInput.tsx:3855](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:3855) → `handleWorkspaceAction(onNewSession)` → `Chat.handleCreateNewSession`。保存源状态之后先核对 visit/key/workspace；owner 抛错时保留菜单入口草稿并显示错误；helper 返回 null 时不做成功后的局部清理。
- 正向 helper 使用原 `hostApi.workspaces.update`（[host-api.ts:834](D:/ClawX-work/session-task-unified-relay-20261109/src/lib/host-api.ts:834)）；Main 写入 workspace document 后返回 snapshot（[workspaces-api.ts:1715](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:1715)、第 1749 行）；helper 继承工作组、刷新 workspace、清 topic marker，最后调用 `resetSessionView(..., { deferSessionEntry: true })`。没有导航变化的正向新建与 owner 拒绝后的再次创建均在已有 helper 单测中通过。

回读 [u5-new-session-final.result.json](D:/tmp/unified-management-20261109/lifecycle-validation/u5-new-session-final.result.json) 与 [u5-new-session-final.tests.json](D:/tmp/unified-management-20261109/lifecycle-validation/u5-new-session-final.tests.json)：`exitCode=0`、`sourceUnchanged=true`，before/after commit 均为指定版本；30 passed、0 failed、0 pending。运行时间为 2026-11-09 17:02:28.574–17:03:21.300 UTC，即 2026-11-10 01:02:28.574–01:03:21.300（Asia/Shanghai）。

| 已运行文件 | 通过数 | 与本次审查的关系 |
| --- | ---: | --- |
| `tests/unit/workspace-session.test.ts` | 12 | 包含新建 update 晚回、拒绝后重试、正向 workspace/agent 绑定；Host 与 stores 为 fixture |
| `tests/unit/session-lifecycle-control-scope.test.ts` | 15 | 包含 visit revision 与既有生命周期隔离 |
| `tests/unit/r0-3-chat-abort-checkstuck.test.ts` | 3 | 既有 Stop/reclamation 回归 |

该运行未包含 ChatInput 的 `/new` 失败断言，也未包含新建末端 await 期间的 B→A 断言；所读 E2E 定义的执行状态不在这份 30/30 报告内。本次交付仅为源码审查与上述磁盘证据回读，新增动态验证为 `not_run`。

---

**2026-11-10 解决情况复核：R1/R2 源码缺口均已修复。**

`driven_by: agent`；`requested_route: ccs-workbuddy/deepseek-v4.1-flash`；复核版本 `4845a0bf991b7fe7756b5a1ab26eced1f1b68b75`。Git 读取前再次确认正确源根目录，HEAD 为该版本，所读 R1/R2 调用链与测试文件相对此版本无 diff。以上原始发现保留为修复前记录。

- **R1：resolved，原 helper 回归已通过。** [workspace-session.ts:159](D:/ClawX-work/session-task-unified-relay-20261109/src/lib/workspace-session.ts:159) 在 `fetchWorkspaces` 和 topic 文件写入两个 await 之后重新调用完整 `isSourceCurrent()`，同时保留 workspace 判断，再执行 `resetSessionView`。B→A 即使回到同 key，也会因 `viewRevision` 改变而返回 null；父级 [Chat/index.tsx:1271](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:1271) 随即返回 false，不清草稿或局部状态。原 [workspace-session.test.ts](D:/ClawX-work/session-task-unified-relay-20261109/tests/unit/workspace-session.test.ts) 新增 `keeps a source revisit during the last new-session await`，确实挂起末端 `files.writeText`，经现有 `switchSession` fixture 执行 B→A，放行后断言 null、源 key 保留、无 reset；对应磁盘断言状态为 passed。正向创建、owner 拒绝后重试也均为 passed。
- **R2：resolved，双入口 Electron 验证待运行。** [ChatInput.tsx:2596](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/ChatInput.tsx:2596) 已用 `closeSlashMenu()` 替换 `clearComposer()`，等待 `onNewSession` 期间不再调用 `updateInput('')`。父级失败仍经 [Chat/index.tsx:1270](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:1270) 显示原 visit 的错误并返回 false；仅非空新 key 成功后在第 1277 行清空父级草稿。原 [chat-workspace-header.spec.ts:386](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/chat-workspace-header.spec.ts:386) 已参数化 sidebar/slash：Host 拒绝时断言错误可见、输入保持，随后重试并核对新建请求的 workspace/agent/sessionKey。该文件未包含在本次 unit 运行中；Electron 状态按当前交接为待跑。

已回读 [u5-review-resolved-unit.result.json](D:/tmp/unified-management-20261109/lifecycle-validation/u5-review-resolved-unit.result.json) 和 [u5-review-resolved-unit.tests.json](D:/tmp/unified-management-20261109/lifecycle-validation/u5-review-resolved-unit.tests.json)：20 passed、0 failed、0 pending，`exitCode=0`、`sourceUnchanged=true`，before/after commit 均为 `4845a0bf991b7fe7756b5a1ab26eced1f1b68b75`，tree 为 `8af972618a5da609372c820d529ddc8c5b4c237e`。其中 workspace-session 为 13/13，CheckpointsDialog 为 7/7。运行时间 2026-11-10 01:21:50.488–01:21:57.740（Asia/Shanghai）。

这两项原 review 的修补位置与失败机制对应，未发现需要继续保留的源码阻断。后续验收是已新增 sidebar/slash Electron 用例的实际执行结果；本轮仅阅读源码和现有报告，新增 tests/build 执行为 `not_run`。
