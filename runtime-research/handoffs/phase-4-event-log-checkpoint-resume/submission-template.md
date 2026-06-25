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

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  | shadow-only / pilot / flag-off |  |  |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
|  |  |  |  |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass/fail/not-run |  |  |
| Completed tool results reused by idempotency key | pass/fail/not-run |  |  |
| Missing tool result returns waiting/verifying diagnostic | pass/fail/not-run |  |  |
| Schema/version marker handled | pass/fail/not-run |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

If a required check was not run, keep the row and explain why in `Gap`.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass/fail/not-run |  |
| No renderer direct IPC | pass/fail/not-run |  |
| No renderer direct Gateway HTTP/WS | pass/fail/not-run |  |
| Feature flags default safe | pass/fail/not-run |  |
| Flag-off parity covered | pass/fail/not-run |  |
| Resume does not execute side effects | pass/fail/not-run |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` for missing evidence, failing required tests, active behavior change without flag/rollback, boundary violations, incomplete legacy parity, or resume/replay that can execute side effects.

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

