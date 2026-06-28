# Phase 10 Parallel Planning Lanes

All lanes may run in separate windows after this entry scaffold is accepted. Each lane must preserve legacy behavior by default and write its submission under `submissions/`.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- proof that Phase 9 synthesis is accepted and only accepted the default-off local sanitized foundation;
- flag-off parity evidence for every touched legacy path;
- no-open/no-read/no-write evidence when `runtime.memory.persist` is false;
- read/write boundary proof that only sanitized records reach `memory-persistence.ts`;
- provider/context hydration proof preserving default provider ordering and readonly/no-authority behavior;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database-service/listener boundary scans;
- source episode/evidence-ref/promotion-evidence proof for durable fact claims;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.

Use `needs_revision` for missing evidence, default-on behavior, raw retention, unverified durable facts, provider-ordering cutover, persistence without rollback, runtime reads/writes when disabled, service/exporter/database-service/listener additions, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: Flag-Off Runtime Wiring Parity

LANE_ID: `lane-a-flag-off-runtime-wiring-parity`

LANE_TITLE: Flag-off runtime wiring parity and no-open proof

LANE_SCOPE:

- Map future TaskLoop/Gateway/runtime wiring seams without implementing cutover.
- Prove existing behavior remains unchanged when all runtime memory flags are false.
- Define the required tests for no SQLite open/read/write when `runtime.memory.persist` is false.
- Do not add TaskLoop cutover, Gateway cutover, default-on flags, provider ordering changes, or runtime authority.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-a-flag-off-runtime-wiring-parity.md
```

## Lane B: Persistence Read/Write Integration Boundary

LANE_ID: `lane-b-persistence-read-write-integration-boundary`

LANE_TITLE: Runtime persistence read/write boundary and sanitized record contract

LANE_SCOPE:

- Define where future runtime writes may call the Phase 9 persistence owner.
- Define where future runtime reads may hydrate the in-memory RuntimeMemoryStore from persisted sanitized records.
- Prove records remain bounded, sanitized, idempotent, retained, redacted, invalidation-aware, and rollback-safe.
- Reject raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret retention and unverified durable facts.
- Do not add a service, exporter, database-service, listener, graph service, daemon, external telemetry, or second runtime.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-b-persistence-read-write-integration-boundary.md
```

## Lane C: Provider/Context Hydration Boundary

LANE_ID: `lane-c-provider-context-hydration-boundary`

LANE_TITLE: Provider and context hydration boundary without ordering cutover

LANE_SCOPE:

- Define how future context hydration may consume a loaded RuntimeMemoryStore without changing default provider ordering.
- Prove RuntimeMemoryProvider remains optional, readonly, budgeted, shadow/no-authority, and default false.
- Prove durable facts require verifier, human, or deterministic-rule promotion evidence with source episode refs and evidence refs.
- Prove candidates, rejected facts, expired facts, invalidated facts, and unpromoted facts remain excluded by default current-valid queries.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-c-provider-context-hydration-boundary.md
```

## Lane D: Rollback Docs Validation Synthesis Readiness

LANE_ID: `lane-d-rollback-docs-validation-synthesis-readiness`

LANE_TITLE: Rollback, docs, validation, scans, and synthesis readiness

LANE_SCOPE:

- Validate Phase 10 and Phase 9 harness specs.
- Confirm A-C submissions exist and each has exactly one valid `Status`.
- Run focused runtime memory tests, node typecheck, renderer bypass scans, raw-retention scans, service/exporter/database-service/listener scans, persistence scans, and comms replay/compare if required.
- Review docs sync requirements and config help wording before any operator-facing persistence flow is accepted.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts Phase 10.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-d-rollback-docs-validation-synthesis-readiness.md
```

## Execution Order

1. Run Lane A first.
2. Run Lane B and Lane C in parallel after Lane A is accepted or clearly stable.
3. Run Lane D after A-C submissions exist.
4. Run synthesis after Lane D completes validation.

Lane B and Lane C must not assume another lane's unverified claim. Each lane needs its own code/test/scan evidence.
