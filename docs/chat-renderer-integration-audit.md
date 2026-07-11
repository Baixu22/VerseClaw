# Chat Renderer Integration Audit

## Production pipeline

The active renderer path is:

`Gateway message -> ChatMessage -> assistant-ui Markdown -> Tool UI parsing -> AI Elements`

## Integration status

| Layer | Status | Production entry |
| --- | --- | --- |
| assistant-ui message context and actions | Integrated | `ChatMessage` uses `MessageProvider` and `ActionBarPrimitive` |
| assistant-ui Markdown | Integrated | `TextMessagePartProvider` wraps `MarkdownTextPrimitive` |
| Tool UI fenced payloads | Integrated | `parseToolUiContent` removes fenced payloads from visible Markdown |
| Tool UI tool-use payloads | Integrated | `parseToolUiToolUses` merges tool interactions with fenced interactions |
| Tool UI interactive actions | Integrated | `AgentInteractionRenderer` receives the existing insert/send callbacks |
| AI Elements test results | Integrated | Rendered through Tool UI interactions |
| AI Elements stack trace | Integrated | Rendered through Tool UI interactions |
| AI Elements chain of thought | Integrated | Rendered through Tool UI interactions |
| AI Elements task | Integrated | Rendered through Tool UI interactions |
| AI Elements reasoning and shimmer | Integrated | Tool UI reasoning plus Chat streaming states |
| AI Elements file tree | Integrated | `WorkspaceBrowserBody` |
| AI Elements commit summary | Integrated | `WorkspaceGitPanel` |
| AI Elements web preview | Integrated | `WorkspaceWebPreviewPanel` |

## Acceptance coverage

- `chat-renderer-pipeline.spec.ts` proves assistant-ui Markdown and Tool UI cards coexist and raw Tool UI JSON is hidden.
- `chat-tool-ui-interactions.spec.ts` covers fenced and Markdown fallback interactions.
- `chat-tool-ui-interaction-flow.spec.ts` covers option and multi-step question callbacks.
- `ai-elements-rendering.spec.ts` covers the AI Elements-backed Tool UI renderers in light and dark themes.
- Workspace E2E specs cover file tree, commit summary, and web preview integrations.

No message protocol, tool schema, Store, Host API, or IPC changes are required for the current integration.
