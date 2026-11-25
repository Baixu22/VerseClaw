# 重排服务与固定池评测

`RerankProvider/v1` 使用 `RerankResult/v1` 返回模型、批次数、耗时、可用 token 用量及原始相关性分数。`scoreKind=raw-relevance`、`calibrated=false`；该分数只决定候选次序，不表示来源可信度或回答正确概率。

输入用量兼容 `tokens.input_tokens` 和 SiliconFlow 的 `meta.tokens.input_tokens`。所有 batch 均报告非负安全整数、且累加结果为安全整数时才返回总 `inputTokens`；缺失或非法批次使总用量保持未知。`meta.billed_units` 由原始评测回执单列保存。

模型清单列出 Qwen3-Reranker 的 0.6B、4B、8B 三种 cross-encoder，参考模型为 `Qwen/Qwen3-Reranker-0.6B`。本地适配器连接操作者提供的 loopback `/rerank` endpoint；远端适配器沿用已配置 provider 的 endpoint 与 SecretRef，或默认 SiliconFlow 环境变量。配置和日志不保存密钥。

设置 > 模型提供模型清单、本地/远端选择、配置、取消、禁用与凭据刷新。默认未启用；取消后不会发起新调用。`local` 检索 profile 不依赖重排，`quality` 和 `research` 在非显式 pin 的普通检索中使用重排。

planner 先融合 lane、复核当前 owner/pin，再把候选文本交给 provider。响应必须完整覆盖批内索引且分数有限；排序结果再次执行 owner 准入和版本复核。模型响应期间撤销、无远端 egress、响应错漏、取消或超时均不采用新排序，保留原 RRF 次序并返回 `rerank-failed` 原因。

`tests/unit/project-rag-rerank-provider.test.ts` 覆盖批次、取消、超时、结果校验和 planner 分支。设置 `PROJECT_RAG_RERANK_EVAL_OUT` 与已有 `SILICONFLOW_API_KEY` 后，该文件的实时用例在固定四语言候选池上执行参考模型与原次序消融，输出 nDCG@5、precision@5 与实际 provider 耗时。供应商未报告 token 用量时保留 `null`；该报告记录观察值，不自动调整线上排序或晋级策略。

本地 endpoint 的完整设置、quality/research 调用与取消/重试由 `tests/e2e/project-rag-rerank.spec.ts` 在真实 Electron、Wiki owner 和 FTS 索引链路上验证。测试 endpoint 是显式标注的 agent 驱动传输 fixture，其指标不代替上述真实参考模型消融。
