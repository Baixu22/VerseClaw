# lane-design-entry-prep: Phase 7 Entry Preparation

## Status

```text
Status: accepted
```

Accepted because Phase 7 now has a fresh harness task spec, handoff scaffold, lane plan, submission/synthesis templates, explicit raw-memory rejection rules, and passing harness context/validate checks. No runtime behavior was implemented.

## Exact Files Reviewed

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`, Phase 7
- `runtime-research/migration-execution-plan.md`, Stage 8
- `runtime-research/agent-runtime-core-spec.md`, RuntimeMemoryProvider references
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md`
- `runtime-research/graphiti/temporal-knowledge-graph.md`
- `runtime-research/graphiti/clawx-mapping.md`
- `runtime-research/graphiti/useful-tests.md`
- `runtime-research/graphiti/extraction.md`
- `harness/specs/tasks/phase-6-trace-context-provider.md`
- `harness/specs/tasks/role-first-memory-control-plane.md`

## Exact Files Changed

- `harness/specs/tasks/phase-7-runtime-memory-provider.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/README.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/parallel-lanes.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/submission-template.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis-template.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/submissions/lane-design-entry-prep.md`
- `runtime-research/agent-runtime-index.md`

No runtime implementation files were edited for this preparation task.

## Phase 7 Accepted Entry Boundary

Phase 7 may proceed only through:

- sanitized episodic records with source episode refs, evidence refs, reference time, bounded summary, and idempotency key;
- temporal fact candidates/facts with `valid_at`, `invalid_at`, `expired_at`, `reference_time`, source episode refs, evidence refs, verification status, and provenance;
- default-off shadow/proposal/readonly flags;
- current-valid and historical queries that exclude invalidated, expired, rejected, or unverified facts by default;
- readonly, token-budgeted RuntimeMemoryProvider context items;
- proposal-first extraction where durable fact promotion requires verifier-backed evidence, human approval, or an accepted deterministic rule.

## Phase 7 Rejected Entry Boundary

Phase 7 must reject:

- raw chat-log memory, raw transcript import, raw trace-dump memory, and prompt full-memory dumps;
- default-on memory recording, memory provider injection, persistence, fact extraction, fact promotion, provider ordering cutover, or full memory prompt injection;
- LLM-extracted durable facts without verifier, human, or deterministic-rule evidence;
- raw prompts, full event payloads, full checkpoints, full tool args/output, complete env, secrets, unbounded command output, or raw trace context values;
- graph database services, daemons, listeners, HTTP/WS servers, Temporal services, second Gateway/runtime services, external telemetry/exporters, or observability platforms;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission policy, or runtime authority.

## Required Lane Evidence

| Lane | Required Evidence |
|---|---|
| A: contracts and harness | Default-off flags, episode/fact contracts, valid_at/invalid_at semantics, sanitizer/redaction helpers, raw chat/raw trace rejection, source/evidence separation, and no service/exporter/UI/provider wiring. |
| B: local episode/fact store/query | Bounded local store, sanitized append, duplicate episode idempotency, clone/read isolation, current-valid filtering, historical query, invalidation behavior, token-budget summary, raw-retention and service/exporter scans. |
| C: fact proposal invalidation shadow | Flag-off parity, candidate-vs-accepted separation, verifier/human/deterministic-rule promotion requirement, invalidation proposal behavior, no raw payload retention, no runtime authority, comms checks if Main/Gateway touched. |
| D: memory context provider summary | Provider disabled when `runtime.memory.provider` is false, readonly budgeted context items, no memory dump, verified facts first, candidate facts only on explicit request, default ordering unchanged. |
| E: validation/docs/synthesis readiness | A-D status audit, harness context/validate, focused tests, typecheck, renderer scan, service/exporter scan, raw-memory scans, docs-sync decision, index update only after synthesis. |

## Commands Run And Results

| Command | Result | Notes |
|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Returned Phase 7 read order through `gateway-backend-communication` and runtime layers. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | `Spec is valid`. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n "raw chat|raw trace|rawTrace|RuntimeMemoryProvider|runtime\.memory|valid_at|invalid_at|episode|fact promotion|proposal-only|Phase 7" ...` | pass/reviewed | Confirms the fresh Phase 7 spec and handoff scaffold carry raw-memory bans, temporal fact fields, default-off flags, proposal-only extraction, and Phase 6 entry evidence. |

## Ready For Lane A?

Yes. Phase 7 is ready for `lane-a-contracts-and-harness`.

Lane A should implement only the canonical contracts, flags, sanitizers, fixture builders, and focused contract tests. It must not wire TaskLoop, Gateway, renderer, persistence, provider registration, or extraction behavior.

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should Phase 7 persistence remain out of scope until after A-D synthesis, or should Lane B define a persist interface with implementation disabled? | Persistence is the highest retention/rollback risk. | maintainer / synthesis owner | no |
| Should accepted deterministic sources initially be limited to verifier/human records only, excluding trace-derived facts until a later lane? | This would further reduce accidental unverified memory promotion. | maintainer / agent | no |

