# Session process owner 最终只读复核

## 结论

当前候选的目标切片未发现会继续阻止合并的确证 P1/P2。identity 已沿两条实际 exec 路径写入 durable managed-process reservation；handoff 在无 `writerClaim` 时仍执行 session-scope 检查；session scope 对内存 bash/supervisor 与 durable reservation 均覆盖同 session 的旧 generation；identity 缺失或不完整的 reservation 继续对 run/session 查询 fail closed。

审查对象为 `HEAD 81b84911a`，其上已包含候选 `9b8645621` 和 main `0fa9d0337` 的合并。当前工作树无未提交改动。本次未运行测试；采用用户提供的 30 项 runtime process 通过、candidate-owner-unit 115/115 通过。当前 tsgo 修正仍需按用户计划重跑，这是验证待办，不是本次代码审查发现的缺陷。

## Identity 实际传播

两条启动路径均闭合：

1. `openclaw_runtime/src/agents/agent-tools.ts:1172` 把 AgentRunContext 的 `options.runId` 写入 exec defaults。
2. 普通 Gateway / VerseShell 路径：`openclaw_runtime/src/agents/bash-tools.exec.ts:2110` 把 `defaults.runId` 传给 `runExecProcess()`。
3. 审批路径：`bash-tools.exec.ts:1911` 把 `defaults.runId` 写入 `processGatewayAllowlist()` 参数；其异步恢复执行在 `bash-tools.exec-host-gateway.ts:806` 把 `params.runId` 传给 `runExecProcess()`。
4. `openclaw_runtime/src/agents/bash-tools.exec-runtime.ts:1091-1096` 由 `runId + sessionKey + sessionGeneration` 构造结构化 identity，而不是从 `scopeKey` 或 owner 字符串推导。
5. `openclaw_runtime/src/agents/verseshell/governed-process.ts:400-407` 将 identity 交给 `admitManagedProcess()`。
6. `openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts:163-169` 在 identity 存在时即使无 cap/port 也执行持久 reservation，且不制造 `limit`；仅 identity、port、limit 全无时保持原 noop。
7. `openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts:11-30,62-99` 持久化可选三元身份。旧记录缺字段仍可读取，但不能被当成完整身份。

提交 `81b84911a` 仅将误加到 `executeNodeHostCommand()` 的 `runId` 移除，并放到 `processGatewayAllowlist()`；当前 Node host 不再接收该无关字段，两条受管 exec 路径均保留该字段。

## Session scope 与旧 generation

- `openclaw_runtime/src/gateway/server-methods/session-task-scope.ts:95-116`：`runState` 仍先要求 Main bridge capability；`processScope` 缺省为 `run`，仅接受 `run|session`。
- `:143-155`：`session` scope 对内存 bash sessions 和 ProcessSupervisor 只按 canonical sessionKey 过滤，不再要求 generation 等于当前 generation。
- `:156-177`：durable reservation 在 `session` scope 下匹配同 sessionKey 的全部 generation；`run` scope 保持 `(sessionKey, sessionGeneration, runId)` 精确匹配。
- `:170-177,196-207`：无身份或身份不完整记录不按 owner 字符串归因，而是进入 `unknownIdentity` 并让所有 run/session 查询保持非静止，直到既有 reconciliation 证明其可结清。
- `tests/unit/session-task-scope-bridge.test.ts:274-289` 覆盖同 session 的旧 generation 以及 reserved/dispatched/observed/unknown/terminal 状态；`:279-282` 覆盖其他 session 不误挡；`:291-299` 覆盖旧 unknown、非法 scope 和非 bridge 拒绝。

## Main 接合点

- `electron/services/workspaces-api.ts:1424-1430`：`selectSessionTask` 始终执行 session-scope 检查；无 writer 时使用 diagnostic runId。
- `electron/services/workspaces-api.ts:1907-1913`：`bindCoordinator` 在环境或任务变更时始终执行 session-scope 检查；无 writer 时同样使用 diagnostic runId。
- `electron/services/sessions-api.ts:3047-3053`：handoff 不再受 `writerClaim` 存在性限制；无 writer 时使用 `handoff:${id}` 的 diagnostic runId 和 session scope。`tests/unit/session-handoff-recovery.test.ts:107-119` 明确验证无 writer、source 资源未结清时 retained pending 与重试。

## 回归证据

- `openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts:61-75`：无 cap/port 的 identity-only 真实 store reservation、`limit=undefined`、释放删除。
- `openclaw_runtime/src/agents/verseshell/governed-process.test.ts:149-153`：governed process 将 identity 写入实际 reservation。
- `tests/unit/session-task-scope-bridge.test.ts:256-300`：run/session scope、旧 generation、unknown、全部未结清 phase、非法 scope 与非 bridge。
- `tests/unit/session-handoff-recovery.test.ts:107-119`：无 writer handoff gate。

剩余验证仅为重跑用户已修正的 tsgo；在目标切片内没有需要继续改代码的 finding。