---
id: inline-spill-eval-projected-input
title: Inline/Spill Eval Projected Input Integrity
type: ai-coding-rule
severity: error
appliesTo:
  - inline-spill-real-benefit-eval-round3
  - inline-spill-real-benefit-eval-round4
---

# 评测输入只有一个内容来源

模型请求中的 function_call_output 必须来自同轮生产投影的对应 toolResult 文本；不得从原始工具历史、隐藏 details 或其他臂的消息恢复内容。缺失投影返回明确的 projection_omitted 诊断。函数调用元数据与输出保留 call_id 对应关系，回读文本不得同时在 prompt 正文和协议输出出现。

压力处理臂与负对照使用同一输入夹具、oracle、温度、压力消息及 archive/session 身份；逐 fixture/repetition 对比首轮完整请求的 SHA256。后续模型生成的调用及 retention 导致的投影差异必须记录，不能假称模型响应也逐字节相同。

mainContextChars 从实际发送 input 的序列化字符数计算，UTF8字节、完整请求与响应、投影工具文本分别留档。原始结果只进入本地评分和证据，不作为额外模型输入。

收益阈值与统计仍以 inline-spill-benefit-quantification 为唯一口径。旧轮次证据保持字节原样，新轮次单独封存；不能用修复输入来源的行为宣称任务收益通过。

第四轮评测的回读工具要求显式的整数 `max_chars`，范围为 1–5500；缺失或超界参数在访问归档前沿用 `invalid_arguments` 诊断。四臂工具定义一致，实际序列化页仍须进入既定 6000 字符生产投影预算。该契约仅用于评测入口，生产工具默认值仍为 12000。

验证：输入装配单测、真实生产投影 deterministic 四臂、live 首轮请求配对哈希与逐调用请求/投影文本复算。
