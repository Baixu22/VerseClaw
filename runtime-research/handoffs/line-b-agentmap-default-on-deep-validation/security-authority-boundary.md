# Security And Authority Boundary

AgentMap remains readonly, diagnostics-only, default-off, and non-authoritative.

Forbidden authority:

- runtime decisions
- tool decisions
- security decisions
- approval decisions
- retry decisions
- completion decisions
- provider/model selection
- provider ordering
- Gateway transport
- TaskLoop decisions
- checkpoint or lifecycle authority
- mutation or workspace edit authority

The explicit TaskLoop pilot may append candidate text only to `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` after all gates are enabled, explicit invocation is true, and an explicit valid AgentMapResult is supplied. That pilot remains non-authoritative and non-persistent.
