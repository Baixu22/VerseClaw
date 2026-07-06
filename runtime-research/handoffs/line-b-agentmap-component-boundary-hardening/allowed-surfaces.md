# Allowed Surfaces

Status: pass.

Allowed AgentMap surfaces are intentionally small:

- bounded readonly prompt/context candidate generation
- counters
- booleans
- hashes
- lengths
- bounded diagnostic codes
- explicit valid `AgentMapResult` input
- explicit gate-protected named pilot surface
- proof documents and focused tests

The only prompt-candidate insertion surface recognized by this hardening package is `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`, and only under explicit invocation with all gates enabled.
