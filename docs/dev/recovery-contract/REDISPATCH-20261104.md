# 恢复收口：实现、测量与边界

`driven_by: agent` · `actor: recovery-convergence-integrator` · `realHumanEvidence: false`

## 当前实现

工具调用的状态、执行相位和 revision 保存在同一条 TaskFlow `flow_runs` 记录。
`TaskFlowCasStore` 是写入入口；`execution-phase/store.ts` 只投影该 owner 的记录，
不再维护第二张执行账本。原型 `execution_phases` 在事务中迁移、核对后删除。
旧注册表快照不能覆盖或清理带 execution phase 的行。

两项开关都显式为 `taskflow` 才开启：

- `OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER`
- `OPENCLAW_EXECUTION_PHASE_WRITER`

默认仍为 legacy；event-log 不参与授权。只打开 execution writer 不会写入执行相位。

assistant 调用落盘后记录 session generation、toolCallId 和参数 digest；执行前以
同一 revision CAS 从 dispatched 进入 effect_pending，重复领取被拒绝。成功返回
进入 effect_committed；真实结果写入 transcript 后再 verified -> terminal。
异常、中止或结果写入失败不能被解释为“副作用没发生”。未知结果保留在原 owner
并进入 reconciliation。receipt 只提供关联证据，不能单独证明 applied/not_applied。

主会话恢复 owner 在 SQLite 中提交边界摘要、稳定 runId 和最多三次尝试的预算。
相同边界复用恢复幂等键，预算耗尽则留下 wedge 终态。只有获准的恢复 run 可从
持久化历史继续；不会将“请重试”写成成功的工具结果。待执行工具由原 executor
执行，继续使用参数校验、扩展钩子与策略包装，再追加真实 toolResult。
user intent、assistant 工具调用与真实 toolResult 在下一步确认前 fsync；写失败向原调用传播，不能在 detached async callback 中被吞掉。恢复后保留 transcript identity，较新的 user turn 不能复活较早 assistant 的调用。

## 正式测量

`tests/e2e/recovery-contract-eval.spec.ts` 使用真实 Electron、Gateway 子进程、
独立端口和脚本 provider；该 provider 只决定输入，实际工具、SQLite、会话树、
进程终止与恢复均走生产实现。显式 E2E probe 在确切边界暂停或抛出写入错误。
先终止进程，再设置下一次 probe，避免原进程提前跨过测量边界。

| 窗口 | 注入与回读 |
|---|---|
| K1 | 用户意图 fsync 后、provider 请求前终止；回读原意图和最终副作用 |
| K2 | 追加式副作用已写、结果/receipt 前终止；不重跑，持久化未知结果的对账状态 |
| K3 | 子会话已持久创建并绑定 parent、parent 结果前终止；子任务恰好一份 |
| K4 | 在 SQLite 事务写入内、ack 前抛 EIO；回读旧值、失败返回和同一写入重试 |
| K5 | 同一 user intent 连续三次重启；各次 checkpoint 指向同一会话，最终效果一次 |

每个样本保存原始磁盘快照、实际 probe hit、recovery decision 和 SHA-256。
完整批次由 `scripts/recovery-contract-matrix.mjs` 串行运行，区分 setup 等待、
测试退出码和实际行为指标。相同候选构建下的 legacy/candidate 两臂各运行 15 次。
这比较的是 writer 模式；不是把原始历史版本重新包装成当前 baseline。

`recovery-longsession-eval.spec.ts` 在真实边界之后发出不含答案的新问题，
只评分新产生的 assistant JSON。压缩必须有真实成功返回；fork 检查 sibling 污染；
handoff 使用 agent 明确接受的交接 artifact，经正式 createHandoff 接口消费；
restart 关闭并重新启动桌面进程；revocation 明确撤销旧指令并检查未复活。
它测量 accepted handoff 的消费，不宣称自动交接摘要质量。
真实 provider 凭据只由内存代理使用，测试配置不写入真实 key。

## 更正的历史证据

上轮驱动将 receipt 的实际 injectionPoint 替换成冻结 manifest 文字，绕过了窗口
校验；K1 标记匹配错误，覆盖写也无法检测重复效果，K5 实际重启三个新任务。
旧长会话评测统计 user 输入中出现的事实，并在 boundary 前判断 next-action；
不存在的 handoff 接口错误被吞掉。这些旧结果均不能继续充当验收证明。

当前合并器保留真实注入点，校验全部 artifact hash，只接纳 boundary 后的
assistant 质量读回。历史原始记录保留，不能改标签或降低冻结门槛使其通过。

## 判定边界

最终数字以同目录的 `harness/specs/fixtures/recovery-contract-eval/` 报告为准。
工具/状态专项、真实故障窗口、live-model 质量、性能和发布批准分别判定。
P50/P95 超过冻结上限时总报告必须 FAIL，不能通过排除慢样本或扣除重启开销改成 PASS。
本轮主会话与工具相位收口不代表 TF-0715 的其他四个恢复入口已经迁移。
默认值、产品锁和发布批准均不随测试结果自动改变。

## 2026-11-05 源码复核与最终采样入口

本轮补齐消息 fsync、旧 turn 恢复排除和真实 shadow outcome；原 shadow 把预判恢复当作成功，现以 RPC 的实际退出结果比较，记录失败和 drift。

统一收口层的认可范围：TaskFlow CAS 作为相位与生命周期单 owner 已有实际接线；domain journal 保持效果真相，event-log 与 receipt 仅关联证据。RecoveryAuthority 仍是 main-session 的只读 shadow，其余四入口 TF-0715 未在本轮授权序列内实施，不能宣称五入口统一已经完成。未知效果可到达持久化 reconciliation，不表示已有通用外部效果对账执行器。

历史 dirty 开发批次的 legacy 15 窗口为 dup=0、lost=0、terminal=9/15，纠正了旧探针的 lost=9。该批次的 raw assistant 离线统一重判：legacy 120/120 事实、30/30 下一步；candidate 19 对，尚缺 11 对。它们是历史开发记录，不传给新候选。

最终工作使用 scripts/recovery-contract-acceptance.mjs：要求干净 commit/tree，两臂每个 family 六对真实 provider 答案和五窗口各三重复，保存所有完成与失败尝试，封存可离线回读的 raw-evidence.json.gz。冻结 workload 与 P50/P95 门槛保持原样；完整采集后如时延不合格，总 verdict 为 FAIL / NO-GO。

## 失败窗口的保留规则

原始 8137cdb2e 窗口批次在已注入故障后可能因恢复观察超时而抛错，没有生成 receipt，已撤回该批次的正式窗口资格。质量域独立校验通过：60/60 新 assistant、问题不含 gold，12/12 压缩头部确实被摘要替代且保留尾部不含原始事实。原始文件与 preliminary score 保留。

修正后的观察器把超时后的最后真实磁盘快照与失败 verdict 一同落盘；elapsed-to-failed-observer-verdict 表示尝试失败的观察时长，不冒充成功恢复时间。只有未到达注入点的 setup 失败才能补测；已有负面 receipt 不允许被好结果替换。

矩阵可使用 scripts/recovery-contract-matrix.mjs --batch：复用一条串行 Playwright worker 的编译缓存，每个测试仍创建新的 home/userData/Electron/Gateway/workspace。冻结的五窗口、每窗三次、所有超时与判据均未改变。采样代码与运行时源代码的 commit/hash 分开记录，运行时与 8137cdb2e 一致。

代理在下游断开或 fixture 关闭时立即取消上游 I/O；已结束的 assistant error/abort 会作为失败返回，不继续等成功答案。评分器 recovery-readback/v4 统一读取 statement/value/text/fact，保留显式错误 nextAction，不把缺少重复 JSON 字段等同于语义丢失。
