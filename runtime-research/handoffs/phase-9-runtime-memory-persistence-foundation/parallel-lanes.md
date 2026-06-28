# Phase 9 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and write its submission under `submissions/`.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- flag-off parity evidence for every touched legacy path;
- local store owner, schema, migration, retention, redaction, invalidation, idempotency, and rollback proof for persistence claims;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database/listener boundary scans;
- source episode/evidence-ref/promotion-evidence proof for durable fact claims;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.

Use `needs_revision` for missing evidence, raw retention, default-on behavior, unverified durable facts, persistence without rollback, provider-ordering cutover without parity proof, service/exporter/database/listener additions, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: Persistence Spec Boundary

LANE_ID: `lane-a-persistence-spec-boundary`

LANE_TITLE: Phase 9 persistence foundation spec, owner, and risk ledger

LANE_SCOPE:

- Refine the Phase 9 harness spec and handoff scaffold if needed.
- Define the persistence owner, schema boundary, migration/rollback risk ledger, and validation matrix.
- Keep all runtime behavior unchanged.
- Prove Phase 9 starts from Phase 8 synthesis and still forbids raw memory, default-on behavior, provider-ordering cutover, unverified durable facts, services/exporters, and runtime authority.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md
```

## Lane B: Local Store Schema Migration

LANE_ID: `lane-b-local-store-schema-migration`

LANE_TITLE: Default-off local persistence store, schema, and migration proof

LANE_SCOPE:

- Design or implement only a local default-off persistence store for sanitized Runtime Memory records.
- Identify store owner, schema shape, retained fields, redacted fields, migration path, idempotency behavior, and disabled parity.
- Do not add a database service, graph service, daemon, listener, exporter, or external telemetry.
- If implementation is added, it must remain behind `runtime.memory.persist` default false and prove no runtime reads/writes when disabled.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-b-local-store-schema-migration.md
```

## Lane C: Retention Redaction Rollback

LANE_ID: `lane-c-retention-redaction-rollback`

LANE_TITLE: Runtime memory retention, redaction, invalidation, and rollback proof

LANE_SCOPE:

- Prove persisted records retain only bounded sanitized episode/fact fields.
- Prove raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, and raw trace context cannot be persisted.
- Prove invalidation and rollback preserve user data while stopping new writes when flags are false.
- Add focused tests if code is added.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-c-retention-redaction-rollback.md
```

## Lane D: Flag-Off Provider Fact Parity

LANE_ID: `lane-d-flag-off-provider-fact-parity`

LANE_TITLE: Flag-off parity, provider ordering, and fact promotion boundary

LANE_SCOPE:

- Prove default provider ordering is unchanged when runtime memory flags are false.
- Prove persistence does not make memory context a completion gate, verifier authority, security policy, retry policy, tool permission authority, or runtime authority.
- Prove durable facts still require verifier, human, or deterministic-rule promotion evidence with source episode refs and evidence refs.
- Do not add renderer direct IPC/Gateway HTTP calls.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-d-flag-off-provider-fact-parity.md
```

## Lane E: Validation Docs Synthesis Readiness

LANE_ID: `lane-e-validation-docs-synthesis-readiness`

LANE_TITLE: Phase 9 validation, scans, docs, and synthesis readiness

LANE_SCOPE:

- Validate Phase 9, Phase 8, and Phase 7 harness specs.
- Confirm A-D submissions exist and each has exactly one valid `Status`.
- Run focused runtime memory tests, node typecheck, renderer bypass scans, raw-retention scans, service/exporter/database scans, persistence scans, and comms replay/compare if required.
- Review docs sync requirements.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts Phase 9.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-e-validation-docs-synthesis-readiness.md
```

## Execution Order

1. Run Lane A first.
2. Run Lane B, Lane C, and Lane D in parallel after Lane A is accepted or clearly stable.
3. Run Lane E after A-D submissions exist.
4. Run synthesis after Lane E completes validation.

Lane B/C/D must not assume another lane's unverified claim. Each lane needs its own code/test/scan evidence.
