# 恢复统一与 GA 验收

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

进程验证命令：

最终投递沿用 `delivery_queue_entries` 的原 intent。队列原子提交恢复决定、已消耗尝试与 owner 身份，并保存 Session 待答复的准确引用；发送前绑定 intent，确认应用后先结算或确认替换该引用，再删除队列行。Session 仍引用同一 intent 但身份不匹配时，保留 applied 队列记录。后来产生的答复由 Session 代次、生产运行、文本、创建时间、路由与 intent 校验保护。

未知或部分发送保留文本与 intent；渠道 owner 确认未发送后，仍按原五次上限与退避执行。已经应用的发送只结算，效果未知时预算耗尽也保留对账状态。切回 legacy 后保留这些已存入队列的统一恢复记录；新 legacy 发送继续沿原路径处理。

整批发送确认后，提交钩子在 applied 真值落盘后执行；Session 引用需要延后结算时，仍保留该次已确认发送的回调。已准入的对账通知使用原 intent 的消息、目标和 receipt，引用结算通过 CAS 保护后来的答复。部分或未知结果继续保留 pending，不运行提交钩子。启动时回填队列索引列会比较原 `entry_json` 快照，避免较旧快照覆盖并发准入刚消耗的预算。进程核验使用不触发 schema 回填的只读 SQLite 连接，独立比较预算列与 JSON。

`node scripts/recovery-owner-process-proof.mjs --out <fresh-output-directory>`

`node scripts/recovery-delivery-process-proof.mjs --out <fresh-output-directory>`

投递进程验证使用原 Queue 与 Session SQLite、实际 PID 中断和 fsynced 本地效果日志，检查并发准入、派发前中断、效果后中断、未知答复保留与原 intent 结算。对账接管也原子绑定当前 PID/epoch；观察完成后释放原队列 claim，保持发送预算。初次入队或发送边界写入失败会停止平台发送。

每次实际平台发送前重新核对 Session 待答复与 intent。permit 使用出站 Session 已保存的 agent 身份，支持 `global` 会话键，并覆盖有效答复的恢复回调和引用结算。过期答复沿原队列完成效果对账；已确认的 applied intent 可在旧世代被 reset/delete fence 后结算，仍引用该 intent 的不匹配答复保留 applied 真值。Core 确知尚未调用平台的预处理失败保留 `not_applied` 与已消耗预算；已开始的发送继续按未知效果对账。提交钩子是当前进程内的尽力通知，失败写日志；过期答复的对账和重启读取 applied 真值后的结算不重放回调。

该命令使用 Session SQLite 和本地追加日志 fixture，执行并发领取、派发前 kill、效果写入后 kill 与对账回读，输出原始日志、源码哈希及 `report.json`。报告含实际 PID、尝试次数、效果计数和进程清理结果。

主会话节点 TF-0813 已于 2026-11-10 完成收口。源码候选为 `80af3990693d53f78d739e707e698f7b76cf8bd6`，主会话证据保存在 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/main-session/`：26 项检查、221 个不同用例、225 次执行通过，干净源码投影中的 owner/CLI/Gateway 73 项通过，指定模型复审发现 0。实际 PID 中断证明保留效果 1、尝试 2、重复准入 0。

GA 当前为 NO-GO，接下来需完成投递、ACP、goal-wake 接线和五入口验收。冻结验收要求 5 个故障窗口、每窗口至少 3 次、至少 30 对真实模型长会话、9 个指标，以及 P50 ≤ 5000ms、P95 ≤ 15000ms 和重复基线结构一致性。发布候选还需完成完整源码与打包门禁。当前默认 writer 为 legacy；默认值切换由发布者决定。

此前实测见 [恢复评测](FINAL-20261105.zh-CN.md) 与 [后续验证](FOLLOWUP-20261106.zh-CN.md)。最新节点证据完成后收录在 `harness/specs/fixtures/recovery-contract-eval/ga-20261106/`。
