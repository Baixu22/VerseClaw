---
id: phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review
title: Phase 5 Evidence Verifier Code Task Gate Internal Shadow Observation Evidence Review
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a fresh evidence-review package for the limited default-off internal shadow observation evidence produced by the code-task Evidence Verifier route, deciding only whether a later readiness-spec package may be written while preserving diagnostic-only, in-memory, non-authoritative behavior and keeping active pilot blocked.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, prompt/model-message, checkpoint, lifecycle, persistence, UI, product config, retry, approval, repair, or tool-policy behavior changes.
  - Evidence review consumes only bounded summaries and reports produced by the existing internal shadow observation package.
  - Evidence review output may recommend only blocked_before_internal_shadow_observation_review, continue_internal_shadow_observation_hardening, or ready_for_limited_default_off_readiness_spec.
  - ready_for_limited_default_off_readiness_spec permits only a later fresh readiness-spec package; it does not approve active pilot, default enablement, completion blocking, runtime cutover, product config, persistence, UI, transport changes, or prompt/model-message insertion.
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
  - active code-task completion gate, active pilot approved, ready_for_active_pilot, default-on verifier gate, default enablement, completion authority, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, public API, or user-visible runtime transport changes
  - persistence, database, cache, file writes from runtime helpers, transcript reads, log reads, workspace scans, services, listeners, daemons, local HTTP servers, second Gateway, second runtime, external database, collector, exporter, or sidecar behavior
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, tools, patch apply, workspace edits, message sends, or transport calls as part of evidence review behavior
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, risky_allow, or evidence-review output as task-completion evidence
featureFlags:
  - No runtime or product config flag is added by this task.
  - Existing TaskLoop shadow collection remains off by omission and disabled mode.
  - Existing internal observation remains explicit shadow_only and caller-owned in-memory only.
  - Any active pilot, enforcement, persistence, UI, product config, or default-on behavior requires a later fresh accepted spec.
rollback:
  - Reject this evidence-review package or any later readiness-spec entrance.
  - Stop consuming internal observation summaries for review.
  - No runtime rollback, schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md
  - rg -n "ready_for_active_pilot|active pilot approved|completionAuthority:\\s*true|default-on verifier gate|default enablement|reviewer prompt insertion|model-message insertion" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md
  - rg -n "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm|readFile|transcript|log|database|cache|service|listener|daemon|sidecar|exporter|collector" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.
acceptance:
  - This task creates only a fresh evidence-review spec, handoff package, and runtime index/handoff pointer updates unless a separate pure helper is explicitly justified.
  - Evidence review accepts only bounded internal observation outputs with nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, legacyDecisionUnaffected true, activePilotRequiresFreshSpec true, and no raw samples required for review.
  - Evidence review must not consume raw transcripts, raw logs, raw workspace scans, raw model prompts/messages, provider transport, Gateway/Main/renderer data, DB handles, files, sidecars, secrets, auth material, tool args/output, or replayed side effects.
  - The evidence-review package records source context, accepted evidence contract, decision matrix, validation results, boundary scan classifications, docs-sync decision, rollback route, and remaining boundaries.
  - Any missing validation, missing boundary scan, unclassified forbidden hit, authority drift, raw detail leak, active-pilot wording outside a hard-boundary denial, completion-proof wording drift, or incomplete rollback proof results in continue_internal_shadow_observation_hardening or blocked_before_internal_shadow_observation_review.
  - Output may contain only blocked_before_internal_shadow_observation_review, continue_internal_shadow_observation_hardening, or ready_for_limited_default_off_readiness_spec as the evidence-review decision.
  - ready_for_limited_default_off_readiness_spec allows only a later fresh readiness spec; it does not approve active pilot, completion authority, runtime cutover, default-on behavior, UI, persistence, product config, Gateway/Main/renderer/provider transport, prompt/model-message insertion, checkpoint/lifecycle authority, or task-completion proof from diagnostics.
  - README translations are reviewed; no README update is required unless user-visible product behavior changed.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 5 Evidence Verifier Code Task Gate Internal Shadow Observation Evidence Review

This task is the fresh review entry after limited default-off internal shadow observation. It is an evidence-review package only:

```text
bounded internal observation summaries
  -> docs/spec-only evidence review
  -> blocked / continue hardening / later readiness-spec entrance
```

It does not implement an active gate, completion authority, product feature, persistence layer, UI surface, prompt/model-message change, transport change, or default-on runtime behavior.
