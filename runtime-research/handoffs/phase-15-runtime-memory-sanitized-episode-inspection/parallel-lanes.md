# Phase 15 Parallel Lanes

## Lane A: Inspection Contract

Prove `loadStore().listEpisodes()` can enumerate persisted sanitized episode inspection summaries without adding a production inspection API.

Evidence must show episode id, task id, kind, reference_time, boundedSummary, source refs, evidence refs, redaction status, safe metadata, and bounded episode-only statistics.

## Lane B: Redaction And Replay Boundary

Prove inspection output excludes raw task text, self-check text, subagent ids, template ids, transcripts, raw rows, `record_json`, tool args/output, env, secrets, and raw trace context.

Evidence must show rejected raw records do not appear in inspection JSON.

## Lane C: Disabled No-Open Parity

Revalidate that omitted or false `runtime.memory.persist` returns a skipped empty store and does not open/read/write SQLite.

Evidence may reuse existing focused tests if they still cover the path exactly.

## Lane D: No Authority, Provider, Or Gateway Boundary

Prove inspection does not call TaskLoop, write facts, invalidate facts, hydrate providers, register RuntimeMemoryProvider by default, alter provider ordering, or add Gateway/Electron/renderer/shared routes.

Facts and candidates may exist in the store, but inspection must not present them as durable runtime authority.

## Lane E: Validation, Scans, And Comms

Run and record:

- Phase 15 context/validate.
- Phase 14/13/12/11/10/9 validate.
- Focused Runtime Memory and TaskLoop Vitest command.
- Node typecheck.
- Boundary scans from the task spec.
- Comms replay/compare when required by dirty communication-adjacent paths.

## Synthesis

The synthesis owner must re-check lane evidence rather than inheriting claims.

If synthesis is accepted, update `runtime-research/agent-runtime-index.md` with the exact accepted scope and next blocked decisions.

The synthesis final line must be exactly one of:

```text
Status: accepted
Status: needs_revision
Status: blocked
```
