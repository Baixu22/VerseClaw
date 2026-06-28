# Phase 6 Synthesis: Trace Context Provider

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
|  | reviewed / missing / needs_revision |  |

## Accepted / Needs Revision Lanes

| Lane | Status | Reason |
|---|---|---|
| lane-a-contracts-and-harness | accepted / needs_revision / blocked |  |
| lane-b-local-span-store-query | accepted / needs_revision / blocked |  |
| lane-c-propagation-recording-shadow | accepted / needs_revision / blocked |  |
| lane-d-context-provider-summary | accepted / needs_revision / blocked |  |
| lane-e-validation-docs-synthesis-readiness | accepted / needs_revision / blocked |  |

## Trace Surface Added

| Surface | Evidence | Accepted Boundary |
|---|---|---|
|  |  |  |

## Accepted Boundary

| Boundary | Evidence | Status |
|---|---|---|
| Canonical span contract is bounded and sanitized |  | pass/fail |
| Local span store/query is bounded and local-only |  | pass/fail/not-applicable |
| Recording/propagation remains default-off shadow |  | pass/fail/not-applicable |
| RuntimeTraceContextProvider is readonly and budgeted |  | pass/fail/not-applicable |
| Validation/docs/synthesis evidence is complete |  | pass/fail |

## Rejected Boundary Audit

| Rejected Surface | Evidence | Result |
|---|---|---|
| Default-on trace recording/provider/export/provider-ordering cutover |  | pass/fail |
| External telemetry, OTLP, collector, observability platform, database, service, listener, or second Gateway/runtime |  | pass/fail |
| Full trace dump to prompt/UI |  | pass/fail |
| Raw prompt/full payload/full checkpoint/full tool args/output/env/secrets/unbounded output retention |  | pass/fail |
| Trace-derived completion, verifier, security, retry, or runtime authority |  | pass/fail |
| Trusted external traceparent/tracestate/baggage |  | pass/fail |

## Legacy Paths Wrapped

| Legacy Path | Trace Adapter | Feature Flag | Parity Evidence |
|---|---|---|---|
|  |  |  |  |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No default-on trace recording/provider/export | pass/fail |
| Runtime trace code inside allowed paths | pass/fail |
| Legacy behavior unchanged with flags off | pass/fail |
| No observability platform/collector/exporter/database | pass/fail |
| No raw prompt/full payload/full trace dump retention | pass/fail |
| External traceparent sanitized/re-rooted/marked untrusted | pass/fail |
| Trace provider remains readonly/non-gating | pass/fail |
| Renderer direct IPC / Gateway HTTP bypass | pass/fail |
| UI changes have E2E | pass/fail/not applicable |

## Feature Flags

| Flag | Default | Evidence | Rollback |
|---|---|---|---|
|  |  |  |  |

## Test Evidence Matrix

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
|  |  |  |  |

## Trace Query / Summary Evidence

| Requirement | Evidence | Status |
|---|---|---|
| Parent/child spans queryable |  | pass/fail |
| Linked resume/evidence spans queryable |  | pass/fail |
| Error spans rank first |  | pass/fail |
| Summary respects token budget |  | pass/fail |
| Source refs connect to evidence refs without replacing verifier evidence |  | pass/fail |
| External traceparent is sanitized or re-rooted |  | pass/fail |

## Contract / Naming Conflicts

| Conflict | Evidence | Required Resolution |
|---|---|---|
|  |  |  |

## Ready For Next Phase?

Yes / No.

Explain why.

## Phase 7 Entry Criteria

Runtime Memory Provider may start only if all rows are `pass`:

| Criterion | Evidence | Status |
|---|---|---|
| Trace spans are local, sanitized, bounded, and queryable |  | pass/fail |
| Trace summaries are budgeted context items, not raw dumps |  | pass/fail |
| Source refs link to evidence refs without replacing verifier evidence |  | pass/fail |
| External trace context is not trusted as local truth |  | pass/fail |
| Trace facts are not treated as durable memory facts unless verified |  | pass/fail |
| Fresh Phase 7 spec exists or is explicitly required before Runtime Memory Provider work |  | pass/fail |

## Required Fixes Before Next Phase

1.

## agent-runtime-index.md Updates To Apply

```text
Trace Context Provider:
  code:
  tests:
  status:
```
