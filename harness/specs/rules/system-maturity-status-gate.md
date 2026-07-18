---
id: system-maturity-status-gate
title: System maturity status gate
type: ai-coding-rule
---

`STATUS.json` is an evidence projection, not a progress opinion. A task may be changed to `done`
only after development is present on the committed tree, focused tests exit 0, acceptance checks
exit 0, evidence paths and hashes validate, and the recorded commit is reachable from the current
integration HEAD. `todo`, `in_progress`, and `blocked` must remain unchanged when any gate is missing.

Every gated task must have a delivery record with explicit `IMPLEMENTATION`, `TESTS`, `ACCEPTANCE`,
`EVIDENCE`, `RESULTS`, `COMMIT`, and `VALIDATED_AT` fields. A green unit test with a failing Electron
or integration acceptance test is not a completed task. Historical delivery text cannot be reused as
fresh proof without rerunning the declared commands.
