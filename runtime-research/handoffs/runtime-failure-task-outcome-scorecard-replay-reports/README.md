# Runtime Failure Task Outcome Scorecard Replay Reports

Status: phase_4_evaluation_metadata_only.

This handoff records the Phase 4 implementation of a deterministic task outcome scorecard core. The core is local/dev/test-only and inert unless explicitly imported by tests or a future accepted spec.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md` | Follow-up task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts` | Pure in-memory scorecard core from Phase 3 replay reports. |
| `tests/unit/runtime-failure-task-outcome-scorecard-replay-reports.test.ts` | Focused proof for five reports, determinism, bounded output, provenance, sanitization, fail-closed behavior, and no active consumer. |
| `validation-plan.md` | Phase 4 validation commands and boundary scans. |
| `synthesis.md` | Phase 4 outcome and next recommended step. |

## Scope

- Accept Phase 3 `RuntimeFailureReplayReport` values only when they are diagnostics-only and not completion proof.
- Reject missing replay metadata, missing provenance, non-JSON payloads, oversized reports, oversized scorecards, `completionProof: true`, and `diagnosticsOnly: false`.
- Produce deterministic, JSON-serializable, bounded scorecards with `authority: 'none'`.
- Cover task completed, wrong-file edit, unnecessary edit, retry correctness, ask-user appropriateness, and test recovery success.
- Preserve replay/failure/evidence/touched-path provenance for metrics and aggregate decisions.

## Stop Lines

- Do not wire scorecards into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not read live providers, execute real tool mutation, or modify the real workspace.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write scorecards, replay reports, or evidence envelopes into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat replay reports, scorecards, evidence, or failure events as task completion proof.
- Do not let scorecard authority exceed `none`.

## Status Vocabulary

- `phase_4_evaluation_metadata_only`: scorecard core exists, validates, and has no active runtime consumer.
- `ready_for_governance_advisory_design`: Phase 4 tests and boundary scans pass; future specs may design advisory governance rules measured by scorecards.
- `needs_follow_up`: coverage, provenance, sanitization, determinism, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.
