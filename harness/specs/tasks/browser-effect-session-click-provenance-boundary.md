---
id: browser-effect-session-click-provenance-boundary
title: Browser-effect provenance boundary for clicks on existing external sessions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close one residual browser-effect path by checking the Main-owned connection mode of an existing agent_browser session before an external or unknown source may click, while preserving managed-session clicks and all trusted/operator behavior.
touchedAreas:
  - harness/specs/tasks/browser-effect-session-click-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - openclaw_runtime/src/agents/agent-browser-provenance-wiring.test.ts
  - electron/services/agent-browser-service.ts
  - electron/gateway/agent-browser-bridge.ts
  - tests/unit/agent-browser-tool.test.ts
  - tests/unit/agent-browser-service.test.ts
  - tests/unit/agent-browser-gateway-bridge.test.ts
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
  - tests/unit/agent-browser-gateway-bridge.test.ts
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The centralized browser-effect classification records this task's session-effect policy as a `narrow` enforcement point; coverage is still not complete and this task enforces only simple agent_browser click calls on existing sessions.
  - For untrusted, derived-untrusted, missing, or invalid provenance, the tool performs one read-only Main-owned status lookup before click execution.
  - A matching existing session with connection.mode=managed remains clickable without a new approval.
  - A matching session with auto-connect, cdp, or external-profile mode is denied before the click bridge invocation.
  - A missing session, missing/invalid connection metadata, malformed status response, or failed status lookup fails closed before click execution.
  - Ordinary click arguments cannot claim a managed connection or bypass the Main-owned status result.
  - Trusted system and direct operator provenance retain the current click path without a status preflight.
  - Non-click actions, including navigate, wait, type, evaluate, screenshot, command, replay, and full-access browser tools, remain unchanged and are not claimed as covered.
  - AgentBrowserService preserves the connection selected at session creation when merging CLI runner metadata, so status cannot be downgraded from external to managed by a later partial session result.
  - The existing Gateway bridge status response, trusted responder binding, Electron Main allowExternalBrowser validation, runtime modes, approvals, private-network restrictions, and failure diagnostics remain unchanged.
  - Existing command-exec defaults, explicit fullAccess behavior, message network-send, message secret-read, and image credential-use behavior remain unchanged.
  - No new host route, protocol field, database, config option, dependency, blanket approval, prompt rewrite, regex classifier, or dynamic taint engine is introduced.
expectedUserBehavior:
  - External web or channel content can continue clicking within a managed Agent Browser session.
  - The same content cannot reuse a pre-existing external/CDP/profile session for a click.
  - Direct operator and trusted system requests keep the existing click behavior.
docs:
  required: false
  note: This consumes existing session metadata and adds no setting, UI, or broad browser-effect claim.
---

# Implementation contract

The agent_browser tool already receives the authoritative run provenance and
uses the Electron-owned Gateway bridge. For a simple `click` call influenced by
external or unknown content, it first invokes the existing read-only `status`
action and finds the exact session id. A pure sink-local policy allows only the
host-reported managed connection mode. Missing, malformed, unknown, or external
session metadata is denied before the click invocation.

The Main service remains the session metadata owner. Its CLI refresh merge must
preserve the connection selected during session creation even if a runner
returns a conflicting partial session object. The session connection is
immutable for the in-memory session lifecycle, so the status lookup and click
do not introduce a connection-mode race.

This task deliberately does not add provenance persistence to AgentBrowserSession,
does not inspect prompt text, and does not generalize the check to type,
evaluate, replay, full-access, browser-control UID actions, supervised tasks, or
plugin callers.
