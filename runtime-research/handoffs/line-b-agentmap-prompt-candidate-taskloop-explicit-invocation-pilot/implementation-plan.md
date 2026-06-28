# Implementation Plan

## Phase Gate

1. Confirm Phase 8, Phase 9, Phase 10, and Phase 11 AgentMap syntheses remain `Status: accepted`.
2. Confirm `runtime-research/agent-runtime-index.md` records the accepted AgentMap phase markers.
3. Create the task spec and this handoff with `synthesis.md` at `Status: needs_revision`.
4. Run task-spec context and validation before runtime implementation.

## Runtime Shape

1. Add `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot?: boolean` as a strict optional/default-off flag in config type/schema/help/labels.
2. Add a pure runtime-core helper for `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.
3. Reuse the accepted controlled cutover helper as the candidate source, but require:
   - `promptAssemblyExperiment === true`
   - `promptCandidateRuntimeShadow === true`
   - `promptCandidateControlledCutoverPilot === true`
   - `promptCandidateTaskLoopExplicitInvocationPilot === true`
   - explicit TaskLoop pilot invocation
   - explicit valid `AgentMapResult`
4. Keep `formatTaskLoopContextPackForReviewer(...)` byte-identical by default.
5. Add a separate explicit TaskLoop reviewer pilot formatter/wrapper that calls the pure helper only when requested.

## Tests

1. Add focused runtime helper tests for gate-blocking, invalid input, explicit invocation, prompt-present exclusion, and budget exhaustion.
2. Extend config schema tests for the new strict key, omitted default, help, and label.
3. Extend TaskLoop tests to prove default reviewer prompt parity and explicit pilot insertion only in the named surface.

## Validation

1. Run required harness context and validate.
2. Run focused Vitest command from the task spec.
3. Run typecheck.
4. Run required boundary scans.
5. Run comms replay/compare only if Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths are touched.
6. Accept synthesis only after required validation passes.
7. Update runtime index only after synthesis is accepted.
