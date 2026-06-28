# Phase 13 Parallel Lanes

All lanes write submissions under `submissions/`. Phase 13 may accept only a default-off TaskLoop shadow persistence pilot for sanitized Runtime Memory episode records. Do not implement Gateway, Electron Main, renderer, shared host contract, provider-ordering, default provider registration, durable fact promotion, default-on persistence, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- proof that Phase 12 synthesis exists and ends with exactly `Status: accepted`;
- proof that Phase 12 accepted planning/spec/evidence only, not runtime cutover;
- proof that Phase 11 accepted only isolated default-off adapter wiring;
- proof that Phase 10 accepted only default-off integration boundary/readiness;
- proof that Phase 9 accepted only default-off local sanitized persistence foundation;
- flag-off parity evidence for every touched legacy path;
- no SQLite open/read/write evidence when `runtime.memory.shadow` or `runtime.memory.persist` is false;
- proof that `runtime.memory.persist=true` with `runtime.memory.shadow=false` does not enable TaskLoop writes;
- sanitized episode-only write proof for any TaskLoop pilot path;
- no TaskLoop memory read or provider hydration proof;
- provider ordering proof if provider/context code is discussed;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database-service/listener scans;
- source episode/evidence-ref/promotion-evidence proof for any durable fact claims;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- rollback/operator/docs/config proof;
- comms replay/compare requirements if Main/Gateway/host-api/api-client/provider transport paths are touched by a future lane.

Use `needs_revision` for missing evidence, accidental broad runtime imports, Gateway/provider cutover, default-on behavior, raw retention, unverified durable facts, provider-ordering cutover, persistence without rollback, runtime reads/writes when disabled, service/exporter/database-service/listener additions, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: TaskLoop Call-Site Gate And Disabled Parity

LANE_ID: `lane-a-taskloop-callsite-gate-disabled-parity`

LANE_TITLE: TaskLoop call-site gate, import isolation, and disabled parity

LANE_SCOPE:

- Define or implement the minimal TaskLoop call-site pilot for Runtime Memory episode writes.
- Require both `runtime.memory.shadow` and `runtime.memory.persist` before adapter writes can run.
- Prove omitted flags, `shadow=false`, `persist=false`, and `persist=true` with `shadow=false` preserve TaskLoop behavior and open/read/write no SQLite.
- Prove any adapter import is isolated to the intended TaskLoop pilot and tests, with no Gateway/Electron/renderer/shared/provider-registry/default-barrel import.
- Do not add TaskLoop memory reads, provider hydration, Gateway cutover, durable fact writes, or runtime authority.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-a-taskloop-callsite-gate-disabled-parity.md
```

## Lane B: Sanitized Episode Write Mapping

LANE_ID: `lane-b-sanitized-episode-write-mapping`

LANE_TITLE: Sanitized TaskLoop episode write mapping

LANE_SCOPE:

- Define or implement the bounded mapping from TaskLoop lifecycle metadata to Runtime Memory episode records.
- Persist only sanitized episode records through the Phase 11 adapter and Phase 9 persistence owner.
- Reject raw prompts, transcripts, full payloads, full checkpoints, tool args/output, env, secrets, raw traceparent/tracestate/baggage, stdout/stderr, and raw trace dumps.
- Do not write facts, candidates, invalidations, provider context, or prompt memory dumps.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-b-sanitized-episode-write-mapping.md
```

## Lane C: Idempotency, Error Isolation, And Rollback

LANE_ID: `lane-c-idempotency-error-isolation-rollback`

LANE_TITLE: Idempotency, adapter error isolation, and rollback proof

LANE_SCOPE:

- Prove TaskLoop episode writes use stable idempotency keys and bounded retention.
- Prove adapter write failures are shadow-only diagnostics and do not change TaskLoop terminal status, return payloads, approvals, retry behavior, tool policy, verifier/security behavior, event-log/checkpoint/resume, or provider ordering.
- Prove rollback by disabling either required flag or omitting the TaskLoop import/call site, while preserving Phase 9 rows.
- Do not delete memory rows or add a doctor/delete policy in Phase 13.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-c-idempotency-error-isolation-rollback.md
```

## Lane D: Provider, Gateway, Docs, And No-Authority Boundary

LANE_ID: `lane-d-provider-gateway-docs-no-authority-boundary`

LANE_TITLE: Provider, Gateway, docs/config, and no-authority boundary

LANE_SCOPE:

- Prove Phase 13 adds no Gateway, Electron Main, renderer, shared host contract, provider default registration, or provider ordering change.
- Prove `runtime.memory.provider` remains separate and default false, and `runtime.memory.persist` does not enable provider output.
- Prove memory remains non-authoritative for completion, verifier, security, retry, tool permission, runtime execution, and provider ordering.
- Update config help/types/schema/tests only if the TaskLoop pilot changes operator-visible semantics; docs must state default-off, dual-flag, no raw retention, no provider output, and rollback boundaries.
- Review README docs sync requirements if user-visible behavior changes.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-d-provider-gateway-docs-no-authority-boundary.md
```

## Lane E: Validation, Scans, Comms, And Synthesis Readiness

LANE_ID: `lane-e-validation-scans-comms-synthesis-readiness`

LANE_TITLE: Validation, scans, comms, and synthesis readiness

LANE_SCOPE:

- Confirm A-D submissions exist and each has exactly one valid `Status` line.
- Run Phase 13 harness context/validate.
- Run Phase 12, Phase 11, Phase 10, and Phase 9 harness validate.
- Run focused Runtime Memory and TaskLoop tests, node typecheck, renderer boundary scan, intended TaskLoop import scan, forbidden authority import scan, raw-retention scan, service/exporter/database-service/listener scan, and persistence scan.
- Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed or if the ambient worktree has dirty communication-adjacent paths.
- Classify A-D as accepted / needs_revision / blocked.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-e-validation-scans-comms-synthesis-readiness.md
```

## Execution Order

1. Run Lane A first because it owns the risky TaskLoop import/gating decision.
2. Run Lane B and Lane C in parallel after Lane A is accepted or clearly stable.
3. Run Lane D in parallel with B/C if no provider/Gateway/config code has been touched, otherwise after B/C stabilize.
4. Run Lane E after A-D submissions exist.
5. Run synthesis after Lane E completes validation.

Each lane must stand on its own evidence. Do not accept another lane's unverified claim by reference.
