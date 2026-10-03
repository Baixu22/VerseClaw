---
id: line-c-grounding-default-on-proposal
title: Line C grounding default-on proposal
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define Phase G as a proposal-only default-on readiness artifact; it must not implement default-on behavior and requires a later accepted implementation spec before any default change.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-default-on-proposal.md
  - runtime-research/handoffs/line-c-grounding-default-on-proposal/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-default-on-proposal.md
  - runtime-research/handoffs/line-c-grounding-default-on-proposal/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - The artifact may propose default-on criteria, evidence requirements, risk mitigations, migration/rollback plans, and docs/i18n/E2E plans.
  - All proposal outputs remain non-authoritative with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - It must not implement default-on, change defaults, silently roll out, grant runtime authority, or change prompt/model-message/provider-ordering/runtime decision behavior.
  - Controlled production opt-in remains the highest approved runtime-use boundary unless a later default-on implementation spec is accepted.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - default-on implementation, default config change, silent rollout, automatic provider registration/order change, prompt/model-message/runtime decision authority, runtime authority, memory promotion, fact acceptance, episode write, persistence, UI/settings default change, or production behavior change
  - raw prompt/trace/payload/tool args/output/stdout/stderr/env/secret/API key/auth header/traceparent/tracestate/baggage retention, untrusted refs, database, sidecar, cache, exporter, listener, service, daemon, server, patch apply, workspace edit, or symbol mutation
  - renderer direct IPC/Gateway calls, Gateway/Main/host-api/api-client/provider transport changes, or comms changes without a later implementation spec and comms validation
featureFlags:
  - No default-on flag, default config, migration, UI setting, public API, Gateway route, IPC route, provider registration, provider ordering, TaskLoop gate, prompt/model-message gate, persistence gate, or runtime decision gate is authorized.
rollback:
  - Reject or revise the proposal and retain controlled production opt-in or diagnostics-only status.
  - No runtime cleanup is required because proposal-only artifacts must not change behavior.
rejectedBoundaries:
  - default-on implementation, runtime authority, prompt/model-message/provider-ordering authority, persistence, memory writes, raw/untrusted leakage, UI default changes, transport changes, and mutation surfaces
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-default-on-proposal.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-default-on-proposal.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-default-on-proposal.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-default-on-proposal.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Proposal-only evidence is complete and explicitly says default-on requires a later accepted implementation spec.
  - No runtime behavior, default, UI, transport, provider, prompt/model-message, persistence, memory, patch, workspace, or symbol mutation change is made.
  - README review and comms decision are recorded.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - A later default-on implementation spec may be proposed only after this proposal is accepted and owner/security/support review approves the next boundary.
  Still forbidden:
    - default-on implementation by this spec, runtime authority, prompt/model-message/provider-ordering authority, persistence, raw/untrusted retention, memory promotion, fact acceptance, episode write, patch apply, workspace edit, and symbol mutation
---

# Line C Grounding Default-on Proposal

Phase G is proposal-only. It does not implement default-on behavior.
