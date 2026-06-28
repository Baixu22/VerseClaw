# Incident Veto Gates

| Gate | Required Value |
|---|---:|
| default-on enabled by this task | no |
| default cutover approved by this task | no |
| production-ready declared by this task | no |
| default runtime behavior changed | no |
| default reviewer prompt byte drift | 0 |
| leakage_count | 0 |
| provider_ordering_drift | 0 |
| candidate persistence | 0 |
| fail-closed invalid/missing/gated-off cases | 100 percent |
| rollback drill | 100 percent |
| new service/listener/database/server | 0 |
| renderer direct IPC/Gateway | 0 |
| authority escalation | 0 |
| scorecard | >= 95 |

Any hard veto prevents `ready_for_default_on_implementation_spec`.
