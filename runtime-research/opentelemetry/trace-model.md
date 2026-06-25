# OpenTelemetry Trace Model

## Span Fields

证据源：`C:\Users\27933\Desktop\verseshell\opentelemetry.io-main\content\en\docs\concepts\signals\traces.md`。

文档列出的 span 信息包括：

- name
- parent span ID
- start/end timestamp
- span context
- attributes
- span events
- span links
- span status

Span context 包含 Trace ID、Span ID、Trace Flags、Trace State。因为 span context 可传播，所以它适合作为 ClawX runtime 跨 renderer/main/gateway/agent/tool 的关联键。

## Events vs Attributes

文档说明 span event 类似结构化日志，适合表示某个时间点发生的事件；attributes 适合描述 operation 的稳定属性，并且许多属性应在 span 创建时设置以影响采样。

ClawX 建议：

- attributes: `task.id`、`tool.name`、`provider.id`、`file.path`、`symbol.name`、`permission.policy`。
- events: `context.assembled`、`tool.output.received`、`patch.applied`、`test.finished`、`verifier.decision`。

## Links

Span links 可关联不同 trace 的 span。ClawX 可用它表达：

- resume 后的新 run 链接旧 run 的 checkpoint span。
- verifier 链接产生 evidence 的 test/tool spans。
- trace context provider 链接线上 trace span 与 agent task span。

## Propagation

证据源：`context-propagation\index.md`。W3C `traceparent` 格式为：

```text
<version>-<trace-id>-<parent-id>-<trace-flags>
```

ClawX 应在 Main-owned transport、Gateway proxy、runtime tool executor 中保留 trace context，避免 renderer 自己拼协议。
