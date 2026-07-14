---
id: agent-browser-tool-interception
title: Agent Browser Tool Interception
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Agent browser tools must pass through a four-layer interception chain before execution. Each layer must independently enforce runtime availability; no layer may skip its check because an upstream layer passed.

The four layers, in order:

- **L1 UI gray-out**: Renderer tool menus must gray out tools whose `toolClassification.runtime` (`browser_control` / `controlled_enhanced` / `full_access`) is not satisfied by the current `browserControlEnabled` and `browserAutomationMode`. Grayed-out tools must be skipped during batch enable.

- **L2 batch enable preset**: Tool select-all, classification-based enable, preset enable, and config import must skip debugger tools that are not available under the current runtime state. Tool classification (`runtime` / `capabilities` / `risk`) may only be used for UI filtering, batch enable, prompt, and audit display; it must not replace the tool registry allow-list, `requiredCapabilities` filtering, runtime authorization, or background execution-time re-validation.

- **L3 Gateway bridge filter**: Before constructing model requests, the Gateway bridge must filter tool schemas and browser automation system prompts by the real runtime state. `browser.*` tools may only be exposed to the model when tool calls are enabled, the user has enabled the specific tool, and the global `browserControlEnabled` runtime state is true. The bridge must re-filter all `browser.*` tools based on current runtime state; it must not trust `enabledToolIds` passed from the renderer alone.

- **L4 service re-validate**: `AgentBrowserService` must independently re-validate `browserControlEnabled` and `browserAutomationMode` before executing any tool action. A tool name returned by the model may only execute if it matches a registered and enabled tool. The service layer must not trust any runtime state passed from upstream layers.

The canonical runtime availability check is `isToolRuntimeAvailable(tool, browserControlEnabled, browserAutomationMode)` in `shared/agent-browser/tool-registry.ts`. The four-layer spec table and helper functions live in `shared/agent-browser/tool-classification.ts`.

Any change to tool classification, runtime requirements, or the interception chain must update `TOOL_CLASSIFICATION_BY_ID` in `tool-registry.ts` and `TOOL_INTERCEPTION_LAYER_SPECS` in `tool-classification.ts` in the same commit.
