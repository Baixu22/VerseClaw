# Runtime Failure Replay Harness Core Fixtures

Status: phase_3_diagnostics_only.

This handoff records the Phase 3 implementation of a deterministic, fixture-backed replay harness core. The harness is local/dev/test-only and inert unless explicitly imported by tests or a future accepted spec.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md` | Follow-up task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts` | Pure in-memory replay harness core. |
| `tests/fixtures/runtime-replay/*.json` | First fixture corpus for success, tool error, provider timeout, test failure after repair, and dirty workspace. |
| `tests/unit/runtime-failure-replay-harness-core-fixtures.test.ts` | Focused proof for fixture validation, determinism, report bounds, sanitization, and no active consumer. |
| `validation-plan.md` | Phase 3 validation commands and boundary scans. |
| `synthesis.md` | Phase 3 outcome and next recommended step. |

## Scope

- Accept validated fixture-backed `ReplayCase` inputs.
- Reject missing provider/tool/workspace fixtures, live provider defaults, invalid scenarios, and invalid budgets.
- Generate `FailureEvent` values through the Phase 1 passive classifier or accept loaded fixtures only after validation.
- Generate evidence decisions through the Phase 2 failure summary adapter or accept loaded envelopes only after validation.
- Return deterministic, JSON-serializable, bounded diagnostics-only reports.

## Stop Lines

- Do not wire replay into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not read live providers, execute real tool mutation, or modify the real workspace.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write replay reports or evidence envelopes into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat replay reports, evidence, or scorecards as task completion proof.
- Do not let envelope authority exceed `none`.

## Status Vocabulary

- `phase_3_diagnostics_only`: replay core exists, validates, and has no active runtime consumer.
- `ready_for_scorecard_design`: Phase 3 tests and boundary scans pass; future specs may design a scorecard consumer.
- `needs_follow_up`: coverage, sanitization, determinism, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.
