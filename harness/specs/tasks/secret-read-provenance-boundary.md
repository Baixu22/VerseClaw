---
lifecycleStatus: archived
id: secret-read-provenance-boundary
title: Secret-read provenance boundary for message credentials
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consume the existing ContentProvenance sidecar at one bounded secret-read surface: channel SecretRef resolution initiated by the agent message tool, without blocking replies in the currently bound channel/account.
touchedAreas:
  - harness/specs/tasks/secret-read-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/tools/message-tool.ts
  - openclaw_runtime/src/agents/tools/message-secret-read-policy.ts
  - openclaw_runtime/src/agents/tools/message-secret-read-policy.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.secret-read-provenance.test.ts
  - openclaw_runtime/src/gateway/cli-runtime/command-secret-gateway.ts
  - openclaw_runtime/src/gateway/cli-runtime/command-secret-gateway.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - openclaw_runtime/src/agents/tools/message-secret-read-policy.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.secret-read-provenance.test.ts
  - openclaw_runtime/src/gateway/cli-runtime/command-secret-gateway.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.provenance.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The centralized secret-read classification records this task's policy as a `narrow` enforcement point; broader secret-read coverage is still not claimed and this task enforces only the bounded message-tool credential path.
  - The policy executes only when the selected message channel/account has a configured SecretRef and before Gateway or local secret resolution.
  - Replies using the currently bound channel and account remain usable for untrusted, derived-untrusted, missing, or invalid provenance.
  - Untrusted, derived-untrusted, missing, or invalid provenance cannot read credentials for another provider or account through an implicit message-tool redirect.
  - Existing explicit operator cross-context settings continue to authorize the corresponding provider/account scope.
  - Trusted system and operator provenance retain the existing message credential resolution behavior.
  - Policy errors never contain the resolved secret value or encrypted vault payload.
  - Existing message delivery, target normalization, allowlists, idempotency, media handling, command-exec defaults, and explicit fullAccess behavior remain unchanged.
  - No blanket approval, prompt rewrite, global taint engine, regex injection classifier, config field, or dependency is introduced.
expectedUserBehavior:
  - Normal replies in the active channel/account continue to work.
  - External or unknown content cannot silently cause credentials for another channel/account to be read before outbound policy runs.
  - Operators retain the existing explicit cross-context configuration controls.
docs:
  required: false
  note: This is a narrow backend policy refinement using existing configuration; it adds no user-visible setting and does not claim complete secret-read coverage.
---

# Implementation contract

The message tool resolves channel SecretRefs before dispatch. This task adds a
single synchronous authorization callback at that resolver boundary. The
callback is invoked only when configured SecretRefs were selected and before
either the Gateway request or local fallback can read plaintext.

The source-dependent decision uses only the authoritative provenance parser,
the host-derived current/requested channel and account scope, and existing
operator-owned cross-context settings. Model-authored message fields cannot
assert trust. Same-bound-scope replies stay available; broader secret,
credential-use, MCP, browser, CLI, and system-delivery paths remain explicit
residual scope.
