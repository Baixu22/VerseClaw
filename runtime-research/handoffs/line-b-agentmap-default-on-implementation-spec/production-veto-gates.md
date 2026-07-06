# Production Veto Gates

Status: active.

Any item below blocks implementation execution, default cutover, or production-ready declaration:

- default-on enabled by this task;
- default cutover approved by this task;
- production-ready declared by this task;
- default runtime behavior changed;
- default TaskLoop reviewer prompt bytes changed;
- provider ordering drift greater than 0;
- AgentMap registered as a default provider;
- candidate text enters default prompts, model messages, Gateway requests, provider transport, checkpoint payloads, lifecycle payloads, or runtime decisions;
- candidate/shadow/replay output persisted;
- renderer direct IPC or direct Gateway HTTP/WebSocket added;
- new service, listener, daemon, database, WebSocket server, HTTP server, exporter, second Gateway, or second runtime service added;
- mutation/apply/edit surface added;
- telemetry contains raw candidate text, raw prompt, model message, provider payload, Gateway payload, checkpoint body, lifecycle raw text, tool output, secret, auth header, or trace raw body;
- rollback gate closure below 100 percent;
- fail-closed invalid/missing/malformed/gated-off cases below 100 percent;
- authority escalation greater than 0.

Current result: no veto fired.
