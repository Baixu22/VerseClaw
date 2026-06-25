# <LANE_ID>: <LANE_TITLE>

## Scope Confirmation

- Lane:
- Output file:
- Lane-owned file only: yes/no
- Files/directories searched:
- Commands run:
- Prior handoffs reviewed:

## Executive Summary

Write 5-10 bullets summarizing what this lane found, what is shadow-only, what is blocked, and what must not be treated as accepted runtime behavior yet.

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

Evidence rules:

- Every material claim needs a matching evidence row.
- File evidence must name the path and the symbol, function, type, or line reference when practical.
- Command evidence must include the exact command and result summary.
- Missing evidence must include the exact search command.
- Handoff evidence can support process history, but it cannot prove current code behavior by itself.

## Current State

Describe the current repository state for this lane. Separate current code, current tests, current harness specs, and existing handoff notes.

If nothing exists for this lane, write `none found with current evidence` and cite the search commands in the evidence table.

## Shadow Contract Or Adapter Shape

Describe the proposed or existing Phase 2 shape without changing active behavior.

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  | shadow-only/warning-only/none |  |  |

## Legacy Behavior Preservation

Explain how old behavior remains unchanged or why parity is not yet proven.

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
|  |  |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

If a required check was not run, keep the row and explain why in `Gap`.

## Design Conflicts

Record conflicts between current implementation, this lane, and the runtime-core target design. If none were found, write `none found with current evidence`.

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` when the lane is incomplete, misplaced, under-evidenced, changes active runtime behavior, lacks legacy parity evidence, touches another lane's files, or conflicts with the Phase 2 rules.

Use `blocked` only when the lane cannot proceed because required upstream contracts, decisions, or files are absent. Include blocker evidence in the evidence table.

## Recommended Next Slice

Define exactly one smallest follow-up slice for this lane.

```text
Slice:
New code path:
Legacy path wrapped:
Shadow / warning boundary:
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

Any details the synthesis owner must not miss. Include cross-lane concerns here instead of editing another lane's file.
