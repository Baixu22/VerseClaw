# Quality Scorecard MVP

Accepted-for-controlled-internal-opt-in threshold: 90/100 with no veto gates.

| Category | Score | Evidence | Gap |
|---|---:|---|---|
| Phase A evidence integration | 10/10 | Phase A replay proof accepted at 100/100 and integrated into this package. | None. |
| Cutover readiness review completeness | 14/15 | Hard gates, veto gates, scope, and non-approval language are documented. | Needs continued live validation on dirty worktrees. |
| Real traffic shadow MVP | 13/15 | Existing TaskLoop runtime shadow path is default-off, explicit, diagnostics-only, in-memory, and tested. | Broader internal sampling policy remains future operator process, not product automation. |
| Controlled internal opt-in plan | 10/10 | Entry gates, explicit invocation, valid result requirement, and rollback conditions are defined. | None. |
| Scorecard rigor | 14/15 | Scores identify evidence sources and gaps instead of granting full credit for absence of failures. | Real-world sample size is still limited to accepted replay/focused tests. |
| Security/authority boundary proof | 15/15 | Existing metadata, tests, and scans prove no runtime/tool/security/approval/retry/completion/provider/model/Gateway authority. | None. |
| Observability diagnostics MVP | 9/10 | Existing diagnostic codes and Phase B field mapping cover inserted/blocked/fail-closed/budget/prompt-present/invalid/gate/invocation states. | Future telemetry aggregation remains plan-only. |
| Rollback/veto/limited production/default-on planning | 10/10 | Rollback playbook, veto gates, limited production plan, and default-on template are documented as future-only where applicable. | None. |
| Total | 95/100 | Meets accepted-for-controlled-internal-opt-in threshold if validation passes and no veto fires. | Controlled internal opt-in remains internal and default-off. |

## Decision Rule

- 90-100: `Status: accepted_for_controlled_internal_opt_in`
- 80-89: `Status: needs_follow_up`
- 70-79: `Status: pilot_only`
- below 70: `Status: needs_revision`
