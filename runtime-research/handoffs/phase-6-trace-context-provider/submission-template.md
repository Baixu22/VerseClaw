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

Write 5-10 bullets covering what landed, what stayed default-off/shadow-only, what legacy behavior was preserved, and what remains blocked.

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

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Path/function evidence for changed surfaces |  | pass/fail/not-run |  |
| Flag-off legacy parity |  | pass/fail/not-run |  |
| Sanitization/redaction coverage |  | pass/fail/not-run |  |
| Raw-retention scan |  | pass/fail/not-run |  |
| External traceparent/tracestate/baggage handling |  | pass/fail/not-run/not-applicable |  |
| Token-budget summary behavior |  | pass/fail/not-run/not-applicable |  |
| Source refs remain separate from verifier evidence |  | pass/fail/not-run |  |
| Touched-file service/exporter scan |  | pass/fail/not-run |  |
| Renderer IPC/Gateway bypass scan |  | pass/fail/not-run |  |
| Comms replay/compare if Main/Gateway paths changed |  | pass/fail/not-run/not-applicable |  |

## Implementation Summary

Separate current code, tests, feature flags, harness/spec changes, and docs/index changes.

## Trace Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  | contract-only / shadow-only / readonly |  |  |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion |  |  |  |
| tools.invoke |  |  |  |
| approval waiting/retry/error mapping |  |  |  |
| event-log/checkpoint/resume |  |  |  |
| Evidence Verifier |  |  |  |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw prompts/full payload persistence | pass/fail/not-run |  |  |
| No full trace dump exposed by default | pass/fail/not-run |  |  |
| External traceparent sanitized/re-rooted/marked untrusted | pass/fail/not-run |  |  |
| Token-budgeted summaries | pass/fail/not-run |  |  |
| Source refs do not replace verifier evidence | pass/fail/not-run |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

If a required check was not run, keep the row and explain why in `Gap`.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on trace recording/provider/export | pass/fail/not-run |  |
| No observability platform/collector/exporter/database | pass/fail/not-run |  |
| No second runtime service/listener/Gateway/Temporal | pass/fail/not-run |  |
| No renderer direct IPC | pass/fail/not-run |  |
| No renderer direct Gateway HTTP/WS | pass/fail/not-run |  |
| No runtime authority/completion gate/security policy from trace provider | pass/fail/not-run |  |
| Comms replay/compare when Main/Gateway paths changed | pass/fail/not-run/not-applicable |  |
| UI changes have E2E | pass/fail/not-run/not-applicable |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` for missing evidence, failing required tests, active behavior change without flag/rollback, boundary violations, incomplete legacy parity, raw trace retention, untrusted trace propagation, or trace behavior that can execute side effects.

Use `accepted` only when the lane materially satisfies its scope and the required evidence matrix has no unexplained failing or not-run rows.

## Recommended Next Slice

```text
Slice:
New code path:
Legacy path wrapped:
Shadow / readonly boundary:
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

## Phase 7 Notes

State whether this lane creates any durable memory input. Phase 6 lanes must not promote trace facts into Runtime Memory Provider facts; any such behavior requires a fresh Phase 7 task spec with raw chat-log memory forbidden and evidence-backed temporal facts required.
