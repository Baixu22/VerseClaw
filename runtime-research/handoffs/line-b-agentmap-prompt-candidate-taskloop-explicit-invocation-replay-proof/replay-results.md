# Replay Results

| # | Replay case | Result | Evidence |
|---:|---|---|---|
| 1 | flags all off | pass | `keeps legacy bytes for all partial gate replay cases` |
| 2 | only one gate enabled | pass | `keeps legacy bytes for all partial gate replay cases` |
| 3 | first two gates enabled | pass | `keeps legacy bytes for all partial gate replay cases` |
| 4 | first three gates enabled | pass | `keeps legacy bytes for all partial gate replay cases` |
| 5 | all gates enabled but `explicitInvocation=false` | pass | `requires explicit invocation...`; realistic replay table |
| 6 | all gates enabled but missing AgentMapResult | pass | `requires explicit invocation...` |
| 7 | all gates enabled but invalid AgentMapResult | pass | `requires explicit invocation...` |
| 8 | valid result + budget 0 | pass | `fails closed for budget exhaustion without silent partial insertion` |
| 9 | valid result + large candidate set | pass | `does not silently truncate large candidates` |
| 10 | valid result + prompt-present file | pass | `excludes prompt-present files from the TaskLoop pilot candidate` |
| 11 | valid result + Windows prompt-present path | pass | `normalizes Windows prompt-present paths before exclusion` |
| 12 | valid result + POSIX prompt-present path | pass | `excludes prompt-present files from the TaskLoop pilot candidate` |
| 13 | valid result + empty candidate | pass | `fails closed for empty candidate output` |
| 14 | successful TaskLoop replay | pass | `replays realistic TaskLoop states without changing default reviewer bytes` |
| 15 | failed TaskLoop replay | pass | `replays realistic TaskLoop states without changing default reviewer bytes` |
| 16 | blocked TaskLoop replay | pass | `replays realistic TaskLoop states without changing default reviewer bytes` |
| 17 | long context replay | pass | `replays realistic TaskLoop states without changing default reviewer bytes` |
| 18 | multi-file ClawX-like replay | pass | `replays realistic TaskLoop states without changing default reviewer bytes`; `tests/fixtures/agent-map/clawx-like-workspace/**` |
| 19 | repeated invocation deterministic output | pass | `produces deterministic replay output for repeated invocations` |
| 20 | rollback one gate at a time | pass | partial gate table covers omitted/one/two/three gates plus false fourth gate |
| 21 | candidate sentinel leakage scan | pass | sentinel tests plus rg scan |
| 22 | default reviewer prompt byte parity scan | pass | `keeps TaskLoop reviewer prompt legacy by default...` |
| 23 | lifecycle/checkpoint default payload scan | pass | `keeps AgentMap sentinel out of default reviewer, lifecycle, and checkpoint payloads` |
| 24 | model/Gateway/provider transport boundary scan | pass | boundary rg scans |
| 25 | provider ordering snapshot | pass | `keeps provider ordering unchanged...`; explicit providers remain after defaults only when injected |
| 26 | no disk persistence scan | pass | persistence rg scan |
| 27 | no renderer direct IPC/direct Gateway scan | pass | renderer boundary rg scan |
| 28 | no automatic discovery/build/cache/reuse AgentMapResult scan | pass | explicit result input only in helper and TaskLoop shadow provider |

## Hard Gates

| Gate | Result | Evidence |
|---|---|---|
| Flags all off reviewer prompt byte-identical | pass | Replay cases 1-4. |
| All gates enabled with `explicitInvocation=false` byte-identical | pass | Replay case 5 and realistic replay table. |
| Any gate closed blocks candidate and emits gate diagnostic | pass | Replay cases 1-4 and 20. |
| Missing/invalid AgentMapResult fail closed | pass | Replay cases 6-7. |
| Budget exhausted fail closed without silent truncate | pass | Replay cases 8-9. |
| Large candidate no silent truncate | pass | Replay case 9. |
| Prompt-present files excluded or diagnosed | pass | Replay cases 10-12. |
| Explicit invocation + all gates + valid result inserts only into named pilot surface | pass | Replay cases 14-18. |
| Successful/failed/blocked/long-context replay do not change default reviewer prompt | pass | Replay cases 14-17. |
| Candidate sentinel not in default payloads | pass | Replay cases 21 and 23. |
| Provider ordering unchanged | pass | Replay case 25. |
| No disk persistence | pass | Replay case 26. |
| No renderer direct IPC/direct Gateway call | pass | Replay case 27. |
| No automatic AgentMapResult discovery/build/cache/reuse | pass | Replay case 28. |
| Rollback by closing any gate restores legacy parity | pass | Replay case 20. |
| Comms paths untouched or replay/compare passed | pass | Comms skipped because this phase touched no Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths. |
