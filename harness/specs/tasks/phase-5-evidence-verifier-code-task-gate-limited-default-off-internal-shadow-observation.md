---
id: phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation
title: Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Internal Shadow Observation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Accumulate a bounded internal evidence package from the existing controlled default-off TaskLoop code-task shadow collection seam, using only explicit shadow_only mode plus caller-owned in-memory sinks and existing replay/readiness helpers, without adding active gate behavior, completion authority, persistence, UI/product config, prompt insertion, transport changes, or runtime decision changes.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/task-loop-controller.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/task-loop-controller.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - Omitted mode and explicit disabled mode do not call collection, producer, caller, sampler, sink, or observation helpers and do not require valid samples.
  - Explicit shadow_only mode may collect TaskLoop-adjacent diagnostics only through an injected caller-owned in-memory sink.
  - Observation consumes only caller-supplied in-memory CodeTaskEvidenceGateRuntimeShadowCollectionResult values and existing replay/readiness output.
  - Observation output is bounded to counts, diagnostic codes, replay/readiness decisions, and one internal review decision.
  - All observation output remains diagnostic-only, non-authoritative, and unable to change TaskLoop or Mission terminal status.
  - Collection output, producer output, caller results, sampler events, EvidenceVerifierReport, would_allow, would_block, and risky_allow remain diagnostics only and are never task-completion evidence.
  - Active pilot remains blocked and fresh-spec-only; this slice may not produce ready_for_active_pilot or recommend default enablement.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - default-on verifier completion gate, active code-task completion gate, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or user-visible runtime transport changes
  - persistence, database, cache, file writes, transcript reads, log reads, workspace scans, services, listeners, daemons, local HTTP servers, second Gateway, second runtime, or external database behavior from the runtime helper/wiring
  - executing lint, typecheck, tests, shell commands, diagnostics, or workspace scans from the runtime helper/wiring
  - patch apply, workspace edit, symbol mutation, prompt/model-message mutation, runtime status mutation, checkpoint/lifecycle mutation, retry/approval/repair semantic changes, or provider transport changes
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, or risky_allow as task-completion evidence
featureFlags:
  - No product/runtime feature flag is added in this slice.
  - The existing TaskLoop seam remains off by omission and by explicit disabled mode.
  - The only enabled behavior allowed in this slice is explicit shadow_only diagnostic collection through injected in-memory sinks.
  - Any active pilot, enforcement, persistence, UI, or default-on behavior requires a later fresh accepted spec.
rollback:
  - Stop supplying shadow_only mode or the injected sink; default TaskLoop behavior remains unchanged.
  - Remove the pure observation helper/tests/docs without touching completion authority.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm|readFile|transcript|log" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts openclaw_runtime/src/agents/task-loop-controller.ts
acceptance:
  - Fresh spec validates and states that active pilot remains blocked and fresh-spec-only.
  - Disabled/default TaskLoop paths do not call builder, sink, producer, caller, sampler, or observation helpers.
  - Explicit shadow_only TaskLoop runs can collect multiple in-memory collection results through an injected sink while TaskLoop still returns complete.
  - A pure observation helper, if added, consumes only caller-supplied in-memory collection results and does not read runtime, files, logs, transcripts, configuration, workspace, or global state.
  - Observation output contains only bounded counts, diagnostic codes, replay/readiness signals, non-authority fields, and one of ready_for_limited_default_off_internal_shadow_observation_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Observation output keeps nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, and legacyDecisionUnaffected true.
  - Checkpoint and lifecycle JSON do not contain the code-task collection marker.
  - Invalid explicit collection input fails closed but does not alter TaskLoop completion.
  - Builder or sink exceptions do not affect TaskLoop terminal result.
  - Focused tests cover valid completion, missing evidence / would_block, semantic-risk / risky_allow, invalid explicit input, disabled/default no-op, and sink/builder failure isolation.
  - Boundary scans show no new forbidden transport, persistence, prompt/model-message, service/listener, command-execution, or active-authority patterns in touched runtime helper/wiring files.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Internal Shadow Observation

This slice may accumulate internal observation evidence from the existing controlled TaskLoop collection seam:

```text
explicit shadow_only TaskLoop run
  -> injected caller-owned in-memory collection sink
  -> caller-supplied CodeTaskEvidenceGateRuntimeShadowCollectionResult values
  -> existing replay/readiness helper output
  -> bounded non-authoritative internal observation decision
```

It is not an active gate, completion authority, product feature, persistence layer, UI surface, prompt/model-message change, transport change, or default-on runtime behavior.
