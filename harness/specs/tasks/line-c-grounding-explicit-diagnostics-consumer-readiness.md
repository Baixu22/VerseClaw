---
id: line-c-grounding-explicit-diagnostics-consumer-readiness
title: Line C grounding explicit diagnostics consumer readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the narrow next-step readiness gate for one future explicit diagnostics-only consumer of Line C grounding metadata, after broad formal runtime use was marked needs_revision.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md
  - runtime-research/handoffs/line-c-grounding-explicit-diagnostics-consumer-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md
  - runtime-research/handoffs/line-c-grounding-explicit-diagnostics-consumer-readiness/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - This task may define a future explicit diagnostics-only consumer readiness gate.
  - It must not implement the consumer, wire any runtime integration, or approve broader formal runtime use.
  - Existing accepted default-on grounding helper behavior remains unchanged: diagnostics-only, metadata-only, summary-only, local, bounded, non-authoritative, and rollbackable.
  - Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Any later consumer must be explicit by callsite, explicit by consumer id, read-only, local-only, non-persistent, non-transport, and unable to affect prompt/model-message/provider/Gateway/TaskLoop/runtime decisions.
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
allowedSurface:
  - Spec and handoff documentation for a future single explicit diagnostics-only consumer.
  - Readiness criteria, veto gates, validation matrix, rollback expectations, and proof requirements for that future consumer.
  - Existing runtime-core `createGroundingShadowConsumerSummary` default-on diagnostics-only metadata helper for valid sanitized refs.
forbiddenPatterns:
  - runtime code implementation, consumer implementation, default consumer registration, provider registration, provider ordering or selection changes, prompt/model-message insertion, Gateway request insertion, TaskLoop integration, runtime decision integration, completion/tool/security/approval/retry authority, or any formal runtime-use cutover
  - runtime authority, prompt authority, model-message authority, provider ordering authority, provider selection authority, Gateway authority, TaskLoop authority, runtime decision authority, completion authority, tool authority, security authority, approval authority, retry authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - raw prompt, raw trace, full payload, full event payload, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, raw retention, untrusted refs, includeRaw true, or includeUntrusted true
  - persistence, cache, database, sidecar, service, listener, exporter, daemon, server, memory promotion, fact acceptance, episode write, memory store write, fact store write, patch apply, workspace edit, symbol mutation, UI setting, public API, renderer IPC, host-api/api-client contract, Gateway route, or provider transport mutation
featureFlags:
  - No new runtime flag is authorized by this readiness task.
  - A later implementation spec must require explicit callsite invocation and explicit consumer id if a consumer is ever implemented.
  - Existing rollback remains `enabled: false` or `killSwitch: true`.
readinessGates:
  - Gate 1: scope is exactly one explicit diagnostics-only consumer surface.
  - Gate 2: consumer output remains metadata-only and summary-only with required markers.
  - Gate 3: byte-identical prompt/model-message/Gateway payload proof passes.
  - Gate 4: provider ordering/selection and TaskLoop/runtime decision drift are zero.
  - Gate 5: raw/untrusted retention, persistence/cache/service/listener/exporter, memory writes, patch/workspace/symbol mutation are all absent.
  - Gate 6: rollback to `enabled: false` or `killSwitch: true` returns disabled/default-off parity.
rollback:
  - Retain current diagnostics-only metadata helper boundary.
  - Reject or revise any later consumer spec that cannot pass all readiness gates.
  - If any forbidden boundary is required, verdict must be `needs_revision`.
rejectedBoundaries:
  - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and production rollout beyond diagnostics metadata
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md --no-diff
  - git diff --check -- harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md docs/dev/runtime-research-boundaries.md
  - rg boundary scan for runtime authority/prompt/model-message/provider ordering/provider selection/Gateway request/TaskLoop/runtime decision/completion/tool/security/approval/retry/raw retention/includeRaw/includeUntrusted/untrusted refs/persistence/cache/service/listener/exporter/database/sidecar/memory promotion/fact acceptance/episode write/patch apply/workspace edit/symbol mutation
acceptance:
  - Fresh narrow readiness spec exists and validates structurally.
  - The handoff defines readiness gates for exactly one future explicit diagnostics-only consumer.
  - The handoff states that no consumer implementation, runtime integration, formal runtime-use cutover, UI/API/transport change, or authority expansion is approved.
  - The synthesis may be accepted only as spec/readiness documentation, not as runtime implementation approval.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - A later implementation proposal may target one explicit diagnostics-only consumer only after this readiness package is accepted and must still start from a fresh accepted task spec.
  Still forbidden:
    - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and production rollout beyond diagnostics metadata
---

# Line C Grounding Explicit Diagnostics Consumer Readiness

This is a narrow readiness package for one future explicit diagnostics-only consumer. It is not an implementation spec and does not approve formal runtime use.
