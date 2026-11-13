---
id: inline-spill-eval-projected-input
title: Inline/Spill Eval Projected Input Integrity
type: ai-coding-rule
severity: error
appliesTo:
  - inline-spill-real-benefit-eval-round3
  - inline-spill-real-benefit-eval-round4
  - inline-spill-real-benefit-eval-round6
  - inline-spill-real-benefit-eval-round7
  - inline-spill-real-benefit-eval-round8
---

# 评测输入只有一个内容来源

模型请求中的 function_call_output 必须来自同轮生产投影的对应 toolResult 文本；不得从原始工具历史、隐藏 details 或其他臂的消息恢复内容。缺失投影返回明确的 projection_omitted 诊断。函数调用元数据与输出保留 call_id 对应关系，回读文本不得同时在 prompt 正文和协议输出出现。

压力处理臂与负对照使用同一输入夹具、oracle、温度、压力消息及 archive/session 身份；逐 fixture/repetition 对比首轮完整请求的 SHA256。后续模型生成的调用及 retention 导致的投影差异必须记录，不能假称模型响应也逐字节相同。

mainContextChars 从实际发送 input 的序列化字符数计算，UTF8字节、完整请求与响应、投影工具文本分别留档。原始结果只进入本地评分和证据，不作为额外模型输入。

收益阈值与统计仍以 inline-spill-benefit-quantification 为唯一口径。旧轮次证据保持字节原样，新轮次单独封存；不能用修复输入来源的行为宣称任务收益通过。

第四轮评测的回读工具要求显式的整数 `max_chars`，范围为 1–5500；缺失或超界参数在访问归档前沿用 `invalid_arguments` 诊断。四臂工具定义一致，实际序列化页仍须进入既定 6000 字符生产投影预算。该契约仅用于评测入口，生产工具默认值仍为 12000。

验证：输入装配单测、真实生产投影 deterministic 四臂、live 首轮请求配对哈希与逐调用请求/投影文本复算。

第六轮在 provider 调用前单独提交冻结设计，再提交评测候选。开跑与结束均记录实际
commit、tree、branch、dirty 和源码摘要；dirty、设计漂移或运行中的源码变化使 B7 失败，
原始记录完整保留。`incomplete` 保留所有 usage 并判该次运行失败；8 轮耗尽仍有工具调用
时记 `loop_budget_exceeded`。输出预算、工具定义和 B1–B7 阈值保持冻结。

收益配对使用证据任务的 fixture/repetition，控制配对单独报告。归档选择按原目标
URI/checksum 与可选 byte_length 匹配分类，原工具 content 命中和页覆盖只用于诊断；
最终任务判分仍读取精确 value。新证据及第五轮原始字节封存包固定字节属性，SHA256
清单与实际 Git blob、逐调用记录及原始归档共同构成复验输入。

第七轮将 agent 生成的健康检查日志记录为 exec 工具观测，逐字节保留旧日志和两个
干扰工具输出，保持原 user/assistant 回合节奏，并保留简短的 user 继续指令。
工具压力增加且继续受既定聚合预算处理；旧 user 来源对照单独封存。原归档锚定说明在
四臂一致，模型仍自行选择可见 URI/checksum 与页偏移，deterministic 策略仅读取可见输入。
压力角色、日志摘要、工具定义和 240000ms 请求期限在 live 前冻结；原 B1–B7 阈值不变。

第八轮允许在请求末尾追加可见导航提示。目标、偏移和字段位置必须只由该请求原有的
可见引用、function-call参数和当轮投影function_call_output复算；不得保存第二份隐含
上下文或恢复已淘汰的payload。完整private_evidence字段只提供call_id/input索引，不把
字段值复制到提示、不与oracle比较。四臂同用该规则，原压力字节和B1–B7阈值不变。
