---
id: line-c-grounding-single-explicit-diagnostics-consumer-implementation
title: Line C grounding single explicit diagnostics-only consumer implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement exactly one runtime-core local explicit diagnostics-only consumer for accepted sanitized Line C grounding diagnostics metadata summaries, without approving broad formal runtime use or any prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts
  - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts
  - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Existing accepted default-on diagnostics-only metadata helper remains unchanged.
  - Exactly one explicit diagnostics-only consumer may be implemented with consumer id `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer`.
  - The consumer is invoked only by directly calling the exported runtime-core helper with the explicit consumer id.
  - The helper consumes only an already sanitized `GroundingShadowConsumerSummary` or an equivalent sanitized metadata-only summary produced inside the same runtime-core boundary.
  - Output remains local, bounded, metadata-only, summary-only, diagnostics-only, read-only, and non-authoritative.
  - Output markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - `enabled: false` and `killSwitch: true` both return disabled/default-off parity.
  - Invalid, missing, wrong-consumer, raw, untrusted, or non-summary input fails closed.
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
  - Runtime-core local helper code in `grounding-shadow-consumers.ts`.
  - Exporting that helper through existing runtime-core barrel exports only.
  - Focused unit tests for explicit invocation, explicit consumer id, bounded diagnostics-only output, rollback, fail-closed behavior, and forbidden-boundary leakage.
  - Handoff, synthesis, and runtime index updates for this implementation package.
  - Existing sanitized `GroundingShadowConsumerSummary` metadata and items may be copied into a bounded diagnostics report after re-sanitization.
consumer:
  id: line-c.grounding.singleExplicitDiagnosticsOnlyConsumer
  invocation: explicit-callsite-only
  input: sanitized-grounding-diagnostics-metadata-summary-only
  output: bounded-diagnostics-metadata-report-only
  authority: none
  rawRetained: false
  includeRaw: false
  includeUntrusted: false
forbiddenPatterns:
  - broad formal runtime use, default consumer registration, provider registration, provider ordering changes, provider selection changes, prompt insertion, model-message insertion, Gateway request insertion, TaskLoop integration, runtime decision integration, completion authority, tool authority, security authority, approval authority, retry authority, or any formal runtime-use cutover
  - runtime authority, prompt authority, model-message authority, provider ordering authority, provider selection authority, Gateway authority, TaskLoop authority, runtime decision authority, completion authority, tool authority, security authority, approval authority, retry authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - raw prompt, raw trace, full payload, full event payload, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, raw retention, untrusted refs, includeRaw true, or includeUntrusted true
  - persistence, cache, database, sidecar, service, listener, exporter, daemon, server, memory promotion, fact acceptance, episode write, memory store write, fact store write, patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, UI setting, public API, renderer IPC, host-api/api-client contract, Gateway route, provider transport mutation, production rollout, or hidden default-on expansion
featureFlags:
  - No new config flag, public setting, API switch, UI switch, or production rollout flag is authorized.
  - Helper-local `enabled` and `killSwitch` options are allowed only as rollback controls.
rollback:
  - `enabled: false` returns disabled/default-off parity with zero items and zero accepted input.
  - `killSwitch: true` returns disabled/default-off parity with zero items and zero accepted input.
  - Missing input, invalid input, wrong consumer id, invalid summary markers, raw inclusion attempts, or untrusted inclusion attempts fail closed.
rejectedBoundaries:
  - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, provider ordering/selection influence, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion/fact acceptance/episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and hidden default-on expansion
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/README.md runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/implementation-synthesis.md runtime-research/agent-runtime-index.md
  - rg boundary scan for prompt/model-message/provider ordering/provider selection/Gateway request/TaskLoop/runtime decision/completion/tool/security/approval/retry/raw retention/includeRaw/includeUntrusted/untrusted refs/persistence/cache/service/listener/exporter/database/sidecar/memory promotion/fact acceptance/episode write/patch apply/workspace edit/symbol mutation/UI/API/transport/production rollout over touched files
acceptance:
  - Fresh implementation spec exists and validates before implementation.
  - Implementation adds exactly one explicit diagnostics-only consumer id: `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer`.
  - Consumer id is required and wrong or missing ids fail closed.
  - Invocation is explicit by callsite; no automatic registration, TaskLoop hook, provider registration, Gateway route, UI/API, transport, or public setting is added.
  - Valid sanitized summary input returns bounded diagnostics-only output with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - `enabled: false` and `killSwitch: true` both return disabled/default-off parity.
  - Invalid/missing input fails closed.
  - Tests prove no prompt/model-message/provider-ordering/provider-selection/Gateway/runtime-decision/raw/untrusted/persistence/memory/mutation leakage.
  - Final synthesis status is `needs_revision` if implementation requires any forbidden boundary.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/README.md
    - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-implementation/implementation-synthesis.md
    - runtime-research/agent-runtime-index.md
nextPhaseEntry:
  Allowed after acceptance:
    - The single explicit diagnostics-only consumer may be used only by explicit runtime-core callsites that pass the fixed consumer id and sanitized summary input.
  Still forbidden:
    - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion/fact acceptance/episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and hidden default-on expansion
---

# Line C Grounding Single Explicit Diagnostics-only Consumer Implementation

This task authorizes one minimal runtime-core helper for the fixed explicit diagnostics-only consumer id only. It does not authorize broad formal runtime use.
