# Phase 14 Parallel Lanes

## Lane A: TaskLoop Real Adapter Replay Proof

Prove the real TaskLoop-to-Runtime-Memory adapter/persistence path writes exactly one sanitized terminal episode when both `runtime.memory.shadow` and `runtime.memory.persist` are true.

Evidence must show:

- TaskLoop result, phase, evidence gate, checkpoint behavior, retries, approvals, and tool policy stay unchanged.
- The persisted episode replays through the existing `RuntimeMemoryStore`.
- The replay contains no raw task text, self-check text, subagent run ids, prompt/template data, transcripts, tool output, env, secrets, or raw trace context.
- The path does not call `loadStore`, write facts, invalidate facts, hydrate providers, or read memory into TaskLoop decisions.

## Lane B: Disabled Parity And Idempotency Boundary

Revalidate that omitted flags, `shadow=false`, `persist=false`, and `persist=true` with omitted shadow do not open, read, or write Runtime Memory.

Evidence must show:

- The dual flag gate remains `shadow === true && persist === true`.
- Disabled states do not construct/open SQLite through the adapter.
- Persisted episode idempotency and replay remain canonical through existing persistence tests.

## Lane C: Redaction, Fact, And Authority Boundary

Revalidate that Phase 14 adds no raw retention, facts, candidate promotion, provider output, provider default registration, provider ordering cutover, Gateway/renderer route, or runtime authority.

Evidence must include focused scans and source/test references.

## Lane D: Validation, Scans, And Comms

Run and record:

- Phase 14 context/validate.
- Phase 13/12/11/10/9 validate.
- Focused Runtime Memory and TaskLoop Vitest command.
- Node typecheck.
- Boundary scans from the task spec.
- Comms replay/compare when required by dirty communication-adjacent paths.

## Lane E: Synthesis And Index

The synthesis owner must re-check lane evidence rather than inheriting claims.

If synthesis is accepted, update `runtime-research/agent-runtime-index.md` with the exact accepted scope and next blocked decisions.

The synthesis final line must be exactly one of:

```text
Status: accepted
Status: needs_revision
Status: blocked
```
