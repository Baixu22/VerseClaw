# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Pilot

This handoff starts the TaskLoop explicit invocation pilot after the accepted controlled cutover pilot phase.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
```

Before implementation review, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
```

## Prerequisites

This phase may proceed only after confirming:

- Phase 8 runtime shadow pilot synthesis is `Status: accepted`.
- Phase 9 replay proof synthesis is `Status: accepted`.
- Phase 10 cutover readiness synthesis is `Status: accepted`.
- Phase 11 controlled cutover pilot synthesis is `Status: accepted`.
- `runtime-research/agent-runtime-index.md` records accepted Phase 8, Phase 9, Phase 10, and Phase 11 AgentMap markers.

## Accepted Boundary

This phase may add a default-off config gate, a pure TaskLoop explicit invocation helper, and focused tests. Candidate text may appear only in the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all required gates are true, the caller explicitly requests TaskLoop pilot invocation, and the caller explicitly supplies a valid `AgentMapResult`.

## Rejected Boundary

This phase must reject default-on AgentMap, default TaskLoop pilot invocation, default provider registration, provider ordering cutover, TaskLoop automatic discovery, model/Gateway/provider transport changes, default reviewer prompt changes, candidate persistence, runtime authority, mutation/apply/edit surfaces, renderer direct IPC, direct Gateway calls, and new services/listeners/daemons/databases.
