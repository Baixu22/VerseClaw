# Phase 15 Runtime Memory Sanitized Episode Inspection

## Scope

Phase 15 is a narrow operator/developer proof follow-up to the Phase 14 TaskLoop sanitized episode replay proof.

Accepted work may only prove that persisted sanitized Runtime Memory episodes can be inspected through the existing `loadStore().listEpisodes()` store snapshot. Inspection output is bounded to episode summaries and safe episode-only statistics.

## Prerequisite

Before implementation or synthesis, confirm:

```text
runtime-research/handoffs/phase-14-runtime-memory-taskloop-shadow-replay-proof/synthesis.md
```

exists, has exactly one `Status:` marker, and ends with:

```text
Status: accepted
```

Phase 14 acceptance is not broad cutover permission. It accepts only default-off sanitized TaskLoop episode replay proof.

## Allowed

- Add the Phase 15 task spec and handoff package.
- Add focused tests proving persisted sanitized episode inspection through `loadStore().listEpisodes()`.
- Document operator proof commands, expected output boundaries, rollback, and forbidden interpretations.
- Update `runtime-research/agent-runtime-index.md` only if synthesis accepts the slice.

## Rejected

- Default-on Runtime Memory persistence, provider output, provider injection, provider ordering, fact extraction, fact promotion, or prompt memory dump.
- TaskLoop memory reads or persisted memory influencing TaskLoop decisions, prompts, retries, approvals, tool policy, verifier/security policy, completion, or runtime authority.
- Gateway/Electron/renderer/shared host contract cutover or direct renderer IPC/Gateway calls.
- Raw DB rows, chat, transcript, jsonl, trace, prompt, payload, checkpoint, tool args/output, env, secret, traceparent, tracestate, baggage, or provider context in inspection output.
- Candidate, LLM-generated, rejected, invalidated, expired, or unpromoted facts becoming durable runtime facts.
- Service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP, Temporal, second Gateway, or second runtime work.

## Operator Proof Boundary

Use an explicit test/operator database path and `runtime.memory.persist === true` before inspection can read persisted episodes. The output boundary is:

- episode id
- task id
- kind
- reference_time
- boundedSummary
- source refs
- evidence refs
- redaction status
- safe metadata
- bounded episode-only statistics

Do not interpret inspection output as facts, prompts, provider context, TaskLoop input, Gateway product behavior, or runtime authority.

## Rollback

Disable `runtime.memory.persist` to make inspection return a skipped empty store without opening SQLite. Disable `runtime.memory.shadow` to stop the TaskLoop shadow episode writer. Preserve existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.

## Validation

Use RTK-wrapped `cmd` commands from the task spec:

- Phase 15 harness context and validate.
- Phase 14, 13, 12, 11, 10, and 9 harness validate.
- Focused Runtime Memory and TaskLoop Vitest command.
- Node typecheck.
- Renderer boundary, intended import, forbidden authority, TaskLoop memory read/fact/provider, raw-retention, service/exporter/listener, and persistence scans.
- Comms replay/compare when required by dirty communication-adjacent paths.
