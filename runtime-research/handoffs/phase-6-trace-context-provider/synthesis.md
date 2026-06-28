# Phase 6 Synthesis: Trace Context Provider

Status: accepted

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
| `C:\Users\27933\.codex\RTK.md` | reviewed | Plain `rtk` was not on PATH, so commands used `C:\Users\27933\.cherrystudio\bin\rtk.exe`. |
| `AGENTS.md` | reviewed | Renderer/Main boundary, comms, docs sync, and harness routing rules applied. |
| `runtime-research/agent-runtime-index.md` | reviewed/updated | Updated to Phase 6 accepted and to require a fresh Phase 7 memory spec. |
| `runtime-research/implementation-roadmap.md`, Phase 6 / Phase 7 | reviewed | Phase 6 is trace context; Phase 7 is memory with evidence-backed temporal facts. |
| `runtime-research/migration-execution-plan.md`, Stage 7 / Stage 8 | reviewed | Trace provider remains readonly context; memory must not store unverified facts. |
| `runtime-research/agent-runtime-core-spec.md` | reviewed | RuntimeTraceContextProvider and RuntimeMemoryProvider order confirmed. |
| `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md` | reviewed | Phase 5 remains warning-only/default-off; trace does not become verifier authority. |
| Phase 6 handoff README / parallel lanes / templates | reviewed/updated | Entry contract tightened before synthesis. |
| `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-design-entry-tightening.md` | reviewed | Accepted design boundary for this synthesis. |
| A-E Phase 6 submissions | reviewed | Each has exactly one `Status: accepted`. |
| OpenTelemetry research docs | reviewed | Trace/span/query/source mapping used as conceptual source only. |
| `harness/specs/tasks/phase-6-trace-context-provider.md` | reviewed/validated | Spec is valid and carries Phase 7 gate. |

## Accepted / Needs Revision Lanes

| Lane | Status | Reason |
|---|---|---|
| lane-a-contracts-and-harness | accepted | Adds canonical bounded trace/span contract, default-off flags, pure query/summary helpers, sanitizer/redaction, external trace context untrusted/rejected handling, and focused contract tests. No live runtime wiring. |
| lane-b-local-span-store-query | accepted | Adds explicit in-memory bounded store, sanitized append, clone/read isolation, query filters, link queries, and budgeted summaries. No persistence/exporter/service/UI/provider wiring. |
| lane-c-propagation-recording-shadow | accepted | Adds TaskLoop-only default-off trace shadow sink with sanitized lifecycle/checkpoint spans and untrusted external context event. Flag-off behavior and verifier/tools.invoke regressions pass. No Main/Gateway/renderer transport change. |
| lane-d-context-provider-summary | accepted | Adds optional readonly RuntimeTraceContextProvider with budgeted `ContextItem` output gated by `runtime.traceContext.provider`; default provider ordering remains unchanged. |
| lane-e-validation-docs-synthesis-readiness | accepted | Re-ran A-D status audit, focused tests, typecheck, boundary scans, raw-retention classification, README review, and verifier/comms confidence checks. |

No Phase 6 lane is `needs_revision` or `blocked`.

## Trace Surface Added

| Surface | Evidence | Accepted Boundary |
|---|---|---|
| Canonical trace contract | `openclaw_runtime/src/runtime-core/trace-context.ts`; `tests/unit/runtime-trace-context-contracts.test.ts` | Contract/pure helpers only; default-off flags; no export/provider/TaskLoop authority. |
| Local span store/query | `openclaw_runtime/src/runtime-core/trace-context-store.ts`; `tests/unit/runtime-trace-context-store.test.ts` | Explicit in-memory bounded store; sanitized append; readonly query clones and summaries. |
| TaskLoop trace shadow sink | `openclaw_runtime/src/agents/task-loop-controller.ts`; `tests/unit/task-loop-controller.test.ts` | `runtime.traceContext.shadow` default false; observe-only injected sink; legacy TaskLoop outputs authoritative. |
| Readonly trace context provider | `openclaw_runtime/src/context-engine/trace-context-provider.ts`; `tests/unit/runtime-trace-context-provider.test.ts` | Gated by `runtime.traceContext.provider`; budgeted trace context items only; no full dump. |
| Optional provider registration path | `openclaw_runtime/src/context-engine/provider-registry.ts`; `tests/unit/context-provider-registry.test.ts` | Explicit optional registration; default provider ordering unchanged. |

## Accepted Boundary

| Boundary | Evidence | Status |
|---|---|---|
| Canonical span contract is bounded and sanitized | Contract tests passed; raw-retention tests assert redaction. | pass |
| Local span store/query is bounded and local-only | Store tests passed; touched-file service/exporter scan had no matches. | pass |
| Recording/propagation remains default-off shadow | TaskLoop tests passed; `runtime.traceContext.shadow` / `propagation` are default false. | pass |
| RuntimeTraceContextProvider is readonly and budgeted | Provider tests passed; output is `ContextItem(kind: "trace")`, not snapshots/dumps. | pass |
| Validation/docs/synthesis evidence is complete | Lane E accepted; this synthesis records commands and Phase 7 gate. | pass |

## Rejected Boundary Audit

| Rejected Surface | Evidence | Result |
|---|---|---|
| Default-on trace recording/provider/export/provider-ordering cutover | Feature flags default false; provider registration explicit; registry tests pass. | pass |
| External telemetry, OTLP, collector, observability platform, database, service, listener, or second Gateway/runtime | Touched-file service/exporter scan returned no matches. Broad scan matches are existing OAuth/Gateway/proxy/test-helper/plugin/config-help surfaces outside Phase 6 touched files. | pass |
| Full trace dump to prompt/UI | Provider emits budgeted context items only; no UI/prompt path added. | pass |
| Raw prompt/full payload/full checkpoint/full tool args/output/env/secrets/unbounded output retention | Production matches are sanitizer patterns and bounded `tracestate`/`baggage` key counts; test matches are redaction fixtures. | pass |
| Trace-derived completion, verifier, security, retry, or runtime authority | TaskLoop trace sink is observe-only; provider metadata is readonly/no-authority; verifier script passed. | pass |
| Trusted external traceparent/tracestate/baggage | `sanitizeExternalRuntimeTraceContext` rejects invalid headers and marks valid external context untrusted; Lane C stores counts/keys only. | pass |

## Legacy Paths Wrapped

| Legacy Path | Trace Adapter | Feature Flag | Parity Evidence |
|---|---|---|---|
| TaskLoop lifecycle/checkpoint | Observe-only trace span shadow sink | `runtime.traceContext.shadow` | `tests/unit/task-loop-controller.test.ts` passed; flag-off test asserts no trace spans and legacy payload unchanged. |
| External trace context input | Sanitized untrusted event metadata only | `runtime.traceContext.propagation` plus shadow | Contract and TaskLoop tests cover untrusted/rejected handling and no raw header value retention. |
| Context provider registry | Optional explicit provider registration | `runtime.traceContext.provider` | `tests/unit/context-provider-registry.test.ts` passed; default ordering unchanged. |
| Evidence Verifier / tools.invoke | No trace authority; source/evidence refs remain passive | none | `scripts/verify-security-shadow-mvp.mjs` passed, including Gateway `tools.invoke` regression and comms replay/compare. |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No default-on trace recording/provider/export | pass |
| Runtime trace code inside allowed paths | pass |
| Legacy behavior unchanged with flags off | pass |
| No observability platform/collector/exporter/database | pass |
| No raw prompt/full payload/full trace dump retention | pass |
| External traceparent sanitized/re-rooted/marked untrusted | pass |
| Trace provider remains readonly/non-gating | pass |
| Renderer direct IPC / Gateway HTTP bypass | pass |
| UI changes have E2E | not applicable |

## Feature Flags

| Flag | Default | Evidence | Rollback |
|---|---|---|---|
| `runtime.traceContext.shadow` | false | Contract and TaskLoop tests; no spans emitted with flags off. | Disable/omit flag; TaskLoop remains authoritative. |
| `runtime.traceContext.provider` | false | Provider test covers disabled result; registry default ordering unchanged. | Disable/omit flag or do not register provider. |
| `runtime.traceContext.propagation` | false | External context event only appears with explicit shadow/propagation input; raw values not retained. | Disable/omit flag; external trace context is not consumed locally. |

No Phase 6 flag enables export, telemetry upload, prompt full-trace dump, completion gating, security policy, retry policy, or provider ordering cutover.

## Test Evidence Matrix

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Phase 6 routing and required read list. | None. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Phase 6 task spec validity. | None. |
| `rtk node -e "<A-E status validator>"` | pass | Each A-E lane has exactly one `Status: accepted`. | None. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 5 files / 69 tests | Contract, store, provider, registry, TaskLoop trace shadow and flag-off behavior. | None. |
| `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime TypeScript surface. | None. |
| Renderer bypass scan over `src/pages src/components` | pass, no matches | No renderer direct IPC or Gateway HTTP/WS. | `rg` exit 1/no output is expected for no matches. |
| Touched-file service/exporter scan | pass, no matches | No Phase 6 service/exporter/listener/database/collector additions in touched files. | None. |
| Broad service/exporter scan | reviewed | Existing repo Gateway/OAuth/proxy/test-helper/plugin/config-help surfaces classified as pre-existing/non-Phase-6. | Broad scan is intentionally noisy. |
| Production raw-retention scan | reviewed/pass | Matches are sanitizer denylist patterns and bounded external context key counts. | None. |
| Test raw-retention scan | reviewed/pass | Matches are redaction fixtures and assertions. | None. |
| `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Security/verifier shadow, Gateway `tools.invoke`, node/web typecheck, comms replay/compare. | None. |
| README search for trace/provider/tool terms | reviewed/pass | Existing Phase 5 security/verifier text only; no user-visible Phase 6 docs required. | README files were already dirty before this synthesis; no Phase 6 README change needed. |

## Trace Query / Summary Evidence

| Requirement | Evidence | Status |
|---|---|---|
| Parent/child spans queryable | Contract/store tests passed. | pass |
| Linked resume/evidence spans queryable | Contract/store tests passed; links are not causal parentage. | pass |
| Error spans rank first | Contract/store/provider tests passed. | pass |
| Summary respects token budget | Contract/store/provider tests passed. | pass |
| Source refs connect to evidence refs without replacing verifier evidence | Contract/provider tests and verifier regression passed. | pass |
| External traceparent is sanitized or re-rooted | Contract/TaskLoop tests prove rejected or untrusted handling; no raw header retention. | pass |

## Contract / Naming Conflicts

| Conflict | Evidence | Required Resolution |
|---|---|---|
| Broad service/exporter scan reports existing services and collector-like names. | Matches are existing Gateway/OAuth/proxy/test-helper/plugin/config-help surfaces outside Phase 6 touched files. | Accept only with touched-file clean scan; do not treat broad matches as Phase 6 additions. |
| Raw-retention scans include sensitive strings. | Production matches are sanitizer/key-count code; test matches are fixtures that prove redaction. | Accept with classification; future lanes must repeat touched-file scans. |
| Existing small `RuntimeTraceContext` naming predates Phase 6 span/provider contract. | Lane A records explicit `RuntimeTraceSpan` / provider naming and avoids treating old trace ids as trusted authority. | Keep names explicit; do not overload external trace context as local truth. |
| Phase 6 submissions A-E already existed before this synthesis run. | Revalidated current files and tests in this synthesis. | Accept current evidence; synthesis, not prior lane text alone, is the phase gate. |

## Ready For Next Phase?

Yes, with a narrowed definition.

Phase 6 is accepted for a local, sanitized, bounded, default-off trace context provider foundation. It is ready to feed the next planning step for Phase 7, but Phase 7 implementation may not start by scraping raw chat logs or treating trace summaries as durable facts.

Phase 7 may begin only as a fresh Runtime Memory Provider task spec that requires evidence-backed temporal facts and forbids raw chat-log or raw trace-dump memory.

## Phase 7 Entry Criteria

| Criterion | Evidence | Status |
|---|---|---|
| Trace spans are local, sanitized, bounded, and queryable | Lane A/B tests and touched-file scans passed. | pass |
| Trace summaries are budgeted context items, not raw dumps | Lane B/D tests passed; provider output is budgeted `ContextItem`. | pass |
| Source refs link to evidence refs without replacing verifier evidence | Contract/provider tests and verifier regression passed. | pass |
| External trace context is not trusted as local truth | Sanitizer marks valid external context untrusted and rejects invalid input. | pass |
| Trace facts are not treated as durable memory facts unless verified | Phase 6 adds no memory provider and no durable memory writes. | pass |
| Fresh Phase 7 spec exists or is explicitly required before Runtime Memory Provider work | This synthesis and task spec require a fresh Phase 7 spec. | pass |

## Required Fixes Before Next Phase

No Phase 6 fixes block moving to Phase 7 planning.

Required before Phase 7 implementation:

1. Add a fresh `Runtime Memory Provider` task spec under `harness/specs/tasks/`.
2. Forbid raw chat-log memory and raw trace-dump memory.
3. Require evidence-backed temporal facts with `valid_at` / `invalid_at`.
4. Require source episode/evidence refs and verifier or human approval before durable fact promotion.
5. Define retention, idempotency, invalidation, and rollback behavior before any memory store is written.

## agent-runtime-index.md Updates Applied

```text
Trace Context Provider:
  code: openclaw_runtime/src/runtime-core/trace-context.ts; openclaw_runtime/src/runtime-core/trace-context-store.ts; openclaw_runtime/src/context-engine/trace-context-provider.ts; openclaw_runtime/src/context-engine/provider-registry.ts; openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/runtime-trace-context-contracts.test.ts; tests/unit/runtime-trace-context-store.test.ts; tests/unit/runtime-trace-context-provider.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/task-loop-controller.test.ts
  status: accepted_phase_6_trace_context_provider_shadow_readonly
  next: Phase 7 Runtime Memory Provider may start only through a fresh harness task spec that forbids raw chat-log/raw-trace memory and requires evidence-backed temporal facts.
```

