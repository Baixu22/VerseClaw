# Replay Corpus

The replay corpus combines existing focused cases with the new realistic TaskLoop state replay table added to `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`.

| # | Replay case | Source | Expected result |
|---:|---|---|---|
| 1 | flags all off | explicit invocation pilot test | legacy reviewer bytes, `gate_disabled`, no candidate insertion |
| 2 | only one gate enabled | explicit invocation pilot test | legacy reviewer bytes, `gate_disabled` |
| 3 | first two gates enabled | explicit invocation pilot test | legacy reviewer bytes, `gate_disabled` |
| 4 | first three gates enabled | explicit invocation pilot test | legacy reviewer bytes, `gate_disabled` |
| 5 | all gates enabled but `explicitInvocation=false` | explicit invocation pilot test | legacy reviewer bytes, `invocation_not_requested` |
| 6 | all gates enabled but missing AgentMapResult | explicit invocation pilot test | legacy reviewer bytes, `invalid_agent_map_result` |
| 7 | all gates enabled but invalid AgentMapResult | explicit invocation pilot test | legacy reviewer bytes, `invalid_agent_map_result` |
| 8 | valid result + budget 0 | explicit invocation pilot test | legacy reviewer bytes, `candidate_budget_exhausted`, no partial insertion |
| 9 | valid result + large candidate set | explicit invocation pilot test | fail closed, no silent truncate, sentinel absent |
| 10 | valid result + prompt-present file | explicit invocation pilot test | prompt-present file excluded with diagnostic |
| 11 | valid result + Windows prompt-present path | explicit invocation pilot test | normalized path excluded with diagnostic |
| 12 | valid result + POSIX prompt-present path | explicit invocation pilot test | POSIX path excluded with diagnostic |
| 13 | valid result + empty candidate | explicit invocation pilot test | legacy reviewer bytes, `candidate_empty` |
| 14 | valid result + successful TaskLoop replay | realistic TaskLoop replay test | default bytes unchanged when not invoked; explicit insertion only in named pilot surface |
| 15 | valid result + failed TaskLoop replay | realistic TaskLoop replay test | default bytes unchanged when not invoked; explicit insertion only in named pilot surface |
| 16 | valid result + blocked TaskLoop replay | realistic TaskLoop replay test | default bytes unchanged when not invoked; explicit insertion only in named pilot surface; no completion authority |
| 17 | valid result + long context replay | realistic TaskLoop replay test | default bytes unchanged; bounded formatted context; explicit insertion deterministic |
| 18 | valid result + multi-file ClawX-like replay | realistic TaskLoop replay test + ClawX-like fixture | default bytes unchanged; explicit insertion uses fixture result only |
| 19 | repeated invocation deterministic output | explicit invocation pilot test | reviewer prompt, diagnostics, and candidate metadata match across runs |
| 20 | rollback by closing each gate | explicit invocation pilot test | each gate closure restores legacy reviewer prompt parity |
| 21 | candidate sentinel leakage scan | explicit invocation and TaskLoop controller tests + rg scan | sentinel appears only in tests and not default payloads |
| 22 | default TaskLoop reviewer prompt byte parity scan | TaskLoop controller tests | default formatter bytes unchanged |
| 23 | lifecycle/checkpoint default payload scan | TaskLoop controller tests + rg scan | no candidate text in lifecycle or checkpoint defaults |
| 24 | model/Gateway/provider transport boundary scan | rg scan | no candidate text or pilot call enters transport paths |
| 25 | provider ordering snapshot | context provider registry tests | default providers remain legacy context then loop context pack |
| 26 | no disk persistence scan | rg scan | no candidate/replay writes or persistence APIs added |
| 27 | no renderer direct IPC/direct Gateway scan | rg scan | no renderer bypass calls added |
| 28 | no automatic discovery/build/cache/reuse AgentMapResult scan | helper/tests/source review + rg scan | explicit input only; no discovery/cache/reuse path |

## Realistic Replay Shapes

- Successful TaskLoop: passing validation and satisfied acceptance.
- Failed TaskLoop: failed validation with repair signal.
- Blocked TaskLoop: blocking permission wait signal.
- Long-context TaskLoop: large plan, prior context, repair brief, and evidence summaries.
- Multi-file ClawX-like TaskLoop: fixture-backed chat composer, host API, IPC, runtime dispatch, and shared chat type scenario.
