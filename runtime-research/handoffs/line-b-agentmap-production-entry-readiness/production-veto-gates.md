# Production Veto Gates

Any veto below blocks limited production opt-in and sets synthesis to `Status: blocked`.

| Veto | Current result | Evidence |
|---|---|---|
| Production default-on/default cutover approved | pass | This package forbids default-on/default cutover. |
| Default prompt or reviewer prompt byte drift | pass | Fail-closed branches return legacy reviewer prompt bytes. |
| Candidate leaks to default prompt/model/Gateway/provider/checkpoint/lifecycle | pass | Sentinel tests and boundary docs. |
| Provider ordering drift | pass | Context provider registry tests preserve default order. |
| AgentMap gains runtime authority | pass | Authority metadata remains false/no-authority. |
| Automatic discovery/build/cache/reuse AgentMapResult | pass | Runtime requires explicit caller-supplied result. |
| Candidate/shadow/replay persistence | pass | No persistence introduced; shadow hashes text. |
| Renderer direct IPC/direct Gateway call | pass | Required scan. |
| New service/listener/daemon/database/WebSocket/HTTP server | pass | Required scan. |
| Any gate closure cannot restore legacy parity | pass | Rollback drill. |
| Rollback drill failure | pass | 8/8 drill cases pass. |
| Internal sample leakage_count > 0 | pass | leakage_count is 0. |
| provider_ordering_drift > 0 | pass | drift is 0. |
| fail-closed rate < 100 percent for invalid/missing/gated-off cases | pass | fail-closed rate is 100 percent. |
| Required validation missing without blocked reason | pass | Required validation is recorded in `synthesis.md` with live dirty-tree noise separated from clean overlay proof; status is `accepted_for_limited_production_opt_in`. |
