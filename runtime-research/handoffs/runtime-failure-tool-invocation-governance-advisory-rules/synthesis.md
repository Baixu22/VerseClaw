# Synthesis

Status: phase_5_advisory_diagnostics_only.

## Decision

Phase 5 accepts a local/dev/test-only tool invocation governance advisory core that consumes Phase 3 diagnostics-only replay reports and Phase 4 task outcome scorecards. Governance reports are deterministic, bounded, JSON-serializable evaluation metadata and keep `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.

## Accepted Shape

- Inputs are a Phase 3 `RuntimeFailureReplayReport` and a Phase 4 `RuntimeFailureTaskOutcomeScorecard`.
- Inputs must be diagnostics/evaluation metadata only and must not be completion proof or active blocking authority.
- Advisory rules cover destructive operation guard, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user vs continue policy, and tool result provenance.
- Findings and aggregate recommendations preserve replay/scorecard/failure/evidence/touched-path provenance refs.
- Aggregate recommendations are limited to `advisory_pass`, `advisory_warn`, `advisory_backoff`, `advisory_ask_user`, and `inconclusive`.
- Governance output excludes raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
- The runtime-core export is additive only.

## Stop Line Preserved

This phase does not claim active runtime readiness. It does not wire governance into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, tool blocking, checkpoint/lifecycle state, services, daemons, listeners, databases, exporters, or schedulers.

`block` is represented only as a future active-spec candidate for narrow destructive-operation cases. It is not a runtime decision, default tool block, completion proof, or checkpoint/lifecycle authority.

## Gap Closure

The closure pass fills the Phase 5 milestone gap that required focused replay/scorecard-backed coverage for each first-wave advisory rule. The focused unit suite now includes destructive deleted-path metadata, duplicate failure backoff metadata, provider-timeout metadata, slow non-completed metadata, slow completed test-repair false-positive protection, dirty-workspace contamination metadata, ask-user policy metadata, and rejected tool-result evidence metadata.

This closes advisory diagnostics coverage only. It still does not prove that any rule should be active, and it does not approve default blocking or runtime consumption.

## Next Recommended Spec

A future limited active guard design spec may evaluate whether any single advisory rule deserves active behavior. That spec must provide replay/scorecard proof, false-block analysis, explicit feature flag rollback, and a fresh boundary review before any runtime consumer is introduced.
