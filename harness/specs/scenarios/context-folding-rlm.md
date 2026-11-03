---
id: context-folding-rlm
title: 长上下文折叠、按需展开与真实任务闭环
type: scenario
appliesTo:
  - context-folding-rlm
  - gateway-backend-communication
---

# 场景：长上下文折叠与按需展开

## 用户可见目标

用户在一个包含长 transcript、工具输出、文档和多个 workspace 资源的任务中，要求代理完成一个真实的代码修改或调查任务。代理不应把所有原始材料塞进主上下文，而应：

1. 识别大材料并以 handle/selector 保留来源；
2. 在需要时按需展开 bounded excerpt；
3. 对独立、工具密集的子任务使用单层子代理；
4. 将子任务结果折叠为 summary + structured output + evidence refs + unresolved claims；
5. 回到父会话后只消费折叠结果，必要时再展开；
6. 通过真实测试和 oracle，而不是仅凭模型文本宣称完成。

## 必须保持的边界

- ContextHandle 不是权限；selector 不是写入授权。
- 父会话不能默认获得 child transcript 或完整工具输出。
- FoldedResult 不能替代任务验收、run terminal、Memory/Knowledge accept 或发布批准。
- 未找到的 selector、stale checksum、跨 scope 引用必须显式诊断。
- 功能关闭时，旧 Context Orchestrator、compaction、`context_read`、`context_search`、subagent 和 prompt 字节保持兼容。
- 任何折叠结果必须保留 `driven_by: agent` 和 child identity。

## 真实任务流程

fixture：

`harness/specs/fixtures/context-folding-rlm/real-workspace`

运行前复制到 `D:/tmp/context-folding-real-task-<runId>`。任务要求修复任务板重复完成导致 revision/event 重复的真实代码缺陷，并运行真实测试。

基线运行：

- 使用现有上下文路径，不启用折叠。
- 记录任务结果、测试 exit code、主上下文 chars、总 tokens、延迟和 evidence。

实验运行：

- 开启 expand-only 或 folded-child。
- 必须至少出现一次有界 expand 或 child FoldedResult。
- 父会话不能收到 child 的完整 transcript。
- 必须通过同一真实任务测试和 `oracle/verify.py`。

## 验收失败条件

以下任一项出现即不接受：

- oracle 失败或测试 skip；
- 必须的 evidence refs 无法解析；
- 跨 session/workspace 读取；
- 父会话注入完整 child transcript；
- stale/missing handle 被静默忽略；
- FoldedResult 被当作任务完成；
- 关闭模式 prompt/tool 行为发生变化；
- 只有 token 减少，没有正确性或证据质量证据。
