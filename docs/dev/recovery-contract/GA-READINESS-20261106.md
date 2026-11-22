# 恢复统一与 GA 验收

2026-11-23 的根作用域元数据修复已提交为 `f2cf0be47f63f6f72ec7c43e5109eaff705307ab`：渠道列表与ID/别名查找共用已有缓存，生命周期刷新统一清理缓存，原配置策略归属元数据模块。加载模块924行、元数据模块184行；18项回归、完整六项源码门禁、通信、打包helper两周期与goal canary十周期通过。

同候选冻结窗口30份、真实模型长会话50份，九指标结论EVIDENCE_INSUFFICIENT；压缩域样本不足，独立legacy复跑待串行窗口。GA为NO_GO；实际门槛与源头回读见[本批验证记录](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/bundled-metadata-20261123/README.md)。完整类型45.578秒、桌面构建69.250秒，原45/58秒门槛保持。新的Agent Dev验证产物完整，CI保留真实的类型、单元及合同检查硬耗时失败。

Gateway 重启后，任务效果准入等待唯一 Main 桥完成认证，并与 Main 回应共享原 15 秒预算。等待期间保留请求去重和当前 run 核验；多桥歧义、代次变化、超时或不匹配的结果继续拒绝效果。

2026-11-21 的按需加载修复已提交为 `9c52d611d`：原生 parser 和 grammar 在首次分析对应语言时加载，内置 harness 在首次执行时加载原 runner 并写出可用的编译缓存。最终两项隔离检查通过；Node 和 Bun 各三对、每进程七种语言的完整分析对象一致。指定 `ccs-ai/gpt-6.1-sol` r6 复核为 0 发现。类型感知 lint、完整无缓存 Node/Web/Test、runtime 重建与启动、六项源码门禁、Harness 和通信检查通过。完整类型外层 43.178 秒，桌面完整构建外层 60.041 秒，原预算分别为 45/58 秒。

同算法编译图扫描的 harness 静态模块为 915→857，dispatch 为 974→941。真实恢复批次因 Electron 依赖缺失在收集用例前中止，0 份恢复回执；依赖入口已修复，后续在串行验收窗口恢复后补齐三组连续三次真实 kill。GA 保持 **NO_GO**。此前 52 项定向检查的夹具版本、三项已在基线重现的 COMPASS 失败、51.689 秒类型回执与本次中止原件均保存在[按需加载验证记录](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/deferred-runtime-20261121/README.md)。

2026-11-20 的来源激活事实修复已提交为 `133a98d1f`：Agent 首次准备携带 `openai` 来源激活理由，直接复用原九个启动插件；45 项回归、指定模型复核、类型感知 lint、两份 Harness、通信、runtime 构建和源码门禁通过。完整无缓存类型检查外层 40.963 秒，桌面构建 89.118 秒；三组连续三次真实 kill 全部正确终态、重复和丢失为 0，恢复 64.275、104.411、91.944 秒。恢复时延和桌面构建仍超原 15/58 秒预算，GA 保持 **NO_GO**。[来源激活验证](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/activation-provenance-20261120/README.md)保存 255 份原件、18 份附件、九个源码输入及诊断改写的恢复记录。

2026-11-20 的桥接等待修复已提交为 `e3384611c`：38 项回归与指定 `ccs-ai/gpt-6.1-sol` 复核通过，完整无缓存类型检查外层 41.688 秒、桌面构建 56.565 秒，满足原 45/58 秒预算；runtime 构建、启动检查、源码门禁、lint、Harness 与通信检查通过。三组连续三次真实重启全部正确完成，重复和丢失均为 0，耗时 32.935、32.207、34.844 秒。18 份磁盘附件与 147 份归档原件逐 SHA256 回读一致。恢复用时仍超过原 15 秒上限，GA 保持 **NO_GO**；继续定位启动和恢复准备耗时。[桥接修复与验证](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/bridge-readiness-20261120/README.md)保存当时源码字节、独立复核与全部试次。

2026-11-20 接力修复已提交为 `a3e185925` 和 `6ab34b48c`：启动计划、lookup table与只读渠道视图复用兼容快照的discovery；来源重叠时保留环境目录回退。最新39项关联回归和指定 `ccs-ai/gpt-6.1-sol` 复核通过。两个启动入口各九次调用的bundled目录读取18→0；18次只读查询27→0，返回内容一致。最新完整类型检查35.017秒、runtime构建/启动、源码门禁与通信检查通过。[启动证据](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/startup-discovery-20261119/README.md)与[只读查询证据](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/readonly-discovery-20261119/README.md)保留原始失败、复核、编译对照和附件。

同源码无探针三组连续三次真实中断均正确完成，重复0、丢失0，恢复耗时43.096、43.280和150.929秒；运行最低可用内存130MiB。桌面构建111.805秒超过58秒预算，即使起跑6822MiB，期间仍降至416MiB。GA保持 **NO_GO**；继续满足原恢复P50≤5秒/P95≤15秒和构建58秒，再冻结干净候选完成两臂矩阵、30对真实模型长会话、第二轮legacy及完整源码/打包门禁。

2026-11-19 的 SDK 别名检查修复已提交为 `ae388c167`。九对交替样本的解析中位耗时从 174.602 ms 降到 106.326 ms，文件存在性检查从 1,666 次降到 624 次，634 个别名的内容一致。最终 4 项 SDK 回归、25 项关联回归运行、指定 6.1 sol 复核、runtime 构建与启动检查及源码门禁通过。两组连续三次真实中断均正确完成，零重复、零丢失，耗时 85.422 和 64.035 秒；另一组等待五分钟后因内存准入不足中止，运行最低可用内存为 1 MiB。类型检查 56.414 秒、桌面构建 113.738 秒超过原 45/58 秒预算。GA 保持 **NO_GO**，继续执行原恢复门槛和同候选完整冻结验收。[源码与磁盘证据](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/sdk-alias-20261119/README.md)保留全部试次、12 份附件及可回放字节归档。

2026-11-19 的 Windows 时间格式查询和 Gateway 启动作用域修复通过 30 项回归，所有者指定的 `gpt-6.1-sol` 最终复核为 0 发现。无缓存类型检查 22.008 秒，桌面构建 54.580 秒，满足原 45/58 秒限额。三组连续三次真实中断均正确完成，重复和丢失为零，耗时 107.062、42.839、64.295 秒；运行期间可用内存最低为 101 MiB。当前 GA 为 **NO_GO**，原 5/15 秒恢复门槛与同候选冻结验收继续执行。[源码与磁盘证据](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/host-startup-20261119/README.md)保留最终复核、18 份附件及未完成测量记录。

同日的 provider 完整元数据视图复用通过 30 项定向回归和指定 DeepSeek 复核，无缓存类型检查 39.774 秒。三组连续重启均正确完成，耗时 65.133、66.372、77.858 秒。[源码与磁盘证据](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/registry-view-20261119/README.md)记录了各跑次与资源观测。

2026-11-17 接力候选 `da1125874` 完成租约过期同 owner 接续修复，193 项定向回归通过，三次真实 kill 的复测效果一次、重复与丢失均为0、终态正确。过期分支另有标注时钟构造的跨进程 SQLite 证明。当前 GA 为 **NO_GO**：连续重启76.466秒，桌面构建63.724秒，完整同候选冻结矩阵尚待执行。[本轮验证与原件](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/relay-20261117/README.md)保留各候选结果。

恢复验收先检查 Electron 可执行路径、桌面与 runtime 构建产物。故障夹具通过现有 Host API 创建任务、绑定协调会话并认领任务后再注入故障；长会话夹具使用 `activeWorkspace.id` 作为交接和分支的 owner。`recovery-contract-acceptance.mjs` 将九指标结论写入 `acceptance.json`，候选未通过时以非零状态退出。每个跑次单独保留 Playwright 诊断，关闭隐式重试，避免覆盖原始失败。

Windows 插件加载将 `file:` URL 转回原生路径后执行已编译 JavaScript，并按同一身份清理模块缓存。源码插件与依赖加载失败沿用原回退策略。

插件发现会在持久索引缺失或过期时重建完整元数据快照。运行时入口、静态模型目录与别名查询在 owner 确认配置和作用域兼容后复用该快照，保留初次索引诊断；插件重载或重启由原生命周期 owner 更新快照。

插件自动启用判断复用同一元数据视图中的清单与目录发现结果。provider 解析将已确认的视图传入激活判断；显式传入的发现结果保持优先。调用者未提供视图时，当前快照与默认快照继续经过原 owner 的作用域校验。

Agent 启动读取 Gateway 已确认且与配置、工作区兼容的插件快照，并携带来源激活理由、清单与安装记录，由原 runtime registry owner 核对复用和子代理绑定。Windows 自动时间格式检测直接读取系统短时间模式；显式 12/24 小时设置和 Intl 回退沿原入口执行。

Gateway 重启先由原生命周期 owner 核对 writer 和持久记录，再加载有待恢复工作的 ClawGraph、Mission 或 Task Loop 控制器。空表、仅终态记录和 legacy 模式省去控制器装载；Mission 沿原 taskflow running 条件执行。实际控制器继续核对存活 run、未决效果与 CAS，单个域失败后其余域继续恢复。

快照保存插件发现环境和模型归一化登记，捕获与还原继续保留原绑定。插件根目录、配置加载路径、source overlay、Nix 模式或实际 host 兼容版本变化时，查询转入原发现路径；省略配置时按默认加载路径核对。`OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY` 开启时，索引与清单查询都使用派生路径并返回禁用诊断。

Gateway 重连复用已认证的设备令牌，并核对原设备、端点和共享凭据。服务端明确拒绝缓存令牌时，同一次连接用共享凭据重新引导一次；临时传输故障和启动未就绪保留令牌。引导完成设备令牌认证后才报告就绪。受管进程使用临时目录中的 Node 字节码缓存，并保留 `NODE_COMPILE_CACHE` 和 `NODE_DISABLE_COMPILE_CACHE` 的显式设置；启动完成及首次加载 Agent 执行模块时写出字节码，让真实进程 kill 后的重启复用编译结果。缓存禁用或不可写时，启动与执行沿原路径继续。

已配对设备的认证、Control UI 令牌查询、令牌轮换与撤销及在线元数据更新只读取已批准的设备表。跨表配对移除继续核对待处理的修复请求。撤销令牌、越权 scope 和已配对记录损坏沿原校验拒绝。

设备凭据变更也会更新原连接 owner 的设备/角色修订。异步配对步骤结束后，握手在注册前重新核对该修订；缓存令牌路径只复用实际通过认证且仍有效的原令牌。有权限的主动轮换与共享凭据引导继续沿原签发路径执行。

连续重启可能跨过任务的120秒租约。同一会话代次和工作树在没有未决效果时，以递增 epoch 接续原任务并拒绝旧凭据；未决效果、显式暂停、代次变化和时钟回退保留原拒绝行为。

工具首次准入携带准备时捕获的任务 ID 和 epoch，Main 在原任务事务中核对 owner。每个工具 operationId 形成独立准入，ACK 丢失可回读该次已提交决定。同一 run 自然续租时，会话准入 ID 与 executionRevision 保持稳定，工具集合采用已确认的新 Task credential；模型上下文通过原 task_active_runs 行核对该 run。显式交接、旧 run 和未知效果继续拒绝新副作用。

完整 runtime 构建在 Windows 可用 `OPENCLAW_TSDOWN_SERIAL=1` 逐配置生成声明，减少并行编译的内存占用。Control UI 通过安装包的 exports 预解析 Lit decorator 入口，再交给 Rolldown 打包。

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

2026-11-18 就绪探针候选 `bd672c7c94df82930a7de4fde6fb17578497d345` 在 Gateway 仍拒绝认证时继续等待，连续重启中因过早认证而被拒的重试降为零。70 项定向测试、真实 Electron 启动重连、源码全门禁、打包 helper 两轮、goal canary 十轮、通信、Agent Dev 完整检查与 Harness CI 通过。无缓存类型检查 33.744 秒；单独构建 79.535 秒，后续完整开发检查中的同候选构建 47.325 秒。

该候选五窗口各三次全部达到正确终态，重复效果与丢失任务为零。连续三次中断到终态为 104.588、93.327、126.770 秒。尚未采集该候选的 30 对真实模型长会话，完整冻结评测返回 `EVIDENCE_INSUFFICIENT`；将缺少的 30 项耗时置零后，P95 下界仍为 90.593 秒。TF-0818 保持 `in_progress`，GA 为 **NO_GO**。逐槽结果、源码绑定与检查证据见[就绪探针验证报告](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/ready-probe-20261118/README.md)。

此前实测见 [恢复评测](FINAL-20261105.zh-CN.md) 与 [后续验证](FOLLOWUP-20261106.zh-CN.md)。最新节点证据完成后收录在 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/`。

2026-11-19 已修复恢复热路径中的重复文件权限写入。同一 POSIX 所有者或 Windows 原生权限匹配时跳过重复 `chmod`，不同 POSIX 所有者继续核对原修改权限；特殊位、只读转换和描述符身份仍在写入前检查。12 项回归、32.700 秒无缓存类型、runtime 重建与启动检查、目标 Harness 和固定 DeepSeek 独立复核通过。九对交替样本的每批 500 次追加中位耗时从 186.479 ms 降至 74.757 ms。精选原件见[文件追加验证](../../../harness/specs/fixtures/recovery-contract-eval/ga-20261106/append-permissions-20261119/README.md)。当前 GA 为 **NO_GO**，干净候选的完整恢复指标和发布门禁继续执行。
