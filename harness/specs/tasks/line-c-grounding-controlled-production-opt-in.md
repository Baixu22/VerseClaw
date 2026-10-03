---
id: line-c-grounding-controlled-production-opt-in
title: Line C grounding controlled production opt-in
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define Phase F controlled production opt-in for Line C diagnostics-only runtime use after Phase E go/no-go, while remaining explicit/default-off, bounded, non-authoritative, and rollbackable.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md
  - runtime-research/handoffs/line-c-grounding-controlled-production-opt-in/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md
  - runtime-research/handoffs/line-c-grounding-controlled-production-opt-in/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Controlled production opt-in remains explicit/default-off and cohort-limited.
  - Production metrics must show leak count 0, provider ordering diff 0, runtime decision diff 0, and rollback drill pass before Line C may be described as entering controlled production opt-in runtime use.
  - Runtime Grounding remains diagnostics/metadata-only and non-authoritative with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - This phase does not approve default-on behavior, runtime authority, prompt/model-message influence, provider ordering influence, memory promotion, fact acceptance, episode writes, raw retention, or unbounded rollout.
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
  - default-on behavior, silent rollout, unbounded cohort, missing production owner, missing rollback switch, or unsupported production-ready/default-on claim
  - runtime authority, completion authority, provider ordering authority, prompt authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - prompt/model-message/provider payload injection, provider ordering drift, provider default registration, runtime decision drift, TaskLoop cutover, Gateway/provider transport mutation, or comms path changes without comms replay/compare
  - raw prompt/trace/full payload/tool args/output/stdout/stderr/env/secret/API key/auth header/traceparent/tracestate/baggage retention, untrusted refs, transcripts, JSONL imports, persistence, database, sidecar, cache, exporter, listener, service, daemon, or server
  - UI/settings without full i18n and E2E coverage, renderer direct IPC/Gateway calls, patch apply, workspace edit, or symbol mutation
featureFlags:
  - Production opt-in must have an explicit owner-approved gate, cohort limit, budget limit, rollback switch, and privacy/support sign-off.
  - No default-on flag, runtime authority flag, provider ordering flag, prompt/model-message flag, persistence flag, UI setting, Gateway route, IPC route, host-api contract, or api-client contract is authorized by this spec.
rollback:
  - Disable controlled production opt-in, verify cohort count 0, verify default disabled parity, and record rollback time objective.
  - Remove any accepted aggregate presentation surface if it becomes unsafe; raw artifacts must not exist.
rejectedBoundaries:
  - default-on, runtime authority, provider ordering drift, runtime decision drift, prompt/model-message injection, raw/untrusted leakage, persistence, memory promotion, fact acceptance, episode write, UI mismatch, transport boundary violation, and rollback failure
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-cutover-readiness-review.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Phase E go recommendation, owner approval, cohort, production metrics, leak count 0, provider ordering/runtime decision diff 0, and rollback drill evidence are documented.
  - The synthesis may state controlled production opt-in runtime use only when this spec and synthesis are accepted and required verification passes.
  - Default-on and runtime authority remain explicitly rejected.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - Phase G default-on proposal may proceed only after this synthesis is accepted; it must remain proposal-only.
  Still forbidden:
    - default-on implementation, runtime authority, unbounded rollout, prompt/model-message/provider-ordering authority, raw/untrusted retention, persistence, memory promotion, fact acceptance, episode write, patch apply, workspace edit, and symbol mutation
---

# Line C Grounding Controlled Production Opt-in

Phase F defines the controlled production opt-in gate. It is not default-on approval and does not grant runtime authority.
