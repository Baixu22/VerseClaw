# Rollback Playbook

Rollback is configuration-only and immediate.

## Actions

| Trigger | Rollback |
|---|---|
| Candidate leakage | Disable any AgentMap prompt candidate gate and stop explicit invocation. |
| Reviewer prompt byte drift | Disable `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot`. |
| Provider ordering drift | Omit AgentMap provider injection and keep `runtime.agentMap.provider` off. |
| Invalid/missing result fails open | Disable all AgentMap prompt candidate gates. |
| Budget failure inserts partial candidate | Disable all AgentMap prompt candidate gates. |
| Shadow output affects runtime decisions | Disable `runtime.agentMap.promptCandidateRuntimeShadow`. |
| Persistence detected | Disable all gates and remove the offending persistence path in a separate fix task. |

## No Cleanup Required

Candidate/shadow/replay text is not persisted by the accepted pilot or this Phase B package. Normal rollback therefore does not require disk, database, localStorage, indexedDB, electron-store, queue, or sidecar cleanup.

## Proof Required After Rollback

- Default TaskLoop reviewer prompt byte-identical.
- Candidate sentinel absent from default payloads.
- Provider ordering unchanged.
- No renderer direct IPC/direct Gateway.
- No service/listener/daemon/database/WebSocket/HTTP server introduced.
