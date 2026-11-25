# 重排用量恢复与短文档隔离修复

2026-11-25，TF-0946 已修复重排用量解析和短文档来源族隔离，当前实现的 195 项节点回归全部通过。定向类型、lint、Harness validate/dry-run、通信 replay/compare 通过。原失败、未知调用和旧报告保留，当前读回入口为 `recovery-validation.json`。

## 重排用量

此前记录为“52 次 rerank 没有用量”的结果来自解析遗漏。封存响应中实际含有 `meta.tokens.input_tokens` 与 `meta.billed_units.input_tokens`；旧适配器和实验驱动只读取顶层 `tokens` 或 `usage`。

生产适配器现同时支持顶层与嵌套 token 字段。全部 batch 都返回非负安全整数、且总和有效时才报告 `inputTokens`；任一批次缺失、负数、小数或溢出，结果保留排序而将总用量留为未知。有效的零用量继续保留。

52 份原始响应逐个匹配原 `responseDigest` 后，通过修复后的适配器离线重放，全部恢复用量：报告输入及计费输入均为 **121,872 tokens**。重放未发起网络或模型请求。`rerank-usage-recovered.json` 保留每项原回执摘要、响应摘要、provider ID、tokens、billed_units 和观察关联。

固定回归 `siliconflow-rerank-response.json` 来自原 r6 的第 13 份响应，SHA256 为 `9876806987420e6418871ae331dc5fa3d8ac3c4d405ef3e324607e247279506d`。新的字段/批次测试在修复前有5项失败，修复后重排和 planner 定向55项通过，最终节点整组195项通过。Electron 重排旅程增加嵌套用量穿过 Wiki/Host API 的断言。

## 短文档隔离

独立 WorkBuddy 复核发现，少于五个词的正文没有五词指纹，仅标点不同的短页可能进入不同来源族。现对短页使用完整词序列，对长页维持五词窗口及既有128个摘要上限。真实快照、来源族和完整题目数据进入回归。空 gold 范围由既有 `spanText` 拒绝，新增回归验证了该调用路径。

复核中的其他两项意见已按实际边界核对：问题封存对象是 `evaluator-only`；实际发给被测模型的公开问题文件没有 sourceIds/familyId。复核身份字段是可信编写流程的记录，独立性另由已保存的 provider 请求、终态和逐题判断验证，没有声明该字符串具有密码学认证能力。原意见与处理记录见 `recovery-review.json`。

## Windows 与剩余资格

系统 `taskkill` 的新受控探针0.359秒退出0；在原候选 `fe9d7b3af` 上，两项原失败随后通过，原180项节点回归全部通过。原8秒超时原件保留并匹配 `fec742c2d88f83eeab51620c733919ba2b5a004833938d8706f3354a45aaa7ca`。本轮没有修改进程回收实现或原测试deadline。

新一轮独立代码复核按四个面串行执行：freeze取得有效正文并发现短页问题；grading超时无终态，capture/owner返回incomplete且只有推理内容，未计为有效终判。没有重发这些未知身份。

TF-0946 仍需当前候选的 Runtime/Electron 构建、引用和重排旅程，以及完整费用资格和最终独立终判。回答仍为131项有效判断、4项历史未结算；重排用量未知已恢复为0，服务商货币账单仍为unknown。排序策略保持现状。

原始证据位于 `D:/tmp/g2-tf0946-20261125-01a21178`：`process-recovery-20261125-r1`、`rerank-usage-before.json`、`rerank-usage-final-validation`、`rerank-usage-recovery.json`、`short-family-before.json`、`short-family-after.json`、`code-review-r10`。所有执行、语料、复核和重放均标为 agent 驱动。
