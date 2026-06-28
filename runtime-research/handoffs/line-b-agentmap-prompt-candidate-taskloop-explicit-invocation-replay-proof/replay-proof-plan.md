# Replay Proof Plan

## Goal

Phase A Replay Proof demonstrates that the accepted AgentMap TaskLoop explicit invocation pilot is usable only in the explicit pilot path and does not change default runtime behavior.

The proof uses focused unit replays plus boundary scans. It records replay status, diagnostics, and scorecard evidence in this handoff directory. It does not persist candidate/replay output to app state, localStorage, indexedDB, electron-store, SQLite, JSONL, cache, Gateway payloads, provider transport, model messages, checkpoint payloads, or lifecycle default payloads.

## Entry Criteria

| Criterion | Result | Evidence |
|---|---|---|
| Deep validation synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/synthesis.md` has `Status: accepted`. |
| Production-readiness plan accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/synthesis.md` has `Status: accepted`. |
| Runtime index records both accepted markers | pass | `runtime-research/agent-runtime-index.md` records Phase 13 deep validation and Phase 14 production-readiness accepted markers. |
| Phase 8/9/10/11/12 syntheses accepted | pass | Runtime shadow pilot, runtime shadow replay proof, cutover readiness, controlled cutover pilot, and TaskLoop explicit invocation pilot syntheses remain `Status: accepted`. |
| AgentMap default-off | pass | Gate resolvers require explicit boolean `true`; omitted config resolves disabled. |
| Explicit pilot surface only | pass | Candidate insertion surface remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## Method

1. Exercise pure TaskLoop explicit invocation helper cases in `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`.
2. Exercise TaskLoop default reviewer, lifecycle, checkpoint, and runtime-shadow boundaries in `tests/unit/task-loop-controller.test.ts`.
3. Exercise provider ordering and explicit AgentMap provider isolation in `tests/unit/context-provider-registry.test.ts`.
4. Run required harness context/validate, focused Vitest bundle, typecheck, and boundary scans.
5. Score against the Phase A 100-point scorecard and veto gates.

## Veto Gates

Any item below blocks acceptance regardless of score:

- candidate text leaks into default prompts, model messages, Gateway requests, provider transport, checkpoint payloads, or lifecycle default payloads;
- provider ordering changes;
- default TaskLoop reviewer prompt byte drift;
- closing any gate fails to restore legacy reviewer prompt parity;
- automatic discovery/build/cache/reuse of AgentMapResult appears;
- candidate/replay output is persisted;
- new service/listener/daemon/database/WebSocket/HTTP server is added;
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority;
- renderer direct IPC or direct Gateway call is added;
- this phase is described as production-ready/default-on/default cutover.
