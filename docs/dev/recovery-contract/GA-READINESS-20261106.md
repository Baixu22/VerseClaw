# 恢复统一与 GA 验收

恢复验收先检查 Electron 可执行路径、桌面与 runtime 构建产物。故障夹具通过现有 Host API 创建任务、绑定协调会话并认领任务后再注入故障；长会话夹具使用 `activeWorkspace.id` 作为交接和分支的 owner。`recovery-contract-acceptance.mjs` 将九指标结论写入 `acceptance.json`，候选未通过时以非零状态退出。每个跑次单独保留 Playwright 诊断，关闭隐式重试，避免覆盖原始失败。

Windows 插件加载将 `file:` URL 转回原生路径后执行已编译 JavaScript，并按同一身份清理模块缓存。源码插件与依赖加载失败沿用原回退策略。

当前开发已实现子代理恢复的持久化准入：同一边界复用运行身份，派发前提交决定和尝试次数，旧回调按会话代次与运行身份校验。并发领取会读取已有决定；旧进程退出后，owner 确认效果尚未发生才允许继续。统一决定层遇到已经应用的效果时返回 settle，不再消耗派发预算。

启用条件为 `OPENCLAW_RECOVERY_AUTHORITY_MODE=authority`，并同时选择 `OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER=taskflow` 和 `OPENCLAW_EXECUTION_PHASE_WRITER=taskflow`。恢复预算记录保存在现有 Session SQLite 中。未知效果保留为对账状态；切回 legacy 后，这些保留记录仍阻止重复执行。

已准入的子代理恢复保留原会话身份与生命周期写入，并抑制合成提示词保存。RPC ACK 丢失后，该运行仍可执行已授权的原工具调用；后续扫描依据原会话中的运行身份重接注册表。未获得准入的对账记录保持对账状态。

注册表重接以已经落盘的生命周期启动为依据。压缩产生的后继会话沿既有 usage lineage 重接同一准入；原运行的等待回调和清理扫描会保留预约。同一轮重接产生的新记录沿用会话去重，避免再次派发。

恢复工具在 run hook 允许执行、目录工具执行器完成绑定后调用。普通会话轮换会清除旧恢复归属，压缩通过显式身份转换保留归属。未知效果的对账预约同时保护等待回调、终态回调和冷启动清理入口。

恢复工具的开始、进度与结束事件接入当前运行的订阅入口。原工具的投递记录、完成状态与浏览器操作事件沿同一入口更新，结果按原调用身份追加到会话。

主会话恢复现在通过相同准入内核记录边界、决定与三次预算，再发送带准确准入身份的 RPC。Session owner 在公开响应发送前记录输出不确定性；未知输出、未知工具效果和待投递文本进入对账。ACK 按运行身份校验，生命周期 owner 负责中断标记；压缩后继保留同一预算与原运行归属。

本地 CLI 每个新轮次使用独立运行身份，并等待生命周期终态落盘。公开正文、推理文本与推理结束通知经过同一输出屏障；切换到未安装屏障的 runtime 时，输出状态重新标记为未知。压缩生成后继会话后，内层重试、外层模型 fallback 与后续回复都使用已提交的后继身份。

已完成恢复的准入身份拒绝再次启动。同一未结束命令的模型 fallback 保留准入；native 和 Codex 的尝试结束先发出 `finishing`，由整条命令在 fallback 与持久化收尾之后提交唯一终态。

原轮次交接还要求当前状态为 `running` 且 `abortedLastRun=true`；原轮次完成或恢复正常运行后拒绝旧准入。Gateway 接收、实际启动与生命周期写入共用这一判断。

压缩后的待投递答复、投递清理和命令终态使用后继身份。压缩结果省略文件路径时，主会话沿用 Session owner 已提交的路径；子代理、ACP 和 cron 沿用各自的身份写入路径。分块回复的同步或异步投递失败会中止模型 fallback。

初次和更新的压缩提示要求以完整原句逐字保留用户指定的有效事实，包括标签、措辞和标点；标签与正文保持连续，不添加冒号或重复标识符，每条事实只出现在一个相关章节。两条调用路径已纳入必跑回归与验收规范。

故障窗口观察器等待 Session 终态或原执行阶段已落盘的对账标记，运行中的 owner 预约继续在原观察预算内等待。探针按实际观察时间排列决定，保留原文件和 PID；两轮基线使用原冻结投影逐槽比较。

进程验证命令：

ACP 在统一模式下将原请求、运行时身份、输出边界和预算存入现有 `acp_sessions` 行。每个 backend 原有的两次尝试形成该请求的持久上限；控制器重建或 fallback 配置变化不重置预算。实际 turn 调用前记录 unknown，公开文本和工具事件发送前完成边界写入。fresh handle 与 backend fallback 经过同一准入，只有 Core 确知尚未进入 turn 时继续；未知效果保留对账，确认终态拒绝重发。身份回写校验原 Session 与准入，预算写入 ACK 丢失也保留已消耗尝试。

`node scripts/recovery-acp-process-proof.mjs --out <fresh-output-directory>` 使用原 ACP/Session SQLite 与实际 PID 中断，检查派发前恢复、并发请求、应用后重复请求及未知效果保留。

ensure/status 的身份写入 ACK 丢失后，按原 ACP 行的精确快照和当前 Session 世代确认提交，并保持同一请求预算。

ACP 的终态 done 在完整事件流与独立 startTurn result 共同校验后发布。早到 done 后出现的流错误或失败结果保持 unknown 对账，阻止错误地结算为 applied。

Goal-wake 在原 `task_runs.progress_summary` 中保存统一对账决定。原 task、Mission、runId、nonce 与 Session epoch 共同校验归属；活 helper 继续被观察，所有恢复都保持零次新 helper 派发。终态与决定在原 SQLite 事务内提交，再沿现有 wait/Mission CAS 推进。过期 exit 先入库后清理，终态 task 对应的待处理 wait 即使已清理 helper 文件也继续 level-check。

同一 helper 的有效 exit 可以将原 lost task 更新为实际终态并清除旧错误。Mission 已消费该 wait 而 ACK 丢失时，恢复复用已提交的 wake 身份，后续 exit 不会再产生一次 tick。

`node scripts/recovery-goal-process-proof.mjs --out <fresh-output-directory>` 启动原生 durable helper，在 Gateway 中断、终态已落盘而 wake 尚未确认、两个恢复进程并发以及文件清理后验证原 helper 效果与 Mission tick 各一次。

最终投递沿用 `delivery_queue_entries` 的原 intent。队列原子提交恢复决定、已消耗尝试与 owner 身份，并保存 Session 待答复的准确引用；发送前绑定 intent，确认应用后先结算或确认替换该引用，再删除队列行。Session 仍引用同一 intent 但身份不匹配时，保留 applied 队列记录。后来产生的答复由 Session 代次、生产运行、文本、创建时间、路由与 intent 校验保护。

未知或部分发送保留文本与 intent；渠道 owner 确认未发送后，仍按原五次上限与退避执行。已经应用的发送只结算，效果未知时预算耗尽也保留对账状态。切回 legacy 后保留这些已存入队列的统一恢复记录；新 legacy 发送继续沿原路径处理。

整批发送确认后，提交钩子在 applied 真值落盘后执行；Session 引用需要延后结算时，仍保留该次已确认发送的回调。已准入的对账通知使用原 intent 的消息、目标和 receipt，引用结算通过 CAS 保护后来的答复。部分或未知结果继续保留 pending，不运行提交钩子。启动时回填队列索引列会比较原 `entry_json` 快照，避免较旧快照覆盖并发准入刚消耗的预算。进程核验使用不触发 schema 回填的只读 SQLite 连接，独立比较预算列与 JSON。

`node scripts/recovery-owner-process-proof.mjs --out <fresh-output-directory>`

`node scripts/recovery-delivery-process-proof.mjs --out <fresh-output-directory>`

投递进程验证使用原 Queue 与 Session SQLite、实际 PID 中断和 fsynced 本地效果日志，检查并发准入、派发前中断、效果后中断、未知答复保留与原 intent 结算。对账接管也原子绑定当前 PID/epoch；观察完成后释放原队列 claim，保持发送预算。初次入队或发送边界写入失败会停止平台发送。

每次实际平台发送前重新核对 Session 待答复与 intent。permit 使用出站 Session 已保存的 agent 身份，支持 `global` 会话键，并覆盖有效答复的恢复回调和引用结算。过期答复沿原队列完成效果对账；已确认的 applied intent 可在旧世代被 reset/delete fence 后结算，仍引用该 intent 的不匹配答复保留 applied 真值。Core 确知尚未调用平台的预处理失败保留 `not_applied` 与已消耗预算；已开始的发送继续按未知效果对账。提交钩子是当前进程内的尽力通知，失败写日志；过期答复的对账和重启读取 applied 真值后的结算不重放回调。

该命令使用 Session SQLite 和本地追加日志 fixture，执行并发领取、派发前 kill、效果写入后 kill 与对账回读，输出原始日志、源码哈希及 `report.json`。报告含实际 PID、尝试次数、效果计数和进程清理结果。

主会话节点 TF-0813 已于 2026-11-10 完成收口。源码候选为 `80af3990693d53f78d739e707e698f7b76cf8bd6`，主会话证据保存在 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/main-session/`：26 项检查、221 个不同用例、225 次执行通过，干净源码投影中的 owner/CLI/Gateway 73 项通过，指定模型复审发现 0。实际 PID 中断证明保留效果 1、尝试 2、重复准入 0。

最终投递节点 TF-0814 的源码候选为 `aacbe24397c6fd8d7b9d67f0147932de25ab8a72`，封存证据位于 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/final-delivery-20261113/`。主候选 241 项、独立检出 139 项回归通过；两份实际 PID/SQLite 证明均记录效果 1、尝试 2、重复准入 0。原生类型、严格 lint、构建、comms、目标 Harness 和指定模型 fresh autoreview 通过。首轮进程证明的空准入与后续原生探针、无探针复跑原样保留，封存内容可按 SHA256SUMS 回算。

五入口统验候选 `6ec53ffe53fef41283eadf8efdacdbfab23d4b3f` 的 21 个原生阶段、359 项 owner 回归、125 项父阶段回归与四份实际 PID/SQLite 证明通过。指定的 `gpt-6.1-sol` fresh review 发现 0 项问题；源码与封存提交为 `abc84bf3fbd7590feca93c28b21d05a8793d7cc9`，47 份验收源码逐 blob 一致。封存见 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/final-owners-20261115/`。

2026-11-16 回读的最终候选 `6115256e882051a154945b5b7298ef8a83d756cc` 已完成 22 个原生阶段、378 项 owner 回归、127 项父阶段回归、四份 PID/SQLite 证明、打包 helper 两轮和 goal canary 十轮。固定 `ccs-workbuddy/deepseek-v4.1-flash` fresh review 发现 0 项问题；初次与更新压缩的完整原句保真修正通过同候选实测。

两臂各 30 份真实模型答案和 15 个故障窗口已完整采集。candidate 事实 120/120、下一步 30/30、终态 15/15，重复效果与丢失任务为 0；两轮 legacy 逐槽 15/15 匹配，原冻结投影 hash 一致。最终原件、九指标与差值见[同候选验收报告](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/final-candidate-6115256e-20261116/REPORT.zh-CN.md)。

冻结候选 `6115256e` 的 GA 为 **NO_GO**：恢复 P50/P95 为 17.439/83.204 秒，构建 1,621.766 秒超出 58 秒限额，源码行数门禁有 165 项失败。类型检查 27.079 秒满足 45 秒限额，完整功能步骤、Harness 证据与覆盖尾门通过。

主线整合候选 `7abba413c47be1e5a772bda7bb3aafc8e87b14c5` 已消除与 main `c3521cfc4` 的十二处冲突。200 次回归、完整无缓存 Node/Web/Test 类型检查、桌面与 runtime 构建、Gateway 启动检查、通信、contract 和目标 Harness 通过；固定 DeepSeek fresh review 发现 0 项问题。旧冻结快照的源码行数门禁有 203 项失败；该失败对应的 2026-10-10 基线已由 G3 收尾分支按当前源码刷新为 1100 项既有超限文件，500 行限额及新增/增长拒绝规则不变。恢复调度定向测试现覆盖 legacy 5 秒、taskflow 0 秒首轮等待及 250 ms 重试。完整冻结实测状态为 `NOT_RUN`，GA 保持 NO_GO。源码与原件见[主线整合开发验证](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/main-integration-20261116/README.md)。后续先优化时延和完整构建耗时，再在新的干净候选上按原门槛实测。

收尾分支已收紧候选恢复扫描与 Gateway 崩溃重连：taskflow 首轮恢复扫描从 1 秒改为 0 秒，失败重试固定 250 ms；Gateway 重启冷却从 5 秒改为 1 秒，重连退避上限从 30 秒改为 1 秒。deep-test 的 Windows pnpm 调用增加隐藏窗口，避免隐藏 cmd.exe 的控制台句柄延长步骤计时。冻结验收要求 5 个故障窗口、每窗口至少 3 次、至少 30 对真实模型长会话、9 个指标，以及 P50 ≤ 5000ms、P95 ≤ 15000ms 和重复基线结构一致性。所有原生样本启动前须满足 2500 MiB 可用内存，candidate 同时启用 authority 与两种 taskflow writer。发布候选还需通过完整源码与打包门禁。当前默认 writer 为 legacy；默认值切换由发布者决定。

此前实测见 [恢复评测](FINAL-20261105.zh-CN.md) 与 [后续验证](FOLLOWUP-20261106.zh-CN.md)。最新节点证据完成后收录在 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/`。
