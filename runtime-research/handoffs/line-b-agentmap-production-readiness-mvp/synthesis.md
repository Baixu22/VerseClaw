# Line B AgentMap Production Readiness MVP Synthesis

Status: accepted_for_controlled_internal_opt_in

## Decision

The AgentMap Phase B Production Readiness MVP is accepted for controlled internal opt-in with a 95/100 score.

This phase does not approve production-ready status, default-on AgentMap, default cutover, production opt-in, or production UI.

## Current Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

Candidate text may enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.

## Prerequisite Check

| Prerequisite | Result | Evidence |
|---|---|---|
| Phase A Replay Proof synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof/synthesis.md` has `Status: accepted`. |
| Deep Validation synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/synthesis.md` has `Status: accepted`. |
| Production Readiness Plan synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/synthesis.md` has `Status: accepted`. |
| Phase 8/9/10/11/12/13 syntheses accepted | pass | Runtime shadow pilot, runtime shadow replay proof, cutover readiness, controlled cutover pilot, TaskLoop explicit invocation pilot, and deep validation syntheses remain accepted. |
| Runtime index records Phase A marker | pass | `runtime-research/agent-runtime-index.md` records `accepted_line_b_phase_15_agentmap_prompt_candidate_taskloop_explicit_invocation_replay_proof_phase_a_cutover_readiness_review_recommended`. |
| AgentMap default-off | pass | All prompt candidate gates resolve enabled only when explicitly true. |
| Candidate text only enters named pilot surface | pass | Surface remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## MVP Artifact Completion

| Artifact | Status | Evidence |
|---|---|---|
| Cutover Readiness Review MVP | complete | `cutover-readiness-review.md` |
| Real Traffic Shadow MVP | complete, implemented by existing default-off diagnostics-only TaskLoop shadow path | `real-shadow-mvp-plan.md`; `task-loop-controller.ts`; `agent-map-prompt-candidate-runtime-shadow.ts` |
| Controlled Internal Opt-in MVP | complete | `controlled-internal-opt-in-plan.md` |
| Quality Scorecard MVP | complete | `quality-scorecard.md` |
| Security / Authority Boundary MVP | complete | `security-authority-boundary.md` |
| Observability Diagnostics MVP | complete | `observability-diagnostics-plan.md` |
| Limited Production Opt-in Plan MVP | complete, future-only | `limited-production-opt-in-plan.md` |
| Default-on Proposal Template MVP | complete, future-only | `default-on-proposal-template.md` |

## Hard Gates

| Gate | Result |
|---|---|
| AgentMap default-off | pass |
| Default runtime behavior unchanged | pass |
| Default TaskLoop reviewer prompt byte-identical | pass |
| Any gate closed restores legacy parity | pass |
| `explicitInvocation=false` restores legacy parity | pass |
| Missing/invalid `AgentMapResult` fails closed | pass |
| Candidate text only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` | pass |
| Candidate text does not enter default prompts/model messages/Gateway/provider transport/checkpoint/lifecycle payloads | pass |
| No disk persistence/localStorage/indexedDB/electron-store/sqlite/postgres/mysql/redis candidate persistence | pass |
| Provider ordering unchanged | pass |
| No renderer direct IPC/direct Gateway | pass |
| No new service/listener/daemon/database/WebSocket/HTTP server | pass |
| No automatic AgentMapResult discovery/build/cache/reuse | pass |
| No runtime/tool/security/approval/retry/completion/provider/model/Gateway authority | pass |
| Comms paths untouched or comms replay/compare passed | pass; skipped because no communication paths were touched |

## Veto Gates

| Veto | Result |
|---|---|
| Production-ready/default-on/default cutover claim | pass; this package denies those approvals |
| Default prompt/reviewer prompt byte drift | pass |
| Candidate leakage into default prompt/model/Gateway/provider/checkpoint/lifecycle | pass |
| Provider ordering drift | pass |
| AgentMap runtime authority escalation | pass |
| Automatic discovery/build/cache/reuse AgentMapResult | pass |
| Candidate/shadow/replay persistence | pass |
| Renderer direct IPC/direct Gateway call | pass |
| New service/listener/daemon/database/WebSocket/HTTP server | pass |
| Any gate closure fails to restore legacy parity | pass |

## Scorecard

| Category | Score |
|---|---:|
| Phase A evidence integration | 10/10 |
| Cutover readiness review completeness | 14/15 |
| Real traffic shadow MVP | 13/15 |
| Controlled internal opt-in plan | 10/10 |
| Quality scorecard rigor | 14/15 |
| Security/authority boundary proof | 15/15 |
| Observability diagnostics MVP | 9/10 |
| Rollback/veto/limited production/default-on planning | 10/10 |
| Total | 95/100 |

## Shadow MVP

Shadow MVP is implemented by the existing TaskLoop runtime shadow path. It remains default-off, diagnostics-only, in-memory/caller-owned, and non-authoritative. Phase B added no runtime code and no production sampling automation.

## Leakage Proof

Pass. `AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK` appears only in focused tests. Candidate text is absent from default reviewer prompts, lifecycle payloads, checkpoint payloads, model/Gateway/provider transport boundaries, and shadow report text fields.

## Provider Ordering Proof

Pass. Context provider registry tests preserve default provider order and require explicit provider injection plus separate default-off AgentMap provider gating. The TaskLoop explicit invocation pilot does not register an AgentMap provider.

## Rollback Proof

Pass. Disabling any AgentMap prompt candidate gate, omitting explicit invocation, omitting/invalidating `AgentMapResult`, or exhausting budget restores legacy reviewer prompt byte parity. No cleanup is required because candidate/shadow/replay text is not persisted.

## Observability Diagnostics Proof

Pass. Existing diagnostic fields cover inserted, blocked, fail-closed, budget-exhausted, prompt-present-excluded, invalid-result, gate-disabled, and invocation-not-requested states. Diagnostics remain audit/observability evidence only and do not become runtime authority.

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
```

Live-worktree result: failed because broad unrelated dirty/untracked files outside this task's touched areas are present. This is classified as live dirty-tree noise, not a Phase B artifact failure.

Clean overlay validation:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
```

Result: passed in temp validation clone `C:\Users\27933\AppData\Local\Temp\agentmap-production-mvp-clean-clone-e662ea20fcbe4bb5868fb50d8169efb3` after setting `refs/remotes/origin/main` to baseline `HEAD` and overlaying only this task's spec, handoff files, and runtime index marker.

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
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_MVP_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
```

Result: matches only focused tests:

- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider/default-on wording, and persistence found only historical runtime-index proof text plus expected task/spec/handoff proof text. They found no production implementation path for candidate persistence, transport, mutation, services, default-on behavior, default reviewer prompt drift, or authority escalation.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Production Readiness MVP|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is internal task/handoff documentation with no functional, UI, public behavior, or architecture change.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This Phase B package touched only the task spec and handoff documentation before the runtime index marker; it did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Final Answers

- Phase B Production Readiness MVP accepted_for_controlled_internal_opt_in: yes.
- AgentMap remains default-off: yes.
- Default runtime behavior changed: no.
- Default TaskLoop reviewer prompt changed: no.
- Candidate text enters default prompts/model messages/Gateway/provider transport/checkpoint/lifecycle payload: no.
- Candidate/shadow/replay output persisted: no.
- Provider ordering changed: no.
- Renderer direct IPC/direct Gateway added: no.
- Service/listener/daemon/database/WebSocket/HTTP server added: no.
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority: no.
- Controlled internal opt-in recommended: yes, internal only and default-off.
- Limited production opt-in allowed in this phase: no.
- Default-on/default cutover allowed in this phase: no.
