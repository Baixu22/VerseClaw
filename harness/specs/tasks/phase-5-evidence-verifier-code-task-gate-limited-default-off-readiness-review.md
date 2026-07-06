---
id: phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review
title: Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Readiness Review
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the Evidence Verifier code-task gate route at the component-readiness review level after quantitative capability optimization, deciding only whether the default-off diagnostic component is ready for limited readiness review while preserving non-authoritative behavior and keeping active enforcement blocked.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, prompt/model-message, checkpoint, lifecycle, persistence, UI, product config, retry, approval, repair, or tool-policy behavior changes.
  - Readiness review consumes only prior specs, handoffs, validation records, boundary scan classifications, and bounded synthetic/sanitized in-memory capability metrics.
  - Readiness review may recommend only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Any ready decision is component-readiness review only; it does not approve active enforcement, default enablement, completion blocking, runtime cutover, product config, persistence, UI, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
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
  - active code-task completion gate, active pilot approved, active enforcement approved, ready_for_active_pilot, default-on verifier gate, default enablement, completion authority, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, public API, or user-visible runtime transport changes
  - persistence, database, cache, file writes from runtime helpers, transcript reads, log reads, workspace scans, services, listeners, daemons, local HTTP servers, second Gateway, second runtime, external database, collector, exporter, or sidecar behavior
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, tools, patch apply, workspace edits, message sends, or transport calls as part of readiness-review behavior
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, risky_allow, quality output, optimization output, capabilityAssessment, readiness review output, or readiness output as task-completion evidence
featureFlags:
  - No runtime or product config flag is added by this task.
  - Existing TaskLoop shadow collection remains off by omission and disabled mode.
  - Existing optimization and capability helpers remain explicit-call only and have no default runtime invocation.
  - Any active enforcement, persistence, UI, product config, default-on behavior, or completion authority requires a later fresh accepted spec with stronger runtime shadow evidence.
rollback:
  - Reject this readiness-review package or decline the component-readiness conclusion.
  - Keep the internal quality optimization/evaluation package as the last accepted Phase 5 state.
  - Stop using capabilityAssessment summaries as readiness-review input.
  - No runtime rollback, schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review/README.md runtime-research/agent-runtime-index.md
  - active-authority and active-pilot-readiness-string scans on touched route files
  - transport scans on touched route files
  - persistence/service/command scans on touched route files
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.
acceptance:
  - This task creates only a fresh limited default-off readiness-review spec, handoff package, and runtime index pointer.
  - The readiness review accepts only prior default-off diagnostic component evidence: specs, handoffs, validation records, boundary scan classifications, and synthetic/sanitized in-memory capability metrics.
  - The readiness review records the optimized capability metrics: at least 50 samples, at least 16 evaluated candidates, block precision at least 0.8, false-block rate at most 0.2, false-allow rate at most 0.25, false-block cause coverage 1, risky false-allow share at least 0.6, full required fixture coverage, and preserved authority parity.
  - The readiness review records fail-closed behavior for weak matrices, undersized matrices, missing metrics, incomplete fixture coverage, missing inputs, and authority drift.
  - The readiness review preserves nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, legacyDecisionUnaffected true, activePilotRequiresFreshSpec true, diagnosticOnly true, callerOwnedInMemoryOnly true, and taskCompletionEvidence false.
  - The readiness review must not consume raw transcripts, raw logs, raw workspace scans, raw model prompts/messages, provider transport, Gateway/Main/renderer data, DB handles, files, sidecars, secrets, auth material, tool args/output, raw samples, or replayed side effects.
  - Output may contain only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route as the route decision.
  - ready_for_limited_default_off_readiness_review allows only component-readiness review of this limited default-off package; it does not approve active enforcement, completion authority, runtime cutover, default-on behavior, UI, persistence, product config, Gateway/Main/renderer/provider transport, prompt/model-message insertion, checkpoint/lifecycle authority, or task-completion proof from diagnostics.
  - README translations are reviewed; no README update is required unless user-visible product behavior changed.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-review/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Readiness Review

This task is the fresh readiness-review closure after internal quality optimization and quantitative capability evaluation:

```text
internal quality optimization/evaluation
  -> limited default-off readiness review
  -> component-readiness review / continued hardening / route freeze
```

It does not implement an active gate, completion authority, product feature, persistence layer, UI surface, prompt/model-message change, transport change, or default-on runtime behavior.
