# Line C Grounding Shadow Consumers Readiness Synthesis

## Inputs and Gate

Required inputs reviewed:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/tasks/line-c-evidence-trace-grounding-spine.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/implementation-synthesis.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/next-spec-synthesis.md`
- `openclaw_runtime/src/runtime-core/grounding.ts`
- `tests/unit/runtime-grounding-contracts.test.ts`
- `tests/unit/runtime-grounding-ref-projections.test.ts`
- `tests/unit/runtime-grounding-query.test.ts`
- `tests/unit/runtime-grounding-retention-boundary.test.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/runtime-symbol-context-provider.test.ts`
- `tests/unit/runtime-trace-context-provider.test.ts`

Fresh task spec created and accepted before implementation:

- `harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md`

Handoff directory created:

- `runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/`

The new spec context and validate gates passed before runtime code was added.

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec before code | accepted | `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md` passed; `validate` passed. |
| Explicit shadow consumer helpers only | accepted | Added explicit helper functions in `openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts`; no automatic provider registry wiring. |
| Readonly/local/bounded/default-off/summary-only/non-authoritative | accepted | Helper output requires `enabled: true`; otherwise it emits an empty diagnostic summary. Enabled output returns `GroundingSummaryItem[]` only, bounded through `summarizeGroundingRefs()`, with `authority: "none"` and `rawRetained: false`. |
| Runtime Memory / AgentMap / Symbol / Trace Context adapters | accepted | Added `createRuntimeMemoryGroundingShadowSummary()`, `createAgentMapGroundingShadowSummary()`, `createSymbolGroundingShadowSummary()`, and `createRuntimeTraceGroundingShadowSummary()`. |
| No TaskLoop/Gateway/provider-ordering/default registration/runtime cutover | accepted | Touched runtime code is limited to runtime-core helper and barrel export; provider-ordering test confirms default registry remains legacy + loop context only. |
| No persistence/database/sidecar/exporter/listener/service | accepted | Production helper-only scans for service/persistence patterns returned no matches. |
| No raw retention | accepted | Helper uses existing grounding sanitizer/summarizer; tests assert raw metadata sentinels and raw key names do not survive. |
| No memory fact promotion | accepted | Summary metadata includes `noMemoryPromotionAuthority: true`; tests preserve `noDurableFactPromotionFromGrounding` markers. |
| No renderer transport changes | accepted | No renderer/Main/Gateway/host-api/api-client files were touched by this slice. |
| No patch apply/workspace edit/symbol edit/rename/safe delete | accepted | Production helper-only mutation scan returned no matches. |

## Implementation Surface

Created:

- `openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts`
  - `GroundingShadowConsumerSummary`
  - `GroundingShadowConsumerSummaryOptions`
  - `isGroundingShadowConsumerSummary()`
  - `createGroundingShadowConsumerSummary()`
  - explicit Runtime Memory, AgentMap, Symbol, and Trace Context summary wrappers

Updated:

- `openclaw_runtime/src/runtime-core/index.ts`
  - Re-exported `grounding-shadow-consumers.js`.
  - Note: the surrounding runtime-core barrel additions were already present in the dirty worktree; this task only added the final shadow-consumer export.

Created tests:

- `tests/unit/runtime-grounding-shadow-consumers.test.ts`
  - default-off helper behavior
  - bounded summary-only output
  - `includeRaw` normalization and raw metadata rejection
  - untrusted refs excluded by default
  - explicit Runtime Memory / AgentMap / Symbol / Trace adapters
  - provider registry ordering unchanged
  - memory-promotion and source-anchor markers preserved

Created docs/handoff:

- `runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/README.md`
- `runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/implementation-synthesis.md`

README review:

- `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed for user-visible/runtime-flow documentation impact.
- No README updates were made because this task adds internal explicit helper APIs only; it does not change UI behavior, public user flows, Gateway behavior, runtime execution, or documented settings.

## Tests and Scans

Commands were executed through the local RTK binary using absolute executable paths because `rtk` is installed at `C:\Users\27933\.cherrystudio\bin\rtk.exe` but is not on this PowerShell PATH.

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-shadow-consumers.test.ts` | pass, 1 file / 5 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts` | pass, 10 files / 78 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` | existing owner/policy matches only: Electron Main allowlist, preload IPC bridge, Electron Gateway/remote-control WebSocket owner code, project-rule detection text, and i18n rule text. |
| Focused renderer scan over `src/pages src/components` | no matches |
| `GroundingRef|GroundingQuery|grounding` scope scan outside intended runtime-core files | no `GroundingRef` / `GroundingQuery` runtime wiring; matches were existing lowercase prose such as "grounding" and "backgrounding" in agent prompt/exec text. |
| Service/exporter/listener/database scan over touched files | matches only spec/handoff policy text; helper-only production scan had no matches. |
| Raw-retention scan over touched files | matches only test sentinels, expected `includeRaw`/`rawRetained` boundary markers, and spec policy text; tests prove sentinel values do not survive output. |
| Persistence/sidecar scan over touched files | matches spec/handoff policy text and the pre-existing `trace-context-store` barrel export in `runtime-core/index.ts`; helper-only production scan had no matches. |
| Mutation/patch-apply scan over touched files | matches only spec policy text; helper-only production scan had no matches. |
| Authority scan over touched files | expected `authority: "none"` / `GROUNDING_REF_AUTHORITY` markers and tests only. |
| Provider/default-registration scan over touched files and registry tests | expected provider constants and ordering assertions only; no provider registration code was added. |

Comms replay/compare were not run because this task did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## Rejected-Boundary Audit

Rejected boundaries remain intact:

- No TaskLoop, Gateway, runtime execution, model-message, prompt assembly, provider-ordering, default provider registration, renderer transport, or provider transport cutover.
- No completion, blocked/failed status, retry, approval, security, verifier enforcement, provider selection, runtime state, or memory promotion decision uses grounding output.
- No persistence, database, SQLite schema, JSONL sidecar, write path, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service was added.
- No raw prompts, raw chat logs, raw traces, full payloads, full checkpoints, tool args, tool output, stdout, stderr, env, secrets, API keys, authorization headers, traceparent, tracestate, baggage, or unbounded command output are retained.
- No renderer direct IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching was added.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior was added.
- Source and symbol refs remain relevance/evidence anchors only.
- Memory facts cannot be promoted from shadow grounding summaries.

## Next Stage Decision

This readiness layer is accepted as a pre-runtime preparation layer.

The next phase must be a fresh accepted task spec before any runtime wiring. It may plan a carefully bounded, default-off shadow use path only after preserving readonly/local/summary-only/non-authoritative behavior and proving no raw retention.

The next phase must not be TaskLoop/Gateway/provider-ordering/default provider registration/runtime execution cutover, prompt/model-message cutover, persistence/database/sidecar/exporter/listener/service work, renderer transport changes, memory fact promotion, raw retention, or patch-apply behavior.

Status: accepted
