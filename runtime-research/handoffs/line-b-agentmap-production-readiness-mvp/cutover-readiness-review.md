# Cutover Readiness Review MVP

This review covers readiness for controlled internal opt-in only. It does not approve production readiness, default-on behavior, or default cutover.

## Phase A Evidence Integrated

| Evidence | Result |
|---|---|
| Phase A Replay Proof synthesis | accepted, 100/100 |
| Replay corpus | 28/28 required cases passed |
| Default reviewer prompt parity | passed for flags off, partial gates, non-invocation, missing/invalid result, rollback, and realistic TaskLoop replays |
| Leakage proof | passed for candidate sentinel, lifecycle payloads, checkpoint payloads, model/Gateway/provider boundaries |
| Provider ordering proof | passed; default registry order unchanged |
| Rollback proof | passed; closing any gate restores legacy bytes and needs no cleanup |

## Controlled Internal Opt-in Hard Gates

| Gate | Required Result |
|---|---|
| AgentMap default-off | pass |
| Default runtime behavior unchanged | pass |
| Default TaskLoop reviewer prompt byte-identical | pass |
| Any gate closed restores legacy parity | pass |
| `explicitInvocation=false` restores legacy parity | pass |
| Missing/invalid `AgentMapResult` fails closed | pass |
| Candidate text only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` | pass |
| Candidate text excluded from default prompt/model/Gateway/provider/checkpoint/lifecycle payloads | pass |
| No candidate/shadow/replay persistence | pass |
| Provider ordering unchanged | pass |
| No renderer direct IPC/direct Gateway | pass |
| No new service/listener/daemon/database/WebSocket/HTTP server | pass |
| No automatic AgentMapResult discovery/build/cache/reuse | pass |
| No runtime/tool/security/approval/retry/completion/provider/model/Gateway authority | pass |

## Veto Gates

Any veto in `production-veto-gates.md` blocks controlled internal opt-in. Current readiness is contingent on validation proving no veto fires.

## Decision Shape

Controlled internal opt-in can be recommended only when required validation passes, all hard gates pass, no veto fires, and the total score is at least 90/100.
