# 下一轮最小实验：评测页预算与工具说明适配

driven_by: agent

actor: codex-inline-spill-closeout-01a1b90a

status: proposed / not-run

目标是验证：在生产工具默认不变时，评测工具入口明确页尺寸与翻页说明，能否让模型自主取得有效投影，并在原 900 输出 token 预算下完成答案。当前封存数据的 120 次超页、14 次 stable oracle 丢失与 53 次 incomplete 是实验依据。

## 唯一实施切片

在评测器的 `RECALL_TOOL_DEF` 中要求显式 `max_chars`，声明 `1..5500` 的页范围，说明可按 offset 翻页、取得精确值即输出原 JSON、证据不存在时返回 null。只在评测器执行入口校验该范围；缺参数或超界由原工具错误路径如实记录。正式工具的默认 `max_chars=12000` 保持原值。

5500 来自封存 deterministic 的现有页设置；其成功结果序列化后 5847–5868 字符，落在既定 6000 字符单条预算内。实施后先用同一生产工具与夹具回读页、校验序列化尺寸以及压力前后投影；不得注入评分器 oracle 或用脚本代替模型选择页。

若序列化封装超出 6000，保留失败并在执行 live 前重新冻结该评测适配设计。不得悄悄截取 oracle、改工具正文或把未经模型读取的原始结果加入历史。

## 执行前冻结

用单独的 Harness spec 和 Task Forest proposal 记录此切片。产物写入独立 round4 目录，至少固定以下项并写出 SHA256：

| 对象 | 固定值或来源 |
|---|---|
| 输入/评分源码 | round3 provenance 的原始 hash；本轮 `source-bindings.json` 可回读 |
| 候选 | 页适配实现后的独立 commit/tree，dirty=false；当前设计尚无该候选 |
| 语料与 oracle | 现有 6 个证据任务、2 个控制，payload/位置/问题与原评分器保持一致 |
| 样本 | 四臂 × 八任务 × 三次 = 96 次运行；按原顺序一次完整执行，保留首次失败 |
| 配对 | 同 fixture/repetition 的 stable/off 首轮完整请求相同，工具定义在四臂相同 |
| provider | 同一 Responses endpoint、`space-bunny`；记录实际返回 model |
| 预算 | temperature=0、max_output_tokens=900、maxTurns=8；最多 768 次请求 |
| 投影与压力 | contextWindow=32000、toolMaxChars=6000、aggregateMaxChars=16000；原压力消息与 retention 开关 |
| 判定 | 原 B1-B7、原统计、有效最终 JSON 与原负例，所有阈值保持原值 |

费用继续按实际 provider 计费信息记录；没有费率/单位时为 `not-run`。900 预算耗尽仍计 incomplete，不通过提高预算、删失败或变更模型消除。

## 停止条件与收口

先通过输入单测、生产投影 deterministic 四臂、实际页尺寸以及 negative/oracle 泄漏检查，再执行冻结 live。

96 次结束后逐次复算 B1-B7，额外列出证据任务与无证据控制任务的正向/反向配对，以及超页、oracle 下一请求消失和 incomplete 数量。若 B2/B4/B5/B6 任一仍失败，保留 NO-GO 与本次首次失败；若所有验收完整满足，再按仓库自动收口流程更新 TF-0749。
