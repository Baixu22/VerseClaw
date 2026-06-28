# Validation Plan

Required commands:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
```

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
```

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts
```

```text
pnpm --config.verify-deps-before-run=false run typecheck
```

Required scans:

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

```text
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
```

```text
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
```

Run touched-file scans for service/listener/database/server, mutation/apply/edit, prompt/model/Gateway/provider/default-on wording, and persistence terms over this task's touched files.

Comms replay/compare:

- Run `pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` if Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, or fallback paths are touched.
- If not touched, record skipped reason in `synthesis.md`.
