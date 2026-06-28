# Phase 11 Parallel Lanes

All lanes write submissions under `submissions/`. Use Lane A first, then run B/C/D in parallel after Lane A has a stable adapter boundary or explicitly blocks it.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function/test/command evidence for each claim;
- proof that Phase 10 synthesis is accepted and only accepted default-off boundary/readiness;
- proof that Phase 9 synthesis accepted only default-off local sanitized persistence foundation;
- flag-off parity evidence for every touched legacy path;
- no SQLite open/read/write evidence when `runtime.memory.persist` is false;
- sanitized read/write proof for any adapter path;
- no TaskLoop/Gateway/Electron/renderer/shared/default-registry wiring proof;
- provider ordering proof if provider/context code is touched;
- raw chat/raw trace/raw-retention evidence;
- service/exporter/database-service/listener scans;
- source episode/evidence-ref/promotion-evidence proof for durable fact claims;
- current-valid query proof excluding invalidated, expired, rejected, candidate, and unpromoted facts by default;
- comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.

Use `needs_revision` for missing evidence, default-on behavior, raw retention, unverified durable facts, provider-ordering cutover, persistence without rollback, runtime reads/writes when disabled, service/exporter/database-service/listener additions, or memory behavior that can execute side effects or affect runtime authority.

## Lane A: Adapter Contract And Flag-Off Parity

LANE_ID: `lane-a-adapter-contract-flag-off-parity`

LANE_TITLE: Adapter contract, isolation, and no-open disabled parity

LANE_SCOPE:

- Define or implement an isolated runtime memory integration adapter.
- Prove the disabled path does not instantiate/open/read/write SQLite.
- Prove the adapter is not imported by TaskLoop, Gateway, Electron, renderer, shared host contracts, default provider registry, verifier, security, retry, or tool policy paths.
- Do not add TaskLoop/Gateway/provider/default-on cutover.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-a-adapter-contract-flag-off-parity.md
```

## Lane B: Sanitized Write Boundary

LANE_ID: `lane-b-sanitized-write-boundary`

LANE_TITLE: Sanitized adapter write boundary

LANE_SCOPE:

- Implement or prove adapter write methods for episodes, facts, candidates, and invalidations.
- Accept only Runtime Memory record shapes or explicit builder outputs that pass existing sanitizers.
- Reject raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret/raw trace context.
- Keep durable fact promotion restricted to verifier, human, or deterministic-rule evidence.
- Do not import runtime execution paths or add automatic extraction/promotion.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-b-sanitized-write-boundary.md
```

## Lane C: Read Hydration And Provider Boundary

LANE_ID: `lane-c-read-hydration-provider-boundary`

LANE_TITLE: Read hydration and explicit provider boundary

LANE_SCOPE:

- Implement or prove adapter read hydration through `RuntimeMemoryStore` only.
- If provider hydration is touched, use explicit extra-provider injection only.
- Keep `runtime.memory.persist` and `runtime.memory.provider` independent.
- Prove default provider ordering is unchanged.
- Prove provider output remains readonly, budgeted, shadow/no-authority, and default false.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-c-read-hydration-provider-boundary.md
```

## Lane D: Config Docs Rollback Boundary

LANE_ID: `lane-d-config-docs-rollback-boundary`

LANE_TITLE: Config help, docs, rollback, and stale wording cleanup

LANE_SCOPE:

- Update stale `runtime.memory.persist` config help/types wording if Phase 11 adds adapter code or operator-visible help.
- Keep wording explicit that persistence remains default-off and does not imply TaskLoop/Gateway/provider/default-on cutover.
- Review README doc-sync requirements and update only if user-facing behavior changed.
- Prove rollback is disable flags/omit adapter/omit provider, preserving existing persisted rows.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-d-config-docs-rollback-boundary.md
```

## Lane E: Validation And Synthesis Readiness

LANE_ID: `lane-e-validation-synthesis-readiness`

LANE_TITLE: Validation, scans, and synthesis readiness

LANE_SCOPE:

- Confirm A-D submissions exist and each has exactly one valid `Status` line.
- Run Phase 11/10/9 harness validate.
- Run focused runtime memory tests, node typecheck, renderer bypass scans, raw-retention scans, service/exporter/database-service/listener scans, runtime authority import scans, and persistence scans.
- Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.
- Classify A-D as accepted / needs_revision / blocked.

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-e-validation-synthesis-readiness.md
```

## Execution Order

1. Run Lane A first.
2. Run Lane B, Lane C, and Lane D in parallel after Lane A is accepted or clearly stable.
3. Run Lane E after A-D submissions exist.
4. Run synthesis after Lane E completes validation.

Lane B, C, and D must not assume another lane's unverified claim. Each lane needs its own code/test/scan evidence.
