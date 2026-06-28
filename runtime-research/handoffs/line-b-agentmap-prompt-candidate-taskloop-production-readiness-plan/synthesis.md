# Line B AgentMap Prompt Candidate TaskLoop Production Readiness Plan Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate TaskLoop production-readiness plan is accepted with a 97/100 score. The recommendation is to enter Phase A Replay Proof.

This is not production-ready approval, not default-on AgentMap, and not default cutover. It accepts only the staged readiness path, acceptance thresholds, Replay Proof design, cutover-readiness design, controlled opt-in design, production veto gates, rollback/operator plan, and validation evidence for the already accepted explicit TaskLoop pilot.

## Current Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all four AgentMap prompt candidate gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid `AgentMapResult`.

## Prerequisite Check

| Prerequisite | Result | Evidence |
|---|---|---|
| Deep validation synthesis accepted | pass | `runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/synthesis.md` has `Status: accepted`. |
| Deep validation score >= 95 | pass | Deep validation scorecard records 98/100. |
| Runtime index records deep validation marker | pass | `runtime-research/agent-runtime-index.md` records `accepted_line_b_phase_13_agentmap_prompt_candidate_taskloop_explicit_invocation_deep_validation_replay_proof_recommended`. |
| Phase 8/9/10/11/12 accepted | pass | Phase 8 runtime shadow pilot, Phase 9 runtime shadow replay proof, Phase 10 cutover readiness, Phase 11 controlled cutover pilot, and Phase 12 TaskLoop explicit invocation pilot syntheses have `Status: accepted`. |
| AgentMap default-off | pass | Gate resolvers require explicit boolean `true`; omitted config resolves disabled. |
| Explicit pilot only enters named surface | pass | `AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE` remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## Readiness Phases

| Phase | Entry Criteria | Exit Criteria |
|---|---|---|
| Phase A Replay Proof | This synthesis accepted; deep validation accepted; AgentMap default-off; explicit invocation and valid `AgentMapResult` required. | Required replay corpus passes; default-off legacy byte parity drift 0; candidate leakage 0; provider ordering drift 0; all failures fail closed; replay deterministic. |
| Phase B Cutover Readiness Review | Phase A accepted; no replay veto; deep validation and readiness plan still accepted. | Default reviewer prompt drift 0; candidate leakage 0; provider ordering drift 0; default runtime behavior drift 0; rollback by any gate 100%; no persistence/discovery/cache/reuse/authority escalation. |
| Phase C Controlled Internal Opt-in | Phase A and B accepted; no veto open; rollback/operator diagnostics documented. | Internal-only, developer-only, per-agent, per-session, allowlist workspace opt-in evidence meets thresholds; all opt-ins auditable, closeable, and rollbackable. |
| Phase D Limited Production Opt-in | Phase A and B accepted and Phase C evidence meets thresholds. | Allowed scope, blocked scope, diagnostics, rollback criteria, incident/veto criteria, and operator guide accepted; still opt-in only. |
| Phase E Default-on Proposal | Representative replay and opt-in evidence exists; all zero-drift/leakage thresholds hold; operator readiness accepted. | Proposal-only synthesis accepted by a separate future spec; no default-on implementation in this phase. |

## Veto Gates

Any of these stops expansion regardless of score:

- candidate text leaks into default prompts/model messages/Gateway/provider transport;
- provider ordering changes;
- default TaskLoop reviewer prompt byte drift;
- default runtime behavior drift;
- any gate closure cannot restore legacy parity;
- automatic discovery/build/cache/reuse of `AgentMapResult`;
- candidate/replay output persists;
- new service/listener/daemon/database/WebSocket/HTTP server;
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority;
- current pilot is described as production-ready, default-on, or default cutover.

No veto fired for this readiness-plan phase.

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
```

Live-worktree result: failed because broad pre-existing dirty/untracked files outside this task's touched areas are present. This is classified as ambient dirty-tree coverage noise, not a production-readiness artifact failure.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md --no-diff
```

Result: passed.

Clean-origin overlay validate:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
```

Result: passed in temp validation dir `C:\Users\27933\AppData\Local\Temp\agentmap-prod-ready-clean-origin-2eaa0e49cc10404181806331ab1109b2` after cloning the current repository, setting `origin/main` to clean `HEAD`, and overlaying only this phase's task spec and handoff files.

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

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider text, and persistence found only expected spec/handoff forbidden-boundary prose, validation commands, and rollback/veto wording. They found no production implementation path for candidate persistence, transport, mutation, services, default-on behavior, or authority escalation.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|production readiness|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README docs updates are not required because this is internal readiness/spec documentation only, with no functional, UI, or public behavior change.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This phase touched only harness specs, handoff documentation, and this runtime index update. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Scorecard

| Category | Score |
|---|---:|
| Replay coverage | 19/20 |
| Default behavior parity | 20/20 |
| Boundary/no authority | 20/20 |
| Fail-closed and rollback | 15/15 |
| Diagnostics/operator readiness | 9/10 |
| Controlled opt-in safety | 10/10 |
| Maintainability/auditability | 4/5 |
| Total | 97/100 |

## Final Readiness Conclusion

- Current production-ready status: no.
- Current default-on permission: no.
- Recommended next phase: yes, enter Phase A Replay Proof.
- Remaining phases before production: Replay Proof, Cutover Readiness Review, Controlled Internal Opt-in, Limited Production Opt-in, and a separate Default-on Proposal if all prior thresholds hold.
