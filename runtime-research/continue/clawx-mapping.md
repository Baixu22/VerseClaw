# Continue.dev -> ClawX Mapping

Source Concept: `BaseContextProvider` and config-loaded provider registry  
ClawX Target: `Runtime Context Provider`  
Reuse Level: copy idea  
Dependencies: provider manifest、context item schema、permission model、token budget service  
Risks: provider 过多会让上下文选择变成噪声；必须有 ranking/budget/evidence。  
First Implementation Slice: 实现 `RuntimeContextProviderRegistry`，先注册 `CurrentFile`、`AgentMap`、`Symbols`、`Trace` 四类 provider。  
Tests Needed: 默认 provider、配置 provider、未知 provider、排序稳定、provider 错误降级。

Source Concept: `callTool.ts` dispatch and result normalization  
ClawX Target: `Tool Invocation Protocol`  
Reuse Level: adapt code  
Dependencies: host-api/api-client、MCP client、permission evaluator、trace context  
Risks: 不同工具返回格式混乱会污染 prompt；异常穿透会破坏任务循环。  
First Implementation Slice: 统一 `ToolCallRequest` / `ToolCallResult`，把内置工具和 MCP 工具都转成同一结果。  
Tests Needed: success/error/denied/cancelled、MCP unsupported item、tool exception、policy deny。

Source Concept: Slash command to prompt/MCP prompt conversion  
ClawX Target: `RuntimeCommandRegistry`  
Reuse Level: rewrite  
Dependencies: command manifest、workflow entrypoints  
Risks: 命令过早 UI 化会偏离 runtime 能力沉淀。  
First Implementation Slice: `/map`、`/symbols`、`/verify` 三个 runtime command。  
Tests Needed: 命令名规范化、参数校验、source 标记、执行 evidence。
