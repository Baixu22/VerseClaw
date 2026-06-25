# OpenTelemetry Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\opentelemetry.io-main\content\en\docs\concepts\signals\traces.md`、`context-propagation\index.md`。该来源没有 SDK 测试；以下是从文档模型派生的 ClawX fixture。

## ClawX Trace Fixtures

- root span 没有 parent，child span 共享 trace id 并指向 parent span id。
- sibling spans 同 parent，但 operation name 不同。
- span event 带 timestamp 和 attributes，attribute-only 数据不要求事件时间。
- status `Unset` 不等于失败，`Error` 才进入错误优先排序。
- span link 连接 resume 后的新 run 与旧 checkpoint span。
- traceparent 解析格式为 `<version>-<trace-id>-<parent-id>-<trace-flags>`。
- 外部 traceparent 被标记为 untrusted 或重新根化。
- source attributes 能链接到 file evidence，但 verifier 不只依赖 attributes。
- trace summary 在 token budget 内优先保留 error/test/verifier span。
