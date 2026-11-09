# 会话、任务与资源操作矩阵

会话操作使用稳定的 SessionKey；generation 对应实际 sessionId；runId 只定位一次运行；leaf 指定 transcript 边界。界面保留任务清单、工作组和来源入口，并按这些身份核对返回结果。

| 操作 | Owner / Host 入口 | 执行条件与范围 | 结果和恢复 |
| --- | --- | --- | --- |
| 新建、切换、重开 | Workspace / `workspaces.create`、`saveState`、`activateWorkspaceScopedSession` | 使用显式 Workspace/Session 关联；项目入口由 `projectCoordinatorSessionKey` 定位 | 待保存草稿在离开时写回原会话；阅读位置按 workspace、session、generation 恢复 |
| 当前运行停止 | Chat runtime / `chat.abort` | 传当前 SessionKey 和已知 runId | 后端返回前保留运行状态；旧 run 的迟到返回不会清空新 run 或另一会话 |
| 会话级停止 | Session runtime / `sessions.stop` | 可传 expectedSessionId；沿现有 owner 清队列、停止派发的 worker 并回收进程 | 返回停止结果与资源回收回执；保留仍需恢复的资源明细。这与仅停止当前 run 是两个范围 |
| 暂停协调器 | Workspace / `pauseCoordinator` | workspace、session、bindingRevision 一致；暂停新的派发和新运行 | 已获写 claim 的当前 run 可完成；暂停结果来自持久 binding |
| 恢复协调器 | Workspace / `bindCoordinator` | 重新检查 session generation、Task Ledger 引用和执行目录 | 使用当前 revision 提交；冲突或失效时保留诊断，重新读取 owner |
| 任务状态调整 | Task Ledger / `updateNode` | 明确 nodeId 与 workspace；显示记录状态 | 任务状态记录与运行终止、自动验收分别展示 |
| 选择当前任务 | Workspace / `selectSessionTask` | 真实 Ledger task、会话归属和 generation 一致；当前 writer 已静止 | 只写任务关联与绑定，不修改任务完成记录；有活动运行时拒绝切换 |
| UI 排队消息 | Chat store / `queuePendingMessage`、`drainPendingMessages` | 记录 workspace、目标 SessionKey、已知 generation 和发送 key | 仅在对应会话范围恢复时续发；切换项目不会把旧队列送到当前会话 |
| Fork / 在新会话中提问 | Session runtime / `sessions.fork` | 来源可读且运行允许分支；问题使用指定 user leaf 之前的 assistant 边界 | 新问题留在子会话草稿；源草稿保留；取消或无有效边界时不创建 |
| Handoff | Workspace + Session runtime / `createHandoff`、`handoffOperation` | 保存 source generation、operationId、child key；runtime 确认 parent 后才完成创建 | 创建响应丢失后核对同一 child；首发使用同一 key；unknown 先核实，不自动重发 |
| 迁移执行环境 | Workspace + Session mutation journal + TaskSystemStore / `migrateExecution`、`executionMigration` | 保留 sessionKey，源绑定关闭后排空；目标预留、物理代次和任务 epoch 分别更新 | 按同 operationId 续接持久步骤；目标合同/产物/未决效果回读后开放；关闭窗口后仍可恢复 |
| 给 worker 发送 / 引导 | Main / `sendWorker` → `sessions.send` / `sessions.steer` | 核对项目、parent generation、真实 child 关系和 child generation，并通过既有权限路由 | 已排队、已引导与新运行已接收分别显示；失败保留输入，未知交付按原发送 key 核对 transcript 或运行时 intervention 回执 |
| 定时执行的首次效果 | Cron embedded owner → 原任务准入桥 | 使用实际执行句柄、runId、generation 和记录的工作区；负责人定时任务同时核对来源 binding 与任务引用 | 独立任务取得自己的 writer，保留项目负责人；来源过期或暂停时拒绝新效果 |
| 归档 / 撤销归档 | Session archive owner / 既有 archive、restore 入口 | 使用显式目标会话和归档策略 | 归档不更新任务完成状态；恢复沿原 owner 回读会话及协调器绑定 |
| 永久删除 | Session lifecycle owner / 侧栏和归档页的 delete 确认流程 | 确认目标后执行原有 generation、删除日志和清理屏障 | 清理属于该目标的 transcript/轨迹；幸存子会话继续从其自身 key 打开，来源缺失单独显示 |
| Compact / 范围整理 | Context owner / `compact`、`compactRange` | 现有 capability、run 与 leaf 边界允许操作 | 更新同一逻辑会话的上下文；刷新 policy 和范围记录 |
| Checkpoint 恢复 / reset | Session/context owner / 既有恢复入口 | checkpoint、generation 和 journal 由 owner 核验 | 失效 generation 的 UI 返回被隔离；新 generation 不继承旧阅读位置或 writer |

资源列表读取资源 owner 的运行/退出回执。上下文 token、进程内存和记忆验收分别来自各自 owner。无法取得回执时显示不可用或未知，并保留可重试输入和已经存在的会话。

运行时工具的写操作在权限检查之后经过 Task Ledger/Workspace 准入。普通讨论与已知纯读操作保持空业务任务；第一次效果创建一个稳定任务。每个任务最多有一个有效 writer，子任务可以独立取得 writer。仅提供 preflight、无法跟踪实际效果的客户端或原生工具入口会返回 `TASK_SCOPE_EFFECT_OWNER_UNAVAILABLE`。

归档页的待确认操作来自原 session-delete gate，并按当前 agent 过滤。继续按钮携带原 operationId；Main 在原锁内核验，过期按钮无法启动新操作。上下文控制携带捕获的 generation；压缩结果与其内部检查点均以压缩前代次核对，检查点恢复持有原准入屏障和存储写队列直到文件回滚完成。

工作树回收保留拥有任务数据库、受管 checkout 或 Workspace 引用的对象；普通无 owner 的原生检出仍采用审批后的 Git 无 force 删除。任务写事务取得锁后再次核验 authority，等待期间删除或替换检出会使后续领取失败。
