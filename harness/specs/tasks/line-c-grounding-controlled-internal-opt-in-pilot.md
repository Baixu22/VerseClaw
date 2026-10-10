---
lifecycleStatus: archived
id: line-c-grounding-controlled-internal-opt-in-pilot
title: Line C grounding controlled internal opt-in pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define Phase A as an internal explicit/default-off diagnostics pilot while preserving readonly, local, bounded, summary-only, diagnostics/metadata-only, and non-authoritative Line C Runtime Grounding boundaries.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md
  - runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-pilot/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md
  - runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-pilot/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default behavior remains unchanged when the internal pilot gate is absent or disabled.
  - Diagnostics metadata is produced only for a controlled internal cohort with explicit opt-in.
  - All emitted metadata keeps `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - The pilot does not create UI, public settings, runtime authority, provider ordering changes, prompt/model-message injection, persistence, or mutation surfaces.
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
  - default-on diagnostics, production-default enablement, or uncontrolled cohort expansion
  - runtime authority, completion authority, prompt authority, provider ordering authority, durable fact authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol mutation authority, or workspace mutation authority
  - Gateway, Main, renderer, host-api, api-client, provider transport, WebSocket, HTTP proxy, IPC, runtime send/receive, delivery, fallback, TaskLoop prompt/model-message, provider registration, provider ordering, provider selection, or runtime decision behavior changes
  - memory promotion, fact acceptance, episode write, memory store write, invalidation acceptance, persistence, database, sidecar, cache, exporter, listener, service, daemon, server, or telemetry upload
  - raw prompts, raw traces, full payloads, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, or untrusted refs in emitted diagnostics
  - AST patch apply, workspace edit, rename, replaceBody, insertBefore, insertAfter, safe delete, symbol edit apply, or mutating patch-planner behavior
featureFlags:
  - Any pilot gate must be internal, explicit, disabled by default, and reversible.
  - No public config, UI setting, Gateway route, IPC route, provider registration, provider ordering, or TaskLoop gate is authorized by this spec.
rollback:
  - Close the internal pilot gate and remove the controlled cohort allowlist.
  - Verify disabled output matches baseline and no persisted pilot artifact exists.
rejectedBoundaries:
  - default-on behavior, production default behavior, runtime authority, prompt/model-message injection, provider ordering changes, memory promotion, fact acceptance, episode writes, persistence, raw retention, untrusted refs, UI, settings, transport changes, patch apply, workspace edit, and symbol mutation
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Context and validation pass, or normal validation is blocked only by unrelated dirty worktree state and `--no-diff` passes.
  - Disabled parity, explicit-only activation, no raw/untrusted retention, `authority: "none"`, and rollback drill evidence are documented.
  - README review is complete; no README update is required unless user-visible behavior changes.
  - Comms replay/compare are run only if communication paths are touched; otherwise the synthesis records the skip reason.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - Phase B diagnostics presentation/operator readiness may proceed only after this synthesis is accepted.
  Still forbidden:
    - default-on, runtime authority, prompt/model-message/provider-ordering use, persistence, UI cutover, memory promotion, fact acceptance, episode write, raw retention, untrusted refs, patch apply, workspace edit, and symbol mutation
---

# Line C Grounding Controlled Internal Opt-in Pilot

Phase A is an internal explicit opt-in diagnostics pilot only. It does not approve production default behavior, runtime authority, prompt/model-message insertion, provider-ordering use, persistence, UI, or mutation.
