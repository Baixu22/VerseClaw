# Submission Template

## Summary

- Scope:
- Files changed:
- Pilot surface:

## Preconditions

- Phase 8 synthesis status:
- Phase 9 synthesis status:
- Phase 10 synthesis status:
- Phase 11 synthesis status:
- Runtime index markers:

## Implementation

- New config flag:
- TaskLoop explicit invocation surface:
- Default behavior preserved:
- Authority boundaries:
- Persistence boundary:

## Validation

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

## Boundary Scans

- AgentMap/runtime scan:
- Renderer IPC/Gateway scan:
- Touched-file service scan:
- Touched-file mutation scan:
- Touched-file prompt/provider scan:
- Touched-file persistence scan:
- README docs-sync scan:

## Comms Decision

- `comms:replay`:
- `comms:compare`:
- Reason:

## Acceptance

- TaskLoop explicit invocation pilot:
- AgentMap default-off:
- Default runtime behavior:
- Default TaskLoop reviewer prompt behavior:
- Candidate text in default prompts/model messages:
- Candidate/replay persistence:
- Provider ordering:
- Status:
