# Component Contract

AgentMap is a readonly context-candidate and diagnostic-evidence component.

## Allowed Contract

- Generate bounded readonly prompt/context candidates.
- Emit counters, booleans, hashes, lengths, and bounded diagnostic codes.
- Enter the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface only when explicitly invoked, given an explicit valid `AgentMapResult`, and protected by all explicit gates.
- Prove default-off legacy parity, rollback, leakage, provider ordering, persistence, telemetry, and authority boundaries.

## Denied Contract

AgentMap does not own selection, memory, transport, completion, retry, approval, blocking, cutover, checkpoint, provider, model, Gateway, lifecycle, tool, security, or runtime-decision authority.

## Stop Recommendation

The component is mature enough to pause capability expansion. The next recommended state is development pause, not default-on runtime implementation execution.
