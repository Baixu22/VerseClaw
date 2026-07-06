# Runtime Failure Tool Invocation Governance Advisory Rules

Status: phase_5_advisory_diagnostics_only.

This handoff records the Phase 5 implementation of deterministic tool invocation governance advisory diagnostics. The core is local/dev/test-only and inert unless explicitly imported by tests or a future accepted spec.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md` | Follow-up task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-advisory.ts` | Pure in-memory advisory governance core from Phase 3 replay reports plus Phase 4 scorecards. |
| `tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts` | Focused proof for five fixture reports, determinism, bounded output, provenance, sanitization, fail-closed behavior, and no active consumer. |
| `validation-plan.md` | Phase 5 validation commands and boundary scans. |
| `synthesis.md` | Phase 5 outcome and next recommended step. |
| `limited-active-guard-design-prep.md` | Non-implementation prep for the next limited active guard design spec. |

## Scope

- Accept only Phase 3 `RuntimeFailureReplayReport` values plus Phase 4 `RuntimeFailureTaskOutcomeScorecard` values.
- Reject missing replay metadata, missing scorecard metadata, missing provenance, non-JSON payloads, oversized input/output, `completionProof: true`, `diagnosticsOnly: false`, and `activeBlocking: true`.
- Produce deterministic, JSON-serializable, bounded governance reports with `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- Cover destructive operation guard, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user vs continue policy, and tool result provenance.
- Preserve replay/scorecard/failure/evidence/touched-path provenance for findings and aggregate recommendations.

## Gap Closure

The Phase 5 closure pass adds focused advisory cases for each first-wave rule:

- destructive operation guard with deleted-path metadata and future active-spec candidate proof
- repeated failure backoff with duplicate failure kind/stage metadata
- timeout classification with provider-timeout metadata
- long-running process detection with timeout and slow non-completed metadata
- false-positive protection for slow but completed test repair metadata
- shell/environment contamination detection with dirty-workspace metadata
- ask-user vs continue policy with permission/contamination metadata
- tool result provenance with rejected evidence metadata

These cases remain synthetic diagnostics derived from Phase 3 replay reports. They do not execute real tools, read live providers, mutate the workspace, or introduce active runtime consumers.

## Stop Lines

- Do not wire governance reports into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not read live providers, execute real tool mutation, or modify the real workspace.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write governance reports, scorecards, replay reports, or evidence envelopes into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat replay reports, scorecards, governance reports, evidence, or failure events as task completion proof.
- Do not let governance authority exceed `none`.
- Do not treat `block` as an active runtime decision in this phase.

## Status Vocabulary

- `phase_5_advisory_diagnostics_only`: governance core exists, validates, and has no active runtime consumer.
- `ready_for_limited_active_guard_design`: Phase 5 tests and boundary scans pass; future specs may design a narrow active guard using replay/scorecard proof.
- `needs_follow_up`: coverage, provenance, sanitization, determinism, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.
