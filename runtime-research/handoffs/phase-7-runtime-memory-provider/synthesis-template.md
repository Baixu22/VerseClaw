# Phase 7 Synthesis: Runtime Memory Provider

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
|  | reviewed / missing / needs_revision |  |

## Accepted / Needs Revision Lanes

| Lane | Status | Reason |
|---|---|---|
| lane-a-contracts-and-harness | accepted / needs_revision / blocked |  |
| lane-b-local-episode-fact-store-query | accepted / needs_revision / blocked |  |
| lane-c-fact-proposal-invalidation-shadow | accepted / needs_revision / blocked |  |
| lane-d-memory-context-provider-summary | accepted / needs_revision / blocked |  |
| lane-e-validation-docs-synthesis-readiness | accepted / needs_revision / blocked |  |

## Memory Surface Added

| Surface | Evidence | Accepted Boundary |
|---|---|---|
|  |  |  |

## Accepted Boundary

| Boundary | Evidence | Status |
|---|---|---|
| Episode contract is bounded and sanitized |  | pass/fail |
| Temporal fact contract carries valid_at / invalid_at / source evidence |  | pass/fail |
| Local store/query is bounded, local-only, and idempotent |  | pass/fail/not-applicable |
| Fact proposal/promotion remains default-off and proposal-only unless verified |  | pass/fail/not-applicable |
| RuntimeMemoryProvider is readonly and budgeted |  | pass/fail/not-applicable |
| Validation/docs/synthesis evidence is complete |  | pass/fail |

## Rejected Boundary Audit

| Rejected Surface | Evidence | Result |
|---|---|---|
| Raw chat-log/transcript memory |  | pass/fail |
| Raw trace-dump memory or trace facts promoted without verification |  | pass/fail |
| Default-on memory recording/provider/persistence/extraction/promotion/provider-ordering cutover |  | pass/fail |
| Full memory dump to prompt/UI |  | pass/fail |
| Raw prompt/full payload/full checkpoint/full tool args/output/env/secrets/unbounded output retention |  | pass/fail |
| LLM-extracted durable facts without verifier/human/deterministic evidence |  | pass/fail |
| External telemetry, OTLP, collector, observability platform, graph database service, listener, or second Gateway/runtime |  | pass/fail |
| Memory-derived completion, verifier, security, retry, tool permission, or runtime authority |  | pass/fail |

## Legacy Paths Wrapped

| Legacy Path | Memory Adapter | Feature Flag | Parity Evidence |
|---|---|---|---|
|  |  |  |  |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass/fail |
| Runtime memory code inside allowed paths | pass/fail |
| Legacy behavior unchanged with flags off | pass/fail |
| No raw chat-log/raw trace memory | pass/fail |
| No observability platform/collector/exporter/database service | pass/fail |
| No raw prompt/full payload/full memory dump retention | pass/fail |
| Automatic extraction remains proposal-only | pass/fail |
| Memory provider remains readonly/non-gating | pass/fail |
| Renderer direct IPC / Gateway HTTP bypass | pass/fail |
| UI changes have E2E/i18n | pass/fail/not applicable |

## Feature Flags

| Flag | Default | Evidence | Rollback |
|---|---|---|---|
|  |  |  |  |

## Test Evidence Matrix

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
|  |  |  |  |

## Temporal Memory Evidence

| Requirement | Evidence | Status |
|---|---|---|
| Duplicate episode writes are idempotent |  | pass/fail |
| Current-valid query excludes invalidated/expired/rejected/unverified facts |  | pass/fail |
| Historical query returns facts valid at requested time |  | pass/fail |
| Conflicting facts create invalidation/proposal records |  | pass/fail |
| Durable facts cite source episode/evidence refs |  | pass/fail |
| Source refs do not replace verifier evidence |  | pass/fail |
| Summary respects token budget |  | pass/fail |

## Contract / Naming Conflicts

| Conflict | Evidence | Required Resolution |
|---|---|---|
|  |  |  |

## Ready For Next Phase?

Yes / No.

Explain why.

## Future Cutover Criteria

Provider-ordering, persistence, or default-on memory behavior may start only if all rows are `pass`:

| Criterion | Evidence | Status |
|---|---|---|
| Memory facts are evidence-backed and not raw chat/trace text |  | pass/fail |
| Unverified extraction remains proposal-only |  | pass/fail |
| Local store is bounded, redacted, idempotent, and rollback-ready |  | pass/fail |
| Current-valid and historical queries handle invalidation correctly |  | pass/fail |
| Memory provider output is budgeted context, not raw dumps |  | pass/fail |
| Fresh cutover spec exists or is explicitly required before default-on behavior |  | pass/fail |

## Required Fixes Before Next Phase

1.

## agent-runtime-index.md Updates To Apply

```text
Runtime Memory Provider:
  code:
  tests:
  status:
```

