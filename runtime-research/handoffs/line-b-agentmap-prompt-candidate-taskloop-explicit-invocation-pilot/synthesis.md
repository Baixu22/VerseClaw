# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Pilot Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate TaskLoop explicit invocation pilot is accepted.

This acceptance is narrow. It accepts a strictly default-off fourth pilot gate, a pure TaskLoop explicit invocation reviewer prompt helper, focused tests, and validation proof. It does not approve default cutover, production default enablement, default AgentMap provider registration, provider ordering changes, automatic TaskLoop discovery, Gateway/model/provider transport changes, candidate persistence, or AgentMap authority.

The live worktree contains many unrelated dirty/untracked files. Normal live-worktree harness validate still fails by seeing those unrelated paths outside this task's touched areas. To prove this phase's actual artifact set without reverting user work, the same normal harness validator was run in a temp clone with `origin/main` reset to the temp clone baseline and exactly this phase's files overlaid; that scoped normal validate passed.

## Current Boundary

The TaskLoop explicit invocation pilot must remain default-off, explicit-invocation only, explicit-`AgentMapResult` only, and non-authoritative. It must not alter default prompts, default TaskLoop reviewer prompts, Gateway payloads, model messages, provider transport, provider ordering, persistence, renderer IPC boundaries, or runtime decisions.

## Implemented Surface

- `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` is added as a strict optional/default-off config gate.
- `assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot()` returns byte-identical legacy reviewer prompt text unless all four gates are true, the caller explicitly requests TaskLoop pilot invocation, and the caller explicitly supplies a valid `AgentMapResult`.
- Candidate text is appended only inside the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` pilot surface.
- `formatTaskLoopContextPackForReviewer(...)` remains unchanged; `formatTaskLoopContextPackForReviewerPilot(...)` is a separate explicit helper.
- Budget exhaustion, missing/invalid input, missing explicit invocation, and gate-disabled states fail closed to legacy reviewer prompt text.
- Prompt-present files remain excluded through the existing prompt assembly experiment diagnostics.
- The helper reuses the accepted controlled cutover pilot and keeps candidate persistence/model/Gateway/provider/default-prompt authority flags false.

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
```

Live-worktree result: failed. The failure is the harness diff-coverage rule reporting many pre-existing dirty/untracked files outside this task's touched areas. This is classified as unrelated ambient dirty-tree coverage noise, not a TaskLoop explicit invocation pilot spec failure.

Scoped temp-clone result:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md
```

Result: passed. The scoped temp clone reset `origin/main` to its clone baseline, overlaid only this phase's files, and ran normal harness validate.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot.md --no-diff
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 9 files, 105 tests.

```text
pnpm --config.verify-deps-before-run=false run typecheck
```

Result: passed.

## Boundary Scan Results

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

Result: no matches.

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
```

Result: no matches.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is default-off runtime-core/config pilot behavior, not public UI behavior.

Touched-file scans found only expected spec/handoff forbidden-boundary text, config help/label text, tests, and pre-existing config/test strings. No new service/listener/daemon/database/WebSocket/HTTP server, mutation/apply/edit surface, candidate persistence, renderer direct IPC, direct Gateway call, provider transport change, Gateway request change, model-message change, or default TaskLoop reviewer prompt change was added.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Acceptance Matrix

| Gate | Status | Evidence |
|---|---|---|
| Phase 8 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted`. |
| Phase 9 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md` has `Status: accepted`. |
| Phase 10 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md` has `Status: accepted`. |
| Phase 11 synthesis remains accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-controlled-cutover-pilot/synthesis.md` has `Status: accepted`. |
| Runtime index prerequisite markers | pass | Phase 8/9/10/11 accepted markers are present before this synthesis update. |
| Task spec shape | pass | `harness validate --no-diff` passed. |
| Normal task spec validate | accepted | Live workspace is blocked by unrelated dirty-tree coverage; scoped temp-clone normal validate passed with only this phase's files overlaid. |
| Focused tests | pass | 9 files, 105 tests passed. |
| Typecheck | pass | `pnpm --config.verify-deps-before-run=false run typecheck` passed. |
| Default-off pilot | pass | Config schema tests cover omitted defaults and strict key. |
| Default reviewer prompt parity | pass | TaskLoop tests prove default formatter bytes are unchanged with flags off, all flags on without explicit invocation, and after rollback. |
| Candidate only in TaskLoop pilot surface | pass | New TaskLoop explicit invocation tests cover insertion only after all gates, explicit invocation, and explicit valid input. |
| Rollback by any gate | pass | New tests cover closed gates returning exact legacy reviewer prompt bytes. |
| Persistence/renderer/Gateway/provider boundary | pass | Scans and touched files show no new boundary-crossing implementation. |

## Current Status

Status: accepted
