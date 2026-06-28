# Line C Grounding Specific Diagnostics Consumers Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec before implementation | accepted | `harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md` created; context passed; structural validate passed with `--no-diff` before runtime edits. |
| Explicit specific diagnostics consumer only | accepted | Chose Symbol Context Provider after design research; added only optional `groundingDiagnostics` provider option. |
| Default-off behavior unchanged | accepted | `runtime-symbol-context-provider.test.ts` compares absent and disabled diagnostics output for exact equality and no `groundingDiagnostics` field. |
| Diagnostics/metadata-only output | accepted | Enabled path appends one diagnostic and result metadata only; it does not add or alter `ContextItem`s or evidence refs. |
| `authority: "none"` and `rawRetained: false` | accepted | Diagnostic metadata copies accepted shadow helper boundary markers and tests assert fixed authority/raw-retention values. |
| Helper readonly/local/bounded/summary-only/non-authoritative | accepted | Reuses `createSymbolGroundingShadowSummary()` with explicit `enabled: true`; tests cover limit/tokenBudget and non-authority markers. |
| No TaskLoop/Gateway/provider-ordering/default registration/runtime decision cutover | accepted | Touched runtime code is limited to Symbol Context Provider diagnostics metadata; provider/default registration scan found no registry ordering changes. |
| No persistence/database/sidecar/exporter/listener/service/raw retention/patch apply | accepted | Production-only scans over touched provider/test files found no service, persistence, or mutation matches; raw scan matched only expected boundary markers and tests. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Insertion point | accepted: Symbol Context Provider diagnostics metadata | It is the narrowest additional concrete diagnostics consumer after the accepted registry and Trace provider paths. |
| Runtime Memory diagnostics | rejected for this phase | Deferred to avoid confusing diagnostics with durable fact promotion. |
| AgentMap diagnostics | acceptable later | Useful but more prompt-adjacent and richer than the Symbol-only anchor path. |
| Trace Context Provider / Registry diagnostics | accepted baseline, not expanded | Already accepted in predecessor phases. |
| TaskLoop/Gateway/provider ordering/prompt assembly/memory promotion/renderer transport/symbol mutation | rejected | These are authoritative, transport, user-visible, durable-state, or mutation boundaries and remain out of scope. |
| Implementation entry | accepted | `Design Status: accepted` in `design-research.md` before code changes. |

## Implementation Surface Summary

Created:

- `harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md`
- `runtime-research/handoffs/line-c-grounding-specific-diagnostics-consumers/design-research.md`
- `runtime-research/handoffs/line-c-grounding-specific-diagnostics-consumers/implementation-synthesis.md`

Updated:

- `openclaw_runtime/src/context-engine/symbol-context-provider.ts`
  - Added `SymbolContextProviderGroundingDiagnosticsOptions`.
  - Added optional `groundingDiagnostics` to `SymbolContextProviderOptions`.
  - Added helper call to `createSymbolGroundingShadowSummary()`.
  - Added diagnostics/result metadata mapping for bounded grounding summary items.

- `tests/unit/runtime-symbol-context-provider.test.ts`
  - Added absent/disabled equality coverage.
  - Added explicit enabled diagnostics-only coverage for token budget, untrusted exclusion, raw sentinel rejection, unchanged `contextItems`, unchanged evidence refs, fixed `authority: "none"`, no memory-promotion authority, and no symbol-mutation authority.

## Tests And Scans Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md` | blocked by unrelated dirty worktree diff outside this task's touched areas; harness validates whole checkout by default for scenario tasks. |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md --no-diff` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-symbol-context-provider.test.ts` | pass, 1 file / 5 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts` | pass, 10 files / 84 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy matches only: Electron preload IPC bridge, Electron Gateway/remote-control WebSocket owner code, Electron Main allowlist, project-rule detection text, and i18n rule text.
- Focused renderer scan over `src/pages src/components` returned no matches.
- Service/exporter/listener/database scan over touched files matched only spec/design policy text; production-only Symbol provider/test scan had no matches.
- Raw-retention scan over touched files matched expected `rawRetained` / `includeRaw` boundary markers, test sentinels, and spec policy text; tests prove sentinel values do not survive output.
- Persistence/sidecar scan over touched files matched only spec/design policy text; production-only Symbol provider/test scan had no matches.
- Mutation/patch-apply scan over touched files matched only spec/design policy text; production-only Symbol provider/test scan had no matches.
- Authority scan found expected existing runtime authority wording plus new `authority: "none"` diagnostic/test assertions.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended context/runtime files found no new runtime wiring; matches were existing lowercase "grounding/backgrounding" prose in agent prompt/exec text.
- Provider/default-registration scan found only existing registry creation/order constants/tests plus the new Symbol provider `groundingDiagnostics` option; no provider registration or default ordering code changed.
- Symbol Context Provider `contextItems` scan/test proves grounding diagnostics are appended as diagnostics/result metadata only and explicit enabled output keeps `contextItems` and evidence refs equal to baseline.

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
- Symbol grounding diagnostics cannot mutate, rename, apply, or safe-delete symbols.

## Next Phase Decision

This Symbol Context Provider diagnostics expansion is accepted as a minimal, specific runtime diagnostics consumer path.

The next phase may plan a fresh accepted task spec for another specific diagnostics consumer or broader diagnostics-only comparison. It may continue to use `GroundingRef` / `GroundingQuery` only as readonly, local, bounded, default-off, summary-only, diagnostics/metadata-only, non-authoritative material.

The next phase must not add TaskLoop/Gateway/provider-ordering/default provider registration/runtime execution cutover, prompt/model-message cutover, persistence/database/sidecar/exporter/listener/service work, renderer transport changes, memory fact promotion, raw retention, symbol mutation, or patch-apply behavior.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, trace context, diagnostics, Symbol, and context provider references. No updates are required because this change is internal, default-off, diagnostics-only, and not exposed through UI, Gateway routes, settings, user-visible flows, or public docs.

Status: accepted
