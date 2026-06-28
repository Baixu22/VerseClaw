# Quantitative Scorecard

| Category | Max | Score | Evidence |
|---|---:|---:|---|
| Default behavior parity | 20 | 20 | Flags-off, partial gate, explicitInvocation=false, runtime-shadow default reviewer, lifecycle/checkpoint sentinel, and default formatter parity tests pass. |
| Explicit invocation correctness | 15 | 15 | Valid explicit invocation requires all four gates plus valid AgentMapResult and inserts only into the named TaskLoop pilot surface. |
| Boundary/no authority | 20 | 20 | Boundary scans and tests show no default prompt/model/Gateway/provider transport/provider ordering/runtime authority expansion. |
| Fail-closed ability | 10 | 10 | Missing/invalid result, budget exhaustion, empty candidate, prompt-present exclusion, and closed gates fail closed with diagnostics. |
| Real task usefulness | 15 | 14 | ClawX-like fixture tests prove useful candidate insertion and prompt-present exclusion; next Replay Proof should add more varied real TaskLoop corpora. |
| Diagnostics quality | 8 | 8 | Diagnostics distinguish `gate_disabled`, `invocation_not_requested`, `invalid_agent_map_result`, `candidate_empty`, `candidate_budget_exhausted`, `prompt_present_file_excluded`, and `candidate_inserted`. |
| Rollback ability | 7 | 7 | Per-gate rollback restores legacy reviewer prompt byte parity with no persisted candidate data to clean up. |
| Maintainability/auditability | 5 | 4 | Validation artifacts and tests are focused; live harness validate is still obstructed by unrelated dirty-tree coverage noise, though scoped normal validate passes. |
| Total | 100 | 98 | Recommend entering Replay Proof. |

## Threshold

Score 98/100 reaches the 95-100 threshold: recommend entering Replay Proof. This is not a default cutover or production-ready declaration.
