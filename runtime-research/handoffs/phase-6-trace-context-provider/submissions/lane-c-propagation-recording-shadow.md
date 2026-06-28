# lane-c-propagation-recording-shadow: Default-Off Propagation And Recording Shadow

## Scope Confirmation

- Lane: `lane-c-propagation-recording-shadow`
- Output file: `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-c-propagation-recording-shadow.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/agents/task-loop-controller.ts`
- Test paths touched:
  - `tests/unit/task-loop-controller.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts`
  - `rtk node scripts/verify-security-shadow-mvp.mjs`
  - `rtk node scripts/comms/replay.mjs`
  - `rtk node scripts/comms/compare.mjs`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components`
  - `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit`
  - `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts`
- Required reading completed:
  - `C:\Users\27933\.codex\RTK.md`
  - `AGENTS.md`
  - `openclaw_runtime/AGENTS.md`
  - `runtime-research/agent-runtime-index.md`
  - `runtime-research/implementation-roadmap.md`, Phase 6
  - `runtime-research/migration-execution-plan.md`, Stage 7
  - `runtime-research/agent-runtime-core-spec.md`
  - `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/README.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/parallel-lanes.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/submission-template.md`
  - `runtime-research/opentelemetry/trace-model.md`
  - `runtime-research/opentelemetry/query-and-source-mapping.md`
  - `runtime-research/opentelemetry/clawx-mapping.md`
  - `runtime-research/opentelemetry/useful-tests.md`
  - `harness/specs/tasks/phase-6-trace-context-provider.md`

## Executive Summary

- Added a TaskLoop-only trace span shadow sink behind `runtime.traceContext.shadow`.
- Added optional external trace context input for propagation-safety tests; it is sanitized with Lane A's `sanitizeExternalRuntimeTraceContext` and recorded only as untrusted bounded counts.
- Emitted sanitized `task_loop.phase` and `task_loop.checkpoint` spans with bounded ids, counts, statuses, source refs, and evidence refs.
- Kept trace shadow independent from RuntimeTaskEvent shadow, event-log/checkpoint writes, Evidence Verifier behavior, and legacy TaskLoop lifecycle/checkpoint payloads.
- Did not touch Gateway, Main, renderer, host-api, api-client, tool invocation, approval waiting, retry, error mapping, return payloads, or provider ordering.
- Sink failures remain diagnostic-only and are swallowed like the existing RuntimeTaskEvent shadow sink.
- No raw task text, external tracestate/baggage values, tool args/output, env, secrets, or full checkpoints are retained in emitted spans.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase 6 context loaded | command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed. |
| Phase 6 spec validated | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed. |
| Trace shadow flag is default-off and resolved from config | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeTraceFlags` line 2128; `runtimeTraceSpanShadowEnabled` line 1498 | Uses Lane A flag resolver; no spans without `runtime.traceContext.shadow`. |
| Trace spans are emitted through an injected observe-only sink | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeTraceSpanShadowSink` line 301; `emitRuntimeTraceSpanShadow` line 1543 | Sink failure cannot perturb TaskLoop behavior. |
| External trace context is sanitized and marked untrusted | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeTraceExternalContextEvent` line 1512 | Stores action/trusted flag/counts only, not header values. |
| Lifecycle and checkpoint spans are sanitized summaries | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `task_loop.phase` line 1666; `task_loop.checkpoint` line 1749 | Counts/status/source/evidence only. |
| Flag-off parity and shadow-on behavior are tested | test | `tests/unit/task-loop-controller.test.ts` | flag-off test line 588; trace shadow test line 660 | Passed in focused TaskLoop test run. |
| Focused TaskLoop tests pass | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | 1 file / 48 tests | Pass. |
| Security shadow verifier still passes | command | `rtk node scripts/verify-security-shadow-mvp.mjs` | n/a | Pass, includes Gateway `tools.invoke` regression. |
| Comms replay/compare pass | command | `rtk node scripts/comms/replay.mjs`; `rtk node scripts/comms/compare.mjs` | n/a | Both pass as standalone commands. |
| Node typecheck passes | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | n/a | Pass. |
| Renderer IPC/Gateway bypass scan has no hits | missing-after-search | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | n/a | Exit 1/no matches. |
| Lane C adds no service/exporter patterns | missing-after-search | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | n/a | Exit 1/no matches. |

## Implementation Summary

Current code:

- `TaskLoopControllerDeps.runtimeTraceSpanShadowSink` accepts sanitized `RuntimeTraceSpan` objects for tests/future local shadow wiring.
- `runtime.traceContext.shadow` enables span emission; `runtime.traceContext.propagation` only permits sanitized external-context observation when explicit external trace context is injected.
- `emitTaskLoopLifecycleShadow` emits `task_loop.phase` spans with bounded status/count metadata and source/evidence refs.
- `emitTaskLoopCheckpointShadow` emits `task_loop.checkpoint` spans with bounded checkpoint summary counts and checkpoint evidence refs.

Tests:

- The existing flag-off parity test now asserts trace spans are not emitted when trace flags are absent.
- A new focused test enables `runtime.traceContext.shadow` and `propagation`, injects external trace headers, and verifies sanitized spans plus unchanged legacy lifecycle/checkpoint payloads.

Feature flags:

- `runtime.traceContext.shadow`: default false; enables TaskLoop trace span shadow sink only.
- `runtime.traceContext.propagation`: default false; allows sanitized external trace context event only when paired with shadow and explicit injected headers.
- `runtime.traceContext.provider`: untouched in this lane.

Harness/spec changes:

- No harness/spec file was changed; the Phase 6 task spec was validated.

Docs/index changes:

- This lane submission records evidence. `agent-runtime-index.md` remains for Lane E/synthesis update after Phase 6 acceptance.

## Trace Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop span sink | `TaskLoopRuntimeTraceSpanShadowSink` | shadow-only injected sink | `runtime.traceContext.shadow` | `task-loop-controller.ts` line 98 / line 301 |
| Lifecycle span | `RuntimeTraceSpan` named `task_loop.phase` | sanitized summary only | `runtime.traceContext.shadow` | `task-loop-controller.ts` line 1666 |
| Checkpoint span | `RuntimeTraceSpan` named `task_loop.checkpoint` | sanitized summary only; no full checkpoint | `runtime.traceContext.shadow` | `task-loop-controller.ts` line 1749 |
| External context event | `trace_context.external` span event | untrusted, bounded counts only | `runtime.traceContext.propagation` | `task-loop-controller.ts` line 1512 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Legacy TaskLoop status/phase remains authoritative. | `tests/unit/task-loop-controller.test.ts` passes; flag-off test asserts lifecycle payload unchanged. | Low. |
| tools.invoke | Existing Gateway-visible tool execution remains unchanged. | `rtk node scripts/verify-security-shadow-mvp.mjs` passed Gateway `tools.invoke` regression. | Low. |
| approval waiting/retry/error mapping | Not touched. | No tool invocation/Gateway/Main changes. | Low. |
| event-log/checkpoint/resume | Existing checkpoint writes and RuntimeTaskEvent shadow remain authoritative. | New spans are emitted through separate sink; flag-off checkpoint payload test passes. | Low. |
| Evidence Verifier | Existing warning-only verifier behavior remains unchanged. | `verify-security-shadow-mvp` and focused TaskLoop tests pass. | Low. |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw prompts/full payload persistence | pass | Trace span attributes omit task text; test asserts task text absent from serialized spans. | None. |
| No full trace dump exposed by default | pass | No provider/UI/prompt wiring; injected sink only under default-off flag. | None. |
| External traceparent sanitized/re-rooted/marked untrusted | pass | `runtimeTraceExternalContextEvent` uses `sanitizeExternalRuntimeTraceContext`; test asserts untrusted event and absence of external header values. | No Main/Gateway propagation was wired in this lane. |
| Token-budgeted summaries | not-applicable | Lane C emits spans only; Lane B owns summary budget behavior. | Future Lane D/provider must preserve budgets. |
| Source refs do not replace verifier evidence | pass | Spans carry source refs and evidence refs only; no verifier/completion gate consumes them. | None. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Required Phase 6 read routing. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Phase 6 spec validity. | None. |
| Focused TaskLoop test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | pass | Flag-off parity and trace shadow sanitized recording. | None. |
| Security shadow verifier | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Security/verifier shadow and Gateway `tools.invoke` regression. | None. |
| Comms replay | `rtk node scripts/comms/replay.mjs` | pass | Communication replay metrics. | None. |
| Comms compare | `rtk node scripts/comms/compare.mjs` | pass | Communication regression compare. | None. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime TypeScript surface. | None. |
| Renderer IPC/Gateway bypass scan | `rtk rg -n ... src/pages src/components` | pass | Renderer boundary. | Exit 1/no matches. |
| Broad second-service/exporter scan | `rtk rg -n ... openclaw_runtime/src electron shared tests/unit` | reviewed | Forbidden service/exporter additions. | Reports pre-existing server/exporter strings outside Lane C touched files. |
| Lane C second-service/exporter scan | `rtk rg -n ... openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | pass | Lane C touched files. | Exit 1/no matches. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on trace recording/provider/export | pass | `runtimeTraceSpanShadowEnabled` requires `runtime.traceContext.shadow === true`; no provider/export wiring. |
| No observability platform/collector/exporter/database | pass | No deps/storage/exporter/platform code added; touched-file scan has no matches. |
| No second runtime service/listener/Gateway/Temporal | pass | No service/listener/Gateway/Temporal code added. |
| No renderer direct IPC | pass | Renderer files not touched; renderer scan has no matches. |
| No renderer direct Gateway HTTP/WS | pass | Renderer files not touched; renderer scan has no matches. |
| No runtime authority/completion gate/security policy from trace provider | pass | Trace spans are sink-only; no TaskLoop/verifier/security policy consumes them. |
| Comms replay/compare when Main/Gateway paths changed | pass | Main/Gateway paths not changed, but replay/compare were run and passed. |
| UI changes have E2E | not-applicable | No UI changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane C requested Main/Gateway propagation only if strictly needed. | TaskLoop-only injected shadow sink satisfies default-off recording without transport changes. | Preserve Main-owned transport and avoid renderer/Gateway edits. | Keep Main/Gateway propagation for a future lane only if a concrete host-api/Gateway trace carrier is required and can prove flag-off parity. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane D readonly RuntimeTraceContextProvider
New code path: openclaw_runtime/src/context-engine/runtime-trace-context-provider.ts or equivalent
Legacy path wrapped: none; provider consumes accepted local trace store/summaries
Shadow / readonly boundary: readonly context items only, no prompt full trace dump
Feature flag: runtime.traceContext.provider remains default false
Tests: provider budget/ranking tests plus provider ordering flag-off parity
Harness: phase-6-trace-context-provider context/validate
Rollback: disable provider flag; TaskLoop/Gateway/tool behavior remains authoritative
Done when: budgeted context items can be queried from local sanitized spans without provider ordering changes by default
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future Main/Gateway propagation use an internal host-api metadata field or remain TaskLoop/runtime-local until provider cutover? | Avoids unnecessary transport changes and comms risk. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally did not edit Gateway, Electron Main, host-api, api-client, renderer, or provider registry paths.
- Broad second-service/exporter scan returns existing repository services/exporter docs/config strings; the Lane C touched-file scan has no matches.
- The worktree contains unrelated pre-existing uncommitted changes in TaskLoop/Evidence Verifier areas; this submission only claims the trace-shadow symbols and tests listed above.
