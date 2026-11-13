# 让知识证据按原序进入上下文

DCS 将 owner 复核后的知识范围装配为 KnowledgeCandidatePacking/v2。普通 Chat、媒体发送、排队与重试，以及 Knowledge Librarian 的 model-only 问答，都通过该装配路径进入模型。

知识通道按 DCS 接受候选时的 ordinal 排列。通道之间沿用现有 precedence。每个 chunk 是一个完整单元；同一 conflictGroupId 的成员按原序组成一个单元，并占据首个成员的位置。分组只能约束装配，来源仍须各自通过 owner 准入；一个成员读取失败时整组退出。

每个单元的头部、引用标识和正文一起计入已有的共享字符预算。单元放不下时全部丢弃，后续更小的单元仍可使用剩余空间。Owner 读取返回的原始范围保持完整，DCS 不再截取一个字符前缀。现有默认总预算为 6000 个 JavaScript 字符单元。

| 字段 | 对应内容 |
|---|---|
| sourceDigest | 整份原文的 UTF-8 digest，来自 SourceRef/v2 |
| chunkDigest | owner 实际读取范围的 UTF-8 digest |
| projectionDigest | DCS 保留的完整装配单元，包括头部与正文 |
| retainedBodyChars / retainedBodyUtf8Bytes | 引用范围实际保留的正文字符与字节数 |
| retainedChars / retainedUtf8Bytes | 完整装配单元实际保留的字符与字节数 |
| estimatedTokens | UTF-8 字节数除以 4 向上取整的估算 |

RetainedEvidenceManifest/v1 只列入模型上下文中仍存在的完整单元，携带原始 SourceRef、ordinal、三种 digest 和实际用量。字符与字节数从最终文本读取；token 使用上述声明的估算方法，provider usage 继续由已有账本记录。候选 lineage 同时保留请求量、预算丢弃原因与 token 估算。

同一缓存投影只追加一次；后续 model call 按消息身份与 projectionDigest 回读仍保留的单元。取消、kill switch 或 owner 撤销会排除相应正文，manifest 随实际上下文更新。

Knowledge Librarian 的 Main 服务发送问题、历史与来源标识，并把 owner pins 交给 Gateway。当前 owner 在选定模型的 egress 范围重新解析这些 pins，DCS 装配正文。agent.wait 为具备 operator.read 权限的调用者返回最后一个 model call 的 manifest；Main 只校验 manifest 内实际保留来源的引用。

Model-only QA 的来源传输上限为 8 个引用，选择时保留完整冲突组。更大的 Source Set 会返回明确的排除来源清单；DCS 继续决定字符预算内保留的单元。内部模型使用独立会话，并保持来源所属 agent 与 workspace 的绑定。当前答案从终态结果读取，引用以模型后的 owner 回源字节和 retained chunk digest 校验。缺失当前模型结果时返回错误，不使用旧会话答案。Chat 重发保留原消息的引用 pins 与分组。

实现入口为 context-candidate、project-rag-packing、chat-knowledge-intent 与 embedded runner。回归入口为 project-rag-packing.test.ts、knowledge-evidence-qa.test.ts 和 Electron 的 project-rag-dcs-citation.spec.ts。
