# Phase 12 Parallel Lanes

All lanes write submissions under `submissions/`. Phase 12 is evidence-only planning. Do not implement TaskLoop, Gateway, provider-ordering, default provider registration, runtime call-site imports, default-on persistence, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- proof that Phase 11 synthesis exists and ends with exactly `Status: accepted`;
- proof that Phase 11 accepted only isolated default-off adapter wiring;
- proof that Phase 10 accepted only default-off integration boundary/readiness;
- proof that Phase 9 accepted only default-off local sanitized persistence foundation;
- no runtime code cutover proof for Phase 12;
- flag-off parity requirements for every future touched legacy path;
- no SQLite open/read/write requirements when `runtime.memory.persist` is false;
- adapter isolation proof from TaskLoop/Gateway/Electron/renderer/shared/default registry;
- provider ordering proof if provider/context code is discussed;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database-service/listener scans;
- source episode/evidence-ref/promotion-evidence proof for durable fact claims;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- rollback/operator/docs/config proof;
- comms replay/compare requirements if Main/Gateway/host-api/api-client/provider transport paths are touched by a future lane.

Use `needs_revision` for missing evidence, accidental runtime imports, default-on behavior, raw retention, unverified durable facts, provider-ordering cutover, persistence without rollback, runtime reads/writes when disabled, service/exporter/database-service/listener additions, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: TaskLoop Import And Call-Site Cutover Risk Map

LANE_ID: `lane-a-taskloop-callsite-cutover-risk-map`

LANE_TITLE: TaskLoop import and runtime call-site cutover risk map

LANE_SCOPE:

- Map every future place that could import or invoke `createRuntimeMemoryRuntimeIntegration`, `RuntimeMemoryRuntimeIntegration`, `createRuntimeMemoryPersistenceStore`, or the Phase 9 persistence owner from TaskLoop, Gateway, Electron Main, renderer, shared host contracts, security, retry, tool policy, verifier, or runtime execution paths.
- Define evidence required before any such import can be accepted, including disabled parity, no-open/no-read/no-write proof, rollout flag, rollback, error mapping, retry behavior, task lifecycle parity, and comms impact.
- Prove Phase 12 does not add the import or call site.
- Do not implement cutover.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-a-taskloop-callsite-cutover-risk-map.md
```

## Lane B: Provider Registration And Order Cutover Risk Map

LANE_ID: `lane-b-provider-registration-order-risk-map`

LANE_TITLE: Provider registration and provider ordering cutover risk map

LANE_SCOPE:

- Map default provider registry order and all future ways Runtime Memory could become registered by default.
- Define evidence required before any default provider registration or provider ordering cutover can be accepted, including disabled parity, explicit flag behavior, provider output parity, rollback, prompt byte/order impact, and no-authority metadata.
- Prove `runtime.memory.persist` does not enable provider output and `runtime.memory.provider` remains separate.
- Prove Phase 12 does not change provider registration or ordering.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-b-provider-registration-order-risk-map.md
```

## Lane C: Durable Fact Promotion Authority Gate Proof Plan

LANE_ID: `lane-c-durable-fact-authority-gate-proof-plan`

LANE_TITLE: Durable fact promotion authority gate proof plan

LANE_SCOPE:

- Define the proof required before memory-derived facts can influence runtime context beyond readonly summaries.
- Require source episode refs, evidence refs, accepted verification status, finite `acceptedAt`, and verifier/human/deterministic-rule promotion evidence for durable facts.
- Require proof that candidates, LLM proposals, rejected facts, invalidated facts, expired facts, and unpromoted facts are excluded from current-valid queries by default.
- Reject any memory-derived completion, verifier, security, retry, tool, or runtime authority.
- Do not implement automatic extraction or promotion.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-c-durable-fact-authority-gate-proof-plan.md
```

## Lane D: Rollback, Operator, Docs, And Config Proof Plan

LANE_ID: `lane-d-rollback-operator-docs-config-proof-plan`

LANE_TITLE: Rollback, operator, docs, and config proof plan

LANE_SCOPE:

- Define rollback evidence required before any future cutover: disable flags, omit adapter imports, omit provider registration, preserve existing Phase 9 rows, and keep legacy runtime behavior authoritative.
- Define operator/config evidence required before exposing persistence flows or defaults.
- Keep `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, and `runtime.memory.persist` default false.
- Review docs sync expectations for `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and other user-visible docs if a future phase changes behavior.
- Do not accept default-on persistence or operator-facing persistence in Phase 12.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-d-rollback-operator-docs-config-proof-plan.md
```

## Lane E: Validation, Scans, And Comms Proof Plan

LANE_ID: `lane-e-validation-scans-comms-proof-plan`

LANE_TITLE: Validation, scans, and comms proof plan

LANE_SCOPE:

- Confirm A-D submissions exist and each has exactly one valid `Status` line.
- Run Phase 12 harness context/validate.
- Run Phase 11, Phase 10, and Phase 9 harness validate.
- Run focused Runtime Memory tests, node typecheck, renderer boundary scan, runtime authority import scan, raw-retention scan, service/exporter/database-service/listener scan, and persistence scan.
- Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.
- Classify A-D as accepted / needs_revision / blocked.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-e-validation-scans-comms-proof-plan.md
```

## Execution Order

1. Run Lane A and Lane B first because they map the riskiest future cutover surfaces.
2. Run Lane C and Lane D in parallel after A/B identify the relevant future authority and rollback surfaces.
3. Run Lane E after A-D submissions exist.
4. Run synthesis after Lane E completes validation.

Each lane must stand on its own evidence. Do not accept another lane's unverified claim by reference.
