---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# 第七轮冻结设计

第六轮 clean 候选保持 NO_GO：stable 证据 3/18，成功回读率 17/18，token 增长
87.78%。本轮先做独立 deterministic 来源对照，再提交 design.freeze.json，随后提交
评测候选。真实收益由该 clean 候选的固定 96 次运行与原始证据复算判定。

原归档选择漂移对应 `anchored` 说明：四臂使用相同工具定义，模型从初始可见 exec
记录自行选取 URI/checksum，沿同一归档连续翻页。策略没有 oracle 参数；每次请求
执行模型返回的第一次 recall，最多三次后要求输出精确 value 或 null。

健康日志由 agent 生成，旧压力把它记为受保护的 user 文本；生产剪枝仅处理工具
观测。本轮保留日志全部字节、原两个干扰输出和 user/assistant 回合节奏，把该日志
作为第三个 exec 观测，并保留简短继续指令。每次增加 11405 字符工具压力。
旧 user 来源与修复 tool 来源的 deterministic 对照均保留；本轮压力角色与第六轮
不同，阈值、生产投影预算和语料保持原值。

两种 deterministic 来源均为 stable 6/6、reference-visible 6/6、retention-off 0/6，
控制均正确。stable 末次输入均值分别为 43965.75 与 18462 字符，逐运行 recall 次数
相同。该对照没有 provider token usage；B6 以 live 原始 usage 判定。

固定模型 space-bunny、四臂、六个证据/两个控制、三次重复、900 输出 token、低推理、
温度 0、8 次请求、5500 字符页、6000 单工具及 16000 工具聚合预算。单请求期限统一
固定为 240000ms，无自动重试；incomplete、传输错误与全部 usage 保留在固定分母。

dirty 候选在开跑前拒绝；运行后再次核对 commit/tree/源码。B1–B7 必须全部满足，
verifier 接受 clean 候选且 Task Forest base_graph_hash 匹配后才收口 TF-0749。
第五、六轮的清单及原始失败保留，生产默认值、产品锁和发布状态保持原样。
