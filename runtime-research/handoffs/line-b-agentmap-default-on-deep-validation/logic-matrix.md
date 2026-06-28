# Logic Matrix

| Dimension | Covered values | Expected behavior |
|---|---|---|
| AgentMap flags | omitted, off, on for all four prompt candidate flags | Only all-on can insert, and only with explicit invocation plus valid result. |
| Explicit invocation | true, false | false preserves legacy reviewer bytes. |
| AgentMapResult | valid, invalid, missing | invalid/missing fail closed. |
| Budget | normal, near-limit, exhausted | exhausted fails closed; near-limit never silently truncates. |
| Prompt presence | absent, present | prompt-present symbols are excluded; empty candidate fails closed. |
| Runtime shadow | enabled, disabled | disabled has no runtime shadow report; enabled report is diagnostics-only. |
| Controlled cutover pilot | enabled, disabled | disabled closes the TaskLoop pilot gate. |
| TaskLoop explicit pilot | enabled, disabled | disabled closes the final pilot gate. |
| Provider ordering | default registry order | legacy provider then loop context provider; no default AgentMap provider. |
| Checkpoint/lifecycle | sentinel payloads | candidate text remains absent from default lifecycle/checkpoint payloads. |
| Long context | oversized candidate text | no default prompt drift or persistence. |
| Multi-file | multiple file symbols | bounded explicit pilot only. |
| Failed/blocked tasks | failed and blocked replay labels | no authority escalation. |
| Sentinel text | candidate, production-entry, default-on | no leak in default or fail-closed payloads. |
