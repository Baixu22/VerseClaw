# Line B AgentMap Prompt Candidate Controlled Cutover Pilot Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate controlled cutover pilot is accepted.

This acceptance is narrow. It accepts a strictly default-off third pilot gate, a pure controlled prompt assembly pilot helper, focused tests, and validation proof. It does not approve default cutover, production default enablement, default AgentMap provider registration, provider ordering changes, automatic TaskLoop discovery, Gateway/model/provider transport changes, candidate persistence, or AgentMap authority.

The live worktree contains many unrelated dirty/untracked files. Normal live-worktree harness validate still fails by seeing those unrelated paths outside this task's touched areas. To prove this phase's actual artifact set without reverting user work, the same normal harness validator was run in a clean temp clone with `origin/main` set to the clone baseline and exactly this phase's files copied in; that scoped normal validate passed.

## Current Boundary

The controlled cutover pilot must remain default-off, explicit-input only, and non-authoritative. It must not alter default prompts, TaskLoop reviewer prompts, Gateway payloads, model messages, provider transport, provider ordering, persistence, renderer IPC boundaries, or runtime decisions.

## Implemented Surface

- `runtime.agentMap.promptCandidateControlledCutoverPilot` is added as a strict optional/default-off config gate.
- `assembleAgentMapPromptCandidateControlledCutoverPilot()` returns byte-identical legacy prompt text unless all three gates are true and the caller explicitly supplies a valid `AgentMapResult`.
- Candidate text is appended only inside the named `agent_map.prompt_candidate.controlled_cutover_pilot` pilot surface.
- Budget exhaustion, missing/invalid input, and gate-disabled states fail closed to legacy prompt text.
- Prompt-present files remain excluded through the existing prompt assembly experiment diagnostics.
- The helper reuses runtime shadow diagnostics and keeps candidate persistence/model/Gateway/provider/default-prompt authority flags false.

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
```

Live-worktree result: failed. The failure is the harness diff-coverage rule reporting many pre-existing dirty/untracked files outside this task's touched areas. This is classified as unrelated ambient dirty-tree coverage noise, not a controlled-cutover spec failure.

Scoped clean-clone result:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
```

Result: passed. The scoped clone changed only:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
openclaw_runtime/src/config/schema.help.ts
openclaw_runtime/src/config/schema.labels.ts
openclaw_runtime/src/config/types.openclaw.ts
openclaw_runtime/src/config/zod-schema.ts
openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
openclaw_runtime/src/runtime-core/index.ts
runtime-research/handoffs/line-b-agentmap-prompt-candidate-controlled-cutover-pilot/**
tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts
tests/unit/runtime-feature-config-schema.test.ts
tsconfig.node.json
tsconfig.web.json
```

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md --no-diff
```

Result: passed. The task spec shape is valid when unrelated dirty-tree diff coverage is excluded.

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 8 files, 100 tests.

```text
pnpm --config.verify-deps-before-run=false run typecheck
```

Result: passed after adding root TypeScript path mappings for existing `openclaw_runtime/packages/normalization-core` and `openclaw_runtime/packages/acp-core`, and moving root node/web TypeScript libs to ES2023 so existing runtime imports using `toSorted`/`findLast` typecheck when pulled into the root graph.

## Boundary Scan Results

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
```

Result: no matches.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is default-off runtime-core/config pilot behavior, not public UI behavior.

Touched-file scans found only expected spec/handoff forbidden-boundary text, config help/label text, tests, and pre-existing config help strings. No new service/listener/daemon/database/WebSocket/HTTP server, mutation/apply/edit surface, candidate persistence, renderer direct IPC, direct Gateway call, provider transport change, Gateway request change, model-message change, or TaskLoop reviewer prompt change was added.

The required broad AgentMap scan command returned no matches in this shell:

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

PowerShell cross-check over `openclaw_runtime/src/agents/task-loop-controller.ts` found the pre-existing TaskLoop runtime-shadow diagnostics references for `AgentMapPromptCandidateRuntimeShadow`; no TaskLoop controlled-cutover insertion path was added.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Acceptance Matrix

| Gate | Status | Evidence |
|---|---|---|
| Phase 8 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted`. |
| Phase 9 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md` has `Status: accepted`. |
| Phase 10 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md` has `Status: accepted`. |
| Runtime index prerequisite markers | pass | Phase 8/9/10 accepted markers are present. |
| Task spec shape | pass | `harness validate --no-diff` passed. |
| Normal task spec validate | accepted | Live workspace is blocked by unrelated dirty-tree coverage; scoped clean-clone normal validate passed with only this phase's files changed. |
| Focused tests | pass | 8 files, 100 tests passed. |
| Typecheck | accepted | `pnpm --config.verify-deps-before-run=false run typecheck` passed after root TS path/lib repair. |
| Default-off pilot | pass | Config schema tests cover omitted defaults and strict key. |
| Candidate only in pilot surface | pass | New controlled-cutover tests cover insertion only after all gates and explicit valid input. |
| Rollback by any gate | pass | New tests cover closed gates returning exact legacy prompt bytes. |
| Persistence/renderer/Gateway/provider boundary | pass | Scans and touched files show no new boundary-crossing implementation. |

## Current Status

Status: accepted
