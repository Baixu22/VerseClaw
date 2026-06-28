# Phase 8 Lane A: Cutover Spec Boundary

## Scope Confirmation

- Lane: lane-a-cutover-spec-boundary
- Output file: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-a-cutover-spec-boundary.md
- Files reviewed: AGENTS.md; openclaw_runtime/AGENTS.md; runtime-research/agent-runtime-index.md; runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md; runtime-research/handoffs/phase-7-runtime-memory-provider/README.md; runtime-research/handoffs/phase-7-runtime-memory-provider/parallel-lanes.md; harness/specs/tasks/phase-7-runtime-memory-provider.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md; harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md; openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; openclaw_runtime/src/context-engine/provider-registry.ts; tests/unit/runtime-memory-*.test.ts; tests/unit/context-provider-registry.test.ts
- Files changed: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-a-cutover-spec-boundary.md
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Phase 8's existing README, parallel-lanes doc, and harness spec already draw the required cutover-readiness boundary. No runtime behavior or spec text was changed. Lane A accepts the boundary scaffold as stable for B/C/D work, while explicitly leaving persistence cutover, default-on memory behavior, durable unverified fact promotion, and provider-ordering cutover blocked pending later synthesis evidence.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase 8 starts from accepted Phase 7 and does not implement runtime behavior | file | runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md | Decision; Memory Surface Accepted; Rejected Boundary Audit | Phase 7 accepted only default-off local memory foundation. |
| Phase 8 harness spec forbids default-on memory, raw memory, unverified durable facts, provider-ordering cutover, services/exporters, and runtime authority | file | harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | lines 6, 48-54, 74-83 | The spec frames readiness only and lists forbidden patterns. |
| Phase 8 README repeats non-negotiable boundary | file | runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md | lines 29-42 | It rejects raw chat/trace memory, default-on behavior, services/exporters, and authority. |
| Lane scaffold requires path/function/test/command evidence | file | runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md | lines 7-19, 32 | Missing evidence or cutover without proof is needs_revision. |
| Feature flags remain default false | file/test | openclaw_runtime/src/runtime-core/memory-context.ts; tests/unit/runtime-memory-context-contracts.test.ts | memory-context.ts:129-133; test lines 110, 146-151 | runtime.memory.shadow/provider/proposeFacts/persist default false. |
| Durable facts require promotion evidence | file/test | openclaw_runtime/src/runtime-core/memory-context.ts; tests/unit/runtime-memory-context-contracts.test.ts | memory-context.ts:201-207, 570-583; test lines 197-236 | Candidate or promotion without evidence is rejected as durable fact. |
| Provider registration is optional and default ordering is unchanged without extras | file/test | openclaw_runtime/src/context-engine/provider-registry.ts; tests/unit/runtime-memory-context-provider.test.ts | provider-registry.ts:252-258; test lines 32-45 | Default registry is legacy + loop; memory only appears when explicitly passed. |
| Harness context and validation pass | command | rtk node harness/src/cli.mjs context/validate | pass | Phase 8 context, Phase 8 validate, and Phase 7 validate all passed. |
| Touched docs contain forbidden terms only as rejected boundary language | scan | rtk rg boundary scan over Phase 8 README, parallel-lanes, and task spec | reviewed matches at README lines 29-42; parallel-lanes lines 12-19, 32, 50-51, 71, 110; spec lines 48-54, 80-83 | No text accepts a forbidden cutover. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | openclaw_runtime/src/runtime-core/memory-context.ts:129-133; tests/unit/runtime-memory-context-contracts.test.ts:110, 146-151 | pass | Docs-only lane; no runtime path touched. |
| Raw chat/raw trace rejection | tests/unit/runtime-memory-context-contracts.test.ts:239-256; openclaw_runtime/src/runtime-core/memory-context.ts:710-742 | pass | Phase 8 carries forward Phase 7 sanitizer boundary. |
| No raw retention | rtk raw-retention scan over Phase 7 memory code/tests | pass | Production matches are sanitizer denylist/rejection classifier; test matches are negative fixtures. |
| No service/exporter/database/listener | focused service scan over Phase 7 memory production files | pass | No matches. |
| Source episode/evidence refs | openclaw_runtime/src/runtime-core/memory-context.ts:157-207; tests/unit/runtime-memory-context-contracts.test.ts:154-228 | pass | Required by contract and tested. |
| Durable promotion gate | openclaw_runtime/src/runtime-core/memory-context.ts:570-583; tests/unit/runtime-memory-context-contracts.test.ts:229-236 | pass | Candidate status or empty promotion evidence is not durable. |
| Current-valid query exclusion | openclaw_runtime/src/runtime-core/memory-context.ts:900, 1176-1195; tests/unit/runtime-memory-store.test.ts:239-329 | pass | Candidates/rejected/expired/unpromoted excluded by default. |
| Rollback proof | harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md:57-62 | pass | Disable memory flags and omit optional registration; no Lane A runtime changes. |
| Comms replay/compare if required | comms-regression rule; changed files list | not applicable | Lane A changed only a handoff submission, not comms paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Phase 8 spec lines 48 and feature flag defaults in memory-context.ts:129-133. |
| No raw chat-log/raw trace memory | pass | Phase 8 README lines 29-30 and sanitizer tests at runtime-memory-context-contracts.test.ts:239-256. |
| No unverified durable facts | pass | isRuntimeMemoryTemporalFact requires accepted status plus promotion evidence at memory-context.ts:570-583. |
| No persistence without rollback proof | pass | Phase 8 spec line 51 keeps persistence without proof forbidden; Lane A adds no persistence. |
| No provider-ordering cutover without parity proof | pass | Phase 8 spec line 52 and default registry evidence at provider-registry.ts:252-258. |
| No runtime authority | pass | Phase 8 spec line 53; provider manifest no-authority metadata in memory-context-provider.ts:77-84. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 context/read order | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 task spec | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md | pass | Phase 7 prerequisite spec | none |
| rtk rg boundary scan over Phase 8 README/parallel-lanes/spec | pass/reviewed | Forbidden boundary language in docs | Matches are explicit forbids, not acceptance. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| RTK was not on shell PATH as plain rtk | rtk --version failed through PATH; C:\Users\27933\.cherrystudio\bin\rtk.exe reports 0.30.1 | Use the full RTK path for command evidence in this thread. |
| The worktree contains many pre-existing modified/untracked files | git status shows broad dirty state outside Lane A | Do not revert unrelated work; confine Phase 8 edits to submissions. |

## Status

```text
Status: accepted
```
