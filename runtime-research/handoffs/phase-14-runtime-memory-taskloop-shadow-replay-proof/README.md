# Phase 14 Runtime Memory TaskLoop Shadow Replay Proof

## Scope

Phase 14 is a narrow hardening and replay-proof follow-up to the Phase 13 TaskLoop shadow persistence pilot.

Accepted work may only prove that the existing dual-flag TaskLoop shadow episode write path persists one bounded sanitized terminal episode through the real Runtime Memory adapter/persistence stack, and that the persisted episode can be replayed through the existing `RuntimeMemoryStore` without changing TaskLoop behavior.

## Prerequisite

Before implementation or synthesis, confirm:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/synthesis.md
```

exists, has exactly one `Status:` marker, and ends with:

```text
Status: accepted
```

Phase 13 acceptance is not broad cutover permission. It accepts only a default-off dual-flag sanitized TaskLoop terminal episode shadow write pilot.

## Allowed

- Add or update focused tests that prove Phase 13 replay, idempotency, redaction, no-open/no-write disabled parity, and operator boundaries.
- Add lane submissions and synthesis that revalidate evidence from source, tests, and scans.
- Update `runtime-research/agent-runtime-index.md` only if synthesis accepts the slice.

## Rejected

- Default-on Runtime Memory persistence, provider output, provider injection, provider ordering, fact extraction, fact promotion, or prompt memory dump.
- TaskLoop memory reads or persisted memory influencing TaskLoop decisions, prompts, retries, approvals, tool policy, verifier/security policy, completion, or runtime authority.
- Gateway/Electron/renderer/shared host contract cutover or direct renderer IPC/Gateway calls.
- Raw chat, transcript, jsonl, trace, prompt, payload, checkpoint, tool args/output, env, secret, traceparent, tracestate, or baggage retention.
- Candidate, LLM-generated, rejected, invalidated, expired, or unpromoted facts becoming durable facts.
- Service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP, Temporal, second Gateway, or second runtime work.

## Validation

Use RTK-wrapped `cmd` commands from the task spec:

- Phase 14 harness context and validate.
- Phase 13, 12, 11, 10, and 9 harness validate.
- Focused Runtime Memory and TaskLoop Vitest command.
- Node typecheck.
- Renderer boundary, intended import, forbidden authority, raw-retention, service/exporter/listener, and persistence scans.
- Comms replay/compare if communication-adjacent paths are dirty or changed.
