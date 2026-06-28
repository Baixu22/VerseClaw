# Implementation Plan

## Scope

1. Add `runtime.agentMap.promptCandidateControlledCutoverPilot` as a strict default-off gate in schema, types, labels, help, and tests.
2. Add a pure runtime-core helper that accepts legacy prompt text plus explicit `AgentMapResult`, evaluates the three gates, and returns either byte-identical legacy text or a controlled pilot prompt assembly result.
3. Reuse the existing prompt assembly experiment helper and runtime shadow diagnostics so budget, prompt-present exclusion, and authority metadata stay aligned with Phase 8/9 behavior.
4. Keep TaskLoop, provider ordering, Gateway, model messages, renderer, and persistence surfaces unchanged by default.

## Non-Scope

- No default cutover.
- No default provider registration.
- No TaskLoop automatic AgentMapResult discovery.
- No disk persistence.
- No Gateway/model/provider transport modification.
- No mutation/apply/edit capability.

## Acceptance Shape

The helper must return legacy prompt byte parity when any gate is closed, AgentMapResult is invalid/missing, candidate assembly is disabled, candidate is empty, budget is exhausted, or prompt-present exclusion leaves no eligible candidate.

Only when all gates are open and the candidate succeeds may the helper append candidate text to the named pilot surface.
