**本方案把目标契约、执行资格和产物验收作为三个独立的事实。** 任务规划服务用户目标，运行尝试可以更换；领取记录负责决定当前谁能推进，完成事实由要求与实际证据逐项对应后产生。研发 Task Forest 只记录本工作树的实施节点。

取消同时核对活动运行和未决效果。原运行结束或匹配会话代次的 Runtime 停止回执完成后，任务 owner 才结算取消；被释放的协调者使用精确 run 的停止入口，避免影响已换选的其它任务。心跳失效停止续租，原运行的终态清理仍保留。

归档恢复消费 Runtime 的 previousSessionId 和新 sessionId，在任务事务内迁移绑定并提升 writer epoch；只读引用迁移代次而不领取写入资格。活跃运行、未知效果和未结算评审阻止 writer 迁移。恢复重试保持同一领取，显式暂停保持暂停状态。agent 恢复沿新运行已读取的暂停 epoch 继续，允许该运行自身的只读上下文记录，拒绝暂停前的旧运行。

工具副作用分类集中在 shared/task-system/tool-policy.ts。Main 准入读取当前任务和原父任务的持久来源，事件提交使用不生成全量快照的 owner 入口；列表投影使用节点和链接索引合并。Renderer 将等待历史期间的后台发送写入目标会话缓存，迟到操作回调核对原作用域和读取代次。

**采用这些机制的原因。**

| 成熟设计 | 抽象到本项目的规则 | 明确取舍 |
|---|---|---|
| Temporal 的 Workflow ID 与 Run ID | 稳定任务身份和多次尝试分开 | LLM 推理与工具副作用不能按普通确定性函数重放；恢复读取持久事实，未知效果先核对 |
| Kubernetes 的期望状态、实际状态与版本 | objective/revision 与 run/epoch 分开 | 一个版本决定要做什么，另一个代数决定谁有资格执行 |
| Camunda 的领取与工作状态 | 任务归属可以跨暂停保留 | 租约用于执行有效性，不用超时直接分配重复开发 |
| Kanban 的 WIP 与拉取 | 每个会话一次绑定一个实现任务，依赖满足才领取 | 资源容量继续由现有资源 owner 决定；调度不复制资源计数 |
| HSE 交接中的固定信息与接手复核 | objective、constraints、criteria、checkpoint、unknown effects 有固定字段 | 不要求真人；agent 接手时核验工作树、版本与操作回执 |
| 幂等 API 与 fencing | requestId 区分重试，epoch 拒绝旧写者 | 同内容的新业务实例用 occurrenceKey，标题相似不自动合并 |

**任务识别分五步。** 显式 taskNodeId 直接定位；businessKey + occurrenceKey 定位业务对象；相同 requestId 的重复请求按原结果回复；精确契约指纹查找尚未结束的重复目标；其余相似意图只进入候选推荐。建议对最近 500 个活动任务使用词项重合与同目标路径评分，返回解释而不自动合并。Agent 可通过 decompose 提交依赖计划；事务一次写入子任务并保留父目标及验收，失败整组回滚。

**执行资格有三个检查点。** claim 在 SQLite 单事务中产生；模型调用边界重新读契约并核验版本；实际受管工具在调用前登记操作并检查 epoch。会话身份由宿主给出，任务控制工具参数不能替换 session/generation。Fork 不继承 writer；handoff 在未知副作用消除或隔离后换代。同一 session 的两个 run 也会被持久的 active-run 记录区分。

首次执行同样经过领取检查：工作树尚无任务库时，读取与讨论可以继续，首次受管副作用要求 agent 通过 `task_control` 创建或选择任务并领取。不能用“数据库还没创建”作为免除目标持久化的条件。

**跨工作树共享以仓库任务域为准。** linked worktree 与主检出通过 Git common directory 使用同一数据库。ordinary workspace 使用显式根目录。目标的持久 UUID 不包含工作树路径。现阶段是同机共享文件系统，不对不同 clone 或不同机器声称互斥；远程部署要将同一协议迁到单一协调服务，不能复制 SQLite 文件实现多主写入。

**压缩不参与目标修订。** 每次向模型发请求都重新装配持久目标；检查点只补充进度和下一步。目标变更走 expectedRevision，保留旧契约事件并使旧领取失效。上下文内容使用数据边界，受长度预算约束；核心目标放不下时明确拒绝执行。实际模型是否正确理解全部约束仍需长会话配对评测，结构化恢复和行为收益分别验收。

每次恢复以任务 ID、revision、epoch、session generation、run 和上下文摘要标识注入回执，记录在原有事件 journal。同一 run 中内容不变时复用已有回执；目标或检查点变化产生新回执。回执写入前在事务中核对最新 binding 与上下文，`changes` 可查询记录；模型请求始终重新读取持久目标。

分叉会话由 session owner 的 parentSessionKey、generation 和 workspace 信息继承只读任务引用，原 writer 保持不变。桌面 chat 入口可根据持久会话 lineage 补建遗漏引用。`task_control.revise` 按 expectedRevision 保存显式目标修订，旧 run 的资格立即失效；接续 run 重新领取新版本。

**完成绑定可复算证据。** 当前实现精确文件哈希检查，以及 runtime exec 返回的真实终态/退出码与检查输入文件的前后哈希。文件在检查后变化就使回执失效；宽泛业务要求使用 owner-receipt 类型，在其 owner 尚未接线时返回拒绝。命令成功只满足该命令对应的 criterion，不升级成任意业务正确。副作用 owner、测试运行 owner、业务评审的结果仍分别保留。

**降级策略。**

| 故障 | 系统行为 | 恢复条件 |
|---|---|---|
| 数据库忙锁/损坏/不可读 | 保留最近显示，拒绝新领取与写入 | 同一 owner 库恢复可读写并核对版本 |
| 租约过期/宿主失联 | 保留归属与产物，进入恢复 | 旧 epoch 无资格；在途操作排空或明确隔离 |
| 工具返回后台句柄 | 记录 unknown，阻止新的写操作 | 真实 process poll 返回匹配句柄的终态 |
| 同步文件工具所在进程死亡 | 允许回收执行资格，记录未知部分写入 | 先检查产物；不把“进程死了”记录成“写入成功” |
| 外部工具超时且无 owner 回执 | 保持 pending，禁止自动重复 | 该效果 owner 的回读/撤销/隔离证据 |
| 目标修订或候选变化 | 拒绝旧 revision/epoch/证据 | 新契约与新候选重新验证 |
| 验证器不可用 | 停在 review | 绑定本任务本候选的有效回执 |
| 上下文预算不足 | 保留数据库目标，拒绝继续受管执行 | 缩小执行切片或提供足够模型上下文 |

**事件与投影。** 现有 Task Ledger 事件迁入 events.sqlite3，保留 JSONL 原件和 ID；执行契约保存在仓库级 task-ledger.sqlite3。两类数据由同一个产品 Task Ledger API 暴露，每个受管节点只有执行契约能够推进状态，旧 CRUD 入口拒绝修改它。投影缓存按事件序号失效，可从原始事件重建。任务事件与状态在同一事务提交，changes/acknowledge 以消费游标实现持久 outbox；未确认事件在重启后重送。分页冻结插入上界，期间新增任务不会挤掉下一页的已有任务。

跨子代理的 writer 在实际 dispatch 前转移，registry 终态与在途效果结清后归还。排队期间记录领取意图，容量可用后重新核对 epoch；父会话保留只读目标引用。验收接入既有 EvidenceVerifier、EffectReceiptStore 和独立 verifier run。外部效果通过 `tasks.contract.reconcile` 回读已有 owner；没有已知终态回执的工具保持 pending。

**分解后的执行方式。** `task_control.decompose` 原子建立子任务和依赖，释放父任务的实现资格并保留 coordinator 引用。会话按可执行叶子领取，独立会话可以并行处理不同叶子；同一会话在切换任务时开启新 run，以免旧 run 静默获得新凭证。模型上下文携带从根到叶的完整目标、约束与验收；总上下文超过 12,000 字符时拒绝继续执行。检查点的下一步完整保留，超出预算的未决项以数量说明，原件仍在持久库。

活跃子任务存在时，父目标修订返回 `TASK_PLAN_CHILDREN_ACTIVE`。待旧子项全部完成或取消后，修订记录 `plan_retired` 事件并保留旧节点，再建立新计划。取消父计划递归设置 cancelling；已启动操作等待效果 owner 结清，未开始子项直接取消，最后父任务取消。任务领取与系统原有资源调度协作，模型不能通过相似度建议或任务文本增加权限。

双模型配对评测使用生产目标恢复函数和真实供应商，输入是人工构造的摘要丢失场景；报告同时给出字段保留、输出格式、失败请求和原始响应。它衡量恢复后的模型读取能力。实际 Gateway 会话、工作树交接和产品交互由 Electron 测试分别覆盖。服务端多机器模式是独立部署能力。

**性能判断依据。** 当前控制面只在领取、目标读取、工具执行和活跃 run 心跳时访问持久库，不扫描开发 Task Forest，也不为每个待办创建定时器。已有 1k/10k 任务与 16 进程真实工作树测试。初次数据与并发构建负载下的数据分开保留；开销要与文件/模型工具实际执行时间比较，不能仅展示数据库平均数。同步验收读取限制为每文件 32 MiB，更大产物需要流式验证器。

**引用来源**（通过 versesearch → Exa 查阅）：

- Workflow Id and Run Id — https://docs.temporal.io/workflow-execution/workflowid-runid
- Controllers | Kubernetes — https://kubernetes.io/docs/concepts/architecture/controller/
- User task lifecycle | Camunda 8 Docs — https://docs.camunda.io/docs/apis-tools/frontend-development/task-applications/user-task-lifecycle/
- Transactional outbox pattern - AWS Prescriptive Guidance — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- How to do distributed locking — Martin Kleppmann’s blog — https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- latest | The Kanban Guide | Kanban Guides — https://kanbanguides.org/the-kanban-guide/
- Shift handover - HSE — https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm

**只读命令。** 无领取的会话可查询文件、记忆与会话历史。Git 差异和历史命令在子命令后先传入 `--no-textconv --no-ext-diff`，例如 `git diff --no-textconv --no-ext-diff -- src/`，以关闭仓库配置中的外部转换程序。请求外部分页、搜索预处理或 hostname helper 的命令需要有效任务领取。

**会话优先交互。** 普通聊天由 agent 通过 `task_control.start` 定位目标并领取任务，讨论可以没有任务。`sessionTask` 按工作区、会话与 generation 读取绑定和子任务；任务与窗口事件合并刷新，旧作用域响应丢弃。读取失败保留陈旧状态并提供刷新。

**会话任务托盘。** 运行任务停靠在输入框上方，默认展示目标、状态、已知步骤进度与当前步骤，完成后收为一行回执。展开后可查看任务 ID、子任务、更新时间与账本链接；菜单支持复制完整 ID、展开、刷新和隐藏。隐藏只保存显示偏好，后台任务与执行资格保持。运行计划全部完成且本轮结束后离开托盘，回合摘要保留记录。

**任务账本。** 默认打开持久任务的紧凑列表，每行展示目标、真实状态和非空下一步。归属、约束、验收条件与任务操作按需展开。任务树保留父子导引线，DAG、历史和核验保持为其他视图；页签上方的标题与操作区稳定，新建和关联控件收在页签下的折叠区。

**执行追踪。** 任务报告以轻量折叠行打开。已记录耗时与调用显示为简洁摘要；用量、未知金额、分段耗时、运行、验证、诊断与原始记录仍可展开查询。报告的来源、版本、候选与产物检查继续读取原 Task owner。

**项目总览。** 项目使用同一灰阶工作面和细线列表，先显示项目名称、协调状态、目标、下一步与任务进度。有效资源读数简洁展示，证据引用、未知读数及配置在卡底展开。项目派发与配置仍使用各自的 owner 与版本检查。

会话任务范围只在有内容或状态异常时显示页眉入口；空范围保留可读状态。会话状态面板以键值行展示上下文用量、连接器、变更与后台任务。界面使用一致的标题、辅助文字、状态图标与 28–32px 控件，支持四语、键盘和明暗主题。


会话任务条与项目、执行目录和分支共用上沿托盘，输入框采用22px圆角；折叠行只显示目标、中性步骤计数和必要操作，当前步骤在展开区查看。运行、完成与暂停用低饱和微标区分，读取失败用错误微标及独立刷新按钮；比例圆环和输入框流光已移除。持久任务存在时，本轮计划承接更细的执行步骤；实时步骤只在任务条展开，已结束的计划归入对应对话摘要。本轮步骤全部完成后继续显示任务 owner 的验收状态；任务验收通过时自动折叠回执，仍可再次展开。任务 ID 和更新时间收在菜单。首次读取失败和陈旧状态都提供就地刷新；刷新期间保留反馈与输入草稿，迟到响应仅属于原会话。暂停任务有未解决项时显示账本入口，即使先前已隐藏任务条也能看到。

知识来源、调用模式与检索方案在同一书本菜单设置。打开菜单不启动检索；已选择的自动读取继续在发送前完成，读取期间可取消，非本地检索档位保留可见标签。设置只按用户选择变更。队列、读取异常和连接故障直接显示在输入框内，常规检查点与干预记录按需查看。消息目标可通过 `@` 或更多操作选择，权限与模型仍保留直接入口。
