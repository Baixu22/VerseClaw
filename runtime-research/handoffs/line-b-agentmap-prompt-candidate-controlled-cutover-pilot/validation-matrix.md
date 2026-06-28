# Validation Matrix

| Gate | Required Proof |
|---|---|
| Prerequisites | Phase 8/9/10 syntheses remain `Status: accepted`; runtime index records all three accepted markers. |
| Default-off | Schema omits enabled defaults; empty config does not enable any AgentMap gate. |
| Gate rollback | Closing `promptAssemblyExperiment`, `promptCandidateRuntimeShadow`, or `promptCandidateControlledCutoverPilot` returns legacy prompt bytes. |
| Explicit input | Missing or invalid `AgentMapResult` returns legacy prompt bytes and gate diagnostics. |
| Pilot insertion | Candidate text appears only in the helper's controlled pilot surface after all gates are open and explicit input is valid. |
| Budget | Over-budget candidates fail closed and do not silently truncate into prompt text. |
| Prompt-present | Prompt-present files are excluded from the candidate or diagnosed as excluded. |
| TaskLoop parity | Default reviewer prompt remains byte-identical and does not contain candidate text. |
| Provider/Gateway boundary | No provider ordering, Gateway, model-message, or provider transport changes. |
| Persistence boundary | No candidate/replay disk persistence. |
| Renderer boundary | No direct renderer IPC or direct Gateway calls. |

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```
