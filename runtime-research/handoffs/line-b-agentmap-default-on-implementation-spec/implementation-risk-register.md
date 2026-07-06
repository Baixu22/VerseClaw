# Implementation Risk Register

Status: accepted.

| Risk | Severity | Mitigation | Current result |
|---|---:|---|---|
| Default-on enablement slips into spec work | High | Task spec and synthesis explicitly forbid enablement. | pass |
| Default cutover is implied by implementation spec acceptance | High | Separate future cutover task is required. | pass |
| Raw candidate text leaks through telemetry | High | Telemetry allows counters, booleans, hashes, lengths, and bounded diagnostics only. | pass |
| Provider ordering changes when AgentMap is considered for default-on | High | Provider ordering proof pins default manifests and forbids default AgentMap provider registration. | pass |
| Candidate output is persisted for replay or dashboarding | High | Persistence proof forbids persistence and future telemetry is no-persistence-by-default. | pass |
| Runtime authority expands through TaskLoop or checkpoint metadata | High | Authority proof forbids runtime/tool/security/provider/model/Gateway/checkpoint/lifecycle authority. | pass |
| Operator cannot roll back quickly | Medium | Rollback runbook closes any AgentMap gate and requires byte parity. | pass |
| Live dirty tree blocks harness validate | Medium | Provide clean overlay proof and separate unrelated dirty-tree noise. | tracked |
| Docs/i18n mismatch | Low | No user-facing behavior or strings; README and locale updates not required. | pass |

No risk blocks implementation-spec acceptance. Future execution must re-open this register and update current results after code changes.
