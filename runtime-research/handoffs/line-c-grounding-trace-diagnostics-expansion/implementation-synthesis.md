# Line C Grounding Trace Diagnostics Expansion Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec before implementation | accepted | `harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md` created; context and validate passed before runtime edits. |
| Explicit Trace Context Provider diagnostics-only expansion | accepted | Added optional `groundingDiagnostics` provider option to `createRuntimeTraceContextProvider()`. |
| Default-off behavior unchanged | accepted | Absent/disabled tests assert exact provider result equality and no `groundingDiagnostics` metadata. |
| Diagnostics/metadata-only output | accepted | Enabled path appends one diagnostic and result metadata only; it does not add or alter `ContextItem`s. |
| `authority: "none"` and `rawRetained: false` | accepted | Diagnostic metadata copies accepted shadow helper boundary markers and tests assert fixed authority/raw-retention values. |
| Helper readonly/local/bounded/summary-only/non-authoritative | accepted | Reuses `createRuntimeTraceGroundingShadowSummary()` with explicit `enabled: true`; tests cover limit/tokenBudget and non-authority markers. |
| No TaskLoop/Gateway/provider-ordering/default registration/runtime decision cutover | accepted | Touched runtime code is limited to Trace Context Provider diagnostics metadata; registry ordering tests remain stable. |
| No persistence/database/sidecar/exporter/listener/service/raw retention/patch apply | accepted | Boundary scans found no production service, persistence, mutation, or raw-retention behavior beyond expected boundary markers. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Insertion point | accepted: Trace Context Provider diagnostics metadata | It is the smallest specific runtime diagnostics consumer after the accepted registry pilot. |
| Context Provider Registry diagnostics | accepted baseline, not expanded | Existing pilot remains validation coverage; this phase proves a more specific Trace provider path. |
| Runtime Memory / AgentMap / Symbol diagnostics | rejected for this phase | They are useful later but either risk memory-promotion confusion or duplicate readiness coverage. |
| TaskLoop/Gateway/provider ordering/prompt assembly/memory promotion/renderer transport | rejected | These are authoritative, transport, or user-visible boundaries and remain out of scope. |
| Data flow | accepted | `GroundingRef` refs -> explicit Trace provider option -> shadow helper -> provider diagnostic/result metadata. |
| Implementation entry | accepted | `Design Status: accepted` in `design-research.md` before code changes. |

## Implementation Surface Summary

Updated:

- `openclaw_runtime/src/context-engine/trace-context-provider.ts`
  - Added `RuntimeTraceContextProviderGroundingDiagnosticsOptions`.
  - Added optional `groundingDiagnostics` to `RuntimeTraceContextProviderOptions`.
  - Added helper call to `createRuntimeTraceGroundingShadowSummary()`.
  - Added diagnostics/result metadata mapping for bounded grounding summary items.

- `tests/unit/runtime-trace-context-provider.test.ts`
  - Added absent/disabled equality coverage.
  - Added explicit enabled diagnostics-only coverage for token budget, untrusted exclusion, raw sentinel rejection, unchanged `contextItems`, unchanged evidence refs, fixed `authority: "none"`, and no memory-promotion authority.

Created:

- `harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md`
- `runtime-research/handoffs/line-c-grounding-trace-diagnostics-expansion/design-research.md`
- `runtime-research/handoffs/line-c-grounding-trace-diagnostics-expansion/implementation-synthesis.md`

`rtk` is required by local policy but was not available on this PowerShell PATH, so validation used the direct `node` / `rg` commands requested by the task.

## Tests And Scans Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-provider.test.ts` | pass, 1 file / 7 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts` | pass, 10 files / 82 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy matches only: Electron Main allowlist, Electron Gateway WebSocket owner code, remote-control WebSocket owner code, preload IPC bridge, project-rule detection text, and i18n rule text.
- Focused renderer scan over `src/pages src/components` returned no matches.
- Service/exporter/listener/database scan over touched files matched only spec/design policy text; production Trace provider scan had no new service/listener/exporter/database behavior.
- Raw-retention scan over touched files matched expected `rawRetained` / `includeRaw` boundary markers, test sentinels, and spec policy text; tests prove sentinel values do not survive output.
- Persistence/sidecar scan over touched files matched spec policy text and the existing Trace provider in-memory `store` dependency used by prior tests; no write, cache, sidecar, database, or persistence path was added.
- Mutation/patch-apply scan over touched files matched only spec policy text.
- Authority scan found expected existing runtime authority wording plus new `authority: "none"` diagnostic/test assertions.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended context/runtime files found no new runtime wiring; matches were existing lowercase "grounding/backgrounding" prose in agent prompt/exec text.
- Provider/default-registration scan found only existing registry creation/order constants/tests plus the new Trace provider `groundingDiagnostics` option; no provider registration or default ordering code changed.
- Trace Context Provider `contextItems` scan/test proves grounding diagnostics are appended after provider result construction and explicit enabled output keeps `contextItems` equal to baseline.

Comms replay/compare were not run because this task did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## Rejected-Boundary Audit

Rejected boundaries remain intact:

- No TaskLoop, Gateway, runtime execution, model-message, prompt assembly, provider-ordering, default provider registration, renderer transport, or provider transport cutover.
- No completion, blocked/failed status, retry, approval, security, verifier enforcement, provider selection, runtime state, tool policy, or memory promotion decision uses grounding output.
- No persistence, database, SQLite schema, JSONL sidecar, write path, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service was added.
- No raw prompts, raw chat logs, raw traces, full payloads, full checkpoints, tool args, tool output, stdout, stderr, env, secrets, API keys, authorization headers, traceparent, tracestate, baggage, or unbounded command output are retained.
- No renderer direct IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching was added.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior was added.
- Source and symbol refs remain relevance/evidence anchors only.
- Memory facts cannot be promoted from grounding diagnostics metadata.

## Next Phase Decision

This Trace Context Provider diagnostics expansion is accepted as a minimal, specific runtime diagnostics consumer path.

The next phase may plan a fresh accepted task spec for broader explicit runtime diagnostics consumers. It may continue to use `GroundingRef` / `GroundingQuery` only as readonly, local, bounded, default-off, summary-only, diagnostics/metadata-only, non-authoritative material.

The next phase must not add TaskLoop/Gateway/provider-ordering/default provider registration/runtime execution cutover, prompt/model-message cutover, persistence/database/sidecar/exporter/listener/service work, renderer transport changes, memory fact promotion, raw retention, or patch-apply behavior.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, trace context, diagnostics, runtime trace, and context provider references. No updates are required because this change is internal, default-off, diagnostics-only, and not exposed through UI, Gateway routes, settings, user-visible flows, or public docs.

Status: accepted
