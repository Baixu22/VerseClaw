# Temporal Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\Temporal_Python\tests\worker\test_replayer.py`、`tests\worker\workflow_sandbox\test_runner.py`、`tests\test_client.py`、`tests\helpers\worker.py`。

## 值得移植的测试形态

- workflow 成功历史可 replay。
- nondeterministic 历史会失败。
- command reordering 的兼容边界。
- activity cancellation 被吞掉或传播的差异。
- continue-as-new 后 client result 跟随新 run。
- ApplicationError / WorkflowFailureError 的错误链。
- retry attempt 与 non-retryable error。

## ClawX Runtime Tests

- event log replay 能恢复 `planning/running/waiting/verifying` 状态。
- resume 后不会重复执行已有 side-effect tool call。
- tool call 使用 idempotency key，重复结果被识别为同一次调用。
- context compression 后生成新 run，保留 open obligations。
- runtime schema version 改变时按 marker 选择旧恢复逻辑。
