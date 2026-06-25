# Phase 4 Window Prompts

Use these prompts to launch separate implementation windows. Run lanes in order: **A -> B -> C -> D**, then run Lane E / synthesis after A-D submissions exist.

Global Phase-4 rule for every lane:

- Preserve legacy behavior by default.
- Do not start a second runtime service, daemon, listener, local HTTP server, WebSocket server, Temporal service, or Gateway instance.
- Do not treat `verseshell-runtime` as event-log/checkpoint/resume authority.
- Do not add renderer direct `window.electron.ipcRenderer.invoke(...)`.
- Do not add renderer direct Gateway HTTP/WS calls to `127.0.0.1:18789` or `localhost:18789`.
- Do not default-on event-log/resume cutover.
- Resume/replay shadow must not execute side effects.

## Execution Order

1. **Lane A**: define event-log contracts, flags, append-only store/query primitives.
2. **Lane B**: wire TaskLoop RuntimeTaskEvent shadows into Lane A writer behind flags.
3. **Lane C**: build pure reducer and checkpoint serializer over event fixtures.
4. **Lane D**: add resume shadow comparison and side-effect idempotency guard.
5. **Lane E**: run combined validation/boundary/docs after A-D.
6. **Synthesis**: classify A-E as accepted / needs_revision / blocked.

Do not start B before A has submitted its contract/store paths. Do not start C/D before A contracts exist; C may proceed in parallel with B only if it consumes A contracts and uses fixtures, not live TaskLoop wiring. D should start after A and C, and after B if it compares real TaskLoop event-log output.

---

## Lane A Prompt: Event Log Contracts And Store

```text
You are responsible for Phase 4 lane-a-event-log-contracts-and-store.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Goal:
Add the smallest append-only RuntimeTaskEvent event-log contract/store/query pilot for Phase 4. This lane must define canonical event-log envelopes, default-off flags, append-only/idempotent write behavior, and search/export primitives. It must not wire live TaskLoop execution or change legacy behavior.

Required reading:
- C:\Users\27933\.codex\RTK.md
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
- runtime-research/temporal/workflow-semantics.md
- runtime-research/temporal/useful-tests.md
- runtime-research/openhands/runtime-events.md
- runtime-research/openhands/useful-tests.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/parallel-lanes.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md
- harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Before implementation run:
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Allowed implementation paths:
- openclaw_runtime/src/runtime-core/**
- openclaw_runtime/src/agents/long-task-control/**
- openclaw_runtime/src/config/types.openclaw.ts
- openclaw_runtime/src/config/zod-schema.ts
- openclaw_runtime/src/config/schema.labels.ts
- openclaw_runtime/src/config/schema.help.ts

Allowed test paths:
- tests/unit/runtime-event-log*.test.ts
- tests/unit/runtime-core-contracts.test.ts only if needed for imports/exports

Required scope:
1. Define event-log envelope/record shape around canonical RuntimeTaskEvent. Do not duplicate RuntimeTaskEvent or Checkpoint contracts.
2. Add default-off flag helpers/schema for:
   - runtime.eventLog.shadow
   - runtime.eventLog.persist
   - runtime.checkpointSerializer.shadow
   - runtime.resume.replayShadow
   Do not implement or enable runtime.resume.preferEventLog.
3. Add append-only writer/reader/query primitives suitable for shadow mode:
   - append one/many events
   - idempotency key dedupe
   - get by event id
   - batch get
   - search by taskId, kind, timestamp gte/lt, sort order, page/limit
   - export iterator/order-stable read
4. Add isolated diagnostics for invalid event, duplicate idempotency key, store write/read failure, schema marker mismatch.
5. Keep the store in-process / library-only. No service, no port, no listener, no background runtime.
6. Add tests for append-only behavior, idempotency, filters, pagination after filtering, export order, invalid event isolation, and default-off flags.

Explicit non-goals:
- Do not modify TaskLoop call sites.
- Do not write live events from TaskLoop.
- Do not implement resume.
- Do not change long_task_checkpoints behavior.
- Do not add renderer/Main transport routes.
- Do not add UI.

Required validation:
rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control tests/unit/runtime-event-log*.test.ts

Boundary requirements:
- Feature flags default false unless explicitly true.
- Unknown/invalid events produce diagnostics, not crashes, where shadow store APIs allow it.
- Append-only history cannot be rewritten; compaction is only a future explicit event shape if needed.

Output:
Write exactly one submission:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-a-event-log-contracts-and-store.md

Use:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md

Status rules:
Use Status: accepted only if all required evidence is present and tests pass. Use needs_revision if any evidence/test/boundary item is missing.
```

---

## Lane B Prompt: TaskLoop Event Log Dual-Write

```text
You are responsible for Phase 4 lane-b-taskloop-event-log-dual-write.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Goal:
Wire TaskLoop RuntimeTaskEvent lifecycle/checkpoint shadows into the Lane A event-log writer behind Phase-4 flags only. This lane is dual-write/shadow-only; legacy TaskLoop status, lifecycle payloads, self-check decisions, and persisted checkpoint authority must remain unchanged.

Required reading:
- C:\Users\27933\.codex\RTK.md
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
- runtime-research/temporal/workflow-semantics.md
- runtime-research/temporal/useful-tests.md
- runtime-research/openhands/runtime-events.md
- runtime-research/openhands/useful-tests.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/parallel-lanes.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md
- harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
- Lane A submission and touched code, especially event-log writer/flags.

Before implementation run:
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Allowed implementation paths:
- openclaw_runtime/src/agents/task-loop-controller.ts
- openclaw_runtime/src/agents/long-task-control/**
- openclaw_runtime/src/runtime-core/** only if Lane A contracts need small non-breaking extension

Allowed test paths:
- tests/unit/task-loop-controller.test.ts
- tests/unit/task-loop-event-log*.test.ts

Required scope:
1. Add optional TaskLoop dependency or writer hook for Lane A event-log append API.
2. Event-log dual-write must run only when:
   - existing TaskLoop RuntimeTaskEvent shadow emission is enabled (`runtimeTaskEventLogShadow` or `runtimeCoreShadow`), and
   - Phase-4 event log flag is explicitly enabled (`runtime.eventLog.shadow` and/or `runtime.eventLog.persist`, depending on Lane A design).
3. Emit lifecycle and checkpoint RuntimeTaskEvent shadows to the event-log writer without mutating legacy lifecycle event objects or checkpoint payloads.
4. Writer failures must be swallowed/diagnostic-only and must not change TaskLoop result/status.
5. Maintain Phase-3 registry diagnostics as shadow metadata/evidence only; do not write them into legacy record evidence/checkpoint authority.
6. Add tests for:
   - flag-off: no event-log writes, legacy behavior unchanged
   - flag-on: event-log receives lifecycle/checkpoint shadows
   - writer failure: TaskLoop still completes/blocks/fails exactly as before
   - lifecycle callback object has no event-log metadata
   - persisted checkpoint input has no event-log-only fields

Explicit non-goals:
- Do not implement state reducer.
- Do not implement resume.
- Do not prefer event-log over existing checkpoints.
- Do not change mission_loop/tool visible behavior.
- Do not add renderer/Main IPC or Gateway calls.
- Do not add UI.

Required validation:
rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'
rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/long-task-control tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts

Comms:
Run comms replay/compare only if this lane touches Main/Gateway communication paths. Otherwise record not-run with reason.

Output:
Write exactly one submission:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-b-taskloop-event-log-dual-write.md

Use:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md

Status rules:
Use Status: accepted only if flag-off parity and writer-failure non-fatal tests pass. Use needs_revision for missing evidence, behavior drift, or side-effect risks.
```

---

## Lane C Prompt: State Reducer And Checkpoint Serializer

```text
You are responsible for Phase 4 lane-c-state-reducer-checkpoint-serializer.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Goal:
Build a pure event-log replay reducer and checkpoint serializer/deserializer over canonical RuntimeTaskEvent / Checkpoint contracts. This lane must be deterministic and fixture-driven. It must not replace legacy resume or consume live runtime state as authority.

Required reading:
- C:\Users\27933\.codex\RTK.md
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
- runtime-research/temporal/workflow-semantics.md
- runtime-research/temporal/useful-tests.md
- runtime-research/openhands/runtime-events.md
- runtime-research/openhands/useful-tests.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/parallel-lanes.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md
- harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
- Lane A contracts/store submission and code.

Before implementation run:
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Allowed implementation paths:
- openclaw_runtime/src/runtime-core/**
- openclaw_runtime/src/agents/long-task-control/**

Allowed test paths:
- tests/unit/runtime-state-reducer*.test.ts
- tests/unit/runtime-checkpoint-serializer*.test.ts
- tests/unit/runtime-event-log*.test.ts if shared fixtures need coverage

Required scope:
1. Add pure reducer from `RuntimeTaskEvent[]` or Lane A event-log records to a replayed task state.
2. Cover states:
   - created
   - planning
   - assembling_context
   - running
   - waiting_permission / waiting_tool / waiting_external where represented by event/status metadata
   - applying_changes
   - verifying
   - completed
   - failed
   - blocked
   - cancelled
   - checkpoint
3. Reducer must be deterministic and must not execute tools, commands, Gateway calls, file writes, or model calls.
4. Add replay diagnostics for:
   - invalid event order
   - duplicate event id
   - missing checkpoint payload
   - schema/version marker mismatch
   - terminal event followed by non-compaction continuation
5. Add checkpoint serializer/deserializer that preserves:
   - checkpointId
   - taskId
   - state
   - openObligations
   - contextSummary
   - toolResults/tool result refs
   - fileHashes
   - evidenceRefs
   - schemaVersion
   - metadata/version markers
6. Add continue-as-new / compaction shadow shape if needed, but do not wire it into live runtime.
7. Add tests for reducer replay, nondeterministic/invalid histories, checkpoint round-trip, schema marker handling, and obligations/evidence preservation.

Explicit non-goals:
- Do not write live events.
- Do not modify TaskLoop call sites unless only importing shared types is necessary.
- Do not implement resume shadow comparison; Lane D owns that.
- Do not change legacy checkpoint store behavior.
- Do not add UI.

Required validation:
rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts

Output:
Write exactly one submission:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-c-state-reducer-checkpoint-serializer.md

Use:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md

Status rules:
Use Status: accepted only if reducer/serializer tests prove no side effects and deterministic replay. Use needs_revision if any replay claim lacks path/function/test/command evidence.
```

---

## Lane D Prompt: Resume Shadow And Idempotency

```text
You are responsible for Phase 4 lane-d-resume-shadow-idempotency.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Goal:
Add default-off resume shadow comparison and side-effect idempotency guard using Lane A event-log records and Lane C reducer/serializer. Resume shadow must compare replayed event-log state to legacy checkpoint/session state without executing tools or changing runtime behavior.

Required reading:
- C:\Users\27933\.codex\RTK.md
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/migration-execution-plan.md
- runtime-research/implementation-roadmap.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
- runtime-research/temporal/workflow-semantics.md
- runtime-research/temporal/useful-tests.md
- runtime-research/openhands/runtime-events.md
- runtime-research/openhands/useful-tests.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/parallel-lanes.md
- runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md
- harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
- Lane A submission/code
- Lane C submission/code
- Lane B submission/code if comparing real TaskLoop-written event logs

Before implementation run:
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Allowed implementation paths:
- openclaw_runtime/src/runtime-core/**
- openclaw_runtime/src/agents/long-task-control/**
- openclaw_runtime/src/agents/task-loop-controller.ts only if adding an optional shadow comparison hook that is fully flag-gated
- openclaw_runtime/src/agents/tools/task-loop-tool.ts only if adding status-only shadow diagnostics without visible behavior changes

Allowed test paths:
- tests/unit/runtime-resume-shadow*.test.ts
- tests/unit/runtime-state-reducer*.test.ts
- tests/unit/task-loop-controller.test.ts if an optional TaskLoop hook is added

Required scope:
1. Add resume shadow helper that:
   - reads event-log records/checkpoints via Lane A APIs or fixture inputs
   - rebuilds state using Lane C reducer
   - compares replayed state against legacy latest checkpoint/session state
   - emits diagnostics only
2. Gate all behavior behind `runtime.resume.replayShadow === true`.
3. Do not implement or enable `runtime.resume.preferEventLog`.
4. Add side-effect idempotency guard model:
   - completed tool results are indexed by `idempotencyKey`
   - resume shadow reuses completed result metadata/evidence
   - missing/ambiguous mutating tool result produces waiting/verifying diagnostic
   - no tool callback/executor is invoked during replay
5. Add tests with spy functions proving resume shadow does not:
   - execute tools
   - call Gateway/Main transport
   - write files
   - send messages
   - apply patches
6. Add tests for:
   - flag-off no-op
   - completed side-effect tool not repeated
   - missing tool result returns waiting/verifying diagnostic, not completed
   - replayed completed/blocked/failed state comparison
   - legacy checkpoint remains authoritative

Explicit non-goals:
- Do not change actual resume behavior to prefer event log.
- Do not add UI.
- Do not add renderer direct IPC/Gateway calls.
- Do not add any service/listener.
- Do not retry mutating tools during resume.

Required validation:
rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts tests/unit/runtime-resume-shadow*.test.ts
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'
rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/tools/task-loop-tool.ts tests/unit/runtime-resume-shadow*.test.ts

Comms:
Run comms replay/compare if this lane touches Main/Gateway communication paths. Otherwise record not-run with reason.

Output:
Write exactly one submission:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-d-resume-shadow-idempotency.md

Use:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md

Status rules:
Use Status: accepted only if tests prove no side-effect execution and flag-off legacy behavior unchanged. Use needs_revision for missing idempotency evidence, default-on behavior, or any replay side-effect risk.
```

---

## Lane E Prompt: Harness, Tests, Boundary, Docs

```text
You are responsible for Phase 4 lane-e-harness-tests-boundary-docs.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Goal:
Validate Phase 4 A-D after their submissions exist. Do not accept under-evidenced claims. Run combined tests, boundary scans, comms checks when needed, and prepare synthesis readiness.

Required reading:
- all Phase 4 README / parallel-lanes / templates
- all Phase 4 lane A-D submissions
- harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
- Phase 3 synthesis

Required validation:
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts tests/unit/runtime-resume-shadow*.test.ts tests/unit/task-loop-controller.test.ts
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'
rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts tests/unit

Run comms replay/compare if Main/Gateway communication paths changed:
rtk node scripts/comms/replay.mjs
rtk node scripts/comms/compare.mjs

Run targeted Electron E2E if UI/user-visible behavior changed.

Output:
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-e-harness-tests-boundary-docs.md
```
