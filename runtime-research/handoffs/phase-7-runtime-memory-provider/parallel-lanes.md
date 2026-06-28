# Phase 7 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and must write its own submission under `submissions/`.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function evidence for each implemented or design claim;
- focused tests or a scoped not-applicable explanation;
- flag-off parity evidence for touched legacy behavior;
- sanitization/redaction and raw-retention evidence;
- raw chat-log/raw trace rejection evidence;
- source episode/evidence-ref separation evidence;
- verifier/human/deterministic-rule requirement for durable fact promotion;
- valid_at/invalid_at/expired_at/reference_time evidence;
- idempotency and duplicate episode evidence;
- current-valid query and invalidation evidence;
- token-budget evidence for summaries, or a lane-scoped not-applicable explanation;
- forbidden-pattern boundary scans;
- comms replay/compare when Main/Gateway communication paths changed.

Use `needs_revision` for missing evidence, raw memory retention, unverified durable facts, default-on behavior, provider ordering cutover, persistence without retention/rollback proof, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: Contracts And Harness

LANE_ID: `lane-a-contracts-and-harness`

LANE_TITLE: Runtime memory episode/fact contracts, taxonomy, handoff scaffold, and harness spec

LANE_SCOPE:

- Add or refine the Phase 7 handoff scaffold and task spec.
- Define canonical runtime-core episode, temporal fact candidate, accepted fact, verification status, invalidation, query, and summary contracts without live runtime wiring.
- Cover episode id, task id, source refs, evidence refs, reference time, idempotency key, bounded summary, fact subject/predicate/object summary, valid_at, invalid_at, expired_at, confidence/source, verification status, and provenance.
- Define memory flags, type guards, sanitizer/redaction helpers, fixture builders, deterministic query/summary contract tests, and raw chat/raw trace rejection helpers.
- Keep all flags default-off and contract/shadow-only.
- Do not touch TaskLoop, Gateway, renderer, provider registry, persistence, or extraction integration in this lane.
- Evidence must prove default-off flags, contract-only behavior, sanitizer coverage, raw chat/raw trace rejection, source/evidence separation, valid_at/invalid_at semantics, and no service/exporter/UI/provider wiring.

SUGGESTED_PATHS:

- `runtime-research/handoffs/phase-7-runtime-memory-provider/**`
- `harness/specs/tasks/phase-7-runtime-memory-provider.md`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-memory-context-contracts.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-7-runtime-memory-provider/submissions/lane-a-contracts-and-harness.md
```

## Lane B: Local Episode Fact Store Query

LANE_ID: `lane-b-local-episode-fact-store-query`

LANE_TITLE: Local sanitized episode/fact store, idempotency, temporal query, and budgeted summary

LANE_SCOPE:

- Add a bounded local episode/fact store over the Lane A contracts.
- Support idempotent episode append by idempotency key and source evidence.
- Support current-valid and historical fact queries by task, file, symbol, subject, evidence, verification status, and time.
- Exclude invalidated, expired, rejected, or unverified facts from default current-valid queries.
- Store only sanitized refs, bounded summaries, ids, statuses, timestamps, and verification metadata.
- Do not persist raw chat logs, raw trace dumps, prompts, full event payloads, full checkpoints, full tool args/output, env, secrets, or unbounded command output.
- Do not introduce persistence, database service, listener, exporter, UI, provider registration, or TaskLoop/Gateway wiring.
- Evidence must prove retention bounds, clone/read isolation, duplicate episode idempotency, invalidation behavior, current-valid filtering, token-budget summaries, sanitizer use on append, and touched-file raw-retention/service/exporter scans.

## Lane C: Fact Proposal Invalidation Shadow

LANE_ID: `lane-c-fact-proposal-invalidation-shadow`

LANE_TITLE: Default-off fact proposal and invalidation shadow over verified sources

LANE_SCOPE:

- Wire candidate fact proposal only behind explicit default-off memory flags.
- Accept only sanitized deterministic inputs from event/test/tool/verifier/trace summaries or explicit human-confirmed sources.
- Keep automatic/LLM extraction proposal-only; do not promote to durable accepted facts.
- Preserve TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering with flags off.
- If Main/Gateway paths change, run comms replay/compare.
- Evidence must prove flag-off parity, candidate-vs-accepted fact separation, invalidation proposal behavior, no raw payload retention, and no verifier/security/retry/runtime authority.

## Lane D: Memory Context Provider Summary

LANE_ID: `lane-d-memory-context-provider-summary`

LANE_TITLE: Readonly RuntimeMemoryProvider and budgeted memory context items

LANE_SCOPE:

- Add a readonly `RuntimeMemoryProvider` adapter over accepted local memory queries.
- Return budgeted context items, not full memory dumps, raw episode payloads, raw facts, or raw trace/chat text.
- Rank verified current facts with direct task/file/symbol/evidence matches first, then relevant historical facts with explicit time labels, then candidate facts only when explicitly requested.
- Keep provider registration default-off/shadow-only and do not change provider ordering by default.
- Do not make memory context a completion gate, verifier authority, security policy, retry policy, tool policy, or runtime authority.
- Evidence must prove provider output is token-budgeted, redacted, readonly, source/evidence linked, disabled when `runtime.memory.provider` is false, and absent from default provider ordering.

## Lane E: Validation Docs Synthesis Readiness

LANE_ID: `lane-e-validation-docs-synthesis-readiness`

LANE_TITLE: Phase 7 validation, boundary scans, docs/index updates, and synthesis readiness

LANE_SCOPE:

- Validate `phase-7-runtime-memory-provider` harness spec and relevant existing specs.
- Confirm A-D submissions exist and each has exactly one valid `Status`.
- Run focused memory context/store/provider tests, node typecheck, renderer/Main boundary scans, raw-retention scans, second-service/exporter scans, and comms replay/compare if Main/Gateway paths changed.
- Review README docs only if A-D changed user-visible behavior or documented RPC behavior.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts Phase 7.
- Evidence must classify broad scan matches as pre-existing or Phase-7-added, rerun touched-file scans, verify required files are referenced, and record whether any future persistence/provider-ordering cutover remains blocked.

## Future Cutover Readiness Check

Lane E and synthesis must not mark Phase 7 ready for provider-ordering or persistence cutover unless A-D evidence proves local sanitized queryable episodes/facts, budgeted memory context items, verified durable facts, idempotent writes, invalidation/current-valid behavior, and rollback. Any default-on memory behavior requires a fresh cutover spec.

