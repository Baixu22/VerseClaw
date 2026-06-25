# Continue Slash Command

证据源：`C:\Users\27933\Desktop\verseshell\continue-main\core\commands\slash\customSlashCommand.ts`、`core\commands\slash\mcpSlashCommand.ts`。

## Custom Slash Command

自定义 slash command 会把配置中的命令名规范化：去掉前导 `/`，标记 source 为 `json-custom-command`。它的价值不是命令执行壳，而是把“用户短命令”映射成可审计的 prompt/action。

## MCP Slash Command

MCP prompt command 标记 source 为 `mcp-prompt`。本地证据显示 prompt stringify 主要支持 text content；非 text 内容不是这里的重点。

## ClawX Target

ClawX 可以实现 `RuntimeCommandRegistry`：

```text
SlashCommand:
  name
  source: local | mcp | project
  argsSchema
  expandsTo: prompt | toolCall | workflow
  permission
  evidence
```

首批只建议支持：

- `/map`: 生成 AgentMap。
- `/symbols`: 调 Serena/LSP 符号 provider。
- `/trace`: 调 RuntimeTraceContextProvider。
- `/verify`: 触发 Evidence Verifier。

不要先做复杂 UI 命令系统；先把 slash command 作为 runtime 意图入口。
