# Continue.dev Extraction

证据源：`C:\Users\27933\Desktop\verseshell\continue-main\core\context\index.ts`、`core\context\providers\index.ts`、`core\config\loadContextProviders.ts`、`core\config\types.ts`、`core\tools\index.ts`、`core\tools\callTool.ts`、`core\commands\slash\customSlashCommand.ts`、`core\commands\slash\mcpSlashCommand.ts`。

## 1. Runtime Contract

Continue 把 runtime 可扩展点拆成 provider/tool/command。Context Provider 输入 `query` 和 `ContextProviderExtras`，输出 `ContextItem[]`；Tool 输入 schema 化参数和执行上下文，输出 `ContextItem[]` 或错误信息；Slash Command 把用户的 `/command` 转成 prompt 或 MCP prompt 调用。

错误表达偏结构化：`callTool.ts` 对 built-in、MCP、HTTP tool 的异常捕获后返回 `errorMessage`、`errorReason` 和可显示的 context item，而不是让异常穿透到 UI。

## 2. Context Assembly

`BaseContextProvider` 定义 `description`、`getContextItems(query, extras)` 和可选 `loadSubmenuItems`。`ContextProviderExtras` 携带 config、fullInput、embeddingsProvider、reranker、llm、ide、selectedCode、fetch、isInAgentMode 等上下文能力。

`loadConfigContextProviders` 先加载默认 provider，再叠加配置 provider；未知 provider 记录为非致命错误；不同 IDE 环境会过滤不支持的 provider。

## 3. Tool Invocation

`core\tools\index.ts` 区分 base tools 和 config-dependent tools。`callTool.ts` 支持三类 URI/来源：HTTP tool、MCP tool、built-in tool。返回统一为 context items 或 error message。

重要做法：tool definition 包含 schema、display/action phrases、readonly/isInstant、policy、preprocessArgs 等字段；序列化给模型前会移除内部执行函数和 policy evaluator。

## 4. State Machine

源码中没有一个中心化任务状态机，但存在工具调用的隐含状态：

`tool_selected -> preprocess_args -> policy_check -> dispatch(http/mcp/builtin) -> normalize_output -> return_context_or_error`

Config handler 也有初始化 cascade，但不属于用户任务 runtime 状态机。

## 5. Checkpoint / Resume

本次提取范围未发现完整 workflow checkpoint。可借鉴的是 provider registry 的可重载配置、MCP connection singleton 的连接刷新，以及工具返回结构化错误后由上层继续处理。

## 6. Verifier / Evidence

Continue 的 evidence 主要是 `ContextItem`：它把工具或 provider 结果转成可显示、可进入 prompt 的结构化单元。MCP unsupported content 会被转成错误 context item，保留失败证据。

## 7. Tests / Fixtures

`loadContextProviders.vitest.ts` 验证默认 provider、配置 provider、未知 provider、IDE 过滤、顺序和构造错误。`core\tools` 下的 vitest 覆盖 tool override、readFileRange、runTerminalCommand、viewDiff、MCP connection 等边界。
