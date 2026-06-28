# Boundary Matrix

| Surface | Readiness Requirement | Current Boundary |
|---|---|---|
| Default runtime behavior | Must remain unchanged | AgentMap prompt candidate helpers are pure and default-off by omission. |
| Default TaskLoop reviewer prompt | Byte-identical unless explicit pilot invoked | Focused tests compare legacy prompt bytes across rollback/fail-closed cases. |
| Explicit invocation | Required for TaskLoop pilot insertion | `explicitInvocation` must be true. |
| AgentMapResult | Must be explicit and valid | Invalid, missing, and malformed values fail closed. |
| Feature flags | All four prompt-candidate flags must be true | Omitted/off flags fail closed. |
| Provider ordering | Must not change | Registry default manifests remain `legacy-context-engine`, then `loop-context-pack`. |
| Default provider registration | AgentMap must not be default provider | AgentMap provider is not in default registry manifests. |
| Gateway/provider/model transport | Candidate text must not enter transport payloads | Helper result fields keep Gateway/model/provider insertion false. |
| Checkpoint/lifecycle | Candidate text must not enter payloads | Existing TaskLoop tests verify sentinel absence in lifecycle/checkpoint payloads. |
| Persistence | Candidate/shadow/replay output must not persist | Candidate `persisted=false`; shadow stores hash/length only. |
| Renderer IPC/Gateway | Renderer must not add direct backend calls | Scan required across `src/pages` and `src/components`. |
| Services/databases/listeners | No new always-on or durable surface | Scan required across readiness files/tests. |
| Mutation/apply/edit | No symbol or workspace mutation | Scan required across readiness files/tests. |

Allowed positive implementation-readiness output still leaves default-on and cutover forbidden.
