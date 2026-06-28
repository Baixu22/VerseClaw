# Replay Cases

| Case | Result | Evidence |
|---|---|---|
| Flags all off | pass | Legacy bytes, `gate_disabled`, no candidate insertion. |
| One gate enabled | pass | Legacy bytes, `gate_disabled`, no candidate insertion. |
| First two gates enabled | pass | Legacy bytes, `gate_disabled`, no candidate insertion. |
| First three gates enabled | pass | Legacy bytes, `gate_disabled`, no candidate insertion. |
| All gates enabled, explicitInvocation=false | pass | Legacy bytes, `invocation_not_requested`. |
| All gates enabled, missing AgentMapResult | pass | Legacy bytes, `invalid_agent_map_result`. |
| All gates enabled, invalid AgentMapResult | pass | Legacy bytes, `invalid_agent_map_result`. |
| Valid result, budget 0 | pass | Legacy bytes, `candidate_budget_exhausted`, no partial insertion. |
| Valid result, prompt-present file | pass | Prompt-present file excluded and diagnosed. |
| Valid result, empty candidate | pass | Legacy bytes, `candidate_empty`. |
| Rollback each gate | pass | Closing any gate returns legacy bytes. |
| Candidate sentinel leakage scan | pass | Sentinel absent from production source and default payload assertions; only tests contain the sentinel literal. |
| Provider ordering snapshot | pass | Context provider registry focused tests pass; no provider ordering implementation changed. |
| Lifecycle/checkpoint default payload scan | pass | TaskLoop sentinel test asserts lifecycle and checkpoint JSON exclude candidate text. |
| Model/Gateway/provider transport boundary scan | pass | Boundary scans show no renderer/Gateway/provider transport path added. |
| Windows/POSIX path normalization | pass | Windows-style prompt-present path excludes POSIX fixture path. |
| Repeated invocation deterministic output | pass | Same input produces identical reviewer prompt, candidate summary, and diagnostic codes. |
| Large candidate set no silent truncate | pass | Oversized sentinel candidate fails closed with budget exhaustion and no sentinel insertion. |
