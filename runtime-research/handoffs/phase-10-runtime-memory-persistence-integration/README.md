# Phase 10 Handoff: Runtime Memory Persistence Integration Planning

Phase 10 starts only after Phase 9 synthesis accepted the default-off local sanitized Runtime Memory persistence foundation.

Phase 9 accepted:

- `openclaw_runtime/src/runtime-core/memory-persistence.ts` as a standalone local SQLite persistence proof;
- sanitized episode, fact, and invalidation persistence with owner/schema, migration, idempotency, retention, redaction, invalidation, rollback, and flag-off parity evidence;
- no runtime cutover, no default-on persistence, no provider ordering cutover, no raw retention, no unverified durable facts, no service/exporter/database-service/listener, and no runtime authority.

## Phase Goal

Prepare the evidence lanes for a later default-off runtime integration decision. This scaffold is planning only: it does not implement TaskLoop wiring, Gateway wiring, provider ordering changes, default-on persistence, or any runtime authority.

The next phase must prove whether future integration can safely add:

- flag-off runtime wiring parity that opens, reads, and writes nothing when `runtime.memory.persist` is false;
- a read/write integration boundary that passes only sanitized records into the Phase 9 persistence owner;
- provider/context hydration boundaries that keep default provider ordering and readonly/no-authority behavior unchanged;
- rollback, docs, scans, and synthesis readiness before any implementation is accepted.

## Accepted Entry Boundary

Phase 10 may accept only:

- planning docs, lane prompts, and validation scaffolding;
- evidence plans for default-off runtime read/write integration;
- boundary analysis for TaskLoop, Gateway, provider/context hydration, config help, tests, docs, and rollback;
- future lane submissions that prove behavior with code/test/scan evidence before synthesis accepts any integration.

## Rejected Entry Boundary

Phase 10 must reject any lane that introduces:

- default-on memory recording, provider injection, persistence, fact extraction, fact promotion, provider ordering cutover, or prompt memory dumps;
- TaskLoop cutover, Gateway cutover, provider ordering cutover, default provider registration, or runtime execution cutover during entry prep;
- raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload/checkpoint/tool args/tool output/env/secret retention, or raw trace context retention;
- LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence;
- runtime persistence reads or writes without flag-off parity, rollback, redaction, no-raw-retention proof, and synthesis acceptance;
- graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway/runtime service, external telemetry/exporter, OTLP exporter, collector, service, exporter, database-service, or listener work;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission policy, runtime execution policy, or runtime authority.

## Non-Negotiable Constraints

1. Keep `runtime.memory.persist`, `runtime.memory.provider`, `runtime.memory.shadow`, and `runtime.memory.proposeFacts` default false.
2. Treat Phase 9 as a foundation only, not as permission for runtime cutover.
3. Do not persist raw chat logs, transcripts, traces, prompts, full payloads, full checkpoints, tool args/output, env, secrets, or raw trace context values.
4. Do not promote candidates or LLM-extracted facts to durable facts without verifier, human, or deterministic-rule promotion evidence.
5. Do not change provider ordering by default.
6. Do not add a service, exporter, collector, database service, daemon, listener, or second runtime.
7. Preserve TaskLoop, tools.invoke, approvals, retries, error mapping, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering when flags are false.
8. Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths change in a later lane.

## Required Reading

Every Phase 10 lane must read:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `tests/unit/runtime-memory-persistence.test.ts`
- relevant runtime memory provider/context tests before making claims

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
```

## Expected Lanes

- `lane-a-flag-off-runtime-wiring-parity`
- `lane-b-persistence-read-write-integration-boundary`
- `lane-c-provider-context-hydration-boundary`
- `lane-d-rollback-docs-validation-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not accept runtime integration claims without code/test/scan evidence.
