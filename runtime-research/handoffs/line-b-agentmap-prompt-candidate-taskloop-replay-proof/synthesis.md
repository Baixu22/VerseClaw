# Line B AgentMap Prompt Candidate TaskLoop Phase A Replay Proof Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate TaskLoop Phase A Replay Proof is accepted with a 100/100 score. The recommendation is to enter Phase B Cutover Readiness Review.

This is not production-ready approval, not default-on AgentMap, and not default cutover.

## Current Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all four gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid `AgentMapResult`.

## Prerequisite Check

| Prerequisite | Result | Evidence |
|---|---|---|
| Production-readiness synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/synthesis.md` has `Status: accepted` and score 97/100. |
| Runtime index records production-readiness marker | pass | Runtime index records `accepted_line_b_phase_14_agentmap_prompt_candidate_taskloop_production_readiness_plan_replay_proof_entry`. |
| Deep validation synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/synthesis.md` has `Status: accepted`. |
| Phase 8/9/10/11/12 AgentMap syntheses accepted | pass | Runtime shadow pilot, runtime shadow replay proof, cutover readiness, controlled cutover pilot, and TaskLoop explicit invocation pilot syntheses all remain `Status: accepted`. |
| AgentMap default-off | pass | Gate resolvers require explicit boolean `true`; omitted config resolves disabled. |
| Explicit pilot candidate text only enters named surface | pass | `AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE` remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## Replay Corpus

All required replay cases passed:

1. successful TaskLoop;
2. failed TaskLoop;
3. blocked TaskLoop;
4. long context TaskLoop;
5. large candidate set;
6. budget exhausted;
7. empty candidate;
8. prompt-present files;
9. missing AgentMapResult;
10. invalid AgentMapResult;
11. explicitInvocation=false;
12. one gate closed;
13. each gate rollback;
14. Windows/POSIX path normalization;
15. candidate sentinel leakage;
16. lifecycle/checkpoint default payload scan;
17. provider ordering snapshot;
18. repeated replay deterministic output.

## Proof Matrix

| Requirement | Result |
|---|---|
| default-off legacy byte parity drift | 0 |
| candidate enters only named pilot surface | pass |
| candidate leakage | 0 |
| provider ordering drift | 0 |
| default runtime behavior drift | 0 |
| every failure path fail closed | pass |
| rollback by any gate | 100% |
| replay deterministic | pass |
| no persistence | pass |
| no automatic discovery/cache/reuse | pass |
| no authority escalation | pass |

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
```

Live-worktree result: failed because broad pre-existing dirty/untracked files outside this task's touched areas are present. Scoped clean-overlay result: passed in temp validation dir `C:\Users\27933\AppData\Local\Temp\agentmap-taskloop-replay-proof-clean-83aabf0dae5f4f329733928353fb76e9` after cloning the current repository, setting `origin/main` to that baseline `HEAD`, and overlaying only this phase's task spec, handoff files, and runtime index update.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md --no-diff
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 9 files, 113 tests.

```text
pnpm --config.verify-deps-before-run=false run typecheck
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

Result: matches only focused tests:

- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider/default-on wording, and persistence found only expected task/spec/handoff proof text and validation command text. They found no production implementation path for candidate persistence, transport, mutation, services, default-on behavior, default reviewer prompt drift, or authority escalation.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Replay Proof|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is internal replay-proof/spec documentation only, with no functional, UI, or public behavior change.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase touched only harness specs and handoff documentation. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Scorecard

| Category | Score |
|---|---:|
| Replay corpus coverage | 25/25 |
| Determinism | 15/15 |
| Default behavior parity | 20/20 |
| Boundary/no authority/no leakage | 20/20 |
| Fail-closed and rollback | 15/15 |
| Maintainability/auditability | 5/5 |
| Total | 100/100 |

## Final Decision

- Replay Proof accepted: yes.
- Recommended next phase: Phase B Cutover Readiness Review.
- Production-ready/default-on/default cutover approval: no.
- AgentMap default-off: yes.
- Default runtime behavior changed: no.
- Default TaskLoop reviewer prompt changed: no.
- Candidate text in default prompts/model/Gateway/provider transport: no.
- Candidate/replay output persisted: no.
- Provider ordering changed: no.
