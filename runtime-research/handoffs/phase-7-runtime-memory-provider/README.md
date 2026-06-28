# Phase 7 Handoff: Runtime Memory Provider

Phase 7 starts after Phase 6 accepted the Trace Context Provider as local, sanitized, bounded, default-off, readonly, and non-authoritative. The goal is to add the smallest Runtime Memory Provider foundation so agents can read evidence-backed temporal facts without storing raw chat logs or treating trace summaries as durable truth.

## Phase Goal

Build a default-off, local-only memory foundation for:

- sanitized episodic records derived from task events, tool results, test outputs, verifier summaries, trace summaries, and explicit human confirmations;
- temporal fact candidates and facts with `valid_at`, `invalid_at`, `expired_at`, `reference_time`, source episode refs, evidence refs, and verification status;
- current-valid and historical-time queries that exclude invalidated or unverified facts by default;
- readonly budgeted memory context items that cite source episodes and evidence refs;
- proposal-first extraction where automatic or LLM-assisted facts cannot become durable truth without verifier-backed evidence, human approval, or an accepted deterministic rule.

## Accepted Entry Boundary

Phase 7 may accept only these surfaces:

- canonical episode and temporal fact contracts with bounded summaries and explicit source/evidence refs;
- local, sanitized, idempotent episode/fact stores or store interfaces, with persistence default-off until retention, redaction, invalidation, rollback, and migration evidence exists;
- candidate fact proposal flows that keep unverified extraction separate from durable accepted facts;
- readonly `RuntimeMemoryProvider` context items that are token-budgeted and source-linked;
- validation/docs/synthesis evidence proving raw chat logs, raw traces, full prompts, full tool payloads, and unverified facts are not accepted as memory.

## Rejected Entry Boundary

Phase 7 must reject any lane that introduces:

- raw chat-log memory, raw transcript import, raw trace-dump memory, or prompt full-memory dumps;
- default-on memory recording, default provider injection, provider ordering cutover, persistence, fact extraction, or fact promotion;
- LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or an accepted deterministic rule;
- retention of raw prompts, full event payloads, full checkpoints, full tool args/output, complete env, secrets, unbounded command output, or raw external trace context values;
- graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway/runtime service, external telemetry/export, or observability platform;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission policy, or runtime authority.

## Non-Negotiable Constraints

1. Do **not** use raw chat logs, raw transcripts, raw trace dumps, or full prompt dumps as durable memory.
2. Do **not** promote unverified trace facts, model summaries, or LLM-extracted facts into accepted durable facts.
3. Do **not** enable memory recording, memory provider injection, fact extraction, fact promotion, persistence, or provider ordering cutover by default.
4. Do **not** add a database service, graph service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway/runtime service, telemetry exporter, OTLP exporter, or collector.
5. Do **not** persist raw prompts, full event payloads, full checkpoints, full tool args/output, complete env, secrets, unbounded command output, or raw `traceparent` / `tracestate` / baggage values.
6. Keep existing TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering unchanged with flags off.
7. Treat the Runtime Memory Provider as readonly context. It must not become a completion gate, verifier authority, security policy, retry policy, tool permission policy, or runtime authority in Phase 7.
8. Memory summaries must be token-budgeted and redacted; no lane may expose full memory dumps to prompts or UI by default.
9. If Main/Gateway communication paths change, run comms replay/compare and preserve renderer/Main transport ownership.

## Required Reading

Every implementation window must read:

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`, Phase 7
- `runtime-research/migration-execution-plan.md`, Stage 8
- `runtime-research/agent-runtime-core-spec.md`, RuntimeMemoryProvider references
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md`
- `runtime-research/graphiti/temporal-knowledge-graph.md`
- `runtime-research/graphiti/clawx-mapping.md`
- `runtime-research/graphiti/useful-tests.md`
- `runtime-research/graphiti/extraction.md`
- `harness/specs/tasks/phase-7-runtime-memory-provider.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
```

## Required Lane Evidence

Every accepted lane must provide path/function/test/command evidence for its claims, plus explicit rows for:

- flag-off parity for every touched legacy path;
- sanitization/redaction and raw-retention scans;
- raw chat-log/raw trace rejection evidence;
- source episode/evidence refs and verifier/human approval requirements;
- valid_at/invalid_at/expired_at/reference_time behavior;
- idempotency and duplicate episode handling;
- invalidation and current-valid query behavior;
- token-budgeted memory summary behavior;
- boundary scans for services/exporters/renderer bypasses;
- comms replay/compare whenever Main/Gateway communication paths changed.

## Expected Lanes

- `lane-a-contracts-and-harness`
- `lane-b-local-episode-fact-store-query`
- `lane-c-fact-proposal-invalidation-shadow`
- `lane-d-memory-context-provider-summary`
- `lane-e-validation-docs-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not treat unverified memory claims as accepted facts.

