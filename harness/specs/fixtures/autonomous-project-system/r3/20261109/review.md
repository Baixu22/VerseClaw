# R3 终端资源所有权实现修复复核（最终）

## 结论

按本轮限定的三项修复范围，没有剩余可确证 P1/P2。

以下修复已从当前本叶工作树直接确认：

### WebPreview generation 与 lifecycle gate

- `electron/services/web-preview-api.ts:52-63` 对 devServer 调 Gateway `sessions.describe` 获取物理 generation；缺失时 fail closed。
- 启动在 Main 的 session-delete gate 内执行；gate 冲突时返回 blocked。
- `electron/main/ipc-handlers.ts:175` 将实际 `gatewayManager` 传入 WebPreview API。
- `electron/services/web-preview-manager.ts:317` 对缺失 generation fail closed。
- `web-preview-manager.ts:327` 在 launch 前执行 reservation reconcile。
- manager 以同一 workspaceId/sessionKey/expectedSessionId 建立 `terminalOwner`，传给 terminal open。
- proxy 启动失败补偿和正常 close 都使用同一 scope。
- cleanup 失败保留 `status=error` runtime、processSessionId 和 terminalOwner，可从同一 runtime 重试。

### PTY generation 与控制作用域

- TerminalPanel open 传已知 generation。
- status/statusChanged 更新 TerminalPanel 持有 generation。
- write、resize、interrupt、close 均接收 owner scope。
- terminal manager 对四类入口统一执行 `assertScope`。
- 已有非空 generation 的 running terminal 在没有调用方 generation 时禁止复用。
- 不同 workspace/session/generation 的控制请求被拒绝。

### terminal finalize 持久失败恢复

- `terminal-session-manager.ts:541-554` 在 native exit 后先尝试 `markTerminal()` 与 `release()`。
- 持久化失败时保留 session，不执行 `sessions.delete()`。
- session 转为 `blocked`，清空 `ptyProcess`，保留原生 `exitCode`、reservation 和 `exitError`，并 `resolveExit()` 返回失败。
- 后续 close 会先重新验证端口，再用同一已观察 native exit 调用 finalize；成功后才删除 session。
- 对应 `terminal-session-manager.test.ts:66-86` 覆盖 persist failure、blocked 状态、capacity 保持和同 owner 重试。

### reservation 与 preview 失败路径

- reservation 覆盖 `reserved / dispatched / observed / terminal / unknown`。
- `markDispatched()` 失败会释放刚创建的 reservation。
- PTY spawn 未返回 handle 时记录 unknown，保留 reservationId。
- terminal phase 和 owner 已死亡且从未 dispatched 的 reserved 由 reconcile 处理；dispatched/observed/unknown 不自动释放。
- `terminal.list()` 暴露 reservationId、owner、phase、ports、rootPids、limit 和 reason。
- WebPreview proxy 启动失败会 await terminal close；cleanup 失败保留 error runtime 供后续同 scope 重试。

## P1

无。

## P2

无。

## 后续合同提示

`unknown` 不自动释放符合当前合同：未知 native dispatch 不得当作未启动、重放或按裸 PID 终止。后续由 RecoveryAuthority 负责外部核实；该项不是当前实现的缺陷。

本轮未运行测试，未修改代码、Task Forest、canonical 图或工作树。用户的 74 项测试结果、真实 PTY 三进程树取消和 43 项 VerseShell 检查作为提供的验证结果记录，不重复冒充本轮执行。