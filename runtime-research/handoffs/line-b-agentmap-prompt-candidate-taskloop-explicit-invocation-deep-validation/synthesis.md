# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Deep Validation Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate TaskLoop explicit invocation deep validation is accepted with a 98/100 score. The recommendation is to enter the next Replay Proof phase.

This is not a default cutover, not production-ready approval, and not default-on AgentMap. It accepts boundary tightening, replay cases, sentinel leakage proof, quantitative scoring, and readiness recommendation for the already accepted explicit TaskLoop pilot only.

## Current Boundary

AgentMap remains default-off, explicit-invocation only, explicit-`AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

## Hard Gates

| Gate | Result | Evidence |
|---|---|---|
| Phase 8 synthesis remains accepted | pass | `line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted`. |
| Phase 9 synthesis remains accepted | pass | `line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md` has `Status: accepted`. |
| Phase 10 synthesis remains accepted | pass | `line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md` has `Status: accepted`. |
| Phase 11 synthesis remains accepted | pass | `line-b-agentmap-prompt-candidate-controlled-cutover-pilot/synthesis.md` has `Status: accepted`. |
| Phase 12 synthesis remains accepted | pass | `line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-pilot/synthesis.md` has `Status: accepted`. |
| Runtime index Phase 8/9/10/11/12 markers | pass | Runtime index contains the accepted AgentMap marker chain through Phase 12 before this synthesis update. |
| Flags all off reviewer prompt parity | pass | Focused tests keep legacy bytes. |
| All gates on but explicit invocation false | pass | Focused tests keep legacy bytes and emit `invocation_not_requested`. |
| Any gate closed | pass | Per-gate replay returns legacy bytes and `gate_disabled`. |
| Missing/invalid AgentMapResult | pass | Missing/invalid result returns legacy bytes and `invalid_agent_map_result`. |
| Budget exhausted | pass | Budget 0 and large candidate set return legacy bytes with `candidate_budget_exhausted`; no silent truncate. |
| Prompt-present files | pass | POSIX and Windows-style paths are excluded or diagnosed. |
| Candidate only in named pilot surface | pass | Valid explicit case inserts only into `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |
| Sentinel no-leak | pass | Sentinel literal exists only in tests; TaskLoop reviewer/lifecycle/checkpoint/runtime-shadow payloads exclude it. |
| Provider ordering unchanged | pass | Context provider registry tests pass; no provider ordering implementation changed. |
| No disk persistence | pass | No candidate/replay persistence code added; persistence scan hits only forbidden-boundary prose and pre-existing runtime-memory tests. |
| No renderer direct IPC/direct Gateway | pass | Renderer boundary scan returns no matches. |
| Rollback | pass | Closing any gate restores legacy bytes; no candidate cleanup required. |

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
```

Live-worktree result: failed because the repository has broad pre-existing dirty/untracked files outside this task's touched areas. This matches the prior Phase 12 limitation and is classified as ambient dirty-tree coverage noise, not a deep-validation artifact failure.

Scoped clean-baseline normal validate:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
```

Result: passed in temp validation dir `C:\Users\27933\AppData\Local\Temp\agentmap-deep-val-94075250d07a457b89914defa3d7c054` after overlaying only this phase's files onto a clean `HEAD` archive baseline.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md --no-diff
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 9 files, 112 tests.

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

Result: matches only in focused tests.

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider text, and persistence found only expected spec/handoff forbidden-boundary prose plus pre-existing runtime-memory test strings in `tests/unit/task-loop-controller.test.ts`. They found no new production implementation path for candidate persistence, transport, mutation, or services.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|deep validation" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README docs updates are not required because this is validation-only/default-off runtime-core evidence, not public UI behavior.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Scorecard

| Category | Score |
|---|---:|
| Default behavior parity | 20/20 |
| Explicit invocation correctness | 15/15 |
| Boundary/no authority | 20/20 |
| Fail-closed ability | 10/10 |
| Real task usefulness | 14/15 |
| Diagnostics quality | 8/8 |
| Rollback ability | 7/7 |
| Maintainability/auditability | 4/5 |
| Total | 98/100 |

## Readiness Recommendation

Recommend entering Replay Proof. The next phase should broaden real TaskLoop replay corpora and keep the same vetoes: no default-on AgentMap, no provider ordering change, no default reviewer prompt drift, no candidate leakage, no persistence, no automatic discovery/cache/reuse, and no runtime/tool/security/approval/retry/completion/provider/model/Gateway authority.
