# Phase 9 Handoff: Runtime Memory Persistence Foundation

Phase 9 starts after Phase 8 accepted Runtime Memory cutover-readiness as docs/evidence only. The goal is to prepare or implement the smallest default-off local persistence foundation for sanitized Runtime Memory records.

## Phase Goal

Prove, with lane evidence, whether Runtime Memory can safely add:

- a named local store owner and schema for sanitized episode/fact records;
- migration, idempotency, invalidation, retention, redaction, and rollback behavior;
- disabled parity when `runtime.memory.persist` is false;
- current-valid and historical query behavior that still excludes invalidated, expired, rejected, candidate, and unpromoted facts by default;
- boundary scans proving no raw chat logs, raw traces, services/exporters/databases, renderer bypasses, or memory runtime authority.

## Accepted Entry Boundary

Phase 9 may accept only these surfaces:

- persistence specs, migration plans, lane evidence, and default-off implementation;
- sanitized local persistence for bounded episode/fact records with source episode refs, evidence refs, and promotion evidence;
- tests proving flag-off parity, retention/redaction, idempotency, invalidation, rollback, and no raw retention;
- optional provider/context integration checks that preserve default provider ordering and readonly context behavior.

## Rejected Entry Boundary

Phase 9 must reject any lane that introduces:

- default-on memory recording, provider injection, persistence, fact extraction, fact promotion, provider ordering cutover, or prompt memory dumps;
- raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload/checkpoint/tool args/tool output/env/secret retention, or raw trace context retention;
- LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence;
- persistence without local store owner, schema, migration, retention, redaction, invalidation, idempotency, rollback, and flag-off parity proof;
- graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway/runtime service, external telemetry/exporter, OTLP exporter, collector, or database service;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission policy, or runtime authority.

## Non-Negotiable Constraints

1. Keep `runtime.memory.persist` default false.
2. Do not treat Phase 8 readiness as permission for runtime cutover.
3. Do not persist raw chat logs, transcripts, traces, prompts, full payloads, full checkpoints, tool args/output, env, secrets, or raw trace context values.
4. Do not promote candidates or LLM-extracted facts to durable facts without verifier, human, or deterministic-rule promotion evidence.
5. Do not change provider ordering by default.
6. Do not add a service, exporter, collector, database service, daemon, listener, or second runtime.
7. Preserve TaskLoop, tools.invoke, approvals, retries, error mapping, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering when flags are false.
8. Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths change.

## Required Reading

Every implementation window must read:

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md`
- `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md`
- `harness/specs/tasks/phase-7-runtime-memory-provider.md`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- relevant tests under `tests/unit/runtime-memory-*.test.ts`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
```

## Expected Lanes

- `lane-a-persistence-spec-boundary`
- `lane-b-local-store-schema-migration`
- `lane-c-retention-redaction-rollback`
- `lane-d-flag-off-provider-fact-parity`
- `lane-e-validation-docs-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not accept persistence cutover claims without code/test/scan evidence.
