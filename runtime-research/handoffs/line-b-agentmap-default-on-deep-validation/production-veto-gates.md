# Production Veto Gates

| Gate | Required value |
|---|---:|
| leakage_count | 0 |
| provider_ordering_drift | 0 |
| default reviewer prompt byte drift | 0 |
| fail-closed invalid/missing/gated-off cases | 100 percent |
| rollback drill | 100 percent |
| candidate persistence | 0 |
| new service/listener/database/server | 0 |
| renderer direct IPC/Gateway | 0 |
| authority escalation | 0 |
| default-on enabled by this task | no |
| default cutover approved by this task | no |

Any hard veto forces `Status: blocked` or `Status: needs_follow_up`; it cannot be promoted to proposal-ready.
