# Leakage Proof

## Sentinel Set

- `AGENTMAP_IMPLEMENTATION_READY_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK`

## Required Proof

Focused tests must show:

- legacy/fail-closed payloads do not contain sentinel text,
- default reviewer prompt bytes remain unchanged,
- candidate text enters only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` when every gate is explicitly enabled,
- candidate fields for default prompt, default TaskLoop reviewer prompt, Gateway, model messages, provider transport, and persistence remain false,
- runtime shadow reports store content hash and length only.

## Current Test Evidence

`tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts` adds a 225-case corpus and a runtime-shadow sentinel check. The final synthesis records the command result.
