**本方案把目标契约、执行资格和产物验收作为三个独立的事实。** 任务规划服务用户目标，运行尝试可以更换；领取记录负责决定当前谁能推进，完成事实由要求与实际证据逐项对应后产生。研发 Task Forest 只记录本工作树的实施节点。

**采用这些机制的原因。**

| 成熟设计 | 抽象到本项目的规则 | 明确取舍 |
|---|---|---|
| Temporal 的 Workflow ID 与 Run ID | 稳定任务身份和多次尝试分开 | LLM 推理与工具副作用不能按普通确定性函数重放；恢复读取持久事实，未知效果先核对 |
| Kubernetes 的期望状态、实际状态与版本 | objective/revision 与 run/epoch 分开 | 一个版本决定要做什么，另一个代数决定谁有资格执行 |
| Camunda 的领取与工作状态 | 任务归属可以跨暂停保留 | 租约用于执行有效性，不用超时直接分配重复开发 |
| Kanban 的 WIP 与拉取 | 每个会话一次绑定一个实现任务，依赖满足才领取 | 资源容量继续由现有资源 owner 决定；调度不复制资源计数 |
| HSE 交接中的固定信息与接手复核 | objective、constraints、criteria、checkpoint、unknown effects 有固定字段 | 不要求真人；agent 接手时核验工作树、版本与操作回执 |
| 幂等 API 与 fencing | requestId 区分重试，epoch 拒绝旧写者 | 同内容的新业务实例用 occurrenceKey，标题相似不自动合并 |

**任务识别分五步。** 显式 taskNodeId 直接定位；businessKey + occurrenceKey 定位业务对象；相同 requestId 的重复请求按原结果回复；精确契约指纹查找尚未结束的重复目标；其余相似意图只进入候选推荐。当前实现前四步，相似度检索与自动拆分的评测留给后续研发节点。只用目标文本散列会误合并两次合法工作，也会漏掉改写后的同一目标，所以不能取代业务身份。

**执行资格有三个检查点。** claim 在 SQLite 单事务中产生；模型调用边界重新读契约并核验版本；实际受管工具在调用前登记操作并检查 epoch。会话身份由宿主给出，任务控制工具参数不能替换 session/generation。Fork 不继承 writer；handoff 在未知副作用消除或隔离后换代。同一 session 的两个 run 也会被持久的 active-run 记录区分。

首次执行同样经过领取检查：工作树尚无任务库时，读取与讨论可以继续，首次受管副作用要求 agent 通过 `task_control` 创建或选择任务并领取。不能用“数据库还没创建”作为免除目标持久化的条件。

**跨工作树共享以仓库任务域为准。** linked worktree 与主检出通过 Git common directory 使用同一数据库。ordinary workspace 使用显式根目录。目标的持久 UUID 不包含工作树路径。现阶段是同机共享文件系统，不对不同 clone 或不同机器声称互斥；远程部署要将同一协议迁到单一协调服务，不能复制 SQLite 文件实现多主写入。

**压缩不参与目标修订。** 每次向模型发请求都重新装配持久目标；检查点只补充进度和下一步。目标变更走 expectedRevision，保留旧契约事件并使旧领取失效。上下文内容使用数据边界，受长度预算约束；核心目标放不下时明确拒绝执行。实际模型是否正确理解全部约束仍需长会话配对评测，结构化恢复和行为收益分别验收。

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

**实现与后续集成边界。** 现有 Task Ledger 事件迁入 events.sqlite3，保留 JSONL 原件和 ID；执行契约保存在仓库级 task-ledger.sqlite3。两类数据由同一个产品 Task Ledger API 暴露，每个受管节点只有执行契约能够推进状态，旧 CRUD 入口拒绝修改它。投影按需读取，未实施跨存储双写完成。后续应收敛成增量投影、分页和统一持久 outbox；当前每次 legacy snapshot 仍读取该 workspace 的事件。

跨子代理的 writer 转移、受控取消后资源 owner 确认、各类外部工具的 unknown 回读、完整 verifier/effect 回执接入、服务端多机器模式、独立长会话收益评测都保留在总目标的后续节点。当前 pre-dispatch 能拒绝错误任务归属；不能把收到子代理 accepted 回执写成其持有任务 writer。

**性能判断依据。** 当前控制面只在领取、目标读取、工具执行和活跃 run 心跳时访问持久库，不扫描开发 Task Forest，也不为每个待办创建定时器。已有 1k/10k 任务与 16 进程真实工作树测试。初次数据与并发构建负载下的数据分开保留；开销要与文件/模型工具实际执行时间比较，不能仅展示数据库平均数。同步验收读取限制为每文件 32 MiB，更大产物需要流式验证器。

**引用来源**（通过 versesearch → Exa 查阅）：

- Workflow Id and Run Id — https://docs.temporal.io/workflow-execution/workflowid-runid
- Controllers | Kubernetes — https://kubernetes.io/docs/concepts/architecture/controller/
- User task lifecycle | Camunda 8 Docs — https://docs.camunda.io/docs/apis-tools/frontend-development/task-applications/user-task-lifecycle/
- Transactional outbox pattern - AWS Prescriptive Guidance — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- How to do distributed locking — Martin Kleppmann’s blog — https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- latest | The Kanban Guide | Kanban Guides — https://kanbanguides.org/the-kanban-guide/
- Shift handover - HSE — https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm
