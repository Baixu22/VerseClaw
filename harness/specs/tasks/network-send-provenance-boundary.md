---
id: network-send-provenance-boundary
title: Network-send provenance boundary for message cross-context sends
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consume the existing ContentProvenance sidecar at one bounded network-send surface: cross-context sends initiated by the agent message tool, while preserving normal replies and existing delivery policy.
touchedAreas:
  - harness/specs/tasks/network-send-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tools/message-tool.ts
  - openclaw_runtime/src/infra/outbound/message-action-runner.ts
  - openclaw_runtime/src/infra/outbound/outbound-policy.ts
  - openclaw_runtime/src/infra/outbound/outbound-policy.provenance.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.provenance.test.ts
  - openclaw_runtime/src/agents/network-send-provenance-wiring.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - openclaw_runtime/src/infra/outbound/outbound-policy.provenance.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.provenance.test.ts
  - openclaw_runtime/src/agents/network-send-provenance-wiring.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The agent message tool carries the run provenance sidecar to the existing outbound cross-context policy boundary.
  - A reply to the currently bound conversation remains usable for untrusted, derived-untrusted, missing, or invalid provenance.
  - An untrusted, derived-untrusted, missing, or invalid source cannot use the implicit same-provider cross-target allowance.
  - Existing explicit operator configuration can still allow same-provider or cross-provider sends.
  - Trusted or operator provenance keeps the existing cross-context configuration behavior.
  - Existing target resolution, account binding, media policy, idempotency, channel action allowlists, and delivery dispatch remain unchanged.
  - CLI, system delivery, broadcast, webhook, and other network-send surfaces are not claimed as covered by this task.
  - The centralized network-send sink classification records the cross-context outbound policy as a `narrow` enforcement point; broader network-send coverage is still not claimed.
  - No blanket approval, prompt rewrite, global taint engine, regex classifier, config field, or dependency is introduced.
expectedUserBehavior:
  - Normal replies to the current channel or thread continue to work.
  - A model turn influenced by external or unknown content cannot silently redirect a message to another target using an implicit same-provider allowance.
  - Operators retain the existing explicit cross-context configuration controls.
docs:
  required: false
  note: This is a narrow backend policy refinement using existing configuration; it adds no user-visible setting or complete network-send enforcement claim.
---

# Implementation contract

This task adds one small source-dependent decision at the existing
`enforceCrossContextPolicy` boundary. Provenance participates only when the
call originates from the agent message tool. Other runtime delivery callers
keep their current behavior and remain explicit residual scope.

For a bound conversation, same-target delivery is never considered a
cross-context redirect. For a different target, untrusted or unknown
provenance requires an explicit existing operator setting instead of the
implicit same-provider default. The implementation must reuse target
normalization and the authoritative provenance parser rather than inspecting
message text.
