# Production Veto Gates

These vetoes block controlled internal opt-in and any later production advancement.

| Veto | Current Result | Evidence |
|---|---|---|
| production-ready/default-on/default cutover claim | pass | This package explicitly denies those approvals. |
| default prompt or reviewer prompt byte drift | pass | Phase A tests and TaskLoop tests preserve legacy bytes by default and on rollback. |
| candidate leakage into default prompt/model/Gateway/provider/checkpoint/lifecycle | pass | Phase A leakage proof and sentinel tests. |
| provider ordering drift | pass | Context provider registry tests and provider ordering proof. |
| AgentMap gains runtime authority | pass | Authority metadata and boundary proof keep all authority false/non-authoritative. |
| automatic discovery/build/cache/reuse AgentMapResult | pass | Explicit dependency/input only. |
| candidate/shadow/replay persistence | pass | Shadow report stores hash/counts only; candidate text persistence flags false. |
| renderer direct IPC/direct Gateway call | pass | Boundary scan required. |
| new service/listener/daemon/database/WebSocket/HTTP server | pass | Boundary scan required. |
| any gate closure cannot restore legacy parity | pass | Replay and rollback tests. |

No veto is currently known to fire. Final status depends on required validation.
