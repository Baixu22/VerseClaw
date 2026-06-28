# Line B AgentMap Production Entry Readiness Synthesis

Status: accepted_for_limited_production_opt_in

## Decision

The production-entry package is accepted for limited production opt-in.

Score: 97/100.

No production veto fired. Required tests, scans, live typecheck, clean frozen install, clean typecheck, clean harness validation, rollback drill, leakage proof, and provider-ordering proof passed.

This task does not approve default-on AgentMap, default cutover, production-ready status, production opt-in UI, provider ordering changes, persistence, automatic discovery/build/cache/reuse, or runtime authority.

## Prerequisite Check

| Prerequisite | Result |
|---|---|
| Phase B Production Readiness MVP synthesis is `Status: accepted_for_controlled_internal_opt_in` | pass |
| Runtime index records Phase B accepted marker | pass |
| Phase A Replay Proof synthesis is accepted | pass |
| Deep Validation synthesis is accepted | pass |
| Production Readiness Plan synthesis is accepted | pass |
| AgentMap default-off | pass |
| Candidate text only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` | pass |
| Default runtime behavior unchanged | pass |
| Default TaskLoop reviewer prompt unchanged | pass |
| Provider ordering unchanged | pass |

## Artifact Completion

All required handoff artifacts are present:

- README
- prerequisite check
- controlled internal opt-in execution plan
- internal sample corpus
- internal sample results
- limited production readiness review
- production entry scorecard
- production veto gates
- security authority boundary
- leakage proof
- provider ordering proof
- rollback drill report
- observability metrics plan
- privacy retention boundary
- operator runbook
- limited production opt-in spec draft
- default-on blocker register
- validation plan
- submission template
- synthesis

## Hard Gates

| Gate | Result |
|---|---|
| AgentMap default-off | pass |
| Default runtime behavior unchanged | pass |
| Default TaskLoop reviewer prompt byte-identical | pass |
| Any gate closed restores legacy parity | pass |
| `explicitInvocation=false` restores legacy parity | pass |
| Missing/invalid AgentMapResult fail closed | pass |
| Budget exhausted fail closed with no silent partial insertion | pass |
| Candidate text only enters named TaskLoop explicit pilot surface | pass |
| Candidate text absent from default prompt/model/Gateway/provider/checkpoint/lifecycle | pass |
| Candidate/shadow/replay output non-persistent | pass |
| Provider ordering unchanged | pass |
| No renderer direct IPC/direct Gateway in this task | pass |
| No new service/listener/daemon/database/WebSocket/HTTP server in this task | pass |
| No automatic AgentMapResult discovery/build/cache/reuse | pass |
| No runtime/tool/security/approval/retry/completion/provider/model/Gateway authority | pass |
| Rollback drill 100 percent pass | pass |
| Required validation green | pass |

## Veto Gates

No veto fired.

## Internal Samples

Sample corpus: 30 samples.

Results: 30 pass, 0 fail.

Coverage includes successful, failed, blocked, long-context, multi-file, large-candidate, budget-exhausted, prompt-present, invalid-result, gate rollback, provider-ordering-sensitive, and lifecycle/checkpoint-sensitive cases.

Metrics:

- leakage_count: 0
- provider_ordering_drift: 0
- fail-closed rate for invalid/missing/gated-off cases: 100 percent
- rollback success: 8/8

## Leakage Proof

Pass. `AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK` remains in focused tests, and `AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK` was added in `tests/unit/runtime-agent-map-production-entry-readiness.test.ts`. The production-entry test proves fail-closed TaskLoop pilot payloads and runtime shadow reports do not retain the production-entry sentinel text.

## Provider Ordering Proof

Pass. Context provider registry tests preserve default provider ordering and keep AgentMap provider explicit/injected/default-off.

## Rollback Drill

Pass. Drill cases:

- `promptAssemblyExperiment=false`
- `promptCandidateRuntimeShadow=false`
- `promptCandidateControlledCutoverPilot=false`
- `promptCandidateTaskLoopExplicitInvocationPilot=false`
- `explicitInvocation=false`
- missing AgentMapResult
- invalid AgentMapResult
- budget exhausted

## Validation Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
```

Live-worktree result: failed because broad unrelated dirty/untracked files outside this task's touched areas are present. This is classified as live dirty-tree noise, not a production-entry artifact failure.

Clean overlay validation:

```text
node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
```

Result: passed in temp validation clone after setting `refs/remotes/origin/main` to baseline `HEAD` and overlaying only this task's spec, handoff directory, production-entry sentinel test, runtime index, and validation dependency metadata (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`).

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts
```

Result: passed. 10 files, 117 tests.

```text
pnpm --config.verify-deps-before-run=false run typecheck
```

Live-worktree result: passed. The required `typecheck` script now runs `node scripts/generate-ext-bridge.mjs` before node/web TypeScript checks, so ignored bridge stubs are regenerated instead of relying on local leftovers.

Clean dependency/typecheck proof:

- Fresh temp clone overlaid only `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
- `electron/extensions/_ext-bridge.generated.ts` and `src/extensions/_ext-bridge.generated.ts` were absent before the command.
- `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --ignore-scripts` passed.
- `pnpm --config.verify-deps-before-run=false run typecheck` passed and regenerated empty extension bridge stubs.

Resolved clean blockers:

- Missing `electron/extensions/_ext-bridge.generated` / `src/extensions/_ext-bridge.generated`: fixed by generating bridge stubs inside `pnpm run typecheck`.
- Missing `electron-updater`: fixed by keeping the dependency in `package.json` / `pnpm-lock.yaml` for baseline clean typecheck.
- Frozen lockfile/overrides mismatch: fixed by restoring lockfile override metadata and moving the effective `isbinaryfile` override into `pnpm-workspace.yaml`.
- No-frozen install exotic `@whiskeysockets/baileys` subdependency: avoided by making frozen install pass; no no-frozen install is required.

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
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
```

Result: matches only focused tests:

- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts`
- `tests/unit/runtime-agent-map-production-entry-readiness.test.ts`

Touched-file scans for service/listener/database/WebSocket/HTTP server, mutation/apply/edit, prompt/model/Gateway/provider/default-on wording, and persistence found only expected task/spec/handoff proof text, runtime-index historical boundary entries, and package/lock dependency metadata. They found no production implementation path for candidate persistence, transport, mutation, services, default-on behavior, default reviewer prompt drift, or authority escalation.

```text
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Result: no matches. README translation updates are not required because this is internal task/handoff documentation plus test-only proof, with no functional, UI, public behavior, or architecture change.

## Comms Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` were skipped. This task touched only a task spec, handoff documentation, runtime index, a test-only sentinel proof, and package/pnpm validation metadata for clean typecheck reproducibility. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Final Answers

- accepted_for_limited_production_opt_in: yes.
- AgentMap remains default-off: yes.
- Recommend entering limited production opt-in: yes, internal explicit opt-in only.
- Allow default-on/default cutover: no.
- Default runtime behavior changed: no.
- Default TaskLoop reviewer prompt changed: no.
- Candidate text enters default prompts/model messages/Gateway/provider transport/checkpoint/lifecycle payload: no.
- Candidate/shadow/replay output persisted: no.
- Provider ordering changed: no.
- Renderer direct IPC/direct Gateway added: no.
- Service/listener/daemon/database/WebSocket/HTTP server added: no.
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority: no.

Status: accepted_for_limited_production_opt_in
