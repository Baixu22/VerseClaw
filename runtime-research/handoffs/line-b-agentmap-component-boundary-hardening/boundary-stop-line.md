# Boundary Stop Line

The stop line is the named explicit pilot surface. AgentMap output may be built and measured there, but it must not cross into default runtime behavior.

## Hard Stops

- No default-on.
- No default cutover.
- No production-ready declaration.
- No default runtime behavior change.
- No default TaskLoop reviewer prompt change.
- No provider ordering change.
- No default AgentMap provider registration.
- No candidate/shadow/replay persistence.
- No service, listener, daemon, database, WebSocket server, or HTTP server.
- No renderer direct IPC or direct Gateway HTTP/WebSocket.
- No runtime/tool/security/approval/retry/completion/provider/model/Gateway/checkpoint/lifecycle authority.

## Future Entry

Future work may only reopen AgentMap through a fresh task spec. This hardening package recommends pause, not next-stage runtime implementation execution.
