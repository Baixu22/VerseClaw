---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# 第九轮冻结设计

第八轮349次调用中，stable证据14/18、reference16/18，B1/B4/B6失败；增幅25.027526%仍高于固定25%。
模型曾把URI文件名16位摘要扩写成完整64位checksum，missing后导航又锁定该错误参数。

本轮只复制最初实际可见exec文本中的URI/checksum，作为最多512字符的书签放入既有agent问题。
当前生产投影提供书签，导航优先使用该元数据；无引用基线不加书签。书签不含payload或字段值，
工具执行器仍只执行模型原始function_call，不静默改写参数或代发调用。

正常32次和首次URI扩写故障32次确定性对照均为reference/stable 6/6、off0/6、控制全部正确。
故障只在deterministic显式选择，主clean对照及live禁止注入故障。脚本结果不验收live收益和token预算。

原模型space-bunny、四臂、六证据/两控制、三次重复、900输出token、低推理、温度0、
8次请求、5500页、6000单工具/16000聚合预算、240000ms期限和B1–B7阈值保持原值。
第五至第八轮证据和失败原字节保留，来源标签与冻结源码单独绑定，设计先提交再提交clean候选。
只有96次live的B1–B7全过、verifier接受clean候选、子节点证据完整及base_graph_hash匹配后关闭TF-0749。
