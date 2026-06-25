# Continue Providers

## Context Provider Registry

证据源：`C:\Users\27933\Desktop\verseshell\continue-main\core\context\index.ts`、`core\context\providers\index.ts`、`core\config\loadContextProviders.ts`、`core\config\types.ts`。

`BaseContextProvider` 实现 `IContextProvider`，每个 provider 有 `description`，必须实现 `getContextItems(query, extras)`，可选 `loadSubmenuItems`。`ContextProviderDescription` 包含 `title`、`displayTitle`、`description`、`renderInlineAs`、`type`、`dependsOnIndexing`。

默认 provider 包括 File、CurrentFile、Diff、Terminal、Problems、Rules。配置可增加 Codebase、RepoMap、Web、URL、GitHub、Jira、Database、MCP 等 provider。未知 provider 不阻断加载，而是进入错误列表。

## ClawX Target

ClawX 应实现两个 registry：

```text
RuntimeContextProviderRegistry
  register(provider)
  list(capability/filter)
  resolve(id)
  getContext(providerId, query, extras)

RuntimeToolProviderRegistry
  register(toolProvider)
  listTools(context)
  callTool(toolCall, runtimeContext)
```

Provider 的关键不是“能不能拿上下文”，而是每个 provider 都要声明：

- `id/title/displayTitle`
- `input schema`
- `output item kind`
- `budget behavior`
- `index dependency`
- `permission requirement`
- `evidence fields`

## 不建议提取

不提取 VSCode/JetBrains 绑定和聊天 UI。ClawX 只需要 provider contract、registry loading、错误降级和配置覆盖策略。
