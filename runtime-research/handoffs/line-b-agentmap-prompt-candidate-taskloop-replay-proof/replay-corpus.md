# Replay Corpus

Status: accepted

The corpus uses focused unit replay coverage and ClawX-like fixtures under `tests/fixtures/agent-map/**`. It includes near-real TaskLoop context pack shapes, fixture files for renderer/Main/runtime/shared code, and synthetic failure inputs that exercise the same TaskLoop reviewer formatting path.

| Case | Evidence Source | Expected Result |
|---|---|---|
| successful TaskLoop | `runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts` realistic replay table | default-off legacy bytes unchanged; explicit valid pilot inserts only named surface |
| failed TaskLoop | realistic replay table with failed validation state | default-off legacy bytes unchanged; no candidate authority over repair/failure |
| blocked TaskLoop | realistic replay table with blocking control signal | default-off legacy bytes unchanged; no candidate authority over blocked decision |
| long context TaskLoop | realistic replay table with large plan/history/evidence | deterministic bounded legacy prompt and explicit pilot output |
| large candidate set | large sentinel candidate test | fails closed with budget exhaustion; no silent partial insertion |
| budget exhausted | token budget 0 test | legacy reviewer bytes, `candidate_budget_exhausted`, no partial candidate |
| empty candidate | empty AgentMapResult test | legacy reviewer bytes, `candidate_empty` |
| prompt-present files | POSIX prompt-present path test | prompt-present file excluded and diagnosed |
| missing AgentMapResult | missing result test | legacy reviewer bytes, `invalid_agent_map_result` |
| invalid AgentMapResult | invalid shape test | legacy reviewer bytes, `invalid_agent_map_result` |
| explicitInvocation=false | explicit invocation false test | legacy reviewer bytes, `invocation_not_requested` |
| one gate closed | partial gate replay table | legacy reviewer bytes, `gate_disabled` |
| each gate rollback | partial gate replay table | closing each gate restores legacy parity |
| Windows/POSIX path normalization | Windows prompt-present path test plus POSIX path test | equivalent exclusion behavior |
| candidate sentinel leakage | sentinel default/fail-closed payload test plus rg scan | sentinel absent from default/fail-closed payloads |
| lifecycle/checkpoint default payload scan | `task-loop-controller.test.ts` lifecycle/checkpoint assertions | default lifecycle/checkpoint payloads exclude candidate text |
| provider ordering snapshot | `context-provider-registry.test.ts` and boundary review | provider ordering drift 0 |
| repeated replay deterministic output | repeated invocation test | reviewer prompt, diagnostics, and candidate metadata repeat byte-identically |

No replay output is written to runtime state, JSONL, localStorage, indexedDB, electron-store, SQLite, Postgres, MySQL, Redis, or cache files.
