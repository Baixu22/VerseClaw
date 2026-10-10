---
lifecycleStatus: archived
id: browser-effect-provenance-boundary
title: Browser-effect provenance boundary for external browser reuse
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consume the existing ContentProvenance sidecar at one bounded browser-effect surface: agent_browser requests that explicitly select a running browser, CDP endpoint, or external browser profile connection mode, without changing managed browsing, search, or read-only diagnostics.
touchedAreas:
  - harness/specs/tasks/browser-effect-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/agent-browser-provenance-wiring.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - tests/unit/agent-browser-tool.test.ts
  - tests/unit/agent-browser-service.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - openclaw_runtime/src/agents/agent-browser-provenance-wiring.test.ts
  - tests/unit/agent-browser-tool.test.ts
  - tests/unit/agent-browser-service.test.ts
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The centralized browser-effect classification records this task's policy as a `narrow` enforcement point; broader browser-effect coverage is still not claimed and this task enforces only agent_browser external browser reuse.
  - Managed browser open, navigate, wait, status, screenshot, console diagnostics, and ordinary web search/read flows remain usable for all provenance states.
  - Untrusted, derived-untrusted, missing, or invalid provenance cannot select auto-connect, CDP, or external-profile connection modes, even when ordinary tool arguments set allowExternalBrowser=true.
  - Trusted system and direct operator provenance retain the existing external browser reuse behavior.
  - A no-op allowExternalBrowser=true value with the managed connection mode does not change authorization or browser behavior.
  - This task does not classify a pre-existing sessionId as managed or external; reuse of an already-created external session remains residual scope.
  - The source-dependent decision runs in the agent_browser tool before Gateway invocation and Electron Main connection handling, and receives only provenance plus the requested connection mode.
  - Electron Main continues to require allowExternalBrowser=true for non-managed modes and continues to validate CDP endpoints, external profile values, executable paths, controlled CLI flags, and sandbox policy.
  - Existing browser approval, runtime mode, private-network, diagnostics, bridge responder binding, and failure handling remain unchanged.
  - Existing command-exec defaults, explicit fullAccess behavior, message network-send, message secret-read, and image credential-use behavior remain unchanged.
  - Cron browser automation remains managed by default and is not broadened to external browser reuse.
  - No blanket approval, prompt rewrite, global taint engine, regex injection classifier, config field, dependency, or browser shutdown is introduced.
expectedUserBehavior:
  - Normal managed browsing, search, page reading, screenshots, and diagnostics continue to work.
  - External or unknown content cannot explicitly select a running browser, CDP endpoint, or existing browser profile through connectionMode.
  - A direct operator request can still explicitly use an external browser mode subject to the existing Main-process acknowledgement and validation.
docs:
  required: false
  note: This is a narrow runtime authorization refinement using existing provenance metadata and browser connection modes; it adds no user-visible setting and does not claim complete browser-effect enforcement.
---

# Implementation contract

The agent_browser tool already normalizes open and command payloads before
calling the Gateway-owned Electron bridge. This task inserts one pure,
source-dependent decision between payload normalization and bridge invocation.
The decision inspects only the authoritative provenance status and the requested
connection mode; it does not inspect prompt text, cookies, storage, CDP data,
profile contents, or credential values.

For external, derived-external, missing, or invalid provenance, the managed
connection mode remains available while auto-connect, CDP, and external-profile
modes fail closed before the request crosses Gateway. Direct operator and
trusted system sources preserve the current external-mode path, which remains
subject to Electron Main's existing allowExternalBrowser acknowledgement,
input validation, sandbox policy, runtime modes, grants, and audit behavior.
Clicks, typing, evaluation, replay, full-access browser tools, and other
browser-effect surfaces remain explicit residual scope. The tool does not own
authoritative metadata for pre-existing session IDs, so using an already-created
external session without selecting its connection mode is also not claimed as
covered by this task.
