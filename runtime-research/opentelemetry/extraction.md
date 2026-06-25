# OpenTelemetry Extraction

证据源：`C:\Users\27933\Desktop\verseshell\opentelemetry.io-main\content\en\docs\concepts\signals\traces.md`、`content\en\docs\concepts\context-propagation\index.md`。该目录是 OpenTelemetry 文档站，不是 SDK 源码。

## 1. Runtime Contract

OpenTelemetry trace contract 是 trace/span/context。Trace 是共享 `trace_id` 的 span 集合；span 通过 `parent_id` 形成层级。Span context 是不可变对象，包含 Trace ID、Span ID、Trace Flags、Trace State，并可通过 W3C `traceparent` 传播。

## 2. Context Assembly

对 ClawX 来说，Trace Context Provider 应把线上行为压缩成“与当前任务有关的 trace 子图”：按 trace id、service/route/error、时间窗口、文件/源码映射筛选 span，再把 span events、attributes、status 摘成 context item。

## 3. Tool Invocation

OpenTelemetry 不定义 agent tool invocation。可借鉴的是每个 tool call 都应生成 span：`tool.call` 为父 span，子 span 包括 permission、execution、parse result、verifier。跨进程/Gateway 调用用 trace context 贯穿。

## 4. State Machine

Span 有开始/结束时间、status、events。ClawX 可把 task state transition 记录为 span event，例如 `planning.started`、`tool.requested`、`tool.completed`、`verification.failed`。

## 5. Checkpoint / Resume

Trace 本身不是 checkpoint，但 trace id/run id 可成为恢复索引。resume 后应链接到原 run 的 trace，或用 span links 表达“新 run 继承旧 run evidence”。

## 6. Verifier / Evidence

Evidence 来自 span status、attributes、events、links。OpenTelemetry status 为 `Unset`、`Error`、`Ok`；ClawX 不应把 `Unset` 当失败，它可以表示没有显式错误。

## 7. Tests / Fixtures

文档站没有 SDK 测试可提取。ClawX 应自建 trace fixtures：父子 span、跨 trace link、error span、tool-call span、resume span link、traceparent 解析。
