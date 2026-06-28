# <LANE_ID>: <LANE_TITLE>

## Scope Confirmation

- Lane:
- Output file:
- Lane-owned file only: yes/no
- Implementation paths touched:
- Test paths touched:
- Commands run:
- Required reading completed:

## Executive Summary

Write 5-10 bullets covering what landed, what stayed shadow-only/flagged, what legacy behavior was preserved, and what remains blocked.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
|  | file |  |  |  |

Allowed `Evidence Type` values:

- `file`
- `test`
- `command`
- `config`
- `missing-after-search`
- `handoff`

## Implementation Summary

Separate current code, tests, feature flags, and harness/spec changes.

## Verifier Contract Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  | shadow-only / pilot / flag-off |  |  |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion |  |  |  |
| tools.invoke |  |  |  |
| approval waiting/retry/error mapping |  |  |  |

## Taxonomy Audit

| Taxonomy Focus | Result | Evidence | Gap |
|---|---|---|---|
| Completed requires evidence refs | pass/fail/not-run |  |  |
| Tool/test failures become failed | pass/fail/not-run |  |  |
| Blocked requires external dependency | pass/fail/not-run |  |  |
| Missing evidence becomes insufficient_evidence | pass/fail/not-run |  |  |
| Cancelled remains distinct | pass/fail/not-run |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

If a required check was not run, keep the row and explain why in `Gap`.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on verifier gate | pass/fail/not-run |  |
| No second runtime service | pass/fail/not-run |  |
| No renderer direct IPC | pass/fail/not-run |  |
| No renderer direct Gateway HTTP/WS | pass/fail/not-run |  |
| No external test/lint/typecheck execution inside verifier runtime behavior | pass/fail/not-run |  |
| No LLM judge | pass/fail/not-run |  |
| Raw data retention ban | pass/fail/not-run |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` for missing evidence, failing required tests, active behavior change without flag/rollback, boundary violations, incomplete legacy parity, or verifier behavior that can execute side effects.

## Recommended Next Slice

```text
Slice:
New code path:
Legacy path wrapped:
Shadow / pilot boundary:
Feature flag:
Tests:
Harness:
Rollback:
Done when:
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
|  |  | user/maintainer/agent | yes/no |

## Handoff Notes

Include cross-lane concerns, migration caveats, and synthesis warnings.
