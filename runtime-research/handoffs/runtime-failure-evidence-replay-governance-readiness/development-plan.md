# Development Plan

## Summary

Use a staged vertical-slice model. The main dependency chain is:

```text
Failure Intelligence
  -> Evidence Envelope
  -> Replay Harness
  -> Outcome Scorecard
  -> Tool Invocation Governance validation
```

Work can still be parallelized through three streams:

| Stream | Owns | Notes |
|---|---|---|
| Runtime event and decision stream | FailureEvent, recoverability, suggested action, TaskLoop/repair/handoff consumers, future governance policy | Starts first because it creates the signal other lanes consume. |
| Evidence and prompt assembly stream | EvidenceEnvelope, validation, redaction, TTL, scope, evidence slots | Starts after the schema spike; first consumer should be FailureEvent evidence. |
| Replay and evaluation stream | ReplayCase, fixtures, replay runner, scorecard, baseline compare | Starts once FailureEvent/EvidenceEnvelope are stable enough for fixtures. |

## Phase 0: Schema Spike

Duration target: 1 week.

Goal: define contracts before active behavior.

Deliverables:

- `FailureEvent` draft type and validators.
- `EvidenceEnvelope` draft type and fail-closed validator.
- `ReplayCase` draft type and fixture boundaries.
- Scope decision for where future code lives under `openclaw_runtime/src/runtime-core/**`.
- No provider, Gateway, prompt, tool, or TaskLoop behavior changes.

Exit criteria:

- Unit tests validate schema accept/reject behavior.
- Boundary scans show no active consumers.
- Follow-up specs can reference stable field names.

## Phase 1: Runtime Failure Intelligence

Duration target: 1-2 weeks.

Goal: make failures structured without changing decisions yet.

Minimum stages:

- `planning`
- `tool_call`
- `patch`
- `test`
- `provider`
- `gateway`
- `user_interrupt`
- `unknown`

Minimum kinds:

- `permission`
- `path`
- `dependency`
- `timeout`
- `type_error`
- `test_failure`
- `environment_contamination`
- `context_insufficient`
- `provider_error`
- `gateway_error`
- `unknown`

Minimum actions:

- `retry`
- `ask_user`
- `rollback_recommended`
- `degrade`
- `stop`
- `continue_with_caution`

Exit criteria:

- Tool failure, test failure, provider timeout, gateway error, and user interruption are classified.
- Classifier output is passive or shadow-only.
- Handoff/repair summaries may consume bounded text only after a follow-up spec accepts that consumer.

## Phase 2: Runtime Evidence Envelope

Duration target: 1-2 weeks.

Goal: create a uniform read-only evidence container and validator.

First evidence kinds:

- failure summary
- test result summary
- file change summary

Exit criteria:

- Missing source/scope/TTL/confidence/redaction/provenance fails closed.
- Expired, out-of-scope, unredacted, malformed, or low-confidence evidence is rejected with a reason.
- Evidence remains diagnostics-only unless a future consumer spec accepts a slot.

## Phase 3: Deterministic Replay Harness

Duration target: 2-4 weeks.

Goal: make narrow runtime chains reproducible and comparable.

First replay scenarios:

- success
- tool error
- test failure after repair
- provider timeout
- dirty workspace

Second replay scenarios:

- blocked
- long context
- flaky test
- user interruption
- budget exhausted

Exit criteria:

- Same replay case is stable across repeated runs.
- Provider and tool results can be fixture-backed.
- Output report includes failure events, evidence envelope decisions, touched files, prompts bytes/hashes when allowed, and final status.

## Phase 4: Task Outcome Scorecard

Duration target: 1-2 weeks.

Goal: compare task quality from replay reports.

First metrics:

- task completed
- wrong-file edit
- unnecessary edit
- retry correctness
- ask-user appropriateness
- test recovery success

Later metrics:

- user-visible drift
- prompt byte drift
- authority escalation
- rollback correctness
- time budget use
- cost budget use

Exit criteria:

- Score source points back to replay/evidence/failure/tool provenance.
- Aggregate score can distinguish improvement, regression, and neutral drift.
- Scorecard does not gate real runtime behavior yet.

## Phase 5: Tool Invocation Governance

Duration target: 2 weeks for v1, then iterative.

Goal: add narrow rules only where replay proves clear benefit.

First rules:

- destructive operation guard
- repeated failure backoff
- timeout classification
- long-running process detection
- shell/environment contamination detection
- ask-user vs continue policy
- tool result provenance

Exit criteria:

- Governance decisions emit structured diagnostics.
- Active blocking is limited to high-risk cases accepted by a follow-up spec.
- Replay/scorecard proves reduced repeated failure or unsafe action without increasing false blocked outcomes.

## Parallelization Guidance

Can run in parallel:

- Failure classifier and TaskLoop summary adapters.
- Evidence validator and prompt/evidence slot design.
- Replay runner and fixture authoring.
- Scorecard schema and replay report extension.
- Individual governance rules after replay core exists.

Should not run fully in parallel:

- Scorecard before replay reports exist.
- Active governance blocking before scorecard proof.
- Evidence prompt injection before fail-closed validation.
- Provider/Gateway transport changes before the above local layers prove value.
