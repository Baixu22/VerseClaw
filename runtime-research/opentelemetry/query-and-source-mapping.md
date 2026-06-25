# OpenTelemetry Query and Source Mapping

证据源：`C:\Users\27933\Desktop\verseshell\opentelemetry.io-main\content\en\docs\concepts\signals\traces.md`、`content\en\docs\concepts\context-propagation\index.md`、`content\en\docs\concepts\semantic-conventions.md`。这些是概念文档，不是查询引擎或 SDK 实现。

## Query Model

本地 OpenTelemetry 文档没有定义某个具体后端查询语言。可真实提取的是 trace/span 数据模型本身适合的查询键：

- `trace_id`: 找到一次端到端任务或请求的所有 span。
- `span_id` / `parent_id`: 还原父子层级。
- span name: 定位 operation，例如 `tool.call`、`gateway.proxy`、`test.run`。
- timestamps: 过滤时间窗口。
- status: 找错误 span 或显式成功 span。
- attributes: 按 service、route、tool、file、symbol、task 等维度过滤。
- events: 查某个时间点发生的结构化事件。
- links: 查 resume、异步任务、跨 trace evidence 关系。

ClawX 的 `RuntimeTraceContextProvider` 首期不需要 observability 平台，只需要在本地 trace store 上支持：

```text
findTrace(traceId)
findSpans({ taskId, status, name, timeRange, attributes })
findLinkedEvidence(spanId)
summarizeTrace(traceId, tokenBudget)
```

## Source Mapping Idea

`traces.md` 说明 attributes 用来给 span 附加 operation 信息，并建议使用 semantic attribute naming；`semantic-conventions.md` 说明 semantic conventions 是跨代码库、库和平台标准化命名的通用属性集合。概念文档没有给出 ClawX 可直接照抄的源码映射 schema，因此 ClawX 应定义自己的最小 source attributes：

```text
source.file
source.startLine
source.endLine
source.symbol
source.commit
source.diffHash
```

这些字段不应替代 file evidence；它们只是把 runtime span 与源码证据连接起来。真正的 verifier 仍要检查文件 hash、diff、symbol range、test output。

## Context Provider Output

`RuntimeTraceContextProvider` 输出应是可预算的 context items，而不是完整 trace dump：

```text
TraceContextItem:
  traceId
  spanId
  parentSpanId
  name
  status
  durationMs
  attributesSummary
  eventSummary
  sourceRefs
  evidenceRefs
```

排序建议：

1. error status span。
2. 与当前 task/tool/file/symbol attribute 匹配的 span。
3. verifier 或 test span。
4. links 指向的 resume/evidence span。
5. 其它同 trace sibling span。

## Safety

`context-propagation\index.md` 明确提醒 malicious actors 可以伪造 trace headers，内部 trace IDs、span IDs 或 baggage 可能泄露敏感信息。ClawX 因此应：

- 不信任外部传入的 traceparent，进入本地 runtime 时重新校验或重新根化。
- 不把 secret、完整 env、完整 command output 放进 span attributes。
- 给 trace provider 增加 redaction 和 budget cap。
