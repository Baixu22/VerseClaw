# Submission Template

## Status

Status: needs_revision

Change to `Status: accepted` only after required validation passes, scorecard is at least 95, and no veto gate fires.

## Summary

- Production readiness plan:
- Replay Proof plan:
- Cutover Readiness plan:
- Controlled Internal Opt-in plan:
- Limited Production Opt-in plan:
- Default-on proposal prerequisites:

## Prerequisite Check

| Prerequisite | Result | Evidence |
|---|---|---|
| Deep validation synthesis accepted |  |  |
| Deep validation score >= 95 |  |  |
| Runtime index records deep validation marker |  |  |
| Phase 8/9/10/11/12 accepted |  |  |
| AgentMap default-off |  |  |
| Explicit pilot only enters named surface |  |  |

## Veto Gates

| Gate | Result | Evidence |
|---|---|---|
| Candidate leakage |  |  |
| Provider ordering drift |  |  |
| Default reviewer prompt drift |  |  |
| Default runtime behavior drift |  |  |
| Rollback parity |  |  |
| Automatic discovery/cache/reuse |  |  |
| Persistence |  |  |
| New service/listener/database |  |  |
| Authority escalation |  |  |
| Production-ready/default-on wording |  |  |

## Scorecard

| Category | Score |
|---|---:|
| Replay coverage |  |
| Default behavior parity |  |
| Boundary/no authority |  |
| Fail-closed and rollback |  |
| Diagnostics/operator readiness |  |
| Controlled opt-in safety |  |
| Maintainability/auditability |  |
| Total |  |

## Validation

| Command/Scan | Result |
|---|---|
| harness context |  |
| harness validate |  |
| focused Vitest suite |  |
| typecheck |  |
| boundary scans |  |
| comms replay/compare |  |

## Decision

- Production-ready:
- Default-on allowed:
- Recommend Replay Proof:
- Remaining phases:
