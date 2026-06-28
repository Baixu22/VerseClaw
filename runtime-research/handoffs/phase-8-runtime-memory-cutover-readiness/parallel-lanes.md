# Phase 8 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and write its submission under `submissions/`.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- flag-off parity evidence for every touched legacy path;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database/listener boundary scans;
- source episode/evidence-ref proof for any durable fact claim;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- rollback proof for any persistence/provider-ordering/default-on proposal;
- comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.

Use `needs_revision` for missing evidence, raw retention, default-on behavior, unverified durable facts, persistence without rollback, provider-ordering cutover without parity proof, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: Cutover Spec Boundary

LANE_ID: `lane-a-cutover-spec-boundary`

LANE_TITLE: Phase 8 cutover readiness spec, risk ledger, and lane scaffold

LANE_SCOPE:

- Refine the Phase 8 harness spec and handoff scaffold.
- Define the cutover risk ledger for persistence, provider registration, provider ordering, fact promotion, and rollback.
- Keep all runtime behavior unchanged.
- Prove the spec starts from Phase 7 synthesis and still forbids raw memory, default-on behavior, persistence cutover, provider-ordering cutover, and runtime authority.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-a-cutover-spec-boundary.md
```

## Lane B: Persistence Retention Rollback

LANE_ID: `lane-b-persistence-retention-rollback`

LANE_TITLE: Runtime memory persistence retention, migration, and rollback proof

LANE_SCOPE:

- Design or implement only default-off persistence readiness for sanitized memory records.
- Identify store owner, schema shape, retained fields, redacted fields, migration path, rollback path, idempotency behavior, and invalidation behavior.
- Do not store raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, or raw trace context.
- Do not add a database service, graph service, daemon, listener, exporter, or external telemetry.
- If implementation is added, it must remain behind `runtime.memory.persist` default false and prove disabled parity.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-b-persistence-retention-rollback.md
```

## Lane C: Provider Registration Ordering Cutover

LANE_ID: `lane-c-provider-registration-ordering-cutover`

LANE_TITLE: Optional RuntimeMemoryProvider registration and ordering cutover proof

LANE_SCOPE:

- Design or implement only optional provider registration experiments behind default-off flags.
- Prove default provider ordering is unchanged when flags are false.
- If ordering changes are proposed, prove exact ordering, rollback, diagnostics, and prompt/context parity.
- Do not make memory provider a completion gate, verifier authority, security policy, retry policy, tool permission authority, or runtime authority.
- If Main/Gateway/host-api/api-client paths change, run comms replay/compare.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-c-provider-registration-ordering-cutover.md
```

## Lane D: Durable Fact Promotion Gate

LANE_ID: `lane-d-durable-fact-promotion-gate`

LANE_TITLE: Durable fact promotion gate and candidate separation

LANE_SCOPE:

- Prove candidate facts cannot become durable facts without verifier, human, or deterministic-rule promotion evidence.
- Add or validate promotion helpers only if they preserve proposal/durable separation and source episode/evidence refs.
- Prove rejected, expired, invalidated, candidate, and unpromoted facts stay out of current-valid queries by default.
- Do not use LLM extraction as durable authority.
- Do not create runtime completion, verifier, security, retry, tool, or execution authority.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-d-durable-fact-promotion-gate.md
```

## Lane E: Validation Docs Synthesis Readiness

LANE_ID: `lane-e-validation-docs-synthesis-readiness`

LANE_TITLE: Phase 8 validation, scans, docs, and synthesis readiness

LANE_SCOPE:

- Validate Phase 8 and Phase 7 harness specs.
- Confirm A-D submissions exist and each has exactly one valid `Status`.
- Run focused runtime memory tests, node typecheck, renderer bypass scans, raw-retention scans, service/exporter/database scans, and comms replay/compare if required.
- Review docs sync requirements.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts Phase 8.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-e-validation-docs-synthesis-readiness.md
```

## Execution Order

1. Run Lane A first.
2. Run Lane B, Lane C, and Lane D in parallel after Lane A is accepted or clearly stable.
3. Run Lane E after A-D submissions exist.
4. Run synthesis after Lane E completes validation.

Lane B/C/D must not assume another lane's unverified claim. Each lane needs its own code/test/scan evidence.
