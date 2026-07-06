# Milestone Checklist

Use this as the done checklist for each phase. A phase is not ready to promote just because code exists.

## Phase 0: Schema Spike

Required:

- `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase` are typed and validated.
- Invalid enum values, missing required metadata, malformed timestamps, oversized payloads, and unknown authority values fail closed.
- Tests prove `rawRetained: true` is rejected for evidence intended for prompt/replay/scorecard use.
- No runtime consumer changes TaskLoop, provider, Gateway, prompt, approval, retry, rollback, completion, or tool decisions.
- No persistence beyond test-owned fixtures or caller-owned local artifacts.

Exit status:

- `ready_for_failure_intelligence_passive_shadow`
- `needs_follow_up`
- `blocked`

## Phase 1: Failure Intelligence

Required:

- The classifier covers `planning`, `tool_call`, `patch`, `test`, `provider`, `gateway`, `user_interrupt`, and `unknown`.
- The classifier covers permission, path, dependency, timeout, type error, test failure, environment contamination, context insufficiency, provider error, gateway error, and unknown.
- Unknown fallback is stable and bounded.
- Suggested actions are advisory unless a future spec accepts active consumption.
- Failure summaries are sanitized and bounded.
- Unit tests cover at least tool error, test failure, provider timeout, gateway error, and user interruption.

Exit status:

- `ready_for_evidence_envelope_failure_summary`
- `needs_follow_up`
- `blocked`

## Phase 2: Evidence Envelope

Required:

- Envelope validation requires source, scope, TTL, confidence, redaction, provenance, authority `none`, and bounded payload.
- Rejection reasons are structured and test-covered.
- First supported kinds are failure summary, test result summary, and file change summary.
- Evidence does not write checkpoint or lifecycle authority state.
- Prompt assembly receives no evidence unless a future spec accepts a consumer slot.

Exit status:

- `ready_for_replay_core`
- `needs_follow_up`
- `blocked`

## Phase 3: Replay Harness

Required:

- Provider and tool outputs can be fixture-backed.
- Workspace mutations happen only in explicit replay fixtures or isolated worktrees.
- Repeated runs of the same case are deterministic.
- Reports include terminal status, failure events, envelope accept/reject decisions, touched paths, and bounded prompt/report hashes when allowed.
- First corpus includes success, tool error, test failure, provider timeout, and dirty workspace.

Exit status:

- `ready_for_scorecard_replay_adapter`
- `needs_follow_up`
- `blocked`

## Phase 4: Outcome Scorecard

Required:

- Every metric traces to replay/evidence/failure/tool provenance.
- First metrics cover task completed, wrong-file edit, unnecessary edit, retry correctness, ask-user appropriateness, and test recovery success.
- Scorecard differentiates improved, regressed, neutral, and inconclusive.
- Scorecard does not gate real runtime behavior.
- False-blocked and false-continue cases are measured explicitly.

Exit status:

- `ready_for_governance_advisory_rules`
- `needs_follow_up`
- `blocked`

## Phase 5: Tool Invocation Governance

Required:

- Rules start advisory unless the implementation spec accepts a narrow active guard.
- Destructive operation detection, repeated failure backoff, timeout subtype classification, long-running command detection, environment contamination detection, and ask-user policy each have focused replay cases.
- Active blocking has a flag-disable rollback.
- Replay/scorecard proves the rule reduces unsafe or repeated failure behavior without increasing false blocked outcomes.
- Normal test runners and known dev servers are not misclassified as stuck commands.

Exit status:

- `ready_for_limited_active_guard`
- `needs_follow_up`
- `blocked`

## Cross-Phase Hard Stop

Stop and write a follow-up spec when a slice wants to:

- change provider transport
- change Gateway payloads
- change prompt/model-message content
- change TaskLoop terminal status
- block tools by default
- persist raw evidence
- store evidence in checkpoint/lifecycle authority state
- add a service, listener, server, database, exporter, or scheduler
- use scorecard as completion proof
