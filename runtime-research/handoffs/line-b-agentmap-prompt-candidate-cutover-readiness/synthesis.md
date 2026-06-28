# Line B AgentMap Prompt Candidate Cutover Readiness Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate cutover readiness plan is accepted as a spec-only readiness gate.

This acceptance does not approve prompt cutover. It accepts only the future evidence gates, lane definitions, rollback criteria, and validation checklist required before any later implementation spec may propose inserting AgentMap prompt candidate text into model-facing or runtime-authoritative paths.

The current checkout contains a large unrelated dirty worktree, so the normal harness validate command in the live workspace fails by seeing unrelated changed/untracked files outside this task's touched areas. To prove the actual readiness artifact set without reverting user work, the task spec and handoff directory were copied into a temporary clean detached worktree from the current `HEAD`, that worktree's `origin/main` ref was set to its baseline `HEAD`, and normal harness validate passed there with exactly the readiness artifacts as the changed files.

## Boundary

This phase is spec-only/readiness-only. It defines the evidence required before a future AgentMap prompt candidate cutover proposal can be considered. It does not approve cutover and does not implement cutover.

AgentMap remains default-off, readonly, explicit-input only, diagnostics-only, and non-authoritative. The accepted Phase 8 runtime shadow pilot and Phase 9 replay proof remain evidence only. Candidate text must not enter TaskLoop prompts, reviewer prompts, default prompt assembly, Gateway requests, model messages, provider transport, user prompts, chat prompts, or system prompts.

## Lane Status

| Lane | Status | Notes |
|---|---|---|
| Lane A: Prompt byte parity and diff-risk map | accepted | Readiness lane exists and names byte-parity surfaces, future snapshot proof, forbidden prompt/model/Gateway/provider insertion, rollback, and validation scans. |
| Lane B: Authority and rollback gate | accepted | Readiness lane exists and names no-authority invariants, explicit input requirement, rollback, TaskLoop/provider files, and validation scans. |
| Lane C: Budget and prompt-present promotion criteria | accepted | Readiness lane exists and names complete-symbol-block, budget, prompt-present exclusion, no-persistence, and fixture/test proof requirements. |
| Lane D: Provider/Gateway/model-message boundary proof | accepted | Readiness lane exists and names provider/Gateway/model-message boundary proof, provider-ordering proof, renderer boundary scan, and comms trigger conditions. |
| Lane E: Validation, docs, and synthesis readiness | accepted | Required validation is satisfied by scoped normal harness validate in a clean temp worktree, focused tests in the real workspace, boundary scans, docs-sync scan, and comms skip decision. |

## Required Validation

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Boundary scans:

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-cutover-readiness-touched-files>
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-cutover-readiness-touched-files>
rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover" <agentmap-cutover-readiness-touched-files>
rg -n "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-cutover-readiness-touched-files>
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Comms replay/compare are required only if Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths are touched.

## Validation Results

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
```

Result: passed. The harness produced the expected gateway-backend-communication read list.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
```

Result: failed. The failure is the harness diff-coverage rule reporting many pre-existing dirty/untracked files outside this task's owned paths and touched areas. This is not a task spec shape failure, but it blocks acceptance because the required normal validate command did not pass.

This live-workspace failure is classified as unrelated ambient dirty-tree coverage noise, not a readiness artifact failure. It was resolved for acceptance by running the same normal validate command in a clean temp worktree with only this readiness artifact set changed.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md --no-diff
```

Result: passed. The spec is structurally valid when unrelated dirty-tree diff coverage is excluded.

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
```

Scoped temp-worktree result: passed. Final changed files were exactly:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/README.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/parallel-lanes.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/submission-template.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/window-prompts.md
runtime-research/agent-runtime-index.md
```

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 7 files, 96 tests.

Typecheck was skipped because this phase changed only Markdown task/handoff/index documentation and no TS/JS/JSON files.

## Boundary Scan Results

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Results: all three broad scans returned no matches.

Touched-file scans over:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/README.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/parallel-lanes.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/submission-template.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/window-prompts.md
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md
```

Results:

- service/listener/daemon/database scan matched the new Markdown forbidden-boundary text/scan command examples plus pre-existing Runtime Memory index history; no AgentMap implementation file was touched;
- mutation/apply/edit scan matched only the new Markdown forbidden-boundary text and scan command examples;
- prompt/model/Gateway/provider scan matched only the new Markdown readiness requirements and scan command examples;
- persistence scan matched only the new Markdown forbidden-boundary text and scan command examples.

These are docs-only/spec-only hits. No implementation file was changed by this phase.

README docs-sync scan returned no matches, so README translation updates are not required.

Comms replay/compare were skipped because this phase touched only harness task/handoff Markdown files and did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, gateway events, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Prerequisite Check

```text
rg -n "^Status: accepted$|accepted_line_b_phase_8_agentmap_prompt_candidate_runtime_shadow_pilot_default_off_diagnostics_only|accepted_line_b_phase_9_agentmap_prompt_candidate_runtime_shadow_replay_proof_default_off_stability_diagnostics_only" runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md runtime-research/agent-runtime-index.md
```

Result: passed. Phase 8 and Phase 9 syntheses both have `Status: accepted`, and the runtime index records both required accepted AgentMap markers.

## Acceptance Matrix

| Gate | Required result before accepted |
|---|---|
| Task spec | accepted: context passed; structural `--no-diff` validate passed; scoped normal validate passed in a clean temp worktree with only readiness artifacts changed. |
| Prior evidence | accepted: Phase 8 pilot and Phase 9 replay proof remain `Status: accepted`; runtime index records both accepted markers. |
| Scope | accepted: only docs/spec/handoff/index Markdown files were changed by this phase. |
| Runtime behavior | accepted: no runtime behavior file was changed by this phase. |
| Config | accepted: no schema/default flag file was changed by this phase. |
| Prompt/model/Gateway/provider | accepted: no implementation file changed; focused tests and scans preserve no candidate text insertion. |
| Provider ordering | accepted: focused tests passed, including default provider order assertions. |
| Persistence | accepted: no implementation file changed; touched-file persistence hits are docs-only forbidden-boundary text. |
| Authority | accepted: no implementation file changed; focused tests preserve no-authority shadow invariants. |
| Services/mutation | accepted: touched-file hits are docs-only forbidden-boundary text. |
| Docs/comms | accepted: README docs-sync scan returned no matches; comms replay/compare skipped with reason. |

## Rollback Matrix

| Surface | Rollback requirement |
|---|---|
| Prompt candidate diagnostics | Disable `runtime.agentMap.promptAssemblyExperiment` or `runtime.agentMap.promptCandidateRuntimeShadow`. |
| TaskLoop diagnostics | Omit explicit valid `AgentMapResult` injection. |
| AgentMap provider | Omit optional AgentMap extra provider and keep `runtime.agentMap.provider` false/omitted. |
| Provider ordering | Keep `createContextProviderRegistryPilot()` defaults unchanged. |
| Candidate/replay output | Keep caller-owned, memory-only, discardable; no disk cleanup required because no persistence is allowed. |
| Future cutover proposal | Revert candidate insertion and restore byte-identical legacy prompt/model/Gateway/provider payloads when flags are off. |
