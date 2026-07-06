# Schema Decision Log

Record every contract decision here before or during implementation. This keeps later agents from silently changing semantics.

## Decision Template

```text
Decision:
Status: proposed | accepted | rejected | superseded
Date:
Applies to: FailureEvent | EvidenceEnvelope | ReplayCase | TaskOutcomeScorecard | ToolGovernanceDecision
Context:
Accepted shape:
Rejected alternatives:
Validation impact:
Replay impact:
Rollback impact:
Follow-up:
```

## Current Decisions

### Evidence Has No Authority

Status: accepted

Applies to: EvidenceEnvelope

Accepted shape:

- `authority: 'none'`
- `rawRetained: false`
- fail closed if either field violates the allowed value

Rejected alternatives:

- evidence that directly controls retry, approval, rollback, completion, provider selection, Gateway routing, checkpoint state, lifecycle state, or tool blocking
- evidence that persists raw prompt/provider/tool payloads

Validation impact:

- Unit tests must reject any authority value other than `none`.
- Boundary scans must search for authority-bearing evidence consumers.

Replay impact:

- Replay can record evidence accept/reject decisions.
- Replay cannot treat evidence as completion proof by itself.

Rollback impact:

- Disable or remove evidence producers/validators with no data migration.

### Failure Suggested Actions Are Advisory First

Status: accepted

Applies to: FailureEvent

Accepted shape:

- `suggestedAction` may be `retry`, `ask_user`, `rollback_recommended`, `degrade`, `stop`, or `continue_with_caution`.
- Action consumers are not active until a future spec accepts them.

Rejected alternatives:

- classifier output directly retries tools
- classifier output directly rolls back files
- classifier output directly marks blocked or complete

Validation impact:

- Tests must prove passive classification does not change default behavior.

Replay impact:

- Replay should compare action recommendation quality before active consumption.

Rollback impact:

- Disable the passive classifier or consumer flag.

### Replay Is Fixture-Backed By Default

Status: accepted

Applies to: ReplayCase

Accepted shape:

- provider outputs come from fixtures
- tool outputs come from fixtures or isolated replay tools
- workspace state comes from fixtures or isolated worktrees

Rejected alternatives:

- live provider replay by default
- mutation of the developer workspace outside an explicit fixture/worktree
- replay reports depending on wall-clock network behavior

Validation impact:

- Replay determinism must be tested by repeated runs.

Replay impact:

- First corpus is success, tool error, test failure, provider timeout, and dirty workspace.

Rollback impact:

- Delete local replay fixtures/artifacts without changing runtime state.

### Scorecard Is Evaluation Metadata

Status: accepted

Applies to: TaskOutcomeScorecard

Accepted shape:

- score metrics reference replay/evidence/failure/tool provenance
- score output is `improved`, `regressed`, `neutral`, or `inconclusive`

Rejected alternatives:

- scorecard as task completion proof
- scorecard as active runtime gate before a future gate spec

Validation impact:

- Tests must require evidence refs for nontrivial metrics.

Replay impact:

- Scorecard consumes replay reports only after report schema stabilizes.

Rollback impact:

- Disable scorecard generation without affecting runtime behavior.

### Governance Starts Advisory Or Narrow

Status: accepted

Applies to: ToolGovernanceDecision

Accepted shape:

- first decisions may be `allow`, `warn`, `ask_user`, `backoff`, or `block`
- `block` requires a future spec unless the rule is explicitly narrow and accepted

Rejected alternatives:

- broad destructive pattern matching that blocks normal development workflows
- repeated failure backoff that hides useful recovery attempts
- timeout handling that treats slow tests and long-running dev servers as identical failures

Validation impact:

- Governance tests must cover false positive and false blocked cases.

Replay impact:

- Active guards require replay/scorecard improvement proof.

Rollback impact:

- Disable the specific rule flag to restore legacy tool behavior.

### Phase 0 Contracts Are Schema-Only And Fail Closed

Status: accepted

Date: 2026-07-01

Applies to: FailureEvent | EvidenceEnvelope | ReplayCase

Context:

- `runtime-failure-evidence-replay-schema-spike` implements only typed contracts and validators.
- No active runtime consumer is introduced.

Accepted shape:

- `FailureEvent` requires `id`, `stage`, `kind`, `recoverability`, `suggestedAction`, `confidence`, `source`, `occurredAt`, `summary`, `evidenceRefs`, `rawRetained: false`, and redaction `metadata_only` or `sanitized`.
- `EvidenceEnvelope` requires `id`, `kind`, `source`, `scope`, `createdAt`, positive `ttlMs`, `confidence`, `redaction`, `provenance`, `authority: 'none'`, and a bounded JSON-serializable `payload`.
- `ReplayCase` requires `id`, `title`, `scenario`, fixture-backed `input`, `expected`, and positive `budgets`.

Rejected alternatives:

- evidence authority other than `none`
- retained raw prompt/provider/tool/workspace payloads
- replay cases that omit provider, tool, or workspace fixtures
- replay cases that default to live providers
- wiring these contracts into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking

Validation impact:

- Validators reject missing required fields, illegal enums, malformed timestamps, expired evidence, nonpositive TTL, confidence outside `0..1`, missing redaction/provenance, `rawRetained: true`, authority other than `none`, oversized payloads, missing replay fixtures, and live-provider defaults.
- Focused unit coverage lives in `tests/unit/runtime-failure-evidence-replay-schema-spike.test.ts`.

Replay impact:

- Replay remains fixture-backed by contract.
- This phase does not execute replay cases or create replay artifacts.

Rollback impact:

- Delete the schema-only file, additive export, focused test, and follow-up spec with no data migration.

Follow-up:

- A later passive Failure Intelligence spec may consume `FailureEvent` only after its own harness spec, tests, and rollback are accepted.

### Phase 1 Failure Intelligence Is Passive Shadow Only

Status: accepted

Date: 2026-07-01

Applies to: FailureEvent

Context:

- `runtime-failure-intelligence-passive-shadow` implements a passive classifier that returns Phase 0 `FailureEvent` values.
- Classifier output is validated with `validateFailureEvent`.
- No active runtime consumer is introduced.

Accepted shape:

- Classifier input accepts `id`, `source`, `occurredAt`, `signal`, optional `runId`, optional `evidenceRefs`, and optional bounded message/status metadata.
- Classifier output is a `FailureEvent` with `rawRetained: false` and redaction `sanitized`.
- Supported stages are `planning`, `tool_call`, `patch`, `test`, `provider`, `gateway`, `user_interrupt`, and `unknown`.
- Supported kinds are `permission`, `path`, `dependency`, `timeout`, `type_error`, `test_failure`, `environment_contamination`, `context_insufficient`, `provider_error`, `gateway_error`, and `unknown`.
- `suggestedAction` remains advisory-only.
- Unknown fallback is stable, bounded, and test-covered.

Rejected alternatives:

- classifier output directly retrying, asking the user, rolling back, stopping, completing, or blocking tools
- wiring classifier output into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking
- persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
- writing failure events into checkpoint or lifecycle authority state

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-intelligence-passive-shadow.test.ts`.
- Tests cover representative tool error, test failure, provider timeout, gateway error, user interruption, secret sanitization, stable unknown fallback, validator proof, advisory-only suggested action, and no active consumer.

Replay impact:

- This phase does not add replay execution or replay artifacts.
- A future replay spec may consume passive failure events only through its own accepted fixtures and validation gates.

Rollback impact:

- Delete the passive classifier, additive export, focused unit test, task spec, and Phase 1 handoff package with no migration.

Follow-up:

- A later Evidence Envelope failure summary spec may wrap sanitized passive failure summaries with authority `none`, but it must not inject evidence into prompts or active runtime decisions without a separate accepted consumer spec.

### Phase 2 Failure Summary Envelopes Are Diagnostics-Only

Status: accepted

Date: 2026-07-01

Applies to: EvidenceEnvelope

Context:

- `runtime-failure-evidence-envelope-failure-summary` implements a narrow adapter from Phase 1 sanitized `FailureEvent` values to Phase 0 `EvidenceEnvelope` values.
- Adapter output is validated with `validateEvidenceEnvelope`.
- No active runtime consumer is introduced.

Accepted shape:

- Adapter input must pass `validateFailureEvent`.
- Adapter output is a `failure_summary` `EvidenceEnvelope`.
- Envelope `authority` is fixed to `none`.
- Top-level and redaction `rawRetained` are fixed to `false`.
- Source, scope, TTL, confidence, redaction, and provenance metadata are required.
- Payload contains only sanitized bounded summary text, classification metadata, and refs.
- Caller attempts to set authority above `none`, retain raw data, omit required metadata, exceed payload budget, or use expired TTL fail closed.

Rejected alternatives:

- envelope authority above `none`
- evidence prompt injection in this phase
- TaskLoop, provider, Gateway, retry, approval, rollback, completion, or tool-blocking consumers
- writing evidence envelopes into checkpoint or lifecycle authority state
- persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-evidence-envelope-failure-summary.test.ts`.
- Tests cover valid passive failure wrapping, invalid failure rejection, raw-retention rejection, authority rejection, missing metadata rejection, expired TTL rejection, oversized payload rejection, sanitizer proof, validator proof, no active consumer, and no checkpoint/lifecycle write.

Replay impact:

- This phase does not add replay execution, replay capture, or replay artifacts.
- A future replay spec may consume these envelopes only through its own accepted fixtures and validation gates.

Rollback impact:

- Delete the adapter, additive export, focused unit test, task spec, and Phase 2 handoff package with no migration.

Follow-up:

- A future replay or prompt-slot design spec may consume failure summary envelopes only if it remains read-only/default-off and preserves the `authority: 'none'` boundary.

### Phase 3 Replay Harness Core Is Fixture-Backed Diagnostics Only

Status: accepted

Date: 2026-07-01

Applies to: ReplayCase | FailureEvent | EvidenceEnvelope

Context:

- `runtime-failure-replay-harness-core-fixtures` implements a local/dev/test-only deterministic replay harness core.
- The harness consumes explicit provider/tool/workspace fixtures and never defaults to live providers.
- Reports are diagnostics/evaluation metadata only and are not task completion proof.

Accepted shape:

- Replay input must pass `validateReplayCase`.
- Provider, tool, and workspace fixtures must be explicit, non-empty, and ref-matched to the `ReplayCase` input.
- Live provider defaults fail closed.
- Failure events are generated through the Phase 1 passive classifier or accepted only after `validateFailureEvent`.
- Evidence decisions are generated through the Phase 2 failure summary adapter or accepted only after `validateEvidenceEnvelope`.
- Evidence authority remains `none`.
- Reports are deterministic, JSON-serializable, bounded, diagnostics-only, and include only sanitized replay metadata, fixture refs, failure events, evidence decisions, terminal status, and touched path summaries.

Rejected alternatives:

- live provider replay by default
- real tool execution or real workspace mutation
- active TaskLoop, provider, Gateway, prompt/model-message, retry, approval, rollback, completion, or tool-blocking consumers
- checkpoint or lifecycle authority writes
- services, daemons, listeners, servers, databases, exporters, or schedulers for replay
- replay reports, evidence, or scorecards as task completion proof
- raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content in reports

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-replay-harness-core-fixtures.test.ts`.
- Tests cover the first five fixture scenarios, fixture validation, deterministic repeated output, generated/loaded failure and evidence validation, fail-closed rejection, report bounds, sanitization, no active consumer, and no checkpoint/lifecycle write.

Replay impact:

- First fixture corpus lives under `tests/fixtures/runtime-replay`.
- Replay reports are stable enough for a future scorecard design spec, but only as evaluation metadata.

Rollback impact:

- Delete the replay harness core, additive export, fixtures, focused test, Phase 3 spec, and Phase 3 handoff package with no migration.

Follow-up:

- A future task outcome scorecard spec may consume replay reports only if it preserves diagnostics-only authority and does not claim active runtime readiness.

### Phase 4 Task Outcome Scorecards Are Evaluation Metadata Only

Status: accepted

Date: 2026-07-01

Applies to: TaskOutcomeScorecard

Context:

- `runtime-failure-task-outcome-scorecard-replay-reports` implements a local/dev/test-only scorecard core.
- The scorecard consumes Phase 3 `RuntimeFailureReplayReport` values only when they are diagnostics-only and not completion proof.
- No active runtime consumer is introduced.

Accepted shape:

- Input must be a Phase 3 replay report with `diagnosticsOnly: true`, `completionProof: false`, replay metadata, bounded JSON payload, and provenance sufficient for metrics.
- Output is deterministic, JSON-serializable, bounded, diagnostics-only, evaluation metadata only, and has `authority: 'none'`.
- First metrics are `task_completed`, `wrong_file_edit`, `unnecessary_edit`, `retry_correctness`, `ask_user_appropriateness`, and `test_recovery_success`.
- Every metric and aggregate decision preserves replay/failure/evidence/touched-path provenance refs.
- Aggregate decisions are limited to `improved`, `regressed`, `neutral`, and `inconclusive`.

Rejected alternatives:

- scorecards as task completion proof
- scorecards as active runtime gates
- wiring scorecards into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking
- writing scorecards or replay reports into checkpoint or lifecycle authority state
- retaining raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-task-outcome-scorecard-replay-reports.test.ts`.
- Tests cover the five Phase 3 fixture reports, determinism, bounded JSON output, provenance refs, aggregate decisions, fail-closed validation, sanitization, no active consumer, and no checkpoint/lifecycle write.

Replay impact:

- Scorecards consume replay reports as evaluation metadata only.
- Replay reports and scorecards remain insufficient to prove task completion or approve active governance.

Rollback impact:

- Delete the scorecard core, additive export, focused unit test, task spec, and Phase 4 handoff package with no migration.

Follow-up:

- A future tool invocation governance advisory spec may use scorecard deltas as evaluation metadata only; active blocking still requires a separate accepted spec.

### Phase 5 Tool Invocation Governance Is Advisory Diagnostics Only

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-advisory-rules` implements a local/dev/test-only governance advisory core.
- The core consumes Phase 3 `RuntimeFailureReplayReport` values and Phase 4 `RuntimeFailureTaskOutcomeScorecard` values only when they are diagnostics/evaluation metadata and not completion proof.
- No active runtime consumer is introduced.

Accepted shape:

- Input must be a Phase 3 replay report plus a Phase 4 scorecard with `diagnosticsOnly: true`, `completionProof: false`, bounded JSON payloads, matching source metadata, and no `activeBlocking: true`.
- Output is deterministic, JSON-serializable, bounded, diagnostics-only, evaluation metadata only, advisory-only, and has `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- First advisory rules are `destructive_operation_guard`, `repeated_failure_backoff`, `timeout_classification`, `long_running_process_detection`, `shell_environment_contamination_detection`, `ask_user_vs_continue_policy`, and `tool_result_provenance`.
- Every finding and aggregate recommendation preserves replay/scorecard/failure/evidence/touched-path provenance refs.
- Aggregate recommendations are limited to `advisory_pass`, `advisory_warn`, `advisory_backoff`, `advisory_ask_user`, and `inconclusive`.
- `block` may appear only as a future active-spec candidate with `requiresAcceptedSpec: true`; it does not block tools in this phase.

Rejected alternatives:

- governance reports as active runtime gates
- governance reports as task completion proof
- default tool blocking from advisory diagnostics
- wiring governance into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking
- writing governance reports, scorecards, or replay reports into checkpoint or lifecycle authority state
- retaining raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts`.
- Tests cover the five Phase 3 fixture reports with Phase 4 scorecards, determinism, bounded JSON output, provenance refs, aggregate recommendations, fail-closed validation, sanitization, no active consumer, and no checkpoint/lifecycle write.
- A closure pass adds focused advisory cases for destructive operation detection, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user policy, tool result provenance, and slow completed test false-positive protection.

Replay impact:

- Governance consumes replay reports and scorecards as evaluation metadata only.
- Replay reports, scorecards, and governance reports remain insufficient to prove task completion or approve active blocking.

Rollback impact:

- Delete the governance core, additive export, focused unit test, task spec, and Phase 5 handoff package with no migration.

Follow-up:

- A future limited active guard spec may evaluate one narrow rule at a time only after replay/scorecard proof, false-block analysis, explicit rollback, and a fresh boundary review.

### Limited Active Guard Design Is Readiness Only

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-limited-active-guard-design` creates a design/readiness handoff for the next governance step.
- The phase evaluates only the `destructive_operation_guard` advisory rule as a future limited active guard candidate.
- No active runtime consumer, TaskLoop wiring, provider wiring, Gateway wiring, prompt/model-message wiring, retry/approval/rollback/completion wiring, or tool-blocking behavior is introduced.

Accepted shape:

- Candidate scope is exactly `destructive_operation_guard`.
- Phase 5 advisory reports remain diagnostics-only, evaluation metadata only, advisory-only, `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- `block` remains only `futureActiveCandidate.action: "block"` metadata with `requiresAcceptedSpec: true`; it is not a current runtime decision.
- Future active prerequisites require Phase 5 advisory trigger metadata, replay/scorecard provenance, false-block cases, slow test and known dev-server false-positive protection, flag-disable rollback, and a boundary scan plan.
- Future active owner boundary, if later accepted, must be mutation-capable tool invocation preflight owned by tool execution; TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory report generation, retry, approval, rollback, and completion paths must not own the active decision.

Rejected alternatives:

- approving active runtime readiness from this design package
- evaluating any rule other than `destructive_operation_guard`
- default tool blocking from governance advisory metadata
- importing or wiring governance advisory code into active runtime paths
- writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, or readiness reports into checkpoint or lifecycle authority state
- reading live providers, executing real tool mutation, modifying the real workspace, or retaining raw prompt/provider/tool/secret/env/workspace content
- treating governance reports, replay reports, scorecards, evidence, failure events, or readiness docs as task completion proof

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Future active specs must add focused tests and boundary scans before proposing any runtime consumer.

Replay impact:

- Replay and scorecard metadata remain evidence for future design review only.
- False-block cases must include expected edits, normal repair, completed test repair, sanitized/inconclusive path metadata, legitimate fixture mutation, slow tests, and known dev-server-like long-running commands.

Rollback impact:

- Delete this design spec, the limited-active-guard-design handoff package, and these parent doc entries with no runtime migration.
- Future active behavior, if ever accepted, must have an explicit disable flag that restores legacy behavior without migration or state cleanup.

Follow-up:

- A later implementation spec may request active behavior only after it supplies replay/scorecard proof, false-block analysis, flag-disable rollback proof, and boundary scans.

### Destructive Operation Guard Evidence Proof Is Corpus-Only

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof` implements a replay/scorecard/governance proof report for the single `destructive_operation_guard` candidate.
- The phase uses fixture-owned or synthetic in-memory metadata only.
- No active runtime consumer, TaskLoop wiring, provider wiring, Gateway wiring, prompt/model-message wiring, retry/approval/rollback/completion wiring, or tool-blocking behavior is introduced.

Accepted shape:

- Inputs are Phase 3 `RuntimeFailureReplayReport` values and Phase 4 `RuntimeFailureTaskOutcomeScorecard` values, used only as diagnostics/evaluation metadata.
- The helper derives Phase 5 advisory findings in-memory and emits a bounded JSON-serializable proof report with `diagnosticsOnly: true`, `completionProof: false`, `evaluationMetadataOnly: true`, `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- A trigger is evidence-qualified only when deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, and Phase 5 `futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true` are all present.
- False-block coverage includes expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched-path metadata, legitimate fixture mutation, slow test command metadata, and known dev-server-like long-running metadata.
- The proof preserves replay id/scenario/terminal status, scorecard aggregate decision, edit metric refs, failure refs, evidence refs, and touched-path refs.
- Readiness metadata records that a future active spec needs an explicit disable flag and must keep the owner boundary at mutation-capable tool invocation preflight.

Rejected alternatives:

- treating deleted touched-path metadata alone as enough for future active blocking
- approving active runtime readiness from the evidence proof
- default tool blocking from governance advisory metadata
- importing or wiring the proof helper into active runtime paths
- writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, or evidence proof reports into checkpoint or lifecycle authority state
- reading live providers, executing real tool mutation, modifying the real workspace, or retaining raw prompt/provider/tool/secret/env/workspace content
- treating governance reports, replay reports, scorecards, evidence, failure events, or evidence proof reports as task completion proof

Validation impact:

- Focused unit coverage lives in `tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts`.
- Tests cover the positive trigger, all false-block categories, provenance refs, safety metadata, sanitization, bounded JSON output, a negative false-block regression, and active-consumer/checkpoint boundary scans.

Replay impact:

- Replay and scorecard metadata remain evidence for future design review only.
- The expected-deletion case proves Phase 5 future candidate metadata alone is too broad for active behavior; passing edit metrics keep the proof non-triggering.

Rollback impact:

- Delete the evidence proof helper, focused unit test, task spec, evidence-proof handoff package, and these parent doc entries with no runtime migration.
- A future active implementation still needs an explicit disable flag that restores legacy behavior without migration or state cleanup.

Follow-up:

- A later implementation spec may request default-off active behavior only after it preserves tool invocation preflight ownership, defines flag-disable rollback, reruns false-block coverage, and proves no active consumer exists outside the accepted owner boundary.

### Destructive Operation Guard Default-Off Preflight Proposal Is Design-Only

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal` records Phase B of the `destructive_operation_guard` roadmap.
- The phase creates a proposal/design package only. It does not implement an active guard or active runtime consumer.

Accepted shape:

- Candidate scope remains exactly `destructive_operation_guard`.
- The only future active owner boundary is mutation-capable tool invocation preflight owned by tool execution.
- The future explicit default-off flag is `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- Omitted, `false`, or any non-boolean-true flag value means disabled.
- Flag-off rollback must restore legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup.
- A future active trigger requires explicit flag enablement, preflight ownership, deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 `futureActiveCandidate.action: "block"`, `requiresAcceptedSpec: true`, and the false-block corpus still passing.
- The false-block corpus includes expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.
- Phase C must prove the import/consumer boundary before any implementation phase.

Rejected alternatives:

- approving active runtime readiness from this proposal
- making `block` a current runtime decision
- using deleted touched-path metadata alone as an active trigger
- using broad shell command pattern blocking
- making TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, or renderer code the active owner
- reading live providers, executing real tool mutation, modifying the real workspace, or retaining raw prompt/provider/tool/secret/env/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- No Vitest is required because this phase is docs/spec only.

Replay impact:

- Replay reports, scorecards, governance reports, and evidence proof reports remain evidence for future design review only.
- The false-block corpus remains mandatory before any later active implementation spec can request blocking behavior.

Rollback impact:

- Delete this proposal spec, the default-off-preflight-proposal handoff package, and these parent doc entries with no runtime migration.
- Any future active behavior must still be removable by disabling the explicit flag or deleting the pilot, with no migration or state cleanup.

Follow-up:

- Phase C must prove a boundary/import contract that allows only a future accepted mutation-capable tool invocation preflight owner to consume active guard code.

### Destructive Operation Guard Boundary Import Contract Is Design-Only

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract` records Phase C of the `destructive_operation_guard` roadmap.
- The phase creates a boundary/import contract only. It does not implement an active guard or active runtime consumer.

Accepted shape:

- Candidate scope remains exactly `destructive_operation_guard`.
- The only future active consumer is a later accepted mutation-capable tool invocation preflight owner.
- Phase D must name the concrete preflight owner path before active code can be introduced.
- Denied roots include TaskLoop and agents orchestration, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services/preload, renderer surfaces, scripts, exporters, daemons, services, listeners, databases, schedulers, and always-on sidecars.
- Replay, scorecard, governance advisory, and evidence proof code remain evidence producers, not active decision owners.
- Boundary scans must use explicit path lists and exact candidate names, not unbounded workspace scans.
- A future implementation spec must add focused automated boundary scan coverage before active guard code is introduced.

Rejected alternatives:

- approving active runtime readiness from this boundary contract
- making `block` a current runtime decision
- allowing denied roots to import or consume active guard code
- using deleted touched-path metadata alone as an active trigger
- using broad shell command pattern blocking
- reading live providers, executing real tool mutation, modifying the real workspace, or retaining raw prompt/provider/tool/secret/env/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Phase C uses bounded manual scan evidence only; no Vitest is required because this phase is docs/spec only.
- Phase D must add focused automated boundary scans if it introduces active guard code.

Replay impact:

- Replay and scorecard metadata remain evidence for future design review only.
- Boundary scan output is not completion proof and does not approve active blocking.

Rollback impact:

- Delete this boundary/import spec, the boundary-scan-import-contract handoff package, and these parent doc entries with no runtime migration.

Follow-up:

- A later Phase D spec may request a default-off preflight pilot only if it preserves the boundary contract, proves flag-off legacy behavior, reruns false-block coverage, and keeps active ownership limited to mutation-capable tool invocation preflight.

### Destructive Operation Guard Default-Off Preflight Pilot Is Implemented

Status: accepted

Date: 2026-07-01

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot` records Phase D of the `destructive_operation_guard` roadmap.
- The phase implements a default-off pilot limited to mutation-capable tool invocation preflight.
- The phase does not approve production/default-on behavior and does not begin Phase E holdout expansion.

Accepted shape:

- Candidate scope remains exactly `destructive_operation_guard`.
- The concrete active owner is `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`, specifically `runBeforeToolCallHook`.
- The pilot helper lives at `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts`.
- The explicit default-off flag is `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- Omitted or `false` flag values preserve legacy tool behavior; schema validation accepts only boolean values.
- Flag-off evaluation returns an allow decision with `legacyBehavior: true`.
- Flag-on blocking requires mutation-capable preflight ownership, a matching `destructive_operation_guard` candidate, deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 future block candidate metadata, `requiresAcceptedSpec: true`, and passing false-block corpus metadata.
- The active pilot consumes explicit sanitized preflight candidate metadata only. Replay, scorecard, governance advisory, and evidence proof helpers remain evidence producers and are not invoked on the active preflight path.
- Focused tests cover flag-off legacy behavior, flag-on block behavior, non-owner and non-mutation allow paths, missing/invalid candidate allow paths, false-block trigger protection, sanitized diagnostics, config schema strictness, and automated boundary scans.

Rejected alternatives:

- defaulting the pilot on or default-blocking tools
- approving production/default-on readiness
- using deleted touched-path metadata alone as an active trigger
- using broad shell command pattern blocking
- running replay, scorecard, governance advisory, or evidence proof helpers as active preflight proof
- making TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, or scripts an active owner
- reading live providers, executing real tool mutation for proof, modifying the real workspace for proof, or retaining raw prompt/provider/tool/secret/env/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Focused Vitest must pass for `tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts` and `tests/unit/runtime-feature-config-schema.test.ts`.

Replay impact:

- Replay reports, scorecards, governance reports, and evidence proof reports remain evidence for future design review only.
- The pilot consumes only explicit candidate metadata supplied to mutation-capable preflight; it does not recompute replay or scorecard evidence in active runtime.

Rollback impact:

- Disable or omit `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` to restore legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup.
- Deleting the pilot removes the helper, hook integration, config schema entries, focused tests, Phase D spec/handoff package, and this parent doc entry.

Follow-up:

- Phase E may expand the synthetic and fixture-owned holdout corpus only in a separate Goal/spec. Phase D stops here.

### Destructive Operation Guard Holdout Regression Expansion Is Recorded

Status: accepted

Date: 2026-07-02

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion` records Phase E of the `destructive_operation_guard` roadmap.
- The phase expands synthetic and fixture-owned holdout/regression coverage after the Phase D default-off preflight pilot.
- The phase is tests/docs only. It does not change runtime behavior, approve production/default-on readiness, or begin Phase F readiness review.

Accepted shape:

- Candidate scope remains exactly `destructive_operation_guard`.
- The Phase D pilot remains default-off and owned only by mutation-capable tool invocation preflight.
- Holdout coverage includes expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.
- Expected deletion remains non-blocking even when deleted touched-path metadata and Phase 5 future block metadata are present, as long as `wrong_file_edit` and `unnecessary_edit` scorecard failures are absent.
- Slow test command metadata and known dev-server-like long-running metadata remain non-blocking and do not become broad shell pattern triggers.
- A positive-control candidate still blocks when all accepted trigger signals are present.
- Holdout tests use explicit sanitized candidate metadata and fixture/synthetic refs only; they do not read live providers, execute real tool mutation, or mutate the real workspace for proof.

Rejected alternatives:

- changing runtime implementation for holdout coverage
- approving production/default-on readiness from holdout success
- entering Phase F readiness review in the same phase
- using deleted touched-path metadata alone, slow command metadata alone, or known dev-server-like long-running metadata as an active trigger
- broadening blocking to shell command patterns
- reading live providers, executing real tool mutation for proof, modifying the real workspace for proof, or retaining raw prompt/provider/tool/secret/env/workspace content
- making TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, or scripts an active owner

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Focused Vitest must pass for the holdout regression test, Phase D preflight pilot test, evidence-proof corpus test, and runtime feature config schema test.

Replay impact:

- Replay reports, scorecards, governance reports, and evidence proof reports remain evidence for future design review only.
- Holdout coverage does not recompute replay or scorecard evidence in active runtime.

Rollback impact:

- Delete the Phase E holdout regression test, spec, handoff package, and this parent doc entry.
- No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.

Follow-up:

- Phase F may produce a readiness decision in a separate Goal/spec. Phase E stops after holdout results are recorded.

### Destructive Operation Guard Readiness Review Allows Separate-Spec Continuation

Status: accepted

Date: 2026-07-02

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review` records Phase F of the `destructive_operation_guard` roadmap.
- The phase reviews Phases A-E and produces a readiness decision.
- The phase is docs/spec only. It does not implement runtime behavior, approve production/default-on behavior, or broaden active ownership.

Decision:

- Continue, but only through a separate accepted follow-up spec.
- The line is not approved for production/default-on behavior.
- The line is not approved for default blocking or ownership outside mutation-capable tool invocation preflight.

Accepted rationale:

- False-block risk is acceptable for continued default-off work because Phase E protects expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.
- Expected deletion remains non-blocking even when deleted touched-path metadata and Phase 5 future block metadata are present while edit scorecard failures are absent.
- Flag-off legacy proof is acceptable because omitted or `false` `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` values preserve allow behavior and helper-level `legacyBehavior: true`.
- Preflight owner exclusivity is acceptable because Phase C defined the import boundary and Phase D automated scans keep the active consumer limited to mutation-capable tool invocation preflight.
- Rollback proof is acceptable because disabling or omitting the flag restores legacy behavior with no migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup.
- Consumer boundary proof is acceptable for continued default-off work because denied roots remain non-owners.

Residual risks:

- Evidence remains synthetic and fixture-owned by design.
- That residual risk is acceptable for separate-spec continuation, but it prevents production/default-on readiness claims.

Rejected alternatives:

- stopping the line outright
- requiring more evidence before any separate-spec continuation
- approving production/default-on behavior
- treating replay, scorecard, governance, evidence proof, holdout, or readiness docs as task completion proof
- broadening active ownership to TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, or scripts
- using deleted touched-path metadata alone, slow command metadata alone, known dev-server-like long-running metadata, or broad shell command patterns as active triggers
- reading live providers, executing real tool mutation for proof, modifying the real workspace for proof, or retaining raw prompt/provider/tool/secret/env/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Focused Vitest must pass for the holdout regression test, Phase D preflight pilot test, evidence-proof corpus test, and runtime feature config schema test.

Rollback impact:

- Delete the Phase F readiness-review spec, handoff package, and this parent doc entry.
- No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.

Follow-up:

- Any later work requires a new Goal and separate accepted spec.
- Any later continuation must preserve default-off flag semantics, mutation-capable preflight ownership, false-block protection, boundary scans, and flag-disable rollback.

### Destructive Operation Guard Internal Evaluation Scorecard Is Offline Continuation Evidence

Status: accepted

Date: 2026-07-02

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard` records a separate internal evaluation stage after the Phase F readiness review.
- The phase adds an offline scorecard helper and sanitized local transcript metadata scanner for `destructive_operation_guard`.
- The phase evaluates default-off internal continuation readiness only. It does not connect to UI, Gateway, TaskLoop, provider transport, prompt assembly, retry, approval, rollback, completion, Electron/renderer, or any active runtime path.

Accepted shape:

- The scorecard emits `InternalEvaluationReport` with `diagnosticsOnly: true`, `productionReady: false`, and `activeRuntimeConsumer: false`.
- Aggregate score is 0-100 with fixed dimensions: false-block safety 30, trigger correctness 20, owner/boundary integrity 15, rollback/default-off proof 15, real-data feedback quality 15, and sanitization/report hygiene 5.
- Hard vetoes force `blocked_for_continuation` for denied-root consumers, raw report leaks, secret report leaks, or unredacted path leaks.
- Decision thresholds are `score >= 85` -> `continue_with_separate_accepted_spec`, `70 <= score < 85` -> `continue_hardening`, and `score < 70` -> `freeze_active_pilot_expand_corpus`.
- Local transcript scanning defaults to `~/.openclaw/agents/*/sessions/*.jsonl` and accepts caller-provided roots, but emits only hashed transcript/root refs, counts, rates, normalized tool/candidate metadata, partial signal counts, and would-block/would-allow shadow statistics.
- Raw prompts, provider payloads, tool args/results, stdout/stderr, secrets, env-like fields, unredacted paths, and workspace content are not retained in reports.
- Missing local transcript data lowers the real-data feedback score but is not a hard veto.
- Current internal result is 93/100 with decision `continue_with_separate_accepted_spec`; real-data feedback is warning-level because one local transcript was parsed successfully but no tool invocation or candidate metadata was observed.

Rejected alternatives:

- treating the scorecard as production/default-on readiness
- treating scorecard output as task completion proof or an active runtime gate
- connecting transcript scanning, replay, scorecard, governance, or evidence proof code to active runtime behavior
- broadening active ownership beyond mutation-capable tool invocation preflight
- defaulting the pilot on or default-blocking tools
- retaining raw prompt/provider/tool/stdout/stderr/secret/env/path/workspace content
- using live providers, executing real tool mutation, or mutating the real workspace for proof
- writing scorecard reports into checkpoint or lifecycle authority state

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Focused Vitest must pass for the internal evaluation scorecard test plus the Phase E holdout, Phase D preflight pilot, evidence-proof corpus, and runtime feature config schema tests.
- Typecheck must pass before considering the internal evaluation closed.

Rollback impact:

- Delete the internal evaluation helper, export, focused test, task spec, handoff package, and these parent doc entries.
- No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, transcript cleanup, or user-facing state cleanup is required.

Follow-up:

- A separate accepted spec may continue default-off/internal work by expanding sanitized real-data coverage and adding observation-only shadow summaries.
- Production/default-on readiness remains explicitly unapproved.

### Destructive Operation Guard Boundary Tightening Internal Optimization Runtime Coupling Readiness Is Diagnostics-Only

Status: accepted

Date: 2026-07-02

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness` records the next separate accepted phase after the internal evaluation scorecard.
- The phase tightens offline scanner/sanitizer boundaries, adds observation-only shadow summaries, explains the real-data feedback score path, and records runtime coupling readiness.
- The phase remains diagnostics-only and does not connect to UI, Gateway, TaskLoop, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron/renderer, scripts, or any new active runtime path.

Accepted shape:

- Current internal score remains 93/100 with decision `continue_with_separate_accepted_spec`.
- Real-data feedback quality remains 8/15 warning; the next verifiable path targets 12+/15 through sanitized mutation-capable tool observations, candidate metadata, shadow outcome counts, and usage metadata accounting.
- Sanitizer checks cover raw prompt/provider/tool/stdout/stderr content, env-like values, API keys, authorization values, secrets, and Windows/POSIX paths.
- Transcript parsing covers malformed JSONL, unknown tools, `code_mode_exec`, missing usage metadata, candidate metadata, and partial signals without retaining raw prompt/provider/tool/stdout/stderr/env/path/secret/workspace content.
- Observation-only shadow summaries carry `diagnosticsOnly: true`, `observationOnly: true`, `activeDecision: false`, `activeRuntimeConsumer: false`, and `productionReady: false`.
- Runtime coupling readiness allows only future mutation-capable tool invocation preflight ownership and rejects denied-root consumers or owner expansion.

Rejected alternatives:

- approving production/default-on behavior
- defaulting the pilot on or adding default blocking
- treating scorecard, scanner, shadow summary, governance, replay, evidence proof, or readiness docs as task completion proof
- broadening active ownership beyond mutation-capable tool invocation preflight
- connecting readiness helpers to TaskLoop, Gateway, provider, prompt, retry, approval, rollback, completion, checkpoint/lifecycle, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, or schedulers
- using deleted path metadata alone, partial signals, false-block-corpus failures, or broad shell patterns as active triggers
- retaining raw prompt/provider/tool/stdout/stderr/secret/env/path/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md`, with `--no-diff` fallback only when unrelated dirty tree state blocks full validation.
- Focused Vitest must pass for the internal evaluation scorecard test plus the Phase E holdout, Phase D preflight pilot, and runtime feature config schema tests.
- Typecheck must pass before considering the phase closed.

Rollback impact:

- Delete the boundary-tightening task spec, handoff package, parent doc entries, and focused internal-evaluation helper/test additions from this phase.
- No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, transcript cleanup, or user-facing state cleanup is required.

Follow-up:

- A later phase may improve real-data coverage, but must preserve diagnostics-only boundaries unless another separate accepted spec explicitly changes ownership.
- Production/default-on readiness remains explicitly unapproved.

### Destructive Operation Guard Controlled Runtime Component Is Available Default-Off

Status: accepted

Date: 2026-07-02

Applies to: ToolGovernanceDecision

Context:

- `runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization` promotes the existing default-off preflight pilot into a stable runtime preflight component API.
- The active runtime owner remains only mutation-capable tool invocation preflight.

Accepted shape:

- Runtime code may call `evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent`.
- The component metadata records schema version, component id, runtime-core tool-governance preflight layer, default-off status, accepted owner, `callerSuppliedOwner: false`, flag path, production/default-on non-approval, and active owner expansion non-approval.
- The public component entrypoint does not accept caller-supplied owner.
- The low-level evaluator is module-internal and is not exported as a second public runtime entrypoint.
- `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts` calls the component entrypoint from `runBeforeToolCallHook`.
- Omitted or false `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` values preserve legacy allow behavior.
- Explicit flag-on blocking still requires all accepted evidence-qualified trigger signals.
- Deleted path alone, partial signals, missing candidates, non-preflight ownership, non-mutation-capable tools, and false-block corpus failures still allow.

Rejected alternatives:

- default-on production rollout
- active ownership outside mutation-capable tool invocation preflight
- TaskLoop, Gateway, provider, prompt/model-message, retry, approval, rollback, completion, checkpoint/lifecycle, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, or schedulers as consumers
- broad shell pattern blocking or deleted path metadata alone as a trigger
- retaining raw prompt/provider/tool/stdout/stderr/secret/env/path/workspace content

Validation impact:

- Harness context and validation must pass for `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md`, with `--no-diff` fallback only for unrelated dirty worktree state.
- Focused Vitest must pass for the preflight pilot, holdout regression, and runtime feature config schema tests.
- Typecheck must pass.

Rollback impact:

- Disable or omit `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` to restore legacy allow behavior.
- Delete the component entrypoint, componentization spec, handoff package, and parent doc entries if removal is required.
- No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.
