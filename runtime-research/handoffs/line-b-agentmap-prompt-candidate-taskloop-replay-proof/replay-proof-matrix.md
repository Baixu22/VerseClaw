# Replay Proof Matrix

Status: accepted

| Requirement | Proof | Drift/Leak Result |
|---|---|---|
| default-off legacy byte parity | default-off, partial-gate, invalid-input, budget, empty, prompt-present, and realistic TaskLoop replay assertions | 0 drift |
| candidate named-surface-only | inserted case asserts `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` and false default/Gateway/model/provider flags | 0 default leakage |
| explicit invocation | `explicitInvocation=false` returns legacy prompt and `invocation_not_requested` | fail closed |
| explicit valid AgentMapResult | missing/invalid result returns legacy prompt and `invalid_agent_map_result` | fail closed |
| all gate rollback | each prompt candidate gate closed returns legacy prompt | rollback 100% |
| failure paths | missing/invalid/budget/empty/prompt-present/closed-gate cases | fail closed |
| deterministic replay | repeated same input produces identical prompt, diagnostics, and candidate metadata | deterministic |
| provider ordering | registry tests and no provider implementation changes | 0 drift |
| persistence boundary | helper result metadata `persisted: false`; scans for write/storage patterns | 0 persistence |
| automatic discovery/cache/reuse | helper accepts explicit result only; no TaskLoop discovery/build/cache path | 0 automatic reuse |
| authority boundary | metadata flags no runtime/tool/provider/model/Gateway authority; no default TaskLoop decision change | no escalation |

Current status is accepted for Phase A Replay Proof. This does not approve production-ready status, default-on AgentMap, or default cutover.
