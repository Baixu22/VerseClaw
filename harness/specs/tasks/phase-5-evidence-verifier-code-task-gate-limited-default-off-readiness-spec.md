---
id: phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec
title: Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Readiness Spec
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a fresh docs/spec-only readiness package after internal shadow observation evidence review, deciding only whether the limited default-off readiness route is ready for review while preserving diagnostic-only, caller-owned in-memory, non-authoritative behavior and keeping active enforcement blocked.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, prompt/model-message, checkpoint, lifecycle, persistence, UI, product config, retry, approval, repair, or tool-policy behavior changes.
  - Readiness input is limited to prior Phase 5 specs, handoff docs, validation records, boundary scan classifications, and bounded internal observation/evidence-review decisions.
  - Readiness output may recommend only stop_or_freeze_route, continue_internal_shadow_observation_hardening, or ready_for_limited_default_off_readiness_review.
  - The ready decision permits only review of this limited default-off readiness package; it does not approve active enforcement, default enablement, completion blocking, runtime cutover, product config, persistence, UI, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
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
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, tools, patch apply, workspace edits, message sends, or transport calls as part of readiness behavior
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, risky_allow, evidence-review output, or readiness output as task-completion evidence
featureFlags:
  - No runtime or product config flag is added by this task.
  - Existing TaskLoop shadow collection remains off by omission and disabled mode.
  - Existing internal observation remains explicit shadow_only and caller-owned in-memory only.
  - Any active enforcement, persistence, UI, product config, default-on behavior, or completion authority requires a later fresh accepted spec with stronger runtime shadow evidence.
rollback:
  - Reject this readiness package or decline the readiness-review entrance.
  - Keep the prior evidence-review decision as the last accepted Phase 5 state.
  - Stop using internal observation/evidence-review summaries as readiness input.
  - No runtime rollback, schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "active pilot approved|active enforcement approved|completionAuthority:\\s*true|default-on verifier gate|default enablement|reviewer prompt insertion|model-message insertion" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm|readFile|transcript|log|database|cache|service|listener|daemon|sidecar|exporter|collector" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.
acceptance:
  - This task creates only a fresh limited default-off readiness spec, handoff package, and runtime index/handoff pointer updates.
  - Readiness accepts only prior docs/spec/handoff decisions, validation records, and boundary scan classifications produced by the internal shadow observation and evidence-review route.
  - Readiness input must preserve nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, legacyDecisionUnaffected true, and activePilotRequiresFreshSpec true.
  - Readiness must not consume raw transcripts, raw logs, raw workspace scans, raw model prompts/messages, provider transport, Gateway/Main/renderer data, DB handles, files, sidecars, secrets, auth material, tool args/output, raw samples, or replayed side effects.
  - Any missing validation, missing boundary scan, unclassified forbidden hit, authority drift, raw detail leak, active-enforcement wording outside a hard-boundary denial, completion-proof wording drift, or incomplete rollback proof results in continue_internal_shadow_observation_hardening or stop_or_freeze_route.
  - Output may contain only stop_or_freeze_route, continue_internal_shadow_observation_hardening, or ready_for_limited_default_off_readiness_review as the readiness decision.
  - ready_for_limited_default_off_readiness_review allows only review of this limited default-off readiness package; it does not approve active enforcement, completion authority, runtime cutover, default-on behavior, UI, persistence, product config, Gateway/Main/renderer/provider transport, prompt/model-message insertion, checkpoint/lifecycle authority, or task-completion proof from diagnostics.
  - README translations are reviewed; no README update is required unless user-visible product behavior changed.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Readiness Spec

This task is the fresh readiness package after internal shadow observation evidence review. It is docs/spec-only:

```text
accepted internal shadow observation evidence review
  -> limited default-off readiness package
  -> readiness review / continued hardening / route freeze
```

It does not implement an active gate, completion authority, product feature, persistence layer, UI surface, prompt/model-message change, transport change, or default-on runtime behavior.

## Priority Work Arrangement

P1 fresh readiness package:
- Create this spec as the next fresh entry after `ready_for_limited_default_off_readiness_spec`.
- Preserve the prior authority boundary: diagnostic-only, caller-owned in-memory, non-authoritative, and default-off.
- Validate the new spec and focused runtime helper tests without editing runtime code.

P2 readiness matrix:
- Review only prior Phase 5 specs, handoff decisions, validation results, boundary scan classifications, and the bounded evidence-review decision.
- Do not use collection output, observation output, replay/readiness output, EvidenceVerifierReport, sampler events, would_allow, would_block, risky_allow, evidence-review output, or readiness output as task-completion evidence.
- Keep active enforcement blocked until a later fresh spec has stronger runtime shadow evidence and explicitly accepted low-risk boundaries.

P3 docs and index closure:
- Add a readiness handoff README with source context, accepted input contract, decision matrix, validation results, boundary scan classifications, docs-sync decision, rollback route, and remaining boundaries.
- Update the Phase 5 shadow MVP handoff, the evidence-review handoff, and the runtime index only as route pointers.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; update them only if user-visible behavior changed.

P4 boundary scans:
- Run focused harness context/validate, focused Vitest, `git diff --check`, forbidden transport scan, and forbidden persistence/service/command scan on touched route files.
- Classify documentation-only hits separately from implementation hits.
- Treat any touched runtime/helper implementation hit for transport, persistence, service/listener, prompt/model-message insertion, command execution, active authority, or completion authority as blocking.

P5 entry tightening:
- Treat `ready_for_limited_default_off_readiness_review` as the only forward entry for this package.
- Treat `continue_internal_shadow_observation_hardening` as the only investment entry when evidence quality, validation, or boundary classification is incomplete.
- Treat `stop_or_freeze_route` as the required decision for authority drift, raw-detail pressure, false-block risk that cannot be reduced without forbidden inputs, or any implementation pressure toward active enforcement.
- Do not create a new implementation, active pilot, UI/product config, persistence, transport, prompt/model-message, checkpoint/lifecycle, or completion-authority entry from this package.

P6 shadow evidence investment:
- Improve evidence quality only through synthetic/offline corpora, bounded caller-owned in-memory samples, existing focused unit fixtures, and validation/boundary classifications.
- Preserve false-block and false-allow split visibility instead of collapsing uncertainty into a broad insufficient-evidence bucket.
- Track semantic-risk false allows, missing-capture false blocks, local-test-not-required false blocks, and report-shape problems as separate diagnostic categories.
- Keep every evidence artifact diagnostic-only; no EvidenceVerifierReport, sampler event, would_allow, would_block, risky_allow, observation result, readiness output, or deep-test result may become task-completion proof.

P7 deep test gate:
- Use the deeper focused unit set for Evidence Verifier and TaskLoop seam validation.
- Do not run a service, listener, daemon, Gateway, Electron app, provider transport, workspace sampler, transcript reader, log reader, DB reader, or persistence-backed collector for this route.
- Classify any deep-test failure as either route-relevant or unrelated dirty-worktree noise before changing code.
- Passing the deep test may support only readiness review or continued hardening; it never approves active enforcement.

## Readiness Decision States

The readiness decision may recommend only:

- `stop_or_freeze_route`
- `continue_internal_shadow_observation_hardening`
- `ready_for_limited_default_off_readiness_review`

The ready state means only that this limited default-off readiness package is ready for review. It does not approve active enforcement, default enablement, runtime cutover, completion blocking, product config, persistence, UI, transport changes, prompt/model-message insertion, or completion proof from diagnostics.

## Readiness Matrix

| Evidence condition | Readiness decision |
|---|---|
| Missing predecessor evidence-review package, missing accepted authority fields, or contradictory prior decision | `stop_or_freeze_route` |
| Any output grants completion authority, changes runtime decision, changes legacy decision, omits active-pilot fresh-spec requirement, or approves active enforcement | `stop_or_freeze_route` |
| Any readiness input reads files, logs, transcripts, workspace, configuration, global state, DB handles, Gateway/Main/renderer/provider transport, prompts, or model messages | `stop_or_freeze_route` |
| Any UI, product config, persistence, service/listener/daemon, transport, checkpoint/lifecycle authority, prompt/model-message insertion, or default-on behavior is added | `stop_or_freeze_route` |
| Required evidence exists but validation or boundary scan classification is incomplete | `continue_internal_shadow_observation_hardening` |
| Fresh spec/docs/index are complete, validation passes, scans are classified, README translations require no user-visible update, and all authority fields remain non-authoritative | `ready_for_limited_default_off_readiness_review` |

## Entry Tightening Strategy

The route is now intentionally narrow:

```text
readiness package
  -> ready_for_limited_default_off_readiness_review
  -> continue_internal_shadow_observation_hardening
  -> stop_or_freeze_route
```

No other entry is available from this package. The readiness-review entry is documentation and validation review only. The hardening entry may invest in shadow evidence quality only under the same default-off, diagnostic-only, caller-owned in-memory, non-authoritative constraints. The freeze entry is mandatory if the route needs forbidden inputs or authority to improve.

## Shadow Evidence Investment Rules

Allowed investment:

- bounded offline corpus review and synthetic fixtures;
- focused unit tests for sampler, producer, collection, observation, replay/readiness, and TaskLoop no-op/failure-isolation behavior;
- boundary scan automation and scan-hit classification;
- richer diagnostic taxonomy for false blocks, false allows, risky allows, report-shape issues, and missing-capture issues;
- docs-only decision matrices, rollback proof, and validation records.

Blocked investment:

- raw transcript/log/workspace sampling;
- DB/cache/persistence/sidecar storage;
- service/listener/daemon/Gateway/provider transport collection;
- UI/product config;
- prompt/model-message/reviewer prompt insertion;
- checkpoint/lifecycle authority;
- default-on behavior;
- active completion gate or completion authority.

## Explicit Non-Goals

This task does not add runtime code, tests, runtime config, product config, database objects, sidecar files, collector/exporter behavior, service/listener/daemon behavior, Gateway routes, Electron IPC channels, renderer UI, host-api/api-client methods, shared contracts, provider transport, TaskLoop decision/status paths, prompt/model-message paths, retry/approval/tool policy paths, checkpoint/lifecycle authority, or replay side-effect paths.

This task does not treat diagnostics, verifier reports, sampler events, replay/readiness output, observation output, evidence-review output, readiness output, or the next review recommendation as completion proof.
