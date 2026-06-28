# lane-d-context-provider-summary: Readonly RuntimeTraceContextProvider And Budgeted Context Items

## Scope Confirmation

- Lane: `lane-d-context-provider-summary`
- Output file: `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-d-context-provider-summary.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/context-engine/trace-context-provider.ts`
  - `openclaw_runtime/src/context-engine/provider-registry.ts`
- Test paths touched:
  - `tests/unit/runtime-trace-context-provider.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components`
  - `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit`
  - `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/context-engine/trace-context-provider.ts openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/runtime-trace-context-provider.test.ts`
- Required reading completed:
  - `C:\Users\27933\.codex\RTK.md`
  - `AGENTS.md`
  - `openclaw_runtime/AGENTS.md`
  - `runtime-research/agent-runtime-index.md`
  - `runtime-research/implementation-roadmap.md`, Phase 6
  - `runtime-research/migration-execution-plan.md`, Stage 7
  - `runtime-research/agent-runtime-core-spec.md`, RuntimeTraceContextProvider references
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

- Added `createRuntimeTraceContextProvider()` as a readonly `RuntimeContextProvider` adapter over the accepted in-memory trace store and summary item surfaces.
- Provider output is budgeted `ContextItem[]` with `kind: "trace"`; it never exposes a full trace dump, raw attributes, full events, full payloads, prompts, tool args, tool output, or environment data.
- Provider ranking follows Lane D order: error spans, specific current tool/file/symbol matches, verifier/test spans, linked resume/evidence spans, then siblings.
- Provider registration remains optional, default-off, and shadow-only. The default `createContextProviderRegistryPilot()` provider ordering is unchanged.
- The provider is gated by `runtime.traceContext.provider`; flag-off calls return an empty result plus skipped diagnostic.
- Source refs are carried as metadata links and context evidence remains explicit; trace/source refs do not become verifier authority.
- No TaskLoop, Gateway, renderer, host-api/api-client, completion gate, verifier policy, security policy, retry policy, service, exporter, database, or UI path was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase 6 harness context ran | command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed before implementation. |
| Phase 6 harness validation passes | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed. |
| Readonly trace provider adapter added | file | `openclaw_runtime/src/context-engine/trace-context-provider.ts` | `createRuntimeTraceContextProvider` | RuntimeContextProvider adapter over `RuntimeTraceSpanStore.summarizeTrace()`. |
| Provider is default-off/shadow-only | file/test | `openclaw_runtime/src/context-engine/trace-context-provider.ts`; `tests/unit/runtime-trace-context-provider.test.ts` | `enabledByDefault: false`, `shadowOnly: true`, flag-disabled test | Requires `runtime.traceContext.provider`. |
| Default provider ordering unchanged | test | `tests/unit/runtime-trace-context-provider.test.ts` | default registry assertion | `createContextProviderRegistryPilot()` still returns legacy + loop providers only. |
| Optional registration supported | file/test | `openclaw_runtime/src/context-engine/provider-registry.ts`; `tests/unit/runtime-trace-context-provider.test.ts` | `createContextProviderRegistryPilot(extraProviders)` | Extra providers are explicit and appended only by caller. |
| Ranking and budgeting covered | test | `tests/unit/runtime-trace-context-provider.test.ts` | ranked provider output test | Error, match, test, verifier, linked, sibling order. |
| Source/evidence separation covered | test | `tests/unit/runtime-trace-context-provider.test.ts` | source/evidence test | Source refs are metadata links; evidence refs remain explicit. |
| Focused and relevant tests pass | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts` | n/a | Pass: 4 files, 21 tests. |
| Node typecheck passes | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | n/a | Pass. |
| Renderer IPC/Gateway bypass scan passes | missing-after-search | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | n/a | No matches. |
| Lane D files add no service/exporter patterns | missing-after-search | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/context-engine/trace-context-provider.ts openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/runtime-trace-context-provider.test.ts` | n/a | No matches. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/context-engine/trace-context-provider.ts`
  - Defines `RUNTIME_TRACE_CONTEXT_PROVIDER_ID`.
  - Adds `createRuntimeTraceContextProvider({ store, config, defaultTokenBudget, maxTraceIds })`.
  - Gates output on `runtime.traceContext.provider`.
  - Discovers traces from explicit `traceId`/`traceIds` metadata or current task/tool/file/symbol query.
  - Uses sanitized trace summaries from the accepted local store and emits budgeted `ContextItem`s.
  - Attaches compact metadata only: trace/span ids, counts, source refs, rank, readonly/no-authority markers.
- `openclaw_runtime/src/context-engine/provider-registry.ts`
  - `createContextProviderRegistryPilot(extraProviders = [])` supports explicit optional registration without changing the default provider list.

Tests:

- `tests/unit/runtime-trace-context-provider.test.ts`
  - Default registry ordering unchanged.
  - Trace provider manifest validates and is default-off/shadow-only.
  - Flag-off provider returns empty context with `flag_disabled` diagnostic.
  - Flag-on provider returns ranked, budgeted trace context items.
  - Source refs remain metadata links and evidence refs remain explicit.
  - Trace discovery by current task/file/symbol honors token budget.

Feature flags:

- `runtime.traceContext.provider` gates this provider.
- `runtime.traceContext.shadow` and `runtime.traceContext.propagation` remain unaffected.
- No Phase 6 flag enables export, prompt full-trace dumps, completion gates, verifier authority, security policy, retry policy, or runtime authority.

Harness/spec changes:

- No harness spec changes were needed. The existing Phase 6 task spec validates.

Docs/index changes:

- This submission records Lane D evidence. `agent-runtime-index.md` remains for Lane E/synthesis update after Phase 6 acceptance.
- README translations do not need updates because this lane adds no user-visible UI, documented RPC behavior, or runtime flow change.

## Trace Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Provider adapter | `createRuntimeTraceContextProvider` | readonly context provider | `runtime.traceContext.provider` default false | provider tests |
| Provider registration | `createContextProviderRegistryPilot(extraProviders)` | optional explicit registration only | registry flags unchanged | default-ordering test |
| Budgeted output | `ContextItem(kind: "trace")` | budgeted summaries only | `runtime.traceContext.provider` | budget tests |
| Ranking | provider-level item ranking | no runtime authority | n/a | ranked output test |
| Source/evidence refs | metadata `sourceRefs` + explicit `evidenceRefs` | source refs do not replace evidence | n/a | source/evidence test |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Legacy TaskLoop remains authoritative. | TaskLoop files not touched by Lane D. | Low. |
| tools.invoke | Existing Gateway/tool behavior remains authoritative. | Gateway/tool paths not touched by Lane D. | Low. |
| approval waiting/retry/error mapping | Existing behavior remains unchanged. | No tool execution or retry wiring added. | Low. |
| event-log/checkpoint/resume | Existing Phase 4 behavior remains unchanged. | Event-log/checkpoint/resume files not touched by Lane D. | Low. |
| Evidence Verifier | Phase 5 warning-only behavior remains unchanged. | Evidence verifier files not touched by Lane D. | Low. |
| Existing context provider registry pilot | Default provider list remains legacy + loop only. | `tests/unit/runtime-trace-context-provider.test.ts`; `tests/unit/context-provider-registry.test.ts`. | Low. |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw prompts/full payload persistence | pass | Provider consumes sanitized summary items and tests assert raw prompt/output/secrets absent. | Lane C remains responsible for recording-boundary sanitization. |
| No full trace dump exposed by default | pass | Provider emits budgeted context items only; flag off returns none. | Future UI/prompt surfaces must keep budgeted output. |
| External traceparent sanitized/re-rooted/marked untrusted | pass | Existing contract/store tests cover external traceparent; Lane D adds no propagation. | Not a propagation lane. |
| Token-budgeted summaries | pass | Provider tests assert `estimatedTokens <= tokenBudget`. | Deterministic approximate token estimate. |
| Source refs do not replace verifier evidence | pass | Provider context metadata marks `sourceRefsAreEvidenceLinksOnly` and `noVerifierAuthority`; evidence refs remain explicit. | Any verifier authority change requires fresh spec. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Required routing. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Task spec validity. | None. |
| Focused + relevant tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts` | pass | Provider output/ranking/budget/default-off plus existing registry/store/contract behavior. | None. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime-core/context-engine TypeScript surface. | None. |
| Renderer IPC/Gateway bypass scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | Renderer boundary. | No matches. |
| Broad second-service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit` | reviewed | Required forbidden-pattern scan. | Existing matches are outside Lane D paths. |
| Lane D second-service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/context-engine/trace-context-provider.ts openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/runtime-trace-context-provider.test.ts` | pass | No forbidden service/exporter additions in touched files. | No matches. |
| Comms replay/compare | n/a | not-applicable | Main/Gateway paths. | No Main/Gateway communication paths changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on trace recording/provider/export | pass | Provider flag defaults off; optional registration only; no export code. |
| No observability platform/collector/exporter/database | pass | Lane D touched-file scan has no matches; no dependency/storage changes. |
| No second runtime service/listener/Gateway/Temporal | pass | Lane D touched-file scan has no matches. |
| No renderer direct IPC | pass | Renderer scan has no matches; renderer files not touched. |
| No renderer direct Gateway HTTP/WS | pass | Renderer scan has no matches; renderer files not touched. |
| No runtime authority/completion gate/security policy from trace provider | pass | Provider metadata and tests mark readonly/no-authority; no TaskLoop/verifier/security/retry wiring. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | No Main/Gateway paths changed. |
| UI changes have E2E | not-applicable | No UI changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Store summary ranking differs from Lane D provider ranking. | Store tests rank test/verifier ahead of current matches; Lane D requires error, current matches, verifier/test, linked, siblings. | Provider output should follow Lane D ranking without changing accepted store behavior. | Provider applies its own context ranking over sanitized summary items; store remains unchanged. |
| Broad service/exporter scan reports existing project matches. | Scan output includes existing OAuth/web-preview/Gateway/test-helper/config-doc surfaces. | Lane D must not add forbidden services/exporters. | Touched-file scan has no matches; synthesis should not attribute existing matches to Lane D. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane E validation docs synthesis readiness
New code path: no new runtime code unless validation finds gaps
Legacy path wrapped: none
Shadow / readonly boundary: confirm Lane A-D remain default-off/readonly
Feature flag: runtime.traceContext.provider remains default false
Tests: rerun focused trace provider/store/contracts/context registry, node typecheck, boundary scans, comms only if Main/Gateway changed
Harness: validate phase-6-trace-context-provider and audit A-D submissions
Rollback: omit trace provider optional registration or disable runtime.traceContext.provider
Done when: submissions and checks support synthesis classification
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should a future lane register the trace provider through a broader registry pilot runner? | Lane D deliberately keeps registration explicit and default-off. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally did not update `agent-runtime-index.md`; Lane E/synthesis should update it only after Phase 6 acceptance.
- This lane intentionally did not touch TaskLoop, Gateway, renderer, host-api, api-client, verifier, retry, security, or UI paths.
- Existing dirty worktree changes outside the Lane D paths were not reverted or modified.
