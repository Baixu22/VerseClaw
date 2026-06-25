# Continue Tool Provider

证据源：`C:\Users\27933\Desktop\verseshell\continue-main\core\tools\index.ts`、`core\tools\callTool.ts`、`core\tools\definitions\readFile.ts`。

## Tool Definition

Continue tool definition 的可借鉴字段：

- 名称、展示标题、描述。
- JSON schema 风格参数定义。
- action phrase / completion phrase，用于 UI 或 prompt 展示。
- `readonly`、`isInstant` 等执行属性。
- `preprocessArgs` 做路径解析等环境相关转换。
- `evaluateToolCallPolicy` 决定是否允许、需要确认或禁用。

序列化给模型时，`serializeTool` 会去掉内部执行函数和 policy evaluator，避免把 runtime 私有能力泄露给模型。

## Tool Invocation

`callTool.ts` 的价值在于统一不同来源：

```text
tool call
  -> detect HTTP / MCP / built-in
  -> execute
  -> convert result to ContextItem[]
  -> return { contextItems, errorMessage?, errorReason?, mcpUiState? }
```

MCP 输出会把 text/resource 转成 `ContextItem`；不支持的 MCP content item 会转成错误 context item。异常被捕获并结构化返回。

## ClawX Target

ClawX 的 Tool Invocation Protocol 应固定为：

```text
ToolCallRequest:
  callId
  toolName
  args
  permissionContext
  traceContext

ToolCallResult:
  callId
  status: success | error | denied | cancelled
  contextItems
  structuredData
  error
  evidence
```

这样 Planner/Executor/Verifier 可以不用关心工具来自内置、MCP、Gateway 还是 host-api。
