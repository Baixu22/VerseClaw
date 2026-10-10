---
id: browser-effect-session-type-provenance-boundary
title: Browser-effect provenance boundary for typing into existing external sessions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend the existing verified-session browser-effect preflight from click to simple agent_browser type calls, without exposing typed text to policy code or changing other browser actions.
touchedAreas:
  - harness/specs/tasks/browser-effect-session-type-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.ts
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - openclaw_runtime/src/agents/agent-browser-provenance-wiring.test.ts
  - tests/unit/agent-browser-tool.test.ts
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
  - The centralized browser-effect classification records this task's session-effect policy as a `narrow` enforcement point; coverage is still not complete and this task adds only simple agent_browser type calls to the existing verified-session check.
  - The click behavior delivered by browser-effect-session-click-provenance-boundary remains unchanged.
  - For untrusted, derived-untrusted, missing, or invalid provenance, type performs one read-only Main-owned status lookup before typing.
  - A matching existing session with connection.mode=managed remains usable for type without a new approval.
  - A matching session with auto-connect, cdp, or external-profile mode is denied before the type bridge invocation.
  - A missing session, missing/invalid connection metadata, malformed status response, missing success marker, or failed status lookup fails closed before type execution.
  - Ordinary type arguments cannot claim a managed connection or bypass the Main-owned status result.
  - Typed text, selector values, and clear flags are not inputs to the source-dependent policy, status payload, denial reason, or authorization diagnostics.
  - Trusted system and direct operator provenance retain the current type path without a status preflight.
  - Navigate, wait, evaluate, screenshot, command, replay, full-access, browser-control UID actions, supervised tasks, and plugin callers remain unchanged and are not claimed as covered.
  - The existing immutable Main-owned session connection, Gateway responder binding, Electron Main validation, runtime modes, approvals, private-network restrictions, and failure diagnostics remain unchanged.
  - Existing command-exec defaults, explicit fullAccess behavior, message network-send, message secret-read, and image credential-use behavior remain unchanged.
  - No new host route, protocol field, database, config option, dependency, blanket approval, prompt rewrite, regex classifier, or dynamic taint engine is introduced.
expectedUserBehavior:
  - External web or channel content can continue typing into a managed Agent Browser session.
  - The same content cannot reuse a pre-existing external/CDP/profile session for typing.
  - Direct operator and trusted system requests keep the existing type behavior.
docs:
  required: false
  note: This reuses the existing session status preflight and adds no setting, UI, or broad browser-effect claim.
---

# Implementation contract

The click phase already verifies the exact Main-owned session through the
existing read-only `status` bridge. This task renames the click-specific pure
policy/helper to a session-effect policy and invokes it for only `click` and
`type`. Both actions require the same managed-session proof for external or
unknown provenance; trusted and operator sources keep the direct path.

The preflight receives only provenance, action identity, session id, and the
host-reported connection mode. It must not receive or copy the typed text,
selector, or clear flag. The actual type payload crosses the bridge only after
authorization succeeds.

This task deliberately does not generalize the preflight to evaluate, replay,
full-access, browser-control UID actions, supervised tasks, or plugin callers.
