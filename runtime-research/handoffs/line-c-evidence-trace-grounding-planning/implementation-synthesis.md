# Line C Grounding Spine Implementation Synthesis

## Inputs and Gate

Read before validation:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/tasks/line-c-evidence-trace-grounding-spine.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/next-spec-synthesis.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-a-contracts.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-b-evidence-projections.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-c-trace-query.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-d-consumer-projections.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-e-retention-boundary.md`

A-E submissions were present and accepted before Lane F validation began. `rtk` is required by local RTK policy but is not available on this PowerShell PATH, so validation used the direct `node` / `rg` commands requested by the task.

## A-E Lane Decision Table

| Lane | Submitted decision | Lane F decision | Notes |
| --- | --- | --- | --- |
| A: contracts | accepted | accepted | Contract surface is readonly and fixed to `authority: "none"`. The revision hardened shared metadata sanitization so exported sanitizers cannot retain raw/secret-like metadata. |
| B: evidence projections | accepted | accepted | EvidenceRef projections remain derived-only. Projection-options metadata now passes through the hardened metadata sanitizer before it reaches emitted refs or summaries. |
| C: trace query | accepted | accepted | Query helpers remain local, readonly, bounded by limit/page/token budget, and default to excluding untrusted refs. |
| D: consumer projections | accepted | accepted | Runtime Memory, AgentMap, and Symbol projections remain explicit helper projections only; no provider registration, ordering, memory promotion, or runtime cutover was added. |
| E: retention boundary | accepted | accepted | Retention coverage now includes generic ref/query/result metadata and projection-options metadata, including nested raw/secret/tool/env/trace-context fields. |

Overall decision: accepted.

## Implementation Surface Summary

Implemented Line C surface:

- `openclaw_runtime/src/runtime-core/grounding.ts`
  - Grounding contracts: `GroundingRef`, `GroundingRefTrust`, `GroundingRefAuthority`, `GroundingQuery`, `GroundingResult`, summary items, bounds, guards, fixtures, and sanitizers.
  - Derived projections from EvidenceRef, projected file/test refs, RuntimeTaskEvent, event-log records, checkpoint records/diagnostics, EvidenceVerifier reports/findings.
  - Trace/source projection and readonly query helpers: `groundingRefsFromRuntimeTraceSpan()`, `groundingRefsFromRuntimeTraceSourceRefs()`, `findGroundingRefs()`, `summarizeGroundingRefs()`, `groundingQueryFromRuntimeTraceQuery()`, `groundingQueryFromEventLogSearchQuery()`, `rankGroundingRefs()`.
  - Consumer projections from Runtime Memory, AgentMap, and Symbol surfaces.
  - Metadata retention hardening through grounding-only raw metadata key/text rejection before metadata is emitted on refs, queries, results, or summary items.
- `openclaw_runtime/src/runtime-core/index.ts`
  - Re-exports the grounding helpers.
- Tests:
  - `tests/unit/runtime-grounding-contracts.test.ts`
  - `tests/unit/runtime-grounding-ref-projections.test.ts`
  - `tests/unit/runtime-grounding-query.test.ts`
  - `tests/unit/runtime-grounding-retention-boundary.test.ts`

No Line C implementation evidence showed TaskLoop, Gateway, provider ordering, renderer transport, persistence/database, service/listener/exporter, or patch-apply cutover.

## Revision Fix

Fixed the previous Lane F finding by hardening `sanitizeGroundingMetadata()` in `openclaw_runtime/src/runtime-core/grounding.ts`.

- Raw/secret-like metadata keys are dropped recursively before output.
- Raw/secret-like string values are dropped recursively before output.
- Safe metadata remains available for diagnostics, counts, summaries, and ranking explanation.
- The filtering is grounding-specific so safe count fields such as event/checkpoint evidence counts are not treated as full payload retention.
- `rawRetained` and `includeRaw` contract fields remain allowed because they are the explicit false/off boundary markers, not retained raw data.

Added retention coverage in `tests/unit/runtime-grounding-retention-boundary.test.ts` proving raw metadata is removed from:

- generic `GroundingRef.metadata`
- `GroundingQuery.metadata`
- `GroundingResult.metadata`
- projection-options metadata accepted by `groundingRefFromEvidenceRef(...)`
- nested arrays/objects containing raw chat, raw trace, full payload/checkpoint, tool args/output, stdout/stderr, env, API keys, authorization, traceparent, tracestate, and baggage markers

## Tests and Scans

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 4 files / 41 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-verification-auto-sampling.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts` | pass, 29 files / 230 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy references only: Electron Main allowlist, Electron gateway/remote-control WebSocket owner code, preload IPC bridge code, project-rule detection text, and i18n policy strings.
- Focused renderer `src/pages src/components` scan returned no matches.
- Service/exporter/listener/database scan over Line C implementation/tests matched only the retention-boundary test assertion text that checks forbidden exports. Production-only grounding scan had no service/listener/exporter/database matches.
- Raw-retention scan matched expected `includeRaw` / `rawRetained` contract fields, the grounding raw-metadata rejection classifier, and tests that prove raw sentinel values/key names do not survive emitted refs/queries/results/projections.
- Persistence/sidecar scan matched only the retention-boundary forbidden-export assertion and an existing `trace-context-store` barrel export name; no Line C persistence, database, sidecar, write, or cache behavior was introduced.
- Mutation/patch-apply scan matched only the retention-boundary forbidden-export assertion; production-only grounding scan had no mutation/apply matches.
- Authority scan found expected fixed `authority: "none"` contract/test references.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended files found no `GroundingRef` / `GroundingQuery` runtime wiring. Matches were existing lowercase "grounding/backgrounding" prose in agent prompt/exec text.
- `groundingSpine` / runtime flag scan found no config/default runtime wiring.
- Completion/provider-ordering/TaskLoop/Gateway targeted scan over Line C code/tests found only test source labels and event retry metadata copied as summary metadata; no decision gate, provider ordering, or runtime cutover was introduced.
- Comms replay/compare were not run because Line C grounding files did not touch Main/Gateway/host-api/api-client/provider transport paths.

## Rejected-Boundary Audit

Rejected boundaries are intact:

- No completion gate, verifier enforcement gate, active pilot gate, terminal status cutover, retry/approval/security policy, provider-ordering change, or runtime authority was added.
- No TaskLoop, Gateway, runtime execution, model-message, prompt assembly, context-provider default registration, renderer transport, provider transport, or fallback-policy cutover was added.
- No renderer direct page/component IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching was added by Line C.
- No service, daemon, listener, HTTP server, WebSocket server, Temporal worker, OpenTelemetry collector, OTLP exporter, telemetry upload, second Gateway/runtime process, or external service was added.
- No grounding persistence, database, SQLite schema, sidecar, JSON/JSONL/TXT runtime state file, cache, store, exporter, package dependency, or migration surface was added.
- No raw prompts, raw chat logs, raw trace dumps, full traces, full payloads/checkpoints, full tool args/output, stdout/stderr, complete env, credentials, secrets, API keys, auth headers, traceparent/tracestate/baggage values, or unbounded command output are retained in emitted grounding refs/results.
- No mutation of EvidenceRef, TaskLoopEvidenceRef, RuntimeTraceSpan, RuntimeTaskEvent, checkpoint, memory, AgentMap, or Symbol producer contracts was found in Line C.
- No durable memory fact promotion from grounding records was added.
- No source refs, symbol refs, renderer refs, external trace context, subagent prose, model summaries, patch refs, or memory refs became authoritative runtime truth.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior was added.

## Next Stage Decision

Line C is allowed to proceed to the next pre-runtime planning stage.

The next stage must be a fresh accepted task spec for explicit shadow consumer use of GroundingRef/GroundingQuery, still readonly, local, bounded, default-off, summary-only, and non-authoritative.

The next stage must not be TaskLoop/Gateway/provider-ordering/runtime cutover, prompt/model-message cutover, default provider registration, persistence/database/sidecar, exporter/listener/service, raw retention, memory fact promotion, renderer transport changes, or patch-planner apply behavior.

Status: accepted
