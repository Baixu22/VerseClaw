---
id: external-content-source-provenance-baseline
title: External Content Source-to-Sink Provenance Baseline
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Establish one small, auditable provenance contract for external content and
  carry it through channel ingress, external-content wrapping, prompt-data
  sanitization, and one agent handoff path without implementing global taint
  enforcement.
touchedAreas:
  - .agent-workbench/task-forest/proposals/TFP-external-content-provenance-baseline-20260820.json
  - harness/specs/tasks/external-content-source-provenance-baseline.md
  - shared/security/content-provenance.ts
  - shared/channels/inbound-trust.ts
  - openclaw_runtime/src/security/external-content.ts
  - openclaw_runtime/src/agents/sanitize-for-prompt.ts
  - openclaw_runtime/src/agents/tools/web-fetch.ts
  - openclaw_runtime/src/agents/handoff-artifacts.ts
  - openclaw_runtime/src/plugin-sdk/inbound-trust.ts
  - tests/unit/channels-p4-004-inbound-trust.test.ts
  - tests/unit/external-content-provenance.test.ts
  - tests/unit/handoff-artifacts.test.ts
  - openclaw_runtime/src/plugin-sdk/inbound-trust.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/external-content-provenance.test.ts
  - tests/unit/channels-p4-004-inbound-trust.test.ts
  - openclaw_runtime/src/plugin-sdk/inbound-trust.test.ts
  - tests/unit/handoff-artifacts.test.ts
acceptance:
  - The repository has one authoritative ContentProvenance sourceKind/trustLevel contract.
  - Source and trust enum values match the bounded v1 lists in this task.
  - Each provenance value carries sourceId, receivedAt, parentSourceIds, the
    external-untrusted flag, and optional workspace/session/agent identifiers.
  - Channel and web/external content adapters produce untrusted provenance.
  - Tool results derived from external content are derived-untrusted.
  - Prompt-data sanitization preserves the existing user-visible wrapped text.
  - A derived handoff artifact retains parentSourceIds and cannot promote an
    untrusted parent to trusted through ordinary content metadata.
  - Missing or invalid provenance is represented as an explicit missing state.
  - Sensitive sink categories are typed for a later policy integration only.
  - Existing exec default and fullAccess behavior is unchanged.
  - No new dependency, global taint engine, prompt rewrite, or blanket approval
    is introduced.
expectedUserBehavior:
  - Reading channel or web content continues to work and keeps the existing
    wrapping and sanitization text exactly as before.
  - Later policy code can inspect source and trust metadata without treating a
    missing label as trusted.
docs:
  required: false
  note: >-
    No README translation update is required: this change adds sidecar
    metadata and test adapters without changing user-visible wrapping, flows,
    or defaults.
---

# Implementation contract

The provenance value is correlation and trust metadata, not a dynamic taint
engine and not a replacement for existing authorization or approval gates.
External-derived content is monotonic: if any parent is `untrusted` or
`derived-untrusted`, a derived value is `derived-untrusted`. Callers cannot
raise trust by putting a value in an ordinary content field. A missing or
invalid value is reported as `missing`, never silently treated as trusted.

The v1 source kinds are `user-direct`, `channel`, `web`, `file`, `tool-result`,
`memory`, `mcp`, `skill`, `agent-handoff`, `system-generated`, plus explicit
`unknown`. Trust levels are `trusted`, `operator`, `untrusted`, and
`derived-untrusted`.

Sensitive sink names (`secret-read`, `network-send`, `external-write`,
`command-exec`, `browser-effect`, and `credential-use`) are classification
only in this card. Enforcement belongs to a later, separately scoped sink
policy task.
