# 会话、任务与资源操作矩阵

SessionKey 标识逻辑会话，sessionId 标识 generation，runId 标识一次执行，leaf 标识 transcript 边界。下面的“成功”均以对应 owner 回执或回读为准；切换后的迟到响应只处理原目标。任务、会话、运行和资源各自保留状态。

会话协作目录使用同一矩阵：消息进入原 sessions.send，guide 表示原 /loop 同 run 输入，sessions.steer 表示中断后发送。协作入口先回读完整 scope/run；stop 和 compact 使用原 generation 接口，其余范围、分支、接力、迁移和 guide 打开原 owner 操作入口，由它完成边界选择、能力核验和提交。

引导响应丢失时，输入框保留原请求 ID，并可查询原运行的持久回执；原运行结束或出现后继运行后仍可查询。确认后仅清理提交时未再编辑的草稿版本，查询期间的编辑以及切换后的其它会话草稿保持原样。取消引导模式保留输入文字。中断后发送的运行约束延续到实际派发边界，后继运行出现时拒绝该操作。

| 操作及现有入口 | Owner / Host action | 可用条件与目标 | 确认、取消 | pending / success | failure / unknown 与恢复 |
| --- | --- | --- | --- | --- | --- |
| 新会话：项目菜单、新会话按钮、`/new` | Workspace / `createWorkspaceScopedNewSession`，Chat store / `newSession` | 显式 workspace/agent；保存来源草稿和会话状态后创建新 key | 明确的新建操作直接执行 | 准备期间保留来源；完成后激活新 key，来源历史可重开 | Workspace 写入失败保留错误；由项目列表回读实际新建结果，避免用空白画面推断持久成功 |
| 切换：项目、侧栏、来源或后代链接 | Workspace / `saveState`、`activateWorkspaceScopedSession`，Chat / `switchSession` | 按 workspace、SessionKey 和 generation 读取；来源不可访问时显示原因 | 导航直接执行；可返回原会话 | 加载状态与已有列表分开；成功恢复目标草稿、阅读位置、运行状态 | 读失败显示重试；保留原会话缓存。旧请求不能覆盖新 scope |
| 重开：会话行、`/resume`、重启恢复 | Workspace 持久状态 + Session owner / `list`、`chat.history` | 使用实际会话 key；`/resume` 无参数或找不到目标时显示提示 | 选中目标即导航 | 从 owner 重读 transcript 和当前 generation | 历史暂不可用保留重试；不把暂未加载的来源写成 root 或删除孩子 |
| 停止当前 run：输入区 Stop | Runtime / `chat.abort`，必要时 `sessions.describe` 对账 | 目标 SessionKey、已知 runId、捕获 generation；只影响对应运行 | Stop 直接执行，重复点击在 pending 时受控 | 等待 abort 回执；同 generation 的空闲回读也可确认结束 | `aborted:false` 或旧回执不清除运行缓存；回复丢失先回读，错误可重试，邻居会话和后来的 run 保留 |
| 会话级停止：现有 Runtime 控制接口 | Runtime / `sessions.stop` | expectedSessionId、队列、派发 worker 与会话资源由原 owner 核对 | 按现有调用者权限执行；当前输入区 Stop 使用上一行 | 返回停止和资源回收明细 | 不完整清理保留资源及诊断；当前会话 UI 没有把此接口另包装成新的批量停止入口 |
| 暂停协调器：负责人面板 | Workspace / `pauseCoordinator` | workspace、session、bindingRevision 匹配；暂停新的派发与运行 | 已授权暂停直接执行 | 原 binding 提交前显示 pending；回读 state=paused 后显示暂停 | 冲突显示实际错误；丢失回复重新读取同一 binding。已经获得 claim 的当前执行按原策略排空 |
| 恢复协调器：负责人面板 | Workspace / `bindCoordinator` | 核验 generation、Task Ledger 引用、执行目录和当前 revision | 已授权恢复直接执行 | 原 owner 提交 active 后开放派发 | revision 过期不覆盖新 binding；失败保留诊断，通过同 scope 回读后重试 |
| 归档：会话菜单、删除框中的归档 | Session lifecycle / `archive`，原 mutation journal、Main gate | 显式会话、agent、generation；原生命周期屏障和资源权限有效 | 归档动作可通过 toast 撤销；删除框可以取消 | owner 完成后移入归档列表；任务状态保持其原值，孩子继续独立可达 | Runtime 已提交但 Main 清理未完成时保留原 operationId、步骤和资源回执；归档页显示“继续”，携原 ID 恢复 |
| 撤销归档：toast；恢复：归档页 | Session lifecycle / `restore` | 原归档记录的 archivedAt、transcriptPath 和 agent 匹配 | 点击撤销/恢复直接执行 | 恢复原逻辑 key、由 owner 给出新 generation；成功后回读列表 | 失败保留归档项；旧响应不能移除后来产生的新归档记录。pending 操作沿原 ID 继续 |
| 永久删除：会话删除框、归档页 | Session lifecycle / `delete` / `permanentDelete` | 精确目标、归档版本及 generation；原权限、删除日志和清理屏障有效 | 必须确认目标；取消不调用删除 | 完成目标 transcript/轨迹和 scoped tail 后移除目标；幸存孩子继续使用自身 key | 未完成的 gate 保留原 ID；继续按钮不创建新操作。已完成、被替换或跨 agent 的 ID 被拒绝；外部任务证据及其他 scope 资源保留 |
| 手动 Compact：输入区整理对话框 | Context / `compact` | capability、当前 run 状态和捕获 expectedSessionId 允许 | 提交前可取消；pending 禁止重复提交 | 确定完成后刷新上下文和检查点；使用同一逻辑 key | 拒绝、超时或未知保留说明和对话框；回读当前 owner 判断是否已提交，避免自动重发。原生客户端返回 pending 时保持 pending |
| 范围整理：消息范围入口 | Context / `compactRange` | from/to leaf 与捕获 generation 属于同一会话；后端支持此能力 | 确认选择范围；取消保留原边界和草稿 | pending 保留选择；明确成功后刷新范围和上下文 | 错误保留边界；跨会话/跨 generation 的迟到结果不更新当前页面；提交后丢失回复通过 owner transcript/checkpoint 回读 |
| Checkpoint 恢复：检查点对话框 | Session / `resumeCheckpoints`、`checkpointDiff`、`restoreCheckpoint` | checkpoint、journal UUID、generation 相符；原准入屏障和写队列覆盖回滚过程 | 用户选择具体 checkpoint；窗口可关闭；pending 禁止再次恢复 | 展示对应恢复回执；legacy fallback 明示仅文件回滚 | 失败/未知保留错误和草稿；刷新检查点、diff 及实际文件确认结果；旧 generation 拒绝。回滚不新增谱系节点 |
| reset 与本地清屏 | Runtime / `sessions.reset`；现有 `/clear` 仅调用本地视图清理 | reset 由原 Runtime owner 核验代次；当前 UI 没有独立的 reset 写入口 | `/clear` 是显式本地操作；新会话使用新 key | `/clear` 清空可见消息，重读历史可恢复；Runtime reset 是同一 key 的代次事件 | 不把 `/new`、`/clear`、文件 checkpoint 恢复解释成 Runtime reset；代次变化后读取新 owner，不继承旧 writer |
| 工作树创建、切换：项目下拉菜单 | Git / `worktreeAdd`；Workspace / 原创建与切换入口 | 当前 workspaceId/root 与 Git 返回的 workspaceRoot 匹配；branch/base 有效 | 先填写分支并创建；取消表单不建树 | pending 禁止重复；成功打开已有工作树，草稿按工作树所属会话恢复 | Git 或 Workspace 失败显示原错误；迟到的其他 workspace 状态不更新当前列表 |
| 工作树删除：Git / Storage | Git native identity + registry/writer/Task/Workspace owner；原 `worktreeRemove` | 受管或被引用的对象交回原 owner；无产品 owner 的原生 checkout 仍需 clean，且 HEAD 被持久共享 Git ref 保留 | 原审批及删除确认保留；取消不删除 | 原身份与 owner 在审批前后重检；Git 无 force 删除成功后刷新 | dirty、独有 detached commit、Task DB、writer 或 Workspace 引用导致具体拒绝；保留 ref 后可重新申请，产物可从该 ref 重建 |

资源列表读取原 resource owner。上下文 token、进程 RAM、accepted memory 分别来自 Context、进程监控和记忆验收记录；压缩上下文不会自动改变另外两类状态。

任务操作与会话操作通过既有引用衔接：`selectSessionTask` 核对任务、workspace 和 generation，活动 writer 静止后才切换；手工 `updateNode` 记录状态、业务 acceptance 和 run 完成分别展示。`queuePendingMessage` 记录 workspace、目标 key、generation 和发送 key，只向原目标续发。

Fork、Handoff、环境迁移和 worker 交付沿各自持久 owner：Fork 不复制写 claim；Handoff 保存 operationId/child/send key 并在回复丢失后对账；`migrateExecution` 排空源 binding 后按同一操作续接；`sendWorker` 核对 parent/child generation 并区分排队、引导、运行、回传和验收。任务副作用使用现有 Task Ledger 准入，读操作不创建业务任务；事务拿到 SQLite 写锁后再次核验执行目录 authority。

对应验证分工：`session-context-recovery` 覆盖上下文取消、pending、拒绝、超时和晚到结果；`session-context-commit-recovery` 覆盖真实压缩和 journal 文件回滚后的回复丢失；`session-lifecycle-recovery` 覆盖 Stop、暂停/继续和持久 gate 续接；`session-family-lifecycle` 覆盖父项归档、恢复、删除及孩子/任务/文件保留；`session-worktree-storage` 覆盖真实 Git、工作树往返、资源释放及 ref 恢复。实际候选、退出码、计数和首次失败保存在本节点 evidence manifest 中。
