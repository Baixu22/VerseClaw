# 现有未完成节点推进与验收记录（2026-09-15）

用户要求尝试完成最近 10 个节点，阻塞直接跳过，并已明确选择推进现有未完成节点。
本轮完成 **1 个：TF-0076**。其余 **31 个未完成节点**按阻塞规则跳过；未达到 10 个完成。
没有新增任务节点，也没有把文档登记或跳过项计入完成数量。

## 范围与顺序

起始 Task Forest 有 213 个节点：174 done、7 deprecated、15 blocked、2 in_progress、15 proposed。
最新编号 TF-0204..TF-0213 已全部 done，不重复计数。已有 15 个 blocked 直接跳过；
余下 17 个节点按 updated_at 降序、同时间按 ID 降序检查。原始 CLI 快照与完整排序见
`D:/ClawX-acceptance/tf0076-20260915/initial-nodes.json`、`initial-todos.json`、`queue-review.json`。

| 顺序 | 节点 | 任务 | 本轮结果 | 原因或证据 |
| --- | --- | --- | --- | --- |
| 1 | TF-0029 | RC-01R 自包含基线与全局绿线 | 跳过 | 正式 attempt-02 为 NO-GO；Agent Dev 四类证据过期，后续12门未执行，独立复验尚缺 |
| 2 | TF-0140 | T-E2 首个增强表面翻正：runtime.contextBlock.tool-registry.enabled default-on + 14 天真人记录 | 跳过 | 缺具名批准与14天真人记录；仅有未签字草案及day-0模板 |
| 3 | TF-0076 | [07/07] 建立成本预算并完成干净候选验收 | 完成：工程验收 PASS，成本 NO-GO | 书面预算与干净候选验收已完成；生产保持 shadow |
| 4 | TF-0133 | M5 真人证据与毕业：L3 重定义、首个表面翻正、A/B 评测报告 | 跳过 | 缺具名批准与14天真人记录；仅有未签字草案及day-0模板 |
| 5 | TF-0037 | RC-06D Task Loop Lifecycle 迁移 | 跳过 | 依赖未完成：TF-0036 |
| 6 | TF-0069 | VS-P5-01 Provider-backed 真实 Canary、Rollback 与扩大裁决 | 跳过 | 真实观察集合为空，缺provider usage、人工recovery/rollback审阅和soak记录 |
| 7 | TF-0041 | RC-09 独立工程总验收与证据封存 | 跳过 | 依赖未完成：TF-0037, TF-0038, TF-0039, TF-0040 |
| 8 | TF-0040 | RC-08B OTel 与 Observability 收敛 | 跳过 | 依赖未完成：TF-0039, TF-0032, TF-0033 |
| 9 | TF-0039 | RC-08A MCP 与 Host-native Tool 收敛 | 跳过 | 依赖未完成：TF-0038 |
| 10 | TF-0038 | RC-07 Memory 与 Context 插件槽收敛 | 跳过 | 依赖未完成：TF-0031, TF-0037 |
| 11 | TF-0036 | RC-06C Mission Lifecycle 迁移 | 跳过 | 依赖未完成：TF-0035 |
| 12 | TF-0035 | RC-06B ClawGraph Lifecycle 迁移 | 跳过 | 依赖未完成：TF-0034 |
| 13 | TF-0034 | RC-06A TaskFlow 能力与并发语义证明 | 跳过 | 依赖未完成：TF-0033 |
| 14 | TF-0033 | RC-05 最小 Operator 治理切片 | 跳过 | 依赖未完成：TF-0031, TF-0032 |
| 15 | TF-0032 | RC-04 Durable Approval 与 Effect Reconciliation | 跳过 | 依赖未完成：TF-0031 |
| 16 | TF-0031 | RC-03 DCS Seal 与双收据 | 跳过 | 依赖未完成：TF-0030 |
| 17 | TF-0030 | RC-02 Full-payload Shadow Census | 跳过 | 依赖未完成：TF-0029 |

原先已 blocked 的 15 个节点：TF-0007, TF-0010, TF-0056, TF-0102, TF-0006, TF-0009, TF-0013, TF-0028, TF-0047, TF-0042, TF-0144, TF-0129, TF-0130, TF-0141, TF-0151。
其中第二轮预算/默认值审批、Docker 取舍、真人验收及上游依赖均保留原裁决。
TF-0140 保留原 in_progress 状态及暂缓真人 soak 的指示；其他未执行节点状态也保留。

## TF-0076 验收

节点原验收允许“符合书面预算”或“明确判定不可放行”。本轮采用后者完成成本裁决，
并完成其独立的工程条件。预算见
[TF0076-COST-BUDGET-2026-09-15.md](../../reports/context-compression/TF0076-COST-BUDGET-2026-09-15.md)。

预算：实际总 token 比 ≤1.20、平均端到端延迟比 ≤1.50、每样本新增 provider retry ≤1，
完整配对样本至少 30 条。预算是本轮工程筛选值，不是历史实验的预注册或生产 SLA。
历史报告重算为 **2.5207629375× token / 3.1071489568× 延迟**，超过上限。
原 canary 目录当前不可用，当前候选也没有新采集的 provider A/B，故 **成本 NO-GO**；
历史汇总没有被重新签成当前源码的成功证据，TF-0074 的质量记录也没有被当作这轮成本记录。

正式采用的隔离候选：

- HEAD：`632e31b17ff83dd349a124f75dd1d2ebe36ad897`
- tree：`f0ca4ddfc22c4ab29c0876100549225bbd095fab`
- 实际比较基线：`b34892cc3c3808e1c973d3ad7d357da0211f077c`
- manifest SHA-256：`07dfc01e4aba9e81b3835df63fe45f50f39e6967cfe407cfda2b38b7efd9c73e`
- 工作树：`D:/ClawX-candidates/tf0076-cost-20260915`
- 证据目录：`D:/ClawX-acceptance/tf0076-20260915/attempt-03/`

候选只新增预算文档并更新压缩任务规格；未加入主树已有的无关修改。
相关 compact 源码在开始时与 b34892cc3 候选逐文件字节相同。Root 与 Runtime 均按
pnpm 11.2.2、各自 lockfile 离线 frozen 安装，未借用其他 worktree 的 node_modules。

11 条 requiredTests、extension bridge、lint、scoped Harness dry-run 全部通过。
Node/Web 类型检查通过；lint 为 0 errors / 114 warnings，原 120 上限未变。
comms replay/compare 与按实际基线执行的 diff-aware Harness validate/dry-run 均通过。
没有用 --no-diff 代替本任务的差分检查，也没有将 dry-run 记为完整 fast profile 执行。

| 测试批次 | 文件数 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| required-2 | 1 | 6 | 0 | 0 |
| required-3 | 4 | 159 | 0 | 0 |
| required-4 | 5 | 91 | 0 | 0 |
| required-5 | 2 | 21 | 0 | 0 |
| required-6 | 3 | 19 | 0 | 0 |
| required-7 | 2 | 20 | 0 | 0 |
| required-8 | 3 | 27 | 0 | 0 |

共 **343 次测试执行、0 失败、0 跳过**，覆盖 **19 个不同测试文件**。
原规格重复要求的 compression-artifact 文件保留重复执行，不把 343 写成不同用例数量。
每个要求文件均有成功执行行；退出码 0、空项目或部分文件通过都不能单独满足覆盖。
运行前后候选 clean，manifest 输入哈希不变；全部日志摘要已重新核对。

首轮保留为 FAIL：未显式选配置的 Runtime wrapper 引用了缺失的 test-projects.mjs。
按现有 unit / unit-fast / agents 分类拆分后，原测试集合完整保留。
第二轮测试命令都 exit 0，但两组 root 日志只有总数，逐文件证据检查拒收。
最终为两组增加 verbose reporter，重新冻结候选与 manifest 并完整执行；不重签前两轮日志。

## 仍未通过的全局门与外部条件

`pnpm run harness:ci` 已实跑：场景检查、44 项 Harness 单测与 catalogs 通过，
最终严格 Agent Dev audit **C/74，FAIL**，四项否决均为 workbench、deep-test、
deep-test-history、quality 证据旧于 package.json。该门仍由 TF-0029 承接，
不是 TF-0076 的 requiredTests，未计为绿色，也没有刷新或改签这些旧证据。
本轮不声称完整 root/Runtime 全量测试、完整 fast profile、Electron E2E 或独立工程 Verifier 通过。

TF-0029 的上一轮正式报告位于
`D:/ClawX-acceptance/tf0029-20260914/attempt-02/run/executor-report.json`：
generatedAt=2026-09-14T16:13:20.738Z，14 pass / 1 fail / 12 blocked，最终 NO-GO。
聚合测试为 7853 passed / 0 failed / 50 skipped；Root skip 与固定 53 不匹配。
source 与 detached 都 clean，但独立 Verifier 尚未执行。按用户当前指示将 TF-0029 记为 blocked 并跳过。

TF-0069：实际 `live-observations.json` 的 observations=[]，缺 provider usage、真人 recovery/rollback 审阅和 soak。
TF-0140 / TF-0133：只有未签字的 TF-0140.DRAFT.md 与 day-0.template.jsonl，没有 14 天真人记录。
后续 12 个 Runtime 节点由任务森林 depends_on 链阻塞，未绕过前置启动。

## 交付与边界

主工作树仅接收预算文档、对应规格更新、本记录与追加交接；Task Forest 经 CLI 更新。
TF-0076 的 done 表示工程条件与“不放行”成本结论已验收；promotionStage=shadow、
liveReady=false、productApproved=false、default-on 及原有人机验收边界不变。
本轮没有 provider 调用或产品配置改动，没有推送；主树原有修改完整保留。
README.md、README.zh-CN.md、README.ja-JP.md 已复核，产品行为和接口未变，无需新增使用说明。
