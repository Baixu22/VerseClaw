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

Write 5-10 bullets covering what landed, what stayed readonly/default-off, what behavior was preserved, and what remains blocked.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
|  | file |  |  |  |

Allowed `Evidence Type` values: `file`, `test`, `command`, `config`, `missing-after-search`, `handoff`.

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  |  |  |  |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch apply or file write | pass/fail/not-run |  |
| No symbol mutation or workspace edit | pass/fail/not-run |  |
| No TaskLoop/Gateway/Main/renderer integration | pass/fail/not-run |  |
| No service/listener/daemon | pass/fail/not-run |  |
| Invalid/overbroad/overlap/drift fails closed | pass/fail/not-run |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

## Recommended Next Slice

```text
Slice:
New code path:
Readonly boundary:
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
