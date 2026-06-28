# Line B AgentMap Prompt Candidate Controlled Cutover Pilot

This handoff starts the controlled cutover pilot after the accepted cutover readiness spec-only phase.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
```

Before implementation review, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
```

## Prerequisites

This phase may proceed only after confirming:

- Phase 8 runtime shadow pilot synthesis is `Status: accepted`.
- Phase 9 replay proof synthesis is `Status: accepted`.
- Phase 10 cutover readiness synthesis is `Status: accepted`.
- `runtime-research/agent-runtime-index.md` records the accepted Phase 8, Phase 9, and Phase 10 AgentMap markers.

## Accepted Boundary

This phase may add a pure controlled cutover helper and focused tests. Candidate text may appear only in the helper's named controlled pilot prompt assembly surface when all required gates are true and the caller explicitly supplies a valid `AgentMapResult`.

## Rejected Boundary

This phase must reject default-on AgentMap, default provider registration, provider ordering cutover, TaskLoop automatic discovery, model/Gateway/provider transport changes, default prompt changes, candidate persistence, runtime authority, mutation/apply/edit surfaces, renderer direct IPC, direct Gateway calls, and new services/listeners/daemons/databases.
