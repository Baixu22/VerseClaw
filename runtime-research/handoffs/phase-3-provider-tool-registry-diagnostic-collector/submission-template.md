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

Write 5-10 bullets covering what landed, what stayed shadow-only/default-off, what legacy behavior was preserved, and what remains blocked.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
|  | file |  |  |  |

Allowed `Evidence Type` values: `file`, `test`, `command`, `config`, `missing-after-search`, `handoff`.

## Collector Surface

| Surface | Contract / Adapter | Shadow Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  |  |  |  |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
|  |  |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No provider ordering/default registration cutover | pass/fail/not-run |  |
| No tool response/approval semantic drift | pass/fail/not-run |  |
| No TaskLoop authority drift | pass/fail/not-run |  |
| No renderer direct IPC/Gateway bypass | pass/fail/not-run |  |
| No second runtime service/listener | pass/fail/not-run |  |
| Comms replay/compare handled if required | pass/fail/not-run |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` for missing evidence, failing required tests, active behavior change without flag/rollback, boundary violations, or incomplete legacy parity.

## Recommended Next Slice

```text
Slice:
New code path:
Legacy path wrapped:
Shadow boundary:
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
