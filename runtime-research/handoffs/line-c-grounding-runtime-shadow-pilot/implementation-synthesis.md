# Line C Grounding Runtime Shadow Pilot Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec before implementation | accepted | `harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md` created; context and validate passed before runtime edits. |
| Explicit runtime shadow diagnostic pilot only | accepted | Added optional `groundingShadow` parameter to `runContextProviderRegistryPilot()`; absent or disabled options produce no grounding output. |
| Diagnostics/metadata-only output | accepted | Enabled path appends one `RuntimeRegistryDiagnostic` and optional `groundingShadowSummary`; it adds no `ContextItem`s and no provider result. |
| `authority: "none"` and `rawRetained: false` | accepted | Diagnostic metadata copies accepted summary helper boundary markers and tests assert fixed authority/raw-retention values. |
| Helper default-off, readonly, local, bounded, summary-only, non-authoritative | accepted | Reuses `createGroundingShadowConsumerSummary()` with `enabled: true` only from explicit runtime pilot options; tests cover limit/tokenBudget and non-authority markers. |
| No TaskLoop/Gateway/provider-ordering/default registration/runtime decision cutover | accepted | Touched runtime code is limited to Context Provider Registry pilot diagnostics; registry ordering tests remain stable. |
| No persistence/database/sidecar/exporter/listener/service/raw retention/patch apply | accepted | Production-only scans over `provider-registry.ts` found no service, persistence, or mutation patterns; raw scan matched only `rawRetained` and `includeRaw: false` boundary markers. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Insertion point | accepted: Context Provider Registry pilot diagnostics | Existing path is explicit and shadow-only, with diagnostics already separated from prompt/runtime authority. |
| Trace Context Provider direct diagnostics | rejected for first pilot | Useful later, but too trace-specific and requires provider flag interaction. |
| TaskLoop/Gateway/provider ordering/prompt assembly/memory promotion/renderer transport | rejected | These are authoritative or transport/user-visible boundaries and remain out of scope. |
| Data flow | accepted | Producer refs -> explicit `groundingShadow` option -> shadow helper -> registry diagnostic metadata. |
| Implementation entry | accepted | `Design Status: accepted` in `design-research.md` before code changes. |

## Implementation Surface Summary

Updated:

- `openclaw_runtime/src/context-engine/provider-registry.ts`
  - Added `CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID`.
  - Added `ContextProviderRegistryGroundingShadowPilotOptions`.
  - Added optional `groundingShadow` input to `runContextProviderRegistryPilot()`.
  - Added optional `groundingShadowSummary` output for explicit diagnostic inspection.
  - Added JSON-safe diagnostic metadata mapping for bounded grounding summary items.

- `tests/unit/context-provider-registry.test.ts`
  - Added default-off/disabled behavior coverage.
  - Added explicit enabled diagnostics-only coverage for token budget, untrusted exclusion, raw sentinel rejection, no context items, no provider results, no provider ordering changes, and no memory-promotion authority.

Created:

- `harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md`
- `runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/design-research.md`
- `runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/implementation-synthesis.md`

## Tests And Scans

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts` | pass, 10 files / 80 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Renderer broad IPC/Gateway/WebSocket scan over `src/pages src/components electron shared` | existing owner/policy matches only: Electron Gateway WebSocket owner code, preload IPC bridge, Electron Main allowlist, project-rule detection text, and i18n policy strings. |
| Focused renderer scan over `src/pages src/components` | no matches |
| Service/exporter/listener/database scan over touched files | matches only spec/design policy text; production-only `provider-registry.ts` scan had no matches. |
| Raw-retention scan over touched files | matches test sentinels, spec/design policy text, and expected `rawRetained` / `includeRaw: false` boundary markers; tests prove sentinels do not survive output. |
| Persistence/sidecar scan over touched files | matches spec/design policy text and one pre-existing provider-ordering test name mentioning memory persistence disabled; production-only `provider-registry.ts` scan had no matches. |
| Mutation/patch-apply scan over touched files | matches only spec policy text; production-only `provider-registry.ts` scan had no matches. |
| Authority scan over touched files | expected fixed `authority: "none"` assertions and diagnostic metadata mapping. |
| `GroundingRef|GroundingQuery|grounding` scope scan outside intended files | no new `GroundingRef` / `GroundingQuery` runtime wiring; matches were existing lowercase "grounding/backgrounding" prose in agent prompt/exec text. |
| Provider/default registration scan | expected `createContextProviderRegistryPilot()` and legacy/loop constants only; tests assert default provider ordering remains `[legacy-context-engine, loop-context-pack]`. |

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
- Memory facts cannot be promoted from grounding shadow output.

## Next Phase Decision

This runtime shadow pilot is accepted as a minimal diagnostic-only runtime call path.

The next phase may plan a fresh accepted task spec for broader explicit runtime diagnostics or a specific Trace Context Provider diagnostic path. It must preserve readonly, local, bounded, default-off, summary-only, non-authoritative behavior and prove no raw retention.

The next phase must not add TaskLoop/Gateway/provider-ordering/default provider registration/runtime execution cutover, prompt/model-message cutover, persistence/database/sidecar/exporter/listener/service work, renderer transport changes, memory fact promotion, raw retention, or patch-apply behavior.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed. No updates are required because this change is internal, default-off, diagnostics-only, and not exposed through UI, Gateway routes, settings, user-visible flows, or public docs.

Status: accepted
