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

Write 5-10 bullets covering what landed, what stayed default-off/shadow-only/readonly/proposal-only, what legacy behavior was preserved, and what remains blocked.

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
| Raw chat-log rejection |  | pass/fail/not-run |  |
| Raw trace-dump rejection |  | pass/fail/not-run |  |
| Raw-retention scan |  | pass/fail/not-run |  |
| Source episode/evidence refs present |  | pass/fail/not-run |  |
| Durable fact promotion requires verifier/human/deterministic-rule evidence |  | pass/fail/not-run/not-applicable |  |
| valid_at / invalid_at / expired_at / reference_time behavior |  | pass/fail/not-run/not-applicable |  |
| Idempotent duplicate episode handling |  | pass/fail/not-run/not-applicable |  |
| Current-valid query excludes invalid/rejected/unverified facts |  | pass/fail/not-run/not-applicable |  |
| Token-budget summary behavior |  | pass/fail/not-run/not-applicable |  |
| Touched-file service/exporter scan |  | pass/fail/not-run |  |
| Renderer IPC/Gateway bypass scan |  | pass/fail/not-run |  |
| Comms replay/compare if Main/Gateway paths changed |  | pass/fail/not-run/not-applicable |  |

## Implementation Summary

Separate current code, tests, feature flags, harness/spec changes, and docs/index changes.

## Memory Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly / Proposal Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
|  |  | contract-only / shadow-only / readonly / proposal-only |  |  |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion |  |  |  |
| tools.invoke |  |  |  |
| approval waiting/retry/error mapping |  |  |  |
| event-log/checkpoint/resume |  |  |  |
| Evidence Verifier |  |  |  |
| Trace Context Provider |  |  |  |
| Provider ordering |  |  |  |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw chat-log/transcript memory | pass/fail/not-run |  |  |
| No raw trace-dump memory | pass/fail/not-run |  |  |
| No raw prompts/full payload persistence | pass/fail/not-run |  |  |
| No full memory dump exposed by default | pass/fail/not-run |  |  |
| Automatic/LLM extraction remains proposal-only | pass/fail/not-run/not-applicable |  |  |
| Durable facts require verifier/human/deterministic evidence | pass/fail/not-run/not-applicable |  |  |
| Token-budgeted summaries | pass/fail/not-run/not-applicable |  |  |
| Source refs do not replace verifier evidence | pass/fail/not-run |  |  |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
|  |  | pass/fail/not-run |  |  |

If a required check was not run, keep the row and explain why in `Gap`.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass/fail/not-run |  |
| No raw chat-log/raw trace memory | pass/fail/not-run |  |
| No observability platform/collector/exporter/database service | pass/fail/not-run |  |
| No second runtime service/listener/Gateway/Temporal | pass/fail/not-run |  |
| No renderer direct IPC | pass/fail/not-run |  |
| No renderer direct Gateway HTTP/WS | pass/fail/not-run |  |
| No runtime authority/completion gate/security/retry/tool policy from memory provider | pass/fail/not-run |  |
| Comms replay/compare when Main/Gateway paths changed | pass/fail/not-run/not-applicable |  |
| UI changes have E2E and i18n | pass/fail/not-run/not-applicable |  |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
|  |  |  |  |

## Status

Choose exactly one:

```text
Status: accepted | needs_revision | blocked
```

Use `needs_revision` for missing evidence, failing required tests, active behavior change without flag/rollback, boundary violations, incomplete legacy parity, raw memory retention, unverified durable fact promotion, or memory behavior that can execute side effects.

Use `accepted` only when the lane materially satisfies its scope and the required evidence matrix has no unexplained failing or not-run rows.

## Recommended Next Slice

```text
Slice:
New code path:
Legacy path wrapped:
Shadow / readonly / proposal boundary:
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

