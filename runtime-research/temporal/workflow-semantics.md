# Temporal Workflow Semantics

## Retry Policy

证据源：`C:\Users\27933\Desktop\verseshell\Temporal_Python\temporalio\common.py`。

`RetryPolicy` 字段包括：

- `initial_interval`
- `backoff_coefficient`
- `maximum_interval`
- `maximum_attempts`
- `non_retryable_error_types`

ClawX 工具调用和 workflow step 应将 retry policy 放进 step 定义，而不是散落在 executor 中。

## Continue As New

证据源：`C:\Users\27933\Desktop\verseshell\Temporal_Python\temporalio\workflow\_workflow_ops.py`。

`continue_as_new` 表示当前 run 结束，并用新的 run 继续 workflow。它适合长历史压缩。ClawX 可将它映射为：

```text
TaskRun A:
  event log too long / context compressed
  -> emit continue_as_new checkpoint
TaskRun B:
  parentRunId = A
  input = compressed state + open obligations
```

## Patch Markers

证据源：`workflow\_context.py` 中 `patched`、`deprecate_patch`。

Temporal 用 patch marker 处理 workflow 代码演进与历史重放兼容。ClawX 可借鉴为 runtime schema/version marker：当 task event schema、tool result schema 或 context compression 策略升级时，旧 run 仍按旧 marker 恢复。

## Replay

证据源：`worker\_replayer.py`、`tests\worker\test_replayer.py`。

Replay 不是“重新执行所有外部动作”，而是用 history 验证 workflow 代码能否生成同样的决策。ClawX resume 也应区分：

- 可重放：planner decision、context assembly、verifier checks。
- 不可重放：真实写文件、发网络请求、执行命令。
- 可跳过但需证据：已有 tool result、patch hash、test output。
