# TF-0013：embedded ContextEngine 消息替换预算

> 2026-10-09 保留边界：本文所述验证目录、临时脚本及逐轮日志已转为本地历史，不随干净检出提供；下文命令记录的是原运行，不是当前必需门禁。恢复见 [源码保留与本地归档](repository-artifact-retention.md)，持续回归以 `harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md` 中的源码测试为准；未重签历史结论。

本轮承接 `tf0013-compass-budget-20260930.md` 的下一最小项：核验 `assemble().messages` 的历史/新增边界，并修复新增消息绕过 turn 总预算的路径。所有测试与复核均由 agent 驱动，属于工作树开发证据。

## 行为与边界

- `attempt.ts` 在孤立用户消息修复与 heartbeat 过滤之后向 engine 传入独立的消息副本。原样历史按深比较与出现次数匹配，纯窗口裁剪不重复收费；摘要、改写、增加的历史副本都视为新增。
- 含新增内容的整组替换成为既有 `cvk_addition` 通道的 `message_replacement` 候选，参与同一排序、去重、预算和 lineage。计费单位为新增消息的 JSON 字符数（含结构元数据），不会把原历史字数再计入 6000 字符预算。
- 替换必须完整放得进剩余预算，否则丢弃候选、保留原历史。相同的扩展投影准备步骤在溢出预检前完成准入；工具目录生产与 before_agent_start 共用一次准备，kill switch 阻止查询/写入。结构化工具调用与结果不按字符串截断。已采用的替换在工具循环后续模型调用中复用，保留当前 prompt 和新增结果。
- registry 的 quarantine 回退保存调用前消息；engine 修改输入后抛错时，legacy 接到原始历史。这个缺陷由真实入口反例发现，不能只在最外层 catch 修复。
- 原有 6000/0.1 默认值、source flags、产品锁、D7 冻结和发布边界不变。此轮覆盖 embedded；原生插件自行组装与投影上下文仍须按其 host 契约另行验证。

## 可复现证据

运行 `python -X utf8 artifacts/tf0013-message-budget-20260930/verify.py`。每门命令、退出码、耗时及日志见同目录 `verification.json`。当前 22 项真实入口、115 项候选/预算/orchestrator/assembler/seal、26 项扩展层、6 项根目录扫描，共 169 项；runtime core 与根目录 node/web 类型检查通过。通讯 replay/compare 通过。统计最终以磁盘日志和报告为准。

新增真实入口测试使用实际 session 文件（超过预算长度的历史）、核心 ContextEngine producer spy、两次工具循环调用和实际收据存储，fetch 在发网前被截获。正常替换只出现一次；超额和 COMPASS 占满预算时不出现；kill switch 零调用且按既有规则关闭 seal；抛错后修改内容不泄漏。每个启用 seal 的 wire digest 均与 ContextReceipt 配对。它不是第三方服务或真人证据。

第一轮有效复审的三项 findings 均已修复：准入晚于溢出预检、孤立消息修复后的失配收费、克隆历史误记 producer；新增摘要（200k 字符历史）、orphan、pass-through、window 和准备去重/kill 回归。原始记录见 `autoreview-r1.json`。第二轮的规范化后重复应用与可选来源读取失败中断 turn 也已修复，记录见 `autoreview-r2.json`；runner 在预检前仅应用一次准入替换，缓存投影不再重复应用，source gather 失败被隔离并继续仲裁已有候选。

最终第三轮结构化复审 exit 0、findings 为空。

静态检查见 `static-results.json`、Harness 结果见 `harness-results.json`、结构化复审见 `autoreview.json`。全工作树 Harness 被原有 `%SystemDrive%/` Windows 缓存拦下；范围运行只通过临时 Git exclude 排除此目录，仍检查实际 diff，不使用 `--no-diff`。两份已有未格式化文件保留原风格，HEAD 同一 formatter 检查亦失败，见 `format-baseline.json`；其他修改源码检查格式，本轮源码与文档差异检查 whitespace。收尾时另一个 VerseConf 任务更新了共享图（TF-0243..TF-0252），其 alignments 行尾使全工作树 diff check 失败，原日志保存在 `diff-check-concurrent-forest.log`；本轮的范围 diff check 为 0，未修改这些并发记录。

刷新 origin 引用后 `check-landing` 为 exit 1 / 183 项历史漂移；不声称本分支已合并 main。未运行 RC-09/10 全量周期、Electron、外部原生插件服务或付费 provider，也未改写旧 RC verdict。

## 后续

TF-0013 保持 in_progress/60%。下一项是原生插件 ContextEngine 的组装与投影预算核验；先按插件 scoped AGENTS 读取 host/dependency 契约，再补真实调用反例。之后按当前候选核验整节点四项 acceptance。当前开发增量不等于整节点完成，不解除 TF-0010/TF-0028 冻结。

本轮未创建提交：共享图包含同时进行的 VerseConf 改动，代码、证据、已应用的 TF-0013 进度提案和交接均保留在工作区，不把其他任务的图更新混入本轮归因。提案 apply 已在磁盘记录为 applied；Bash 包装器在输出 exit 0 后发生 30 秒传输超时，随后独立运行 validate/export 并核读提案与节点状态。
