**本次交付将目标契约、执行资格、运行尝试和验收证据接入既有产品 Task Ledger。** 研发 Task Forest 记录实施工作树与验收进度，产品代码不读取 TF 节点或 skill 文件。

目标持久化于仓库域 SQLite；会话只是引用与执行者。revision 表示目标版本，epoch 表示执行资格的代次，attempt/run 表示一次尝试。上下文压缩后从持久契约、祖先目标和检查点重建，首次或内容变化的恢复记录注入回执。相同仓库的本机 Git 工作树通过 common-dir 共享任务域。

| 合同要求 | 实现入口与实际行为 | 验收证据 |
|---|---|---|
| 原始目标、来源、约束和验收持续存在 | TaskSystemStore.create/revise/checkpoint；状态询问不修改契约；revision 冲突拒绝 | task-tests.json；owner-readback.json |
| 任务与会话、run、工作树分别标识 | 稳定 taskNodeId；businessKey/occurrenceKey；session generation、run、epoch 独立 | task-tests.json；source-manifest.json |
| 同任务只允许一个实现者 | BEGIN IMMEDIATE 内领取；同会话不同 run 也互斥；旧代次工具调用被拒绝 | 16 进程/2 工作树争抢；lifecycle-readback.json |
| 重复识别有明确规则 | 显式 ID、业务键、请求幂等和精确契约去重；相似文本只推荐 | task-tests.json 的重复请求、同标题异范围及建议测试 |
| 分解保留完整目标 | 事务创建子任务及依赖；继承父约束；从根到叶恢复；父项等待子项验收 | task-tests.json 的分解、回滚、祖先、环检测和父计划修订测试 |
| 不因摘要压缩丢目标 | 每个 provider 调用前 restoreTaskModelContext；预算不足拒绝；context_rehydrated 记录 revision/epoch/run/digest | task-tests.json；live-continuity.json；hydration-performance.json |
| 派发前确定 writer | 实际 dispatch 前转移；排队期间只记录 intent；容量可用时重新核对；registry 终态归还 | runtime-delegation.json；task-tests.json；owner-regressions.json |
| 恢复不盲目重复副作用 | started/unknown 操作持久保存；process 终态或已有 EffectReceiptStore 回执结清；错误身份拒绝 | gateway-tests.json；task-tests.json；concurrency-performance.json |
| 验收绑定当前候选 | 文件字节、命令真实终态与输入哈希；既有 EvidenceVerifier、独立 verifier run；陈旧候选拒绝 | task-tests.json；gateway-tests.json；lifecycle-readback.json |
| 完成回复丢失可重试 | 相同任务/代次/候选回读完成结果；冲突候选、回执拒绝 | task-tests.json；gateway-tests.json |
| 取消形成闭环 | 父计划递归 cancelling，禁止新副作用；子操作结清后依次取消；保存文件和历史 | task-tests.json；lifecycle-readback.json |
| 存储错误有明确降级 | 不返回空任务图；UI 保留陈旧记录且禁止修改；恢复后读取原任务 | task-tests.json；pagination-readback.json；stale-task-store.png |
| 事件可以恢复消费 | 状态与事件同事务；消费序号 CAS；未确认事件重送；缓存按事件序号失效 | task-tests.json 的事件消费和投影缓存测试 |
| 大任务列表可查询 | 冻结插入上界的游标分页；搜索、状态筛选；相似建议最多扫描 500 活跃任务 | pagination-readback.json；concurrency-performance.json |
| 用户能识别归属和状态 | Main hostApi 提供任务页；显示目标、约束、验收、归属、工作树、下一步、取消/恢复；四语 | electron.json；visual-review.json；各语言截图 |
| 保留现有 owner 和权限边界 | Renderer→hostApi→Main→Gateway；Task Ledger 管目标，runtime/effect owner 管执行与效果；task_control 不授予权限 | contract.txt；comms-compare.txt；owner-regressions.json；source-manifest.json |
| 构建与静态契约完整 | 全部 17 项 Runtime 构建配置、插件/声明、桌面构建、node/web/test、四语、Harness | runtime-build.json；runtime-build.txt；types.json；commands.json |
| 性能可复算 | 1k/10k 任务、16 进程、100 文件写入对、200 次目标恢复；新上下文与回执复用分别计量 | concurrency-performance.json；tool-overhead.json；hydration-performance.json |

| 故障窗口 | 观察与恢复结果 |
|---|---|
| claim 成功后回应丢失 | 同 requestId 回读原结果，发生交接后旧结果的 epoch 无执行资格 |
| claim 后工作树或派发失败 | writer 资格保留；派发与清理回执均丢失时标记 unknown，第二写者被拒绝 |
| 写入后进程退出、效果回执缺失 | 独立进程退出码 23；接续保留部分文件并写出未确认操作，不把退出当作写入成功 |
| 旧进程/旧会话恢复 | 旧 epoch、generation、工作树身份在工具/验收入口被拒绝 |
| 后台命令仍在执行 | unknown 阻止再次写；匹配 process 句柄的终态回读后解除 |
| 外部效果结果丢失 | 只读取既有效果 owner 的 applied/not_applied 回执；unknown 和跨会话回执拒绝 |
| 目标修订与执行竞争 | 在途操作时拒绝修订；修订使旧 claim 失效；活跃子计划禁止父目标被替换 |
| 提交后验收失败或输入变化 | 保留 review，陈旧哈希、错误候选、缺失 verifier 回执均拒绝 |
| 完成事件与显示之间中断 | 完成可按原候选重试，投影从事件重建，消费序号未确认时重送 |
| 数据库忙锁、损坏与版本超前 | 忙锁事务失败后同请求可重试且无部分领取；损坏拒绝受管写；未来 schema 拒绝打开 |
| 路径别名及不同工作树 | canonicalPath 和 Git common-dir 解析到相同任务域；损坏 Git 绑定不回退成新域 |
| 时钟回退、休眠和代次变化 | lease 进入 recovery_required，保留原归属；不按超时自动重新派发 |
| 连续十次上下文压缩 | 原目标、约束、验收与下一步重新读取；两模型合成摘要丢失试验单独保留逐样本响应 |
| 相同标题不同意图、依赖成环或跨域引用 | 不同范围保留独立身份；环和不存在依赖在事务中拒绝；跨域 handoff 拒绝 |

成熟设计的借鉴与来源记录在 PLAN.md、DESIGN.md 和 sources.json：稳定业务身份借鉴 Temporal；期望状态与版本冲突借鉴 Kubernetes；领取/暂停/交接借鉴 Camunda 和现实交接实践；事件消费、幂等和隔离旧写者借鉴 outbox 与 fencing。实现复用现有任务、运行、效果和资源 owner。

部署边界为同机同仓库任务域。独立 clone 或不同机器需要单一协调服务；外部终端不参与受管工具领取协议。相似建议属于有界词项匹配；工具缺少效果 owner 终态时保留 pending。跨模型评测使用合成摘要丢失输入与真实模型请求，衡量持久目标重装配后的字段读取，真实产品交互另由 Electron/Gateway 场景覆盖。

完整 Runtime 构建使用显式串行和 12 GiB 构建堆预算；保留插件、类型声明和导出检查。声明阶段允许内容缓存；已裁剪的历史 CLI 源码步骤按既有构建规则跳过。所有证据均由 agent 驱动。首次失败与后续成功记录分别保留在 failure-index.json，初始切片历史证据保留在上级目录。
