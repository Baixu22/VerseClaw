# Default-On Implementation Spec

Status: accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden

Default-on allowed by this task: no.
Default cutover approved by this task: no.
Production-ready declaration allowed by this task: no.

## Intent

This is an implementation specification for a future task. It defines the smallest executable path that a later default-on implementation execution task may follow after this package is accepted. The steps below are future execution only. Do not execute them in this task.

## Prerequisites

- `runtime-research/handoffs/line-b-agentmap-default-on-implementation-readiness/synthesis.md` remains `Status: ready_for_default_on_implementation_spec`.
- Corpus proof remains at least 225/225 pass.
- Rollback gate closure remains 100 percent.
- Leakage count remains 0.
- Provider ordering drift remains 0.
- Candidate persistence remains 0.
- Authority escalation remains 0.
- Default reviewer prompt byte drift remains 0.
- Harness context and validate pass for this implementation-spec task.

## Future Execution Steps

1. Create a fresh task spec for default-on implementation execution. The spec must keep production-ready declaration and default cutover approval out of scope.
2. Add a single default-on decision gate that can be evaluated before any AgentMap candidate is built or inserted. The gate must fail closed when omitted, malformed, disabled, or killed.
3. Keep existing rollback gates intact: `promptAssemblyExperiment`, `promptCandidateRuntimeShadow`, `promptCandidateControlledCutoverPilot`, and `promptCandidateTaskLoopExplicitInvocationPilot`.
4. Add diagnostics-only telemetry counters behind a default-off telemetry gate. Telemetry must emit counters, booleans, hashes, lengths, and bounded diagnostics only.
5. Re-run the full default-path parity, rollback, leakage, persistence, provider-ordering, authority, and comms boundary scans before any cutover proposal.
6. Produce an operator dashboard or report proof before any production rollout task.
7. Require a separate cutover approval task after implementation execution. That task must independently prove production evidence and may still reject cutover.

## Required Telemetry Counters

| Counter | Meaning | Raw text allowed |
|---|---|---|
| `agentmap_default_on_gate_seen` | Default-on gate evaluated. | no |
| `agentmap_default_on_gate_enabled` | Gate allowed evaluation. | no |
| `agentmap_fail_closed_count` | Invalid, missing, malformed, gated-off, prompt-present, or exhausted cases returned legacy bytes. | no |
| `agentmap_rollback_success_count` | Gate closure restored legacy reviewer prompt byte parity. | no |
| `agentmap_leakage_count` | Any candidate text appeared outside the allowed pilot surface. | no |
| `agentmap_provider_ordering_drift` | Provider manifest order changed. | no |
| `agentmap_reviewer_prompt_byte_drift` | Default reviewer prompt changed. | no |
| `agentmap_candidate_persistence_count` | Candidate/shadow/replay output persisted. | no |
| `agentmap_authority_escalation_count` | AgentMap affected runtime/tool/security/provider/model/Gateway/checkpoint/lifecycle authority. | no |

## Acceptance For Future Execution

Future implementation execution may be recommended only when:

- default-off legacy parity remains 100 percent;
- fail-closed invalid/missing/malformed/gated-off cases remain 100 percent;
- rollback gate closure remains 100 percent;
- telemetry payloads contain no raw candidate text, raw prompt, model message, provider payload, Gateway payload, checkpoint body, lifecycle raw text, tool output, secret, auth header, or trace raw body;
- provider ordering drift is 0;
- candidate persistence is 0;
- authority escalation is 0;
- comms replay/compare passes if communication paths are touched.

## Explicit Non-Goals

- No default-on enablement in this task.
- No default cutover approval in this task.
- No production-ready declaration in this task.
- No default runtime behavior change.
- No default TaskLoop reviewer prompt change.
- No provider ordering change.
- No default AgentMap provider registration.
- No candidate/shadow/replay persistence.
- No service/listener/daemon/database/WebSocket/HTTP server.
- No renderer direct IPC or direct Gateway HTTP/WebSocket.
- No AgentMap runtime/tool/security/approval/retry/completion/provider/model/Gateway/checkpoint/lifecycle authority.
