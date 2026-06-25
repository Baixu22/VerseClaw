# Continue Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\continue-main\core\config\loadContextProviders.vitest.ts`、`core\tools\*.vitest.ts`、`core\context\mcp\*.vitest.ts`。

## Provider Tests

- undefined/empty config 只加载默认 provider。
- IDE 不支持的 provider 被过滤。
- `hasDocs` 时增加 Docs provider。
- 配置 provider 能携带 params。
- 未知 provider 进入错误列表，但不阻断其它 provider。
- 配置 provider 和默认 provider 合并时不重复，顺序稳定。
- provider constructor 抛错时仍能返回其它 provider。

## Tool Tests

- tool override 不修改原数组。
- unknown tool override 产生 warning。
- `readFileRange` 验证正数行号、越界范围、负数解析。
- `runTerminalCommand` 覆盖同步、流式、后台、timeout、SIGTERM/SIGKILL、远程环境、cwd fallback、危险命令 policy。
- MCP connection 覆盖 singleton、refresh、状态、Windows 命令包装。

## ClawX 应复刻的 fixture

- Provider registry 加载失败不影响默认 provider。
- Tool policy 三态：allow / ask / deny。
- MCP tool 返回 text/resource/unsupported content 的归一化。
- Tool exception 转成结构化 `ToolCallResult.error`，不会中断 runtime loop。
