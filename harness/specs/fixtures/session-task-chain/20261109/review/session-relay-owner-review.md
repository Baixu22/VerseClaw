# Session Relay Owner Review

更新时间：2026-11-09 03:23 +08:00  
复核范围：仅限 `readManagedSessionEffect`/延后 claim、`TaskSystemStore.start(expectedContract)`、Sidebar 跨 agent coordinator-only 归属。未运行测试，未修改工作树。

## 结论

- 前一版 P1 revision/digest 竞态已由事务内合同前置校验闭合。
- coordinator-only 覆盖建议已通过参数化测试补齐；现有失败证据只是同活动时间返回顺序差异，已改为集合断言。
- 本次窄复核未发现新的 P1/P2 产品缺陷。

## P1 闭合：claim 绑定最初只读 revision/digest

当前代码：

- `shared/task-system/store.ts:678-688`
  - `start()` 接受 `expectedContract: {revision,digest}`。
  - 在既有 `this.transaction()` 内先读取当前合同，比较 revision 与 digest；不一致时抛出 `TASK_CONTRACT_STALE`。
  - 比较完成后才调用 `claim()`，因此 revision 检查与 claim 处于同一个 SQLite 事务边界。
- `electron/services/task-system-service.ts:124-147`
  - `readManagedSessionEffect()` 返回未领取的 TaskView。
  - `startManagedSessionEffect()` 将 `expectedContract` 传给 `store.start()`。
- `electron/services/workspaces-api.ts:1313-1354`
  - 最初只读结果保存为 `managedTask`。
  - 在 writer、environment、final live-run 检查完成后，才 claim。
  - claim 时显式传入最初 `managedTask.contract.revision` 和 `digest`。

回归证据：

- `revision-race-red.tests.json`
  - 修复前实际失败：`rejects a contract revision changed after resolution without claiming the revised task`
  - `revision-race-red.result.json`：exit 1，sourceUnchanged=true；失败是预期 red。
- `scoped-process-owner1.tests.json`
  - 上述 revision-race 测试已 passed。
  - 同测试断言修订后 revision 增加、claim 仍为 null、workspace binding 未创建、ledger 无 execution link。
- `scoped-process-runtime2.tests.json`
  - 30/30 passed，对应 result exit 0、sourceUnchanged=true。

判定：**P1 已闭合。**

## coordinator-only 覆盖补齐

当前测试：

- `tests/unit/sidebar-session-buckets.test.ts:191`
- `it.each(['agent', 'coordinator'])` 使用同一项目分组断言覆盖两类归属。
- coordinator-only case 只通过 `coordinatorBindings` 关联 reviewer session，不使用 `agentBindings`/`sessionStates`。
- `:216` 使用 Set 比较可见 session，不再约束相同 activity 下的返回顺序。

修复前测试结果：

- `scoped-process-owner1.tests.json`
  - coordinator-only case 已可见 reviewer；唯一失败是数组顺序：
    expected 以 main 开头，correlated result 以 reviewer 开头。
  - 这说明 coordinator-only 归属行为本身已生效，失败属于测试对同活动毫秒值的过强顺序要求。
- 当前 working bytes 已把该断言改为集合比较。

证据边界：

- 当前目录尚未发现断言修改后的第二次 `scoped-process-owner1` 运行结果；最新 owner1 结果早于 `<sidebar-session-buckets.test.ts>` 的最终 mtime。
- 需要将后续同 suite pass 落盘并绑定当前 source hash；这不构成产品 P2，只是最终证据绑定项。

判定：**覆盖缺口已在测试代码中闭合；最终绿跑证据待该 suite 新一轮运行。**

## 补充：无 writer 时的 session resource fencing

同期变更还覆盖：

- `taskScope.runState` 接受 `processScope: run | session`。
- `selectSessionTask` 和 task-changing coordinator rebind 在无 workspace writer 时仍读取 session-scoped process owner。
- 对应测试 `blocks task selection and rebinding on session resources even without a Workspace writer` 在 `scoped-process-owner1` 中 passed。

本项不引入额外发现。

## 检查范围

已读取：

- `shared/task-system/store.ts`
- `electron/services/task-system-service.ts`
- `electron/services/workspaces-api.ts`
- `openclaw_runtime/src/gateway/server-methods/session-task-scope.ts`
- `tests/unit/session-task-scope-completion.test.ts`
- `tests/unit/sidebar-session-buckets.test.ts`
- `D:/tmp/unified-management-20261109/session-task-validation/revision-race-red.*`
- `D:/tmp/unified-management-20261109/session-task-validation/scoped-process-owner1.*`
- `D:/tmp/unified-management-20261109/session-task-validation/scoped-process-runtime1.*`
- `D:/tmp/unified-management-20261109/session-task-validation/scoped-process-runtime2.*`

未审查、未重跑：

- 其他 owner/UI 文件
- Electron E2E
- 全量测试
- clean autoreview

## 最终状态

- P1：闭合，有 red→green 和事务内源码证据。
- P2 coverage 建议：测试已补齐；最终 owner suite 需在集合断言版本上再落一次绿色结果。
- 当前窄范围内无新增 P1/P2。