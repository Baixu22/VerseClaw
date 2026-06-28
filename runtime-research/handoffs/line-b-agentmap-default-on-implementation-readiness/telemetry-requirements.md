# Telemetry Requirements

Any future default-on implementation spec must define telemetry before implementation can start.

## Required Counters

| Counter | Required Meaning |
|---|---|
| `agentmap.default_path.invocations` | Count default-path tasks where AgentMap remains inactive. |
| `agentmap.explicit_pilot.invocations` | Count explicit TaskLoop pilot invocations. |
| `agentmap.fail_closed.count` | Count invalid, missing, gated-off, prompt-present, and budget-exhausted closures. |
| `agentmap.leakage_count` | Count candidate text leakage into forbidden default/transport/lifecycle surfaces. |
| `agentmap.persistence_count` | Count candidate/shadow/replay durable writes. |
| `agentmap.provider_ordering_drift` | Count provider order or default-provider drift. |
| `agentmap.reviewer_prompt_byte_drift` | Count default reviewer prompt byte drift. |
| `agentmap.authority_escalation` | Count runtime/tool/security/provider/Gateway/checkpoint/lifecycle authority drift. |
| `agentmap.rollback_success` | Count rollback drill closures that restore legacy bytes. |
| `agentmap.noise_score` | Operator-visible warning/noise score. |

## Privacy Requirements

Telemetry must record counters, booleans, hashes, lengths, and bounded diagnostics only. It must not record raw candidate text, raw prompts, model messages, provider payloads, tool output, secrets, auth headers, or raw trace payloads.
