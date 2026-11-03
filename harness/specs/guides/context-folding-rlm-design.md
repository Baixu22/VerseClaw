---
id: context-folding-rlm-design
title: 从 RLM 吸收可审计的上下文折叠与按需展开
type: guide
appliesTo:
  - context-folding-rlm
  - autonomous-project-system
---

# 从 RLM 吸收可审计的上下文折叠与按需展开

日期：2026-11-02；driven_by: agent；actor: codex/main。

本文是 `context-folding-rlm` 的设计依据和交付边界，不是实现验收。当前只准备规范、Task Forest 节点和真实任务 fixture；后续在专用 worktree 中实现、测试、验收和 eval。

## 1. 目标

把 ClawX 已有但分散的 Context Block、CompressionArtifact、archive handle、Task Ledger Working Context、subagent result 和 context_read/search 能力连接成一条受控的上下文折叠路径：

```text
owner resource
  -> ContextHandle
  -> bounded context_expand
  -> child subagent / deterministic tool
  -> ContextFoldResult
  -> parent turn projection
```

吸收 RLM 的核心思想：大材料留在外部，模型只持有所需控制状态、结构化结果和可验证引用；不把“把数据塞进 prompt”或“生成一段摘要”当作唯一策略。

## 2. 与 RLM 的映射

| RLM 机制 | ClawX 对应 | 本支线要求 |
|---|---|---|
| REPL 外部变量 | Context Block / CompressionArtifact / archive / transcript / artifact | 用统一 ContextHandle 寻址，原文不依赖摘要存活 |
| Python 搜索/切片 | `context_read` / `context_search` / archive recall / 文件工具 | 提供有界展开；确定性操作优先于子 LLM |
| `llm_batch` 子调用 | `sessions_spawn` / role subagent / result bundle | 子任务默认只回传 FoldedResult，不回灌原始工具日志 |
| `answer` 可变状态 | WorkArtifact / 结构化任务结果 / Task Ledger Working Context | 允许迭代修订，但 artifact ready 不等于任务验收 |
| 输出字符上限 | turn budget、context 截断、subagent result cap | 每次展开和回传都有字符/预算/超时上限 |
| environment tips | tool navigation / task playbook / harness spec | 只加载任务相关策略，避免全局 prompt 膨胀 |
| RL 学出的上下文管理 | 运行时策略 + 后续可选反馈优化 | 不依赖模型天然会用 scaffold；先做确定性策略和评测 |

## 3. 不可变原则

1. **原文可寻址**：被折叠的原文仍由 owner 保留，摘要不是唯一真源。
2. **引用不是授权**：ContextHandle 只表示读面，不授予工具、写入、记忆或跨 scope 权限。
3. **有界展开**：每次 expand 必须有 session/workspace scope、checksum、字符上限和 freshness 诊断。
4. **结构化回传**：子任务结果必须包含 summary、evidenceRefs、未解决项、成本/延迟和 child identity。
5. **摘要非权威**：summary/recovery projection 不能直接改变任务状态、默认值或 durable owner。
6. **关闭等价**：flag 关闭时不改变 prompt 字节、工具调用和 compaction 行为。
7. **先证据后省 token**：上下文节省不能抵消 evidence loss；token 结果只在质量门通过后计分。

## 4. 提议契约

### 4.1 ContextHandle/v1

```text
ContextHandle/v1
- handleId
- owner
- scope
- resourceId
- selector
- checksum
- freshness
- estimatedChars
- allowedExpansion
- revision
```

`handleId` 稳定、不可伪造；`selector` 必须由 owner 解析；`checksum` 与解析结果一致；stale/missing 必须返回结构化诊断。

### 4.2 ContextExpandRequest/Result

```text
ContextExpandRequest/v1
- handle
- mode: excerpt | search | aggregate
- maxChars
- query?
- byteRange?
- requesterIdentity

ContextExpandResult/v1
- content or aggregate
- truncated
- charCount
- resolvedSelector
- evidenceRefs
- freshness
- diagnostics
```

不允许通过 expand 读取另一个 session/workspace 的原文；不允许返回未验证的 archive payload。

### 4.3 ContextFoldRequest/v1

```text
ContextFoldRequest/v1
- objective
- taskScope
- inputRefs: ContextHandle[]
- allowedTools
- outputSchema
- maxResultChars
- tokenBudget
- timeoutMs
- parentRunIdentity
```

子代理只能在声明的 scope、工具和预算内工作。禁止把父会话完整 transcript 默认复制给子代理。

### 4.4 ContextFoldResult/v1

```text
ContextFoldResult/v1
- childSessionKey / childRunId
- status
- summary
- structuredOutput
- evidenceRefs
- unresolvedClaims
- blockers
- failedAttempts
- inputRefs
- outputChars
- usage { inputTokens, outputTokens, totalTokens, costUsd?, latencyMs }
- diagnostics
```

父会话只接收这个结果和必要 handle；展开细节必须再次经过 `context_expand`。`result` 不是任务验收，也不能自动写 Memory/Knowledge/Task Ledger。

## 5. 路由策略

默认采用最保守路径，只有满足条件才升级：

| 条件 | 策略 |
|---|---|
| 短 prompt、小上下文、简单确定性任务 | 当前 Context Orchestrator，不折叠 |
| 大文件/大 tool output，但可用确定性搜索或切片 | selector + bounded expand |
| 长 transcript、跨会话恢复、材料复杂 | handle + on-demand expand |
| 多文件独立调查、语义综合、工具输出很长 | 单层 child subagent + FoldedResult |
| 需要精确复制/计数/JSON/代码搜索 | 程序化工具，不用子 LLM 代替 |
| 短任务或数学推理 | 不默认开折叠；文章和现有基准均提示可能退化 |

任何升级都必须先测主上下文 chars、总 tokens、延迟、任务正确率和 evidence retention。

## 6. 功能与验收矩阵

### 6.1 合同测试

- ContextHandle JSON round-trip 和 deterministic id。
- checksum、scope、session ownership、freshness、stale/missing 拒绝。
- `ContextFoldResult` schema、required evidenceRefs、unresolved claims。
- off-mode 与原 prompt/tool path byte parity。

### 6.2 功能测试

- 大 artifact 只进 handle，expand 返回 bounded excerpt。
- `context_search` 到 `context_expand` 的完整读面。
- child subagent 使用工具后，父会话只收到 FoldedResult。
- parent 不重新注入 raw child transcript。
- failure/timeout/cancel/partial result 不伪装 succeeded。
- 缺失 selector、循环引用、跨 scope、staleness 均 fail visible。
- 现有 `context_read`、`context_search`、`context_archive_recall`、SessionStartInjection、CompactionArtifact 行为不回退。

### 6.3 真实任务

真实任务使用 `harness/specs/fixtures/context-folding-rlm/real-workspace` 的冻结小型仓库；运行前复制到 `D:/tmp`，不得直接修改 fixture 源。

任务要求代理修复一个真实的任务板幂等性 bug，完成测试，并输出：

- 实际 patch
- 测试命令、退出码、计数
- ContextHandle / expand / FoldedResult 事件
- evidence refs 和 unresolved claims
- 总 token、主上下文 chars、延迟和成本（可用时）
- agent-driven 标记

真实任务在 feature 关闭时必须保持基线行为；开启时通过同一任务、同一 oracle。真实任务不是“真人数据”，而是 agent 驱动的真实代码修改和真实工具执行。

### 6.4 Eval 门

必须至少比较：

1. baseline：现有 Context Orchestrator，无折叠；
2. expand-only：summary/refs + 按需 expand；
3. folded-child：expand + 单层子任务折叠。

硬门：

- 任务 oracle exit 0，required tests 0 failure / 0 skip；
- required evidence refs resolution = 100%；
- scope violation = 0；
- parent raw child transcript chars <= 8,000；
- stale/missing handle 均显式诊断；
- off-mode 行为完全一致；
- 质量不低于 baseline；主上下文降低且总成本/延迟在预登记预算内，才允许继续评估；
- 任一项失败，节点保持 open，不能以“主上下文更短”收口。

## 7. 非目标

- 不在桌面端默认引入任意 Python REPL、pip install 或 shell。
- 不默认开启无限递归、无界子代理或递归深度大于 1。
- 不以摘要替换原始 transcript、CompressionArtifact 或 Task Ledger。
- 不让子代理自动获得父会话工具、写权限、Memory/Knowledge 写权限。
- 不把 FoldedResult 当作任务完成或发布证据。
- 不改变现有产品锁、冻结默认和默认注入开关。

## 8. 实施顺序

1. 冻结 contracts、flag 和 off-mode parity。
2. 接入 bounded expand，复用现有 selector/archive/context tools。
3. 接入单层 FoldedResult，复用 subagent/result bundle/handoff 语义。
4. 做功能、故障、安全和通信回归。
5. 运行真实任务与 paired eval，保留原始证据和 hash manifest。
6. 只有 eval 硬门通过，才评估更高阶批量/深度/学习型路由。

## 9. Worktree 边界

专用 worktree 计划路径：

`<worktree-root>/context-folding-rlm/ClawX`

只允许在该 worktree 执行本支线的写入和测试。Task Forest 节点通过 `worktree:context-folding-rlm` 标签绑定。其他 worktree 的改动不复制、不覆盖；若发生路径冲突，先记录 deviation，不在主工作树重写。
