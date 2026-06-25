# Temporal Python Extraction

证据源：`C:\Users\27933\Desktop\verseshell\Temporal_Python\temporalio\common.py`、`temporalio\client\_workflow.py`、`temporalio\workflow\_context.py`、`temporalio\workflow\_workflow_ops.py`、`temporalio\worker\_workflow_instance.py`、`temporalio\worker\_replayer.py`、`tests\worker\test_replayer.py`。这是 Python SDK，不是 Temporal 服务端。

## 1. Runtime Contract

SDK contract 围绕 workflow handle 和 workflow execution。client handle 支持 `result`、`cancel`、`query`、`signal`、`terminate`。workflow 内部暴露 info、memo、search attributes、sleep、wait_condition、patched/deprecate_patch、child workflow、external signal/query/update、continue_as_new。

错误通过类型化异常表达：`ApplicationError`、`CancelledError`、`TerminatedError`、`TimeoutError`、`ActivityError`，client 侧以 `WorkflowFailureError` 包裹 workflow 失败。

## 2. Context Assembly

Temporal 不做 LLM context assembly。可借鉴的是 workflow context：`Info` 统一携带 namespace、workflow id、run id、attempt、retry policy、memo、search attributes 等运行上下文。ClawX 可将这些字段映射到 Mission/Task runtime context。

## 3. Tool Invocation

Temporal 的 activity/child workflow 类似“可重试工具调用”。`RetryPolicy` 定义 initial interval、backoff coefficient、maximum interval、maximum attempts、non retryable error types。ClawX 工具调用协议可以吸收这些 retry 字段，但不需要引入 Temporal 服务。

## 4. State Machine

`worker\_workflow_instance.py` 的 activation/job/command 模型体现了状态机：worker 接收 activation，应用 initialize/signal/query/timer/activity resolution/child workflow resolution/cancel 等 job，生成 complete/fail/cancel/continue-as-new 等 command。

面向 ClawX 可抽象为：

`created -> planning -> running -> waiting_external -> waiting_timer -> verifying -> completed | failed | cancelled | continued`

## 5. Checkpoint / Resume

Temporal 的核心恢复语义来自 history replay：workflow 代码重放历史事件，必须生成兼容 command；不兼容会被 replayer 检出。`continue_as_new` 用新的 run 继续执行，减少历史长度并携带必要输入。

ClawX 不引入 Temporal 服务，但可以吸收：

- append-only task event log。
- deterministic resume：从 checkpoint/event log 重建 task state。
- idempotency key：避免 resume 后重复执行不可逆工具。
- continue-as-new：长任务压缩历史，生成新的 task run。

## 6. Verifier / Evidence

Temporal verifier 是 history replay。`worker\_replayer.py` 读取 `WorkflowHistory` 并返回 replay failure。ClawX 的 verifier 可借鉴为：任务完成前不仅看最终消息，还要重放/检查事件序列是否存在未处理失败、open tool call、未验证 patch。

## 7. Tests / Fixtures

`tests\worker\test_replayer.py` 和 JSON histories 覆盖 complete、nondeterministic、command reordering compatibility、event tracing、activity cancellation 等边界。它们比 SDK 封装更值得移植，因为体现了“恢复语义必须可测试”。
