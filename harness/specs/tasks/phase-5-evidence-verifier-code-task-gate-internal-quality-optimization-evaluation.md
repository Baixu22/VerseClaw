---
lifecycleStatus: archived
id: phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation
title: Phase 5 Evidence Verifier Code Task Gate Internal Quality Optimization Evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a bounded internal optimization and quantitative evaluation slice for the Evidence Verifier code-task gate shadow route, using only caller-supplied in-memory synthetic/sanitized fixtures and diagnostic reports, without active enforcement, completion authority, persistence, product config, UI, transport, prompt/model-message, checkpoint/lifecycle, or TaskLoop terminal-state changes.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, prompt/model-message, checkpoint, lifecycle, persistence, UI, product config, retry, approval, repair, or tool-policy behavior changes.
  - The optimization helper consumes only caller-supplied in-memory evaluation, runtime replay readiness, internal observation, and optional fixture-matrix summaries.
  - The optimization helper returns a bounded capabilityAssessment with threshold snapshots, metric margins, shortfall codes, and remediation targets for diagnostic review only.
  - The optimization helper may recommend only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Any ready decision is readiness-review only; it does not approve active enforcement, default enablement, completion blocking, runtime cutover, product config, persistence, UI, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
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
  - active code-task completion gate, active pilot approved, active enforcement approved, default-on verifier gate, default enablement, completion authority, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, public API, or user-visible runtime transport changes
  - persistence, database, cache, file writes from runtime helpers, transcript reads, log reads, workspace scans, services, listeners, daemons, local HTTP servers, second Gateway, second runtime, external database, collector, exporter, or sidecar behavior
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, tools, patch apply, workspace edits, message sends, or transport calls from runtime helper behavior
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, risky_allow, quality output, optimization output, or readiness output as task-completion evidence
featureFlags:
  - No runtime or product config flag is added by this task.
  - Existing TaskLoop shadow collection remains off by omission and disabled mode.
  - The optimization helper is explicit-call only and has no default runtime invocation.
  - Any active enforcement, persistence, UI, product config, default-on behavior, or completion authority requires a later fresh accepted spec with stronger runtime shadow evidence.
rollback:
  - Stop calling the new pure optimization report helper.
  - Remove the helper/tests/docs without touching TaskLoop completion authority.
  - No runtime rollback, schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/task-loop-controller.test.ts docs/dev/runtime-research-boundaries.md
  - active-authority and active-pilot-readiness-string scans on touched route files
  - transport scans on touched route files
  - persistence/service/command scans on touched runtime/helper/docs files
acceptance:
  - The helper is pure, deterministic, explicit-call only, and consumes only caller-supplied in-memory reports and fixture summaries.
  - The helper output keeps nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, legacyDecisionUnaffected true, and activePilotRequiresFreshSpec true.
  - The helper output sets diagnosticOnly true, callerOwnedInMemoryOnly true, and taskCompletionEvidence false.
  - The helper output includes capabilityAssessment.passed, threshold snapshots, metric margins, shortfall codes, remediation targets, and category coverage without adding authority.
  - The helper output may recommend only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Missing evaluation, runtime replay, or observation input routes to continued hardening, not readiness review.
  - Authority drift, blocked runtime replay, or stop/freeze observation input routes to stop_or_freeze_route.
  - Incomplete synthetic/sanitized fixture-matrix coverage routes to continued hardening even when the quality strategy is otherwise ready.
  - Evaluation sample count below threshold, evaluated candidate count below threshold, or missing block precision / false-block rate / false-allow rate routes to continued hardening.
  - Block precision below the conservative runtime replay threshold, false-block rate above threshold, or false-allow rate above threshold routes to continued hardening even when fixture-matrix coverage is complete.
  - An optimized synthetic/sanitized capability matrix with at least 50 samples, all required categories, false-block cause coverage 1, risky false-allow share at least 0.6, block precision at least 0.8, false-block rate at most 0.2, false-allow rate at most 0.25, and authority parity preserved may reach readiness-review output only.
  - Passing optimization output does not approve active pilot, default enablement, completion blocking, TaskLoop/Mission terminal-state changes, persistence, UI, product config, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Internal Quality Optimization Evaluation

This slice implements a bounded internal evaluation loop:

```text
existing caller-supplied in-memory evaluation/replay/observation reports
  -> pure optimization scorecard
  -> readiness review / continued hardening / route freeze
```

It does not implement active enforcement, completion authority, product config, persistence, UI, transport, prompt/model-message insertion, checkpoint/lifecycle authority, or default-on runtime behavior.
