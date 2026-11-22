---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# 第八轮冻结设计

第七轮为96次/416次调用，stable证据1/18、控制6/6，B2/B4失败，NO_GO。
原归档选择39次、其他归档49次；可见字段还曾被误认成文件名或继续翻页。
本轮在每次请求末尾放入可见归档的分页建议和完整字段位置。

导航只接受该请求原有input。目标来自首个可见recall参数，首轮来自可见引用；
页偏移来自可见返回长度或已淘汰页的可见调用参数。工具明确失败时仍推荐该页。
完整private_evidence字段给出call_id与input索引，停止推荐下一页；提示不复制值、
不比较oracle。模型仍自行发起function_call并从当前工具内容输出最终value。

确定性来源对照保留首次2/6失败：字段直接接在日志字母后，词边界要求漏掉四个任务。
修复识别后stable/reference各6/6、retention-off 0/6，控制全部正确；65项测试和
node/web/tests完整类型通过。该对照没有provider usage，真实收益仍由新live判定。

模型space-bunny、四臂、六证据/两控制、三次重复、900输出token、低推理、温度0、
8次请求、5500页、6000单工具/16000聚合工具预算、240000ms期限保持原值。
压力日志沿第七轮tool来源，全部字节与user/assistant回合节奏不变。
无自动provider重试；incomplete、失败、全部usage及每个样本保留在原分母。

design.freeze.json在候选提交和provider调用之前独立提交，锁定导航源码和规则。
dirty、源码漂移与设计变化在开跑前拒绝。原B1–B7阈值保持原值；全部通过、verifier
接受clean候选且base_graph_hash匹配后收口TF-0749。第五至第七轮失败和字节完整保留。
