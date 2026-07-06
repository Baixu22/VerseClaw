# Synthesis

Status: preparation_only.

## Decision

The five-lane runtime research direction is worth pursuing, but only through staged vertical slices with durable harness specs. The immediate accepted outcome is a persistent readiness package, not active implementation.

## Accepted Preparation

- Failure Intelligence should be the first functional lane because it creates structured failure signals for repair, handoff, replay, and governance.
- Evidence Envelope should follow quickly as the common safety container, with strict fail-closed validation and no authority.
- Replay Harness is the long-term proof mechanism and should start once `FailureEvent` and `EvidenceEnvelope` are stable enough for fixtures.
- Outcome Scorecard should consume replay reports rather than invent subjective metrics.
- Tool Invocation Governance should be validated by replay/scorecard deltas and start with narrow high-risk rules.
- Follow-up implementation specs should be copied from `implementation-spec-template.md`, checked against `milestone-checklist.md`, assigned across `parallel-workstreams.md`, and reflected in `schema-decision-log.md` when contract semantics change.

## Current Stop Line

This package does not approve:

- active runtime behavior changes
- prompt/provider/Gateway changes
- TaskLoop retry/approval/rollback/completion changes
- tool blocking
- evidence persistence into checkpoint or lifecycle state
- raw evidence retention
- second services/databases/listeners/exporters
- default-on behavior

## Next Recommended Spec

`runtime-failure-evidence-replay-schema-spike`

Scope:

- implement validators and types for `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase`
- add unit tests for fail-closed behavior
- add no active runtime consumers
- define fixture ownership for the first replay corpus

## Phase 0 Schema Spike Result

Status: ready_for_failure_intelligence_passive_shadow.

The follow-up spec `runtime-failure-evidence-replay-schema-spike` adds schema-only TypeScript contracts and fail-closed validators for `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase`. The accepted Phase 0 contract keeps `EvidenceEnvelope.authority` fixed to `none`, rejects raw retention, bounds payload size, requires redaction/provenance/TTL/confidence metadata, and requires `ReplayCase` provider, tool, and workspace fixtures so replay defaults do not depend on live providers.

This result does not claim active runtime readiness. It does not approve runtime consumers, prompt/model-message changes, provider transport changes, Gateway payload changes, TaskLoop decision changes, retry/approval/rollback/completion/tool-blocking changes, persistence, services, databases, exporters, or scheduler work. Any passive Failure Intelligence implementation still needs its own accepted follow-up spec and validation.

## Phase 1 Passive Failure Intelligence Result

Status: ready_for_evidence_envelope_failure_summary.

The follow-up spec `runtime-failure-intelligence-passive-shadow` adds a passive runtime-core classifier that accepts bounded failure signals and emits Phase 0 `FailureEvent` values after validation with `validateFailureEvent`. The classifier covers the accepted Phase 1 stage and kind vocabulary, produces sanitized bounded summaries, sets `rawRetained: false`, preserves stable unknown fallback behavior, and keeps `suggestedAction` advisory-only.

This result does not claim active runtime readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, or schedulers. A future Evidence Envelope failure summary phase still needs its own accepted follow-up spec before wrapping passive classifier output.

## Phase 2 Failure Summary Evidence Envelope Result

Status: ready_for_replay_or_prompt_slot_design.

The follow-up spec `runtime-failure-evidence-envelope-failure-summary` adds a diagnostics-only runtime-core adapter that wraps validated Phase 1 `FailureEvent` values in Phase 0 `EvidenceEnvelope` values. The adapter fixes `kind` to `failure_summary`, fixes `authority` to `none`, fixes raw retention to `false`, requires source/scope/TTL/provenance metadata, sanitizes and bounds payload summary/classification/ref data, and validates output with `validateEvidenceEnvelope`.

This result does not claim active runtime readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, or schedulers. A future replay or prompt-slot phase still needs its own accepted follow-up spec before consuming these envelopes.

## Phase 3 Replay Harness Core Fixtures Result

Status: ready_for_scorecard_design.

The follow-up spec `runtime-failure-replay-harness-core-fixtures` adds a local/dev/test-only deterministic replay harness core. The core validates fixture-backed `ReplayCase` input, rejects missing provider/tool/workspace fixtures and live provider defaults, uses Phase 1 passive classification or validated `FailureEvent` fixtures, uses Phase 2 failure summary envelopes or validated `EvidenceEnvelope` fixtures, and produces a bounded diagnostics-only replay report.

The first fixture corpus covers `success`, `tool_error`, `test_failure`, `provider_timeout`, and `dirty_workspace`. Reports contain sanitized replay metadata, fixture refs, failure events, evidence decisions with authority fixed to `none`, terminal status, and touched path summaries. Reports do not retain raw prompts, provider payloads, tool args/results, secrets, env dumps, or unredacted workspace content.

This result does not claim active runtime readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, or active governance. A future scorecard phase still needs its own accepted follow-up spec before consuming replay reports.

## Phase 4 Task Outcome Scorecard Result

Status: ready_for_governance_advisory_design.

The follow-up spec `runtime-failure-task-outcome-scorecard-replay-reports` adds a local/dev/test-only task outcome scorecard core. The core consumes Phase 3 `RuntimeFailureReplayReport` values only when they are diagnostics-only, not completion proof, bounded, JSON-serializable, and provenance-bearing. It emits deterministic bounded scorecards with `authority: 'none'`, `evaluationMetadataOnly: true`, and metrics for task completed, wrong-file edit, unnecessary edit, retry correctness, ask-user appropriateness, and test recovery success.

The Phase 4 scorecard preserves replay/failure/evidence/touched-path provenance refs for metrics and aggregate decisions, limits aggregate decisions to `improved`, `regressed`, `neutral`, and `inconclusive`, and excludes raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.

This result does not claim active runtime readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or scorecard-based runtime gates. A future governance advisory phase still needs its own accepted follow-up spec before consuming scorecards.

## Phase 5 Tool Invocation Governance Advisory Result

Status: ready_for_limited_active_guard_design.

The follow-up spec `runtime-failure-tool-invocation-governance-advisory-rules` adds a local/dev/test-only tool invocation governance advisory core. The core consumes Phase 3 `RuntimeFailureReplayReport` values and Phase 4 `RuntimeFailureTaskOutcomeScorecard` values only when they are diagnostics/evaluation metadata, not completion proof, bounded, JSON-serializable, provenance-bearing, and free of active blocking authority. It emits deterministic bounded advisory reports with `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.

The Phase 5 advisory rule set covers destructive operation guard, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user vs continue policy, and tool result provenance. Findings and aggregate recommendations preserve replay/scorecard/failure/evidence/touched-path provenance refs, limit aggregate recommendations to `advisory_pass`, `advisory_warn`, `advisory_backoff`, `advisory_ask_user`, and `inconclusive`, and exclude raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.

The Phase 5 closure pass adds focused advisory coverage for every first-wave rule and one slow-completed-test false-positive case. This improves readiness for design review, but remains advisory diagnostics only.

This result does not claim active runtime readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or governance-based runtime gates. A future limited active guard phase still needs its own accepted follow-up spec before any advisory rule can affect runtime behavior.

## Limited Active Guard Design Result

Status: design_readiness_only_not_active_runtime_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-limited-active-guard-design` narrows the next design review to the single candidate `destructive_operation_guard`. It records the evidence shape required before any later active implementation spec can be proposed: Phase 5 advisory report trigger metadata, replay/scorecard provenance, false-block cases, slow test and known dev-server false-positive protection, flag-disable rollback, and boundary scans.

The accepted future owner boundary is mutation-capable tool invocation preflight owned by tool execution. TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory report generation, retry, approval, rollback, and completion paths must not own the active decision.

This design result does not claim active runtime readiness. It does not add imports or wiring, does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or governance-based runtime gates. `block` remains future-candidate metadata only, not current runtime behavior.

## Destructive Operation Guard Evidence Proof Result

Status: evidence_conditions_met_not_active_runtime_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof` adds a pure in-memory runtime-core proof helper and focused corpus for the single candidate `destructive_operation_guard`. The helper consumes fixture-owned or synthetic Phase 3 replay reports and Phase 4 scorecards, derives Phase 5 advisory findings, and emits bounded diagnostics-only proof metadata with `authority: 'none'`, `governanceDecisionAuthority: 'none'`, `activeBlocking: false`, and `completionProof: false`.

The evidence-qualified trigger requires deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, and Phase 5 `futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true`. The false-block corpus covers expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched-path metadata, legitimate fixture mutation, slow test command metadata, and known dev-server-like long-running metadata.

This result means a later default-off implementation spec may propose active `destructive_operation_guard` behavior if it keeps ownership at mutation-capable tool invocation preflight, defines explicit flag-disable rollback, reruns false-block coverage, and proves no active consumer exists outside the accepted owner boundary.

This evidence proof result does not claim active runtime readiness. It does not add active imports or wiring, does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or default blocking. `block` remains future-candidate metadata only, not current runtime behavior.

## Destructive Operation Guard Default-Off Preflight Proposal Result

Status: default_off_preflight_proposal_only_not_active_runtime_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal` records Phase B of the `destructive_operation_guard` roadmap as a docs/spec-only proposal. It defines the future owner boundary, flag semantics, rollback semantics, false-block corpus, future active trigger gate, and Phase C boundary/import scan plan.

The only future active owner allowed by this proposal is mutation-capable tool invocation preflight owned by tool execution. TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, and renderer code are not allowed to own the active decision.

The future explicit default-off flag is `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`. Omitted, `false`, or any non-boolean-true value means disabled. Flag-off rollback must restore legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup.

A future active trigger still requires all signals at the same time: explicit flag enablement, mutation-capable tool invocation preflight ownership, deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 `futureActiveCandidate.action: "block"`, `requiresAcceptedSpec: true`, and the false-block corpus still passing. Deleted touched-path metadata alone, broad shell command patterns, and future candidate metadata alone are not active triggers.

This proposal result does not claim active runtime readiness. It does not add active imports or wiring, does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or default blocking.

## Destructive Operation Guard Boundary Import Contract Result

Status: boundary_import_contract_only_not_active_runtime_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract` records Phase C of the `destructive_operation_guard` roadmap as a docs/spec-only boundary contract. It defines the allowed future owner, denied roots, bounded scan inputs, future automated scan requirements, and the evidence-producer boundary.

The only future active consumer allowed by this contract is a later accepted mutation-capable tool invocation preflight owner. Phase D must name the concrete preflight owner path before active guard code can be introduced.

Denied roots include TaskLoop and agents orchestration, provider transport and ordering, Gateway payloads and server methods, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services/preload, renderer surfaces, scripts, exporters, daemons, services, listeners, databases, schedulers, and always-on sidecars.

Replay reports, scorecards, governance reports, advisory findings, evidence envelopes, failure events, and evidence proof reports remain diagnostics/evaluation evidence. They are not active decision owners and cannot be treated as completion proof.

This boundary contract result does not claim active runtime readiness. It does not add active imports or wiring, does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion/tool-blocking behavior, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, task completion proof, active governance, or default blocking.

## Destructive Operation Guard Default-Off Preflight Pilot Result

Status: default_off_preflight_pilot_not_production_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot` records Phase D of the `destructive_operation_guard` roadmap. It implements the accepted default-off preflight pilot and names the concrete active owner as `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`, specifically `runBeforeToolCallHook`.

The pilot flag is `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`. Omitted or `false` values preserve legacy tool behavior, and the schema accepts only boolean values. The runtime-core helper returns an allow decision with `legacyBehavior: true` while the flag is disabled.

When the flag is explicitly true, blocking remains limited to a mutation-capable preflight invocation with explicit sanitized candidate metadata for `destructive_operation_guard`. A block requires deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 future block candidate metadata, `requiresAcceptedSpec: true`, and passing false-block corpus metadata. Deleted touched-path metadata alone and broad shell command patterns are not triggers.

Replay reports, scorecards, governance advisory reports, and evidence proof reports remain diagnostics/evaluation evidence. They are not invoked by the active preflight path and are not completion proof.

Focused tests cover flag-off legacy behavior, flag-on block behavior, non-owner and non-mutation allow paths, missing/invalid candidate allow paths, false-block trigger protection, sanitized diagnostics, config schema strictness, and automated boundary scans.

This pilot result does not claim production/default-on readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion behavior changes, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, renderer behavior changes, task completion proof, active governance outside mutation-capable preflight, or Phase E holdout expansion.

## Destructive Operation Guard Holdout Regression Expansion Result

Status: holdout_regression_expanded_not_readiness_review.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion` records Phase E of the `destructive_operation_guard` roadmap. It expands synthetic and fixture-owned holdout/regression coverage after the Phase D default-off preflight pilot.

Focused holdout coverage now records continued non-blocking behavior for expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.

The expected-deletion holdout carries deleted touched-path metadata plus Phase 5 future block metadata while edit scorecard failures are absent. It remains non-blocking, preserving the route rule that deleted touched-path metadata alone is never sufficient.

Slow test command metadata and known dev-server-like long-running metadata remain non-blocking and do not become broad shell pattern triggers. A positive-control candidate still blocks when every accepted trigger signal is present, so the holdout expansion preserves both false-block protection and the Phase D trigger boundary.

The Phase D pilot remains default-off and preflight-owned. Phase E uses explicit sanitized candidate metadata with fixture/synthetic refs only; it does not read live providers, execute real tool mutation, or mutate the real workspace for proof.

This holdout result does not claim readiness review completion, production/default-on readiness, or approval to broaden active ownership. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion behavior changes, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, renderer behavior changes, task completion proof, or Phase F readiness review in the same Goal.

## Destructive Operation Guard Readiness Review Result

Status: continue_with_separate_accepted_spec_not_production_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review` records Phase F of the `destructive_operation_guard` roadmap. It reviews Phases A-E and produces a readiness decision.

Decision: continue, but only through a separate accepted follow-up spec.

The line is not approved for production/default-on behavior, default blocking, ownership broadening, or new runtime implementation.

False-block risk is acceptable for continued default-off work because Phase E protects expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata. Expected deletion remains non-blocking even when deleted touched-path metadata and Phase 5 future block metadata are present while edit scorecard failures are absent.

Flag-off legacy proof is acceptable because omitted or false `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` values preserve allow behavior and helper-level `legacyBehavior: true`.

Preflight owner exclusivity and consumer boundary proof are acceptable for continued default-off work because the active consumer remains mutation-capable tool invocation preflight and denied roots remain non-owners.

Rollback proof is acceptable because disabling or omitting the flag restores legacy behavior with no migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup.

Residual risk remains: evidence is synthetic and fixture-owned by design. That residual risk permits separate-spec continuation but prevents production/default-on readiness claims.

Any later continuation requires a new Goal and separate accepted spec that preserves explicit default-off behavior, mutation-capable preflight ownership, false-block corpus protection, deleted path metadata not sufficient by itself, boundary scans, and flag-disable rollback.

This readiness review does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion behavior changes, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, renderer behavior changes, task completion proof, production/default-on behavior, or active governance outside mutation-capable preflight.

## Destructive Operation Guard Internal Evaluation Scorecard Result

Status: internal_evaluation_scorecard_continue_with_separate_spec_not_production_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard` adds an offline internal 0-100 scorecard for `destructive_operation_guard`. It combines Phase D/E proof, fixture/holdout coverage, boundary/default-off checks, sanitization checks, and sanitized local transcript metadata.

Current internal score: 93/100.

Decision: `continue_with_separate_accepted_spec`.

Dimension results:

- false-block safety: 30/30
- trigger correctness: 20/20
- owner/boundary integrity: 15/15
- rollback/default-off proof: 15/15
- real-data feedback quality: 8/15
- sanitization/report hygiene: 5/5

The real-data feedback dimension is warning-level, not a veto. The local scanner observed one transcript and parsed two records with no parse errors, but found no tool invocation or `destructive_operation_guard` candidate metadata. This provides a real local metadata path sanity check, but it is not enough to support broader pilot claims.

Hard veto status: none observed. Any denied-root consumer, raw report leak, secret leak, or path leak would force `blocked_for_continuation` regardless of aggregate score.

The optimization plan is to continue only through a separate accepted spec, expand sanitized real transcript sample coverage, add transcript parse fixtures for more real-world JSONL shapes, add observation-only shadow summaries before any wider pilot, and keep the false-block corpus, boundary scan, rollback/default-off checks, and sanitizer checks in every continuation gate.

This internal scorecard result does not claim production/default-on readiness. It does not approve TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion behavior changes, checkpoint/lifecycle state writes, raw evidence persistence, services, daemons, listeners, databases, exporters, schedulers, renderer behavior changes, task completion proof, default blocking, or active governance outside mutation-capable preflight.

## Destructive Operation Guard Boundary Tightening Internal Optimization Runtime Coupling Readiness Result

Status: boundary_tightened_internal_optimization_ready_not_production_ready.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness` records the next default-off internal phase after the 93/100 internal evaluation scorecard.

Current internal score remains 93/100. The real-data feedback dimension remains warning-level at 8/15 because the previous local scan found transcript records but did not find tool invocation or `destructive_operation_guard` candidate metadata.

This phase improves the next verification path toward 12+/15 real-data feedback by adding transcript fixtures for malformed JSONL, unknown tools, `code_mode_exec`, missing usage metadata, candidate metadata, and partial signals; stronger sanitizer checks for raw prompt/provider/tool/stdout/stderr content, env-like values, secrets, authorization, API keys, and Windows/POSIX paths; observation-only shadow summaries; and explicit real-data scoring explanations.

Boundary tightening keeps denied roots as hard vetoes. Runtime coupling readiness is limited to future mutation-capable tool invocation preflight ownership. Any TaskLoop, Gateway, provider, prompt/model-message, retry, approval, rollback, completion, checkpoint/lifecycle, Electron, renderer, script, service, daemon, listener, database, exporter, scheduler, or owner-expansion consumer remains rejected.

This readiness result does not claim production/default-on readiness. It does not approve default blocking, new active runtime consumers, owner expansion, TaskLoop decisions, provider transport changes, Gateway payload changes, prompt/model-message changes, retry/approval/rollback/completion behavior changes, checkpoint/lifecycle state writes, raw evidence persistence, renderer behavior changes, task completion proof, or active governance outside mutation-capable preflight.

## Destructive Operation Guard Controlled Runtime Componentization Result

Status: controlled_runtime_component_available_default_off_not_default_on.

The follow-up spec `runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization` promotes the existing default-off preflight pilot into a stable runtime preflight component API.

Direct conclusion: `destructive_operation_guard` can now be used directly in runtime as a controlled default-off preflight component.

The runtime entrypoint is `evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent`. The only accepted active owner remains `mutation_capable_tool_invocation_preflight`, called from `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts` in `runBeforeToolCallHook`.

The component is positioned at the runtime-core tool-governance preflight layer. The public entrypoint does not accept caller-supplied owner; ownership is fixed internally to mutation-capable tool invocation preflight. The low-level evaluator is module-internal and is not exported as a second public runtime entrypoint.

The enabling flag remains `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`. Omitted or false flag values preserve legacy allow behavior. Explicit flag-on blocking still requires all accepted evidence-qualified trigger signals, and deleted path metadata alone remains insufficient.

This result does not approve default-on production behavior or owner expansion. TaskLoop, Gateway, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, and schedulers remain denied consumers.
