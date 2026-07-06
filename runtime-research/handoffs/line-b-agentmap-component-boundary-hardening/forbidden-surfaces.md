# Forbidden Surfaces

Status: pass.

AgentMap output is forbidden from default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, checkpoints, lifecycle payloads, memory, session state, cache, database, sidecar files, dashboards, production telemetry emitters, automatic discovery, automatic build, automatic cache, and automatic reuse.

AgentMap is also forbidden from patch apply, symbol mutation, workspace edit, retry decisions, approval decisions, block decisions, completion decisions, provider selection, model selection, security decisions, and default provider registration.
