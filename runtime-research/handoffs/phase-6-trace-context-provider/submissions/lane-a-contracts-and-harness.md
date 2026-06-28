# lane-a-contracts-and-harness: Runtime Trace Contract, Taxonomy, And Harness

## Scope Confirmation

- Lane: `lane-a-contracts-and-harness`
- Output file: `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-a-contracts-and-harness.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/runtime-core/trace-context.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched:
  - `tests/unit/runtime-trace-context-contracts.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk proxy <rg.exe> -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components`
  - `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit`
  - `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/trace-context.ts tests/unit/runtime-trace-context-contracts.test.ts`
- Required reading completed:
  - `C:\Users\27933\.codex\RTK.md`
  - `AGENTS.md`
  - `openclaw_runtime/AGENTS.md`
  - `runtime-research/agent-runtime-index.md`
  - `runtime-research/implementation-roadmap.md`, Phase 6
  - `runtime-research/migration-execution-plan.md`, Stage 7
  - `runtime-research/agent-runtime-core-spec.md`, Runtime Context Provider references and first implementation order
  - `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/README.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/parallel-lanes.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/submission-template.md`
  - `runtime-research/handoffs/phase-6-trace-context-provider/synthesis-template.md`
  - `runtime-research/opentelemetry/trace-model.md`
  - `runtime-research/opentelemetry/query-and-source-mapping.md`
  - `runtime-research/opentelemetry/clawx-mapping.md`
  - `runtime-research/opentelemetry/useful-tests.md`
  - `harness/specs/tasks/phase-6-trace-context-provider.md`

## Executive Summary

- Added the canonical Phase 6 trace contract in runtime-core only.
- Defined span kind/status/link vocabularies, span events, source refs, evidence refs, timestamps, bounded attributes, and readonly summaries.
- Added default-off `runtime.traceContext.shadow`, `runtime.traceContext.provider`, and `runtime.traceContext.propagation` flag resolution.
- Added pure guards, fixture builder, query helpers, sanitizer/redaction helpers, external traceparent sanitization, ranking, and token-budgeted summary helpers.
- Kept the surface contract-only and readonly: no live trace recording, provider registration, provider ordering change, propagation wiring, export, prompt dump, TaskLoop gate, verifier authority, retry policy, security policy, or runtime authority.
- Kept TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Gateway, Main, renderer, host-api, and api-client behavior unchanged by this lane.
- Focused tests cover taxonomy, default-off flags, span/event/provider-result guards, parent/child queries, linked resume/evidence queries, untrusted external traceparent handling, redaction, priority ranking, and token budgets.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase 6 context loaded | command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed with Phase 6 read list. |
| Phase 6 spec validated | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | n/a | Passed before and after proof. |
| Trace contract is runtime-core only | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `RuntimeTraceSpan`, `RuntimeTraceSpanEvent`, `RuntimeTraceQuery`, `RuntimeTraceSummary`, `RuntimeTraceContextProvider` | No TaskLoop/Gateway/renderer wiring. |
| Feature flags default off | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `DEFAULT_RUNTIME_TRACE_CONTEXT_FEATURE_FLAGS`, `resolveRuntimeTraceContextFeatureFlags` | Unknown/export flags are ignored. |
| External traceparent is not trusted | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `sanitizeExternalRuntimeTraceContext` | Valid external context is marked `trusted: false`; missing/malformed/invalid context is rejected. |
| Raw payload fields are redacted | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `sanitizeRuntimeTraceAttributes`, `sanitizeRuntimeTraceSpan` | Prompt/message/payload/checkpoint/args/output/env/secret-like keys are redacted. |
| Parent/child and linked spans are queryable | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `findRuntimeTraceSpans`, `findRuntimeTraceChildren`, `findRuntimeTraceLinkedSpans` | Link query does not treat links as causal parentage. |
| Summaries are readonly and budgeted | file | `openclaw_runtime/src/runtime-core/trace-context.ts` | `rankRuntimeTraceSpans`, `summarizeRuntimeTrace` | Errors, test/verifier spans, and linked evidence rank ahead of unrelated siblings. |
| Contract tests pass | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts` | 1 file / 7 tests | Passed on current files. |
| Node typecheck passes | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | n/a | Passed. |
| Renderer bypass scan has no matches | command | `rtk proxy <rg.exe> -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | n/a | Exit 1/no matches. |
| Lane A adds no services/exporters | missing-after-search | `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/trace-context.ts tests/unit/runtime-trace-context-contracts.test.ts` | n/a | Exit 1/no matches. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/trace-context.ts` defines the local span schema, span event schema, source refs, span links, feature flags, guards, fixture builder, pure query helpers, redaction helpers, external traceparent sanitizer, ranking, and budgeted summary helper.
- `openclaw_runtime/src/runtime-core/index.ts` exports the trace contract.

Tests:

- `tests/unit/runtime-trace-context-contracts.test.ts` covers taxonomy, default-off flags, contract guards, event guards, parent/child and linked-span queries, external traceparent safety, redaction, ranking, and summary budget behavior.

Feature flags:

- `runtime.traceContext.shadow`
- `runtime.traceContext.provider`
- `runtime.traceContext.propagation`
- All default false; no flag enables external export or prompt full-trace dumps.

Harness/spec changes:

- The existing Phase 6 task spec was validated. No harness behavior changes were made.

Docs/index changes:

- This submission records Lane A evidence. README translation updates are not required because Lane A adds no shipped UI, RPC, setup, or user-visible behavior. `agent-runtime-index.md` remains for Lane E/synthesis update after Phase 6 acceptance.

## Trace Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Span contract | `RuntimeTraceSpan`, `RuntimeTraceSpanEvent` | contract-only | n/a | `openclaw_runtime/src/runtime-core/trace-context.ts` |
| Query model | `RuntimeTraceQuery`, `findRuntimeTraceSpans`, `findRuntimeTraceChildren`, `findRuntimeTraceLinkedSpans` | pure helper only | n/a | `tests/unit/runtime-trace-context-contracts.test.ts` |
| Summary model | `RuntimeTraceSummary`, `summarizeRuntimeTrace` | readonly/budgeted helper | `runtime.traceContext.provider` remains default off | `tests/unit/runtime-trace-context-contracts.test.ts` |
| Propagation safety | `sanitizeExternalRuntimeTraceContext` | sanitization only; no propagation wiring | `runtime.traceContext.propagation` remains default off | `tests/unit/runtime-trace-context-contracts.test.ts` |
| Recording shadow flags | `resolveRuntimeTraceContextFeatureFlags` | flags only; no live recording | `runtime.traceContext.shadow` remains default off | `tests/unit/runtime-trace-context-contracts.test.ts` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Legacy TaskLoop remains authoritative. | Lane A only exports pure runtime-core trace contract helpers; no TaskLoop wiring. | Low. |
| tools.invoke | Existing Gateway/tool behavior remains authoritative. | No Gateway/tool invocation paths changed by Lane A. | Low. |
| approval waiting/retry/error mapping | Existing behavior remains unchanged. | No approval, retry, error mapping, or return-payload code touched by Lane A. | Low. |
| event-log/checkpoint/resume | Existing Phase 4 behavior remains unchanged. | Trace links/evidence refs are passive contract data only. | Low. |
| Evidence Verifier | Phase 5 warning-only behavior remains unchanged. | Source/evidence refs do not replace verifier evidence or decisions. | Low. |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw prompts/full payload persistence | pass | `sanitizeRuntimeTraceAttributes` redacts prompt/message/payload/checkpoint/args/output/env/secret-like keys; tests assert sensitive fixture text is absent from summaries. | Lane B/C must use sanitizer at recording boundaries. |
| No full trace dump exposed by default | pass | No provider/UI/prompt wiring; summary returns bounded readonly items only. | Lane D must preserve budgeted output. |
| External traceparent sanitized/re-rooted/marked untrusted | pass | `sanitizeExternalRuntimeTraceContext` marks valid external context `trusted: false` and rejects missing/malformed/invalid values. | Lane C must apply this before propagation. |
| Token-budgeted summaries | pass | `summarizeRuntimeTrace` enforces `tokenBudget`; tests cover normal and tiny budgets. | Uses approximate character/token estimate. |
| Source refs do not replace verifier evidence | pass | Summary items carry `sourceRefs` and `evidenceRefs`; tests cover both on prioritized spans. | Future verifier work must remain non-authoritative unless a fresh spec says otherwise. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Required read routing. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Task spec validity. | None. |
| Focused contract test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts` | pass | Contract, query, sanitization, external traceparent, ranking, summary behavior. | None. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime-core TypeScript surface. | None. |
| Renderer IPC/Gateway bypass scan | `rtk proxy <rg.exe> -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | Renderer boundary. | Exit 1/no matches. |
| Required broad second-service/exporter scan | `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit` | reviewed | Forbidden service/exporter additions. | Existing OAuth/Gateway/proxy/test-helper/config-help matches are outside Lane A. |
| Lane A second-service/exporter scan | `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/trace-context.ts tests/unit/runtime-trace-context-contracts.test.ts` | pass | Lane A code/test forbidden service/exporter additions. | Exit 1/no matches. |
| Comms replay/compare | n/a | not-applicable | Main/Gateway paths. | Lane A did not change Main/Gateway communication paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on trace recording/provider/export | pass | `DEFAULT_RUNTIME_TRACE_CONTEXT_FEATURE_FLAGS` defaults `shadow`, `provider`, and `propagation` to false; no export flag exists. |
| No observability platform/collector/exporter/database | pass | Lane A code/test forbidden-pattern scan has no matches; no storage/dependency/platform code added. |
| No second runtime service/listener/Gateway/Temporal | pass | Lane A code/test forbidden-pattern scan has no service/listener/Gateway/Temporal matches. |
| No renderer direct IPC | pass | Renderer scan exit 1/no matches; renderer files not touched by Lane A. |
| No renderer direct Gateway HTTP/WS | pass | Renderer scan exit 1/no matches; renderer files not touched by Lane A. |
| No runtime authority/completion gate/security policy from trace provider | pass | Contract returns readonly summary/provider-result shapes only; no TaskLoop/verifier/security wiring. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | Lane A did not change Main/Gateway communication paths. |
| UI changes have E2E | not-applicable | No UI changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane A includes pure query/summary helpers while Lane B owns local store/query. | Phase 6 Lane A asks for deterministic query/summary contract tests; Lane B asks for bounded local store over accepted contract. | Keep Lane A storeless and pure. | Synthesis should treat `findRuntimeTraceSpans`/`summarizeRuntimeTrace` as contract helpers that Lane B can wrap in a bounded in-memory store. |
| Current runtime already has a legacy `RuntimeTraceContext` type for small trace ids in `types.ts`. | `openclaw_runtime/src/runtime-core/types.ts` exports `RuntimeTraceContext`; Lane A adds `RuntimeTraceSpan`/`RuntimeTraceContextProvider` in `trace-context.ts`. | Do not rename or overload the legacy small context shape. | Keep Phase 6 span/provider contract names explicit and avoid treating existing trace ids as trusted propagation authority. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane B local span store query
New code path: openclaw_runtime/src/runtime-core/trace-context-store.ts or equivalent
Legacy path wrapped: none; pure in-memory local store only
Shadow / readonly boundary: local sanitized span diagnostics only
Feature flag: runtime.traceContext.shadow remains default false
Tests: focused parent/child/link/query/retention/budget store tests
Harness: validate phase-6-trace-context-provider before implementation review
Rollback: omit/disable trace store construction; accepted Lane A contracts remain inert
Done when: bounded in-memory store proves query/summarize behavior without persistence/export/service/UI
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should Lane B reuse `summarizeRuntimeTrace` directly or own a separate summarizer facade? | Avoids drift between contract tests and store behavior. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally did not update `agent-runtime-index.md`; Lane E or synthesis should update it only after Phase 6 acceptance.
- This lane intentionally did not touch TaskLoop, Gateway, renderer, provider registry, host-api, or api-client paths.
- The broad service/exporter scan reports existing non-Lane-A runtime/electron/test-helper matches; the Lane A code/test scan has no forbidden service/exporter patterns.
