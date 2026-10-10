---
lifecycleStatus: archived
id: line-c-grounding-limited-production-opt-in-diagnostics-only
title: Line C grounding limited production opt-in diagnostics-only
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define Phase C as a small production opt-in diagnostics-only stage with owner, cohort, sampling, budget, privacy, and rollback gates while preserving non-authoritative boundaries.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md
  - runtime-research/handoffs/line-c-grounding-limited-production-opt-in-diagnostics-only/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md
  - runtime-research/handoffs/line-c-grounding-limited-production-opt-in-diagnostics-only/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - A limited production cohort may explicitly opt in only to diagnostics metadata collection or review that remains default-off and diagnostics-only.
  - The opt-in has a named production owner, cohort boundary, sampling ceiling, budget ceiling, privacy review, and rollback owner.
  - Diagnostics do not affect prompt assembly, model messages, provider order, provider selection, runtime decisions, memory promotion, fact acceptance, episode writes, or persistence.
  - Output continues to require `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
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
  - production default rollout, default-on activation, unbounded production sampling, missing owner, missing budget, or missing rollback switch
  - prompt/model-message/provider payload injection, provider ordering or default registration drift, runtime decision influence, TaskLoop authority, Gateway authority, completion authority, or tool/security/approval/retry authority
  - raw prompt, raw trace, full payload, tool args/output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, or untrusted refs
  - memory promotion, fact acceptance, episode write, memory store write, invalidation acceptance, persistence, database, sidecar, cache, exporter, listener, service, daemon, or server
  - renderer direct IPC/Gateway calls, transport switching, UI/settings without locale/E2E coverage, patch apply, workspace edit, or symbol mutation
featureFlags:
  - Production opt-in must be explicit, owner-approved, bounded, and reversible.
  - No public default, provider registration, provider ordering, prompt/model-message, runtime decision, persistence, UI, Gateway, IPC, host-api, or api-client change is authorized here.
rollback:
  - Disable the production opt-in gate, remove cohort sampling, and verify disabled/default behavior parity.
  - Clean only safe aggregate artifacts if a later accepted spec explicitly allowed them; no raw or untrusted artifacts may exist.
rejectedBoundaries:
  - default-on, prompt/model-message influence, provider ordering drift, runtime authority, memory writes, persistence, raw/untrusted leakage, budget breach, transport boundary violations, UI mismatch, and rollback failure
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Production owner, cohort, sampling ceiling, budget ceiling, privacy review, metrics, and rollback gates are documented.
  - No prompt/model/provider/runtime decision impact is accepted.
  - Performance/token regression budgets and leak-count targets are recorded.
  - README review and comms replay/compare decision are recorded.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - Phase D runtime shadow replay proof may proceed only after this synthesis is accepted.
  Still forbidden:
    - default-on, runtime authority, provider ordering drift, prompt/model-message injection, raw/untrusted retention, persistence, memory promotion, fact acceptance, episode write, UI mismatch, patch apply, workspace edit, and symbol mutation
---

# Line C Grounding Limited Production Opt-in Diagnostics-only

Phase C defines a narrow production opt-in diagnostics-only stage. It does not approve default-on, runtime authority, prompt/model-message use, provider-ordering use, or persistence.
