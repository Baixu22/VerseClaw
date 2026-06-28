# Phase 5 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and must write its own submission under `submissions/`.

## Lane A: Contracts And Harness

LANE_ID: `lane-a-contracts-and-harness`

LANE_TITLE: Evidence Verifier contract, taxonomy, handoff scaffold, and harness spec

LANE_SCOPE:

- Add the Phase 5 handoff scaffold and task spec.
- Define the canonical runtime-core Evidence Verifier contract/taxonomy.
- Cover file/test/tool/trace/human evidence kinds.
- Define verifier input, decision, finding severity/category/code taxonomy, feature flags, type guards, fixture builder, and deterministic contract evaluator.
- Keep all flags default-off and contract/shadow-only.
- Do not touch TaskLoop integration in this lane.

SUGGESTED_PATHS:

- `runtime-research/handoffs/phase-5-evidence-verifier/**`
- `harness/specs/tasks/phase-5-evidence-verifier.md`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-evidence-verifier-contracts.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-a-contracts-and-harness.md
```

## Lane B: Evidence Collector Shadow

LANE_ID: `lane-b-evidence-collector-shadow`

LANE_TITLE: File/test/tool/trace/human evidence collector adapters

LANE_SCOPE:

- Add deterministic adapters that normalize already-available evidence into the Lane A contract.
- Store only evidence refs, hashes, command summaries, status codes, and sanitized counts.
- Do not run tests, lint, typecheck, shell commands, or model judges from verifier runtime behavior.
- Do not persist raw prompts, full tool args/output, full event payloads, or full checkpoints.

## Lane C: Runtime Adapter Shadow

LANE_ID: `lane-c-runtime-adapter-shadow`

LANE_TITLE: Warning-only runtime verifier adapter

LANE_SCOPE:

- Connect accepted evidence inputs into warning-only verifier reports behind explicit shadow flags.
- Preserve legacy completion, blocked/failed statuses, tool invocation behavior, approval waiting, retry, and error mapping.
- Do not introduce a default-on gate or change TaskLoop authority.

## Lane D: Completion Gate Pilot Plan

LANE_ID: `lane-d-completion-gate-pilot-plan`

LANE_TITLE: Future completion gate rollout and rollback plan

LANE_SCOPE:

- Specify how a later code-editing-task gate could move from warning-only to blocking.
- Require rollout, rollback, flag-off parity, failed-vs-blocked taxonomy, and user-visible behavior tests.
- Do not implement or enable the gate in Phase 5 Lane D.

## Lane E: Validation Docs Synthesis

LANE_ID: `lane-e-validation-docs-synthesis`

LANE_TITLE: Phase 5 validation, boundary scans, docs/index updates, synthesis readiness

LANE_SCOPE:

- Validate `phase-5-evidence-verifier` harness spec.
- Run focused verifier tests, node typecheck, and boundary scans.
- Run comms replay/compare only if Main/Gateway communication paths changed.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts lanes.
