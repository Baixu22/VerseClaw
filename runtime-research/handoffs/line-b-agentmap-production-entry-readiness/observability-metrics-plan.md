# Observability Metrics Plan

Diagnostics remain audit/observability evidence only. They must never become runtime authority, provider ordering authority, approval authority, completion authority, retry authority, or Gateway authority.

## Required Fields

| Field | Meaning |
|---|---|
| `inserted` | Candidate entered the explicit TaskLoop pilot surface. |
| `blocked` | Readiness or operator gate blocked execution. |
| `fail_closed` | Invalid, missing, gated-off, or budget case returned legacy behavior. |
| `budget_exhausted` | Candidate was excluded because budget was exhausted. |
| `prompt_present_excluded` | Prompt-present file was excluded. |
| `invalid_result` | Explicit result failed `AgentMapResult` validation. |
| `gate_disabled` | One or more required gates were not true. |
| `invocation_not_requested` | `explicitInvocation` was false. |
| `leakage_count` | Candidate/sentinel leakage count; must stay 0. |
| `provider_ordering_drift` | Provider order drift count; must stay 0. |
| `rollback_success` | Rollback drill/sample result. |

## Retention

Metrics can store counts, status codes, booleans, hashes, lengths, timestamps, sample IDs, and evidence refs. They must not store candidate text, raw model messages, Gateway payloads, provider transport bodies, raw checkpoints, or secret-bearing metadata.
