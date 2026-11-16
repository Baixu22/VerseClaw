**结论：确证 1 项 P2。snapshot 的附带缓存写入失败会丢弃已生成的任务投影，使摘要栏显示“Session tasks 0 / Task owner unavailable”。该旅程存在真实失败记录，不能仅按截图加载瞬态收口；未发现所怀疑的 agent 路由错接。**

核对工作树 `D:/ClawX-work/session-task-unified-relay-20261109`，HEAD 为 `35cbf9c5d8d38eee7d3e85f7baea20a8cf401875`。读取时工作树干净。

**P2：任务摘要读取依赖非权威 snapshot.json 写入成功。**

- 触发：项目/会话导航使同一 workspace 的多个 snapshot 请求重叠。`loadTaskLedgerSnapshot` 已完成事件投影和 managed task 合并，仍在 [task-ledger-service.ts:340](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-ledger-service.ts:340) 无条件等待 `writeTaskLedgerSnapshot`。该函数在同文件 304–307 行写同一个 snapshot.json，失败直接使读取请求 reject。
- 真实证据：[worker-task-journey.json:6321](D:/tmp/unified-management-20261109/session-task-validation/final3-worker-results/session-worker-task-journe-a19f1--accepts-a-scoped-follow-up/worker-task-journey.json:6321) 记录请求 `04c0e177-2791-4e99-9f63-e780e9f510b4`，workspace 为 `worker-project`，于 **2026-11-09 03:51:08.447 +08:00** 以 `Atomic write failed ... EPERM ... rename` 失败，与截图保存时间在同一秒。该文件记录的 17 次 worker-project snapshot 请求中，7 次出现这一错误；其余请求成功。日志路径已脱敏，不能进一步断言是目标 JSON、备份还是 write-meta 的哪一次 rename。
- UI 后果：[TaskLedgerSummaryPanel.tsx:87](D:/ClawX-work/session-task-unified-relay-20261109/src/components/task-ledger/TaskLedgerSummaryPanel.tsx:87) 捕获失败后保存 `snapshot: null, error: 'owner-unavailable'`；[session-read-model.ts:53](D:/ClawX-work/session-task-unified-relay-20261109/src/lib/session-read-model.ts:53) 返回 unavailable 与空 nodes；面板 130、169 行显示数量 0 和 owner unavailable。失败后的结果保留到刷新、scope 或 refreshKey 变化，其他组件成功取得 snapshot 不会更新此组件的本地 loaded 状态。
- 同屏任务标题来自另一条真实读取路径：[SessionTaskDock.tsx:67](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/SessionTaskDock.tsx:67) 调用 `taskLedger.sessionTask({workspaceId, sessionKey})`；[task-system-service.ts:65](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-system-service.ts:65) 以 Gateway generation 读取 `store.sessionSnapshot`，不经过上述 JSON 缓存写入。证据中的 observerOwnerBefore 确认任务 `4cea3e0b-547d-4279-96aa-e972d710429f`，objective 为 `Independent coordinator task`，claim 属于独立 coordinator。

**agent / scope 核对结果。**

| 核对对象 | 当前代码与证据 |
|---|---|
| activeWorkspace 与当前 session | [Chat/index.tsx:3432](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:3432) 同时传入 activeWorkspace.id、currentSession 及按 currentSessionKey 取得的 binding。scopeKey 为 workspaceId/session.key/session.sessionId；摘要按 session link 和 generation 过滤。 |
| snapshot owner 选择 | [task-ledger-api.ts:166](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-ledger-api.ts:166) 仅传 workspaceId；[task-system-service.ts:15](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-system-service.ts:15) 经 workspace.rootPath 打开 TaskDomain；[workspaces-api.ts:729](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:729) 按 workspace id 取 rootPath。此链不使用 workspace.agentId 或 selectedAgentId 筛选任务。 |
| selectedAgentId 现场值 | [worker-task-journey.json:4338](D:/tmp/unified-management-20261109/session-task-validation/final3-worker-results/session-worker-task-journe-a19f1--accepts-a-scoped-follow-up/worker-task-journey.json:4338) 的 currentProject 中，agentId 与 selectedAgentId 均为 independent-coordinator，activeSessionKey 同属该 agent。该记录生成于截图导航之前，未把它冒充截图时的 store 快照。 |
| 右侧 worker 导航 | [session-worker-task-journey.spec.ts:279](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-worker-task-journey.spec.ts:279) 先选择独立 coordinator，再打开其 worker 侧栏，等待 worker 内容后截图；中央摘要仍属于 coordinator session。 |

**最小修复建议。**

在 `loadTaskLedgerSnapshot` 中，只隔离最后一步派生 JSON 缓存写入的失败：记录诊断后返回已成功读取并投影的 snapshot。事件库、TaskDomain 和 scope 校验失败仍按现有错误路径返回。该缓存写失败不要加入 `snapshot.warnings`，因为 read model 会把任意 warning 再次判为 owner unavailable。无需新增 agentId 参数，也无需改 selectedAgentId 或降低 owner 校验。

可在现有 [task-ledger-service.test.ts](D:/ClawX-work/session-task-unified-relay-20261109/tests/unit/task-ledger-service.test.ts) 补一个定向回归：真实事件/任务读出成功，派生 JSON 写入抛 EPERM，snapshot 仍返回相同 workspace、任务和 session/generation link；权威读取失败仍 reject。现有 worker 旅程在截图前增加摘要 `data-state=ready`、展开后包含 Independent coordinator task 的断言，避免仅等待右侧 worker 内容就判定此画面一致。

本次依据当前源码、截图、ui-diagnostics.json 与已保存旅程调用日志核对，未运行测试。旅程的 passed 状态予以保留；原断言未检查摘要栏计数及 owner 状态（spec 279–287 行）。