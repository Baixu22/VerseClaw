# Production Veto Gates

Any item in this file is a one-vote rejection. If one fires, production expansion stops.

| Veto Gate | Rejection Result |
|---|---|
| Candidate text leaks into default prompts/model messages/Gateway/provider transport | stop; revert to default-off diagnostics-only |
| Provider ordering changes | stop; restore provider ordering before retry |
| Default TaskLoop reviewer prompt byte drift | stop; restore byte parity |
| Default runtime behavior drift | stop; restore legacy behavior |
| Any gate closure cannot restore legacy parity | stop; fix rollback before retry |
| Automatic discovery/build/cache/reuse of AgentMapResult | stop; remove automatic path |
| Candidate/replay output persisted | stop; remove persistence and define cleanup if anything was written |
| New service/listener/daemon/database/WebSocket/HTTP server | stop; remove new service surface |
| AgentMap gains runtime/tool/security/approval/retry/completion authority | stop; remove authority path |
| AgentMap gains provider/model/Gateway authority | stop; remove authority path |
| Pilot described as production-ready/default-on/default cutover | stop; correct docs and synthesis |
| Renderer direct IPC or direct Gateway HTTP/WebSocket is added | stop; route through existing host-api/api-client boundaries only if a later approved spec requires it |
| Mutation/apply/edit surface is added | stop; remove mutating surface |

## Required Veto Scan Evidence

Each phase must include evidence for:

- default prompt/model/Gateway/provider leakage scan;
- provider ordering snapshot;
- default reviewer prompt byte parity;
- rollback by each gate;
- persistence scan;
- service/listener/database/WebSocket/HTTP scan;
- authority scan;
- wording scan for production-ready/default-on/default cutover claims.

## Current Veto Status

No veto gate fired for this readiness-plan phase. This is a plan acceptance only and does not approve production enablement.
