# Telemetry Implementation Plan

Status: future-only design; no telemetry code is implemented by this task.

## Mode

Telemetry for a future implementation execution task must be:

- default-off;
- diagnostics-only;
- local to the existing runtime path;
- no persistence by default;
- no new service, listener, daemon, database, WebSocket server, HTTP server, exporter, or background process;
- raw-text-free.

## Payload Shape

Allowed fields:

- counters such as `leakage_count`, `fail_closed_count`, `rollback_success_count`;
- booleans such as `legacy_prompt_byte_identical`, `default_on_gate_enabled`;
- hashes such as candidate content hash or context pack hash;
- lengths such as candidate content length or token estimate;
- bounded diagnostic codes from a closed enum;
- feature flag states.

Forbidden fields:

- raw candidate text;
- raw prompt;
- model message;
- provider payload;
- Gateway payload;
- checkpoint body;
- lifecycle raw text;
- tool output;
- secret;
- auth header;
- trace raw body.

## Future Emitter Location

The future emitter should be called after the existing AgentMap prompt-candidate helper returns its sanitized diagnostics. It must not build, cache, persist, or rediscover AgentMap content. It must not alter reviewer prompt assembly or TaskLoop decisions.

## Future Operator Surface

Operators need an aggregate report with:

- leakage count;
- provider ordering drift;
- reviewer prompt byte drift;
- fail-closed count;
- rollback success count;
- persistence count;
- authority escalation count;
- sampled case count;
- bounded diagnostic code counts.

No raw task text, prompt text, model message, provider request, Gateway request, checkpoint payload, or lifecycle body may appear in the operator surface.
