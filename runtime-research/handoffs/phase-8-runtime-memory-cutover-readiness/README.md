# Phase 8 Handoff: Runtime Memory Cutover Readiness

Phase 8 starts after Phase 7 accepted the Runtime Memory Provider foundation as default-off, local-only, readonly/proposal-only, and non-authoritative. The goal is to prepare and validate cutover readiness without turning memory on by default.

## Phase Goal

Prove, with lane evidence, whether Runtime Memory can safely approach:

- persistence planning or implementation with retention, redaction, invalidation, migration, rollback, and store-owner proof;
- optional provider registration or provider-ordering experiments with flag-off parity and rollback proof;
- durable fact promotion gates that require verifier, human, or deterministic-rule evidence;
- current-valid and historical query behavior that continues to exclude invalidated, expired, rejected, candidate, and unpromoted facts by default;
- boundary scans proving no raw chat logs, raw traces, services/exporters/databases, renderer bypasses, or memory runtime authority.

## Accepted Entry Boundary

Phase 8 may accept only these surfaces:

- cutover-readiness specs, docs, and lane evidence;
- persistence design or default-off implementation that stores only sanitized episode/fact records and includes migration/rollback proof;
- optional provider registration experiments that remain disabled by default and prove default provider ordering unchanged unless explicitly accepted;
- deterministic promotion gates that keep proposal and durable fact surfaces separate;
- validation evidence that starts from Phase 7 code/tests, not memory claims from lane text alone.

## Rejected Entry Boundary

Phase 8 must reject any lane that introduces:

- default-on memory recording, provider injection, persistence, fact extraction, fact promotion, provider ordering cutover, or prompt memory dumps;
- raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload/checkpoint/tool args/tool output/env/secret retention, or raw traceparent/tracestate/baggage retention;
- LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or an accepted deterministic rule;
- persistence without retention, redaction, invalidation, migration, rollback, and store-owner proof;
- graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway/runtime service, external telemetry/exporter, OTLP exporter, or collector;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission policy, or runtime authority.

## Non-Negotiable Constraints

1. Do not treat Phase 7 acceptance as permission for default-on memory behavior.
2. Do not persist raw chat logs, raw transcripts, raw traces, prompts, full payloads, full checkpoints, full tool args/output, env, secrets, or raw trace context values.
3. Do not promote candidates or LLM-extracted facts to durable facts without verifier, human, or deterministic-rule promotion evidence.
4. Do not change provider ordering by default without a fresh lane proving parity and rollback.
5. Do not add a service, exporter, collector, database service, daemon, listener, or second runtime.
6. Preserve TaskLoop, tools.invoke, approvals, retries, error mapping, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering when flags are false.
7. Keep memory context readonly and non-authoritative.
8. Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths change.

## Required Reading

Every implementation window must read:

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/README.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/parallel-lanes.md`
- `harness/specs/tasks/phase-7-runtime-memory-provider.md`
- `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- relevant tests under `tests/unit/runtime-memory-*.test.ts`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
```

## Expected Lanes

- `lane-a-cutover-spec-boundary`
- `lane-b-persistence-retention-rollback`
- `lane-c-provider-registration-ordering-cutover`
- `lane-d-durable-fact-promotion-gate`
- `lane-e-validation-docs-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not accept unverified memory claims or cutover claims without code/test/scan evidence.
