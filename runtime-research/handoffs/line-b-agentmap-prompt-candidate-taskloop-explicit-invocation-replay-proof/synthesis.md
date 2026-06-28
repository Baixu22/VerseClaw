# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Phase A Replay Proof Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate TaskLoop explicit invocation Phase A Replay Proof is accepted with a 100/100 score. The recommendation is to enter the next Cutover Readiness Review phase.

This is not production-ready approval, not default-on AgentMap, and not default cutover. It accepts only replay proof for the already accepted explicit TaskLoop pilot.

## Current Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all four gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid `AgentMapResult`.

## Prerequisite Check

| Prerequisite | Result | Evidence |
|---|---|---|
| Deep validation synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/synthesis.md` has `Status: accepted`. |
| Production-readiness synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/synthesis.md` has `Status: accepted`. |
| Runtime index records deep validation marker | pass | Runtime index records `accepted_line_b_phase_13_agentmap_prompt_candidate_taskloop_explicit_invocation_deep_validation_replay_proof_recommended`. |
| Runtime index records production-readiness marker | pass | Runtime index records `accepted_line_b_phase_14_agentmap_prompt_candidate_taskloop_production_readiness_plan_replay_proof_entry`. |
| Phase 8/9/10/11/12 AgentMap syntheses accepted | pass | Runtime shadow pilot, runtime shadow replay proof, cutover readiness, controlled cutover pilot, and TaskLoop explicit invocation pilot syntheses all remain `Status: accepted`. |
| AgentMap default-off | pass | Gate resolvers require explicit boolean `true`; omitted config resolves disabled. |
| Explicit pilot candidate text only enters named surface | pass | `AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE` remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## Replay Corpus

All 28 required replay cases passed:

1. flags all off;
2. only one gate enabled;
3. first two gates enabled;
4. first three gates enabled;
5. all gates enabled with `explicitInvocation=false`;
6. missing `AgentMapResult`;
7. invalid `AgentMapResult`;
8. valid result + budget 0;
9. valid result + large candidate set no silent truncate;
10. valid result + prompt-present file;
11. valid result + Windows prompt-present path;
12. valid result + POSIX prompt-present path;
13. valid result + empty candidate;
14. successful TaskLoop replay;
15. failed TaskLoop replay;
16. blocked TaskLoop replay;
17. long context replay;
18. multi-file ClawX-like replay;
19. repeated invocation deterministic output;
20. rollback by closing each gate;
21. candidate sentinel leakage scan;
22. default TaskLoop reviewer prompt byte parity scan;
23. lifecycle/checkpoint default payload scan;
24. model/Gateway/provider transport boundary scan;
25. provider ordering snapshot;
26. no disk persistence scan;
27. no renderer direct IPC/direct Gateway scan;
28. no automatic discovery/build/cache/reuse AgentMapResult scan.

## Hard Gates

| Gate | Result | Evidence |
|---|---|---|
| Flags all off reviewer prompt byte-identical | pass | Focused replay tests keep legacy bytes. |
| All gates enabled with `explicitInvocation=false` reviewer prompt byte-identical | pass | Focused replay tests and realistic TaskLoop replay table. |
| Any gate closed blocks candidate and emits gate diagnostic | pass | Partial gate and rollback tests. |
| Missing/invalid `AgentMapResult` fail closed | pass | Missing and invalid result cases. |
| Budget exhausted fail closed with no silent truncate | pass | Budget 0 and large candidate cases. |
| Large candidate set no silent truncate | pass | Sentinel large block remains absent from reviewer prompt. |
| Prompt-present files excluded or diagnosed | pass | POSIX and Windows path cases. |
| Explicit invocation + all gates + valid result inserts only into named pilot surface | pass | Inserted cases assert pilot surface and false default/Gateway/model/provider/persistence flags. |
| Successful/failed/blocked/long-context replay do not change default reviewer prompt | pass | Realistic TaskLoop replay table. |
| Sentinel absent from default payloads | pass | TaskLoop controller lifecycle/checkpoint/default reviewer assertions and sentinel rg scan. |
| Provider ordering unchanged | pass | Context provider registry tests. |
| No disk persistence | pass | Persistence scan matches only task/handoff proof text. |
| No renderer direct IPC/direct Gateway call | pass | Renderer boundary scan returned no matches. |
| No automatic AgentMapResult discovery/build/cache/reuse | pass | Explicit input-only helper review; scan matched only test fixture builders. |
| Rollback by closing any gate restores legacy parity | pass | Per-gate replay table. |

## Validation Results

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
```

Result: passed.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
```

Live-worktree result: failed because broad pre-existing dirty/untracked files outside this task's touched areas are present. This is classified as ambient dirty-tree coverage noise, not a Replay Proof artifact failure.

Clean overlay normal validate:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
```

Result: passed in temp validation dir `C:\Users\27933\AppData\Local\Temp\agentmap-replay-proof-clean-ee58c0a48d884a16a0f669019637e584` after overlaying only this phase's spec, handoff files, runtime index, and focused replay tests onto a clean cloned baseline with `origin/main` set to baseline `HEAD`.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 9 files, 113 tests.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe pnpm --config.verify-deps-before-run=false run typecheck
```

Result: passed.

## Boundary Scans

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

Result: no matches.

```text
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
```

Result: no matches.

```text
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
```

Result: matches only in focused tests:

- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider/default-on wording, and persistence found only expected task/spec/handoff proof text, focused reviewer-formatter assertions, and pre-existing Runtime Memory sqlite assertions in `tests/unit/task-loop-controller.test.ts`. They found no production implementation path for candidate persistence, transport, mutation, services, default-on behavior, default reviewer prompt drift, or authority escalation.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Replay Proof|production readiness|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is internal replay-proof/spec documentation plus focused tests, with no functional, UI, or public behavior change.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase touched the replay task spec, handoff documentation, runtime index, and focused unit replay assertions only. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Scorecard

| Category | Score |
|---|---:|
| Replay corpus coverage | 20/20 |
| Default behavior parity | 20/20 |
| Boundary/no authority | 20/20 |
| Fail-closed + rollback | 15/15 |
| Diagnostics/leakage proof | 10/10 |
| Provider/Gateway/comms safety | 10/10 |
| Maintainability/auditability | 5/5 |
| Total | 100/100 |

## Final Decision

- Replay Proof accepted: yes.
- Recommended next phase: Cutover Readiness Review.
- Production-ready/default-on/default cutover approval: no.
- AgentMap default-off: yes.
- Default runtime behavior changed: no.
- Default TaskLoop reviewer prompt changed: no.
- Candidate/replay output persisted: no.
- Provider ordering changed: no.
