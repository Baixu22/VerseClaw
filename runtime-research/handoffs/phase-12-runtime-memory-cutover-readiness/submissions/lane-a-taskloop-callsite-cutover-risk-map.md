# Phase 12 Lane A Submission: TaskLoop Import And Call-Site Cutover Risk Map

## Scope Confirmation

- Lane: `lane-a-taskloop-callsite-cutover-risk-map`
- Output file: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-a-taskloop-callsite-cutover-risk-map.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md`; Phase 12 `README.md`, `parallel-lanes.md`, and `submission-template.md`; Phase 11/10/9 task specs and syntheses; `runtime-research/agent-runtime-index.md`; harness context scenario/rules/guides/layers; focused Runtime Memory source/tests listed below.
- Files changed: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-a-taskloop-callsite-cutover-risk-map.md`
- Runtime behavior changed: no
- TaskLoop/Gateway/runtime call-site import changed: no
- Provider registration/order changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane A is accepted as a planning-only TaskLoop/Gateway/runtime call-site cutover risk map. It accepts no runtime import, no adapter invocation, no provider ordering change, no default-on persistence, and no memory-derived runtime authority.

Phase 12 did not import or invoke `createRuntimeMemoryRuntimeIntegration`, `RuntimeMemoryRuntimeIntegration`, `createRuntimeMemoryPersistenceStore`, `memory-persistence`, or `RUNTIME_MEMORY_PERSISTENCE_OWNER` from TaskLoop, Gateway, Electron Main, renderer, shared host contracts, default provider registry, verifier, security, retry, tool policy, or runtime execution paths. A future cutover must still provide the disabled parity, rollback, no-authority, error-mapping, retry, lifecycle, raw-retention, and comms evidence mapped here before any runtime call-site import can be accepted.

## Phase Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 11 synthesis exists | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md` was read. | pass |
| Phase 11 synthesis ends exactly with accepted marker | `rtk.exe node.exe -e "const last=raw.trimEnd().split(/\r?\n/).at(-1); ..."` returned `final-content-line: "Status: accepted"` and `final-content-line-exact: true`; the file also has a normal trailing newline. | pass |
| Phase 11 accepted only isolated default-off adapter wiring | Phase 11 synthesis decision accepts `memory-runtime-integration.ts`, disabled parity, sanitized adapter read/write proof, explicit extra-provider hydration proof, and config wording cleanup only. | pass |
| Phase 11 rejected TaskLoop/Gateway/provider-ordering/default-on/raw-retention/runtime-authority cutover | Phase 11 synthesis rejected TaskLoop/Gateway/runtime execution/provider ordering/default registration/default-on/raw retention/service/listener/runtime authority claims. | pass |
| Phase 10 accepted only default-off integration boundary/readiness | Phase 10 synthesis decision accepts boundary/readiness evidence only and rejects runtime read/write wiring. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | Phase 9 synthesis decision accepts standalone local sanitized SQLite persistence foundation only. | pass |

## Files Reviewed

Focused source:

- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/config/types.openclaw.ts`
- `openclaw_runtime/src/config/schema.help.ts`
- `openclaw_runtime/src/config/schema.labels.ts`
- `openclaw_runtime/src/config/zod-schema.ts`
- `openclaw_runtime/src/agents/task-loop-controller.ts`

Focused tests:

- `tests/unit/runtime-memory-context-contracts.test.ts`
- `tests/unit/runtime-memory-store.test.ts`
- `tests/unit/runtime-memory-proposal-shadow.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/runtime-memory-persistence.test.ts`
- `tests/unit/runtime-memory-runtime-integration.test.ts`
- `tests/unit/runtime-feature-config-schema.test.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/task-loop-controller.test.ts`

## Current Risky Surfaces

| Surface | Current Entry Points Reviewed | Why A Future Import Is Risky | Lane A Requirement |
|---|---|---|---|
| TaskLoop runtime execution | `openclaw_runtime/src/agents/task-loop-controller.ts` imports lines 1-35; runtime flags/evidence collection/checkpoint/trace flow lines 2470-2765; `tests/unit/task-loop-controller.test.ts` lines 1941-1998 | A memory adapter call here could alter completion, blocked/error mapping, repair/retry, evidence verifier shadow, checkpoint, trace, or return payload behavior. | No import in Phase 12; future import requires disabled parity, lifecycle parity, error mapping parity, retry parity, checkpoint/resume/event-log parity, and rollback proof. |
| Gateway `tools.invoke` and tool policy | `openclaw_runtime/src/gateway/server-methods/tools-invoke.ts` lines 37-66; `openclaw_runtime/src/gateway/tools-invoke-shared.ts` matches around permission context, approval mode, retryable metadata, and hook results | Memory reads/writes could change protocol-shaped success/error/approval payloads, tool permission decisions, or retryable flags. | Future work must prove identical `tools.invoke` payload shape and approval behavior when flags are false, with comms replay/compare if touched. |
| Gateway security/verifier methods | `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts` lines matching `security.policy.*` and `verification.run`; `openclaw_runtime/src/security-verification-shadow/index.ts` matches for decisions, findings, permission context, and retryable errors | Memory-derived facts could become verifier/security authority or change policy simulation outcomes. | Future work must prove memory is not a verifier/security/tool/retry authority and that durable facts have accepted promotion evidence before any advisory use. |
| Gateway method registry/descriptors | `openclaw_runtime/src/gateway/server-methods.ts`; `openclaw_runtime/src/gateway/methods/core-descriptors.ts`; `openclaw_runtime/src/gateway/server-methods/tools-effective.ts` were included in authority scans | New memory methods or descriptor changes could expose persistence or make runtime behavior user-visible. | Future work must add gateway method/descriptor tests, docs, and comms proof; Phase 12 adds no method. |
| Electron Main Gateway bridge | `electron/main/index.ts` lines 1082-1152 gateway event bridge; `electron/main/ipc-handlers.ts` lines 698-715 legacy gateway RPC; `electron/services/gateway-api.ts` lines 318-416 typed gateway service | Main owns Gateway transport and fallback. Memory call-site imports here could introduce transport drift, backpressure changes, or new renderer-visible behavior. | Future work must go through typed host services, preserve backpressure/error behavior, and run comms replay/compare. |
| Renderer host facade | `src/lib/host-api.ts` lines 380-977; `src/lib/host-api-client.ts`; `src/lib` file inventory showed no `src/lib/api-client.ts` in this checkout | Renderer direct memory access would bypass Main-owned Gateway transport and policy. | Future renderer access must be typed host-api/api-client only; no direct IPC, direct Gateway HTTP, or direct WebSocket. |
| Shared host contracts/events | `shared/host-api/contract.ts` gateway contract lines around 2519-2526; permissions lines around 2508-2510; `shared/host-events/contract.ts` | Contract changes can make memory persistence or runtime facts a supported UI/API surface. | Future contract changes require typed payload tests, docs sync, renderer boundary scan, and comms proof. |
| Provider registry/runtime context | `openclaw_runtime/src/context-engine/provider-registry.ts` lines 375-382; `openclaw_runtime/src/context-engine/memory-context-provider.ts` lines 48-84 | Default registration or order changes could alter prompt/context bytes and make memory authoritative. | Lane B owns provider-order proof; Lane A rejects using TaskLoop/runtime call-site imports as provider cutover. |
| Runtime core barrel | `openclaw_runtime/src/runtime-core/index.ts` included in import scan | Exporting adapter/persistence from a broad barrel could make accidental authority imports easier. | Future exports must be intentional, scanned, and accepted by a cutover synthesis; Phase 12 adds none. |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Adapter is currently isolated behind `runtime.memory.persist` | file/test | `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | `createRuntimeMemoryRuntimeIntegration()` lines 37-40; constructor lines 48-52; methods lines 55-101; disabled test lines 38-69 | Future imports must prove no SQLite open/read/write when disabled. |
| Persistence owner is default-off and opens SQLite only after the flag gate | file/test | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | owner lines 42-44; constructor/open handle lines 321-325; gates lines 342-413; disabled test lines 31-61 | `runtime.memory.persist=false` must remain a no-open/no-read/no-write path. |
| Sanitized persistence only, with recursive raw rejection | file/test/scan | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; raw scan over focused memory source/tests | sanitizer lines 813-862 | Raw scan matches were sanitizer denylist/redaction logic and negative fixtures, not accepted retention. |
| Durable facts require promotion evidence | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `tests/unit/runtime-memory-context-contracts.test.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | fact gate lines 570-584; contract test lines 154-236; adapter candidate test lines 197-251 | Verified-looking candidates remain candidates without `acceptedAt` or promotion. |
| Current-valid queries exclude invalidated, expired, rejected, candidate, and unpromoted facts by default | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; focused tests | validity lines 900-929; verification lines 1176-1195; store shape filter lines 493-514; store tests lines 294-440 | Future runtime context must preserve these exclusions unless explicit query options are intentionally accepted. |
| Provider remains readonly, explicit, and non-authoritative | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | manifest lines 48-84; flag-disabled metadata lines 96-114; persist-only test lines 339-373 | `runtime.memory.persist` does not enable provider output. |
| Default provider order excludes memory | file/test | `openclaw_runtime/src/context-engine/provider-registry.ts`; `tests/unit/context-provider-registry.test.ts` | registry lines 375-382; test lines 54-73 | Default order remains legacy context engine, loop context pack, then explicit extras. |
| TaskLoop currently has no Runtime Memory adapter import | file/scan | `openclaw_runtime/src/agents/task-loop-controller.ts`; runtime authority import scan | imports lines 1-35; scan returned no matches over TaskLoop/Gateway/Electron/shared/renderer/default-registry paths | Future Lane A cutover must add a fresh accepted spec before changing this. |
| TaskLoop behavior stays unchanged with memory persistence disabled | test | `tests/unit/task-loop-controller.test.ts` | lines 1941-1998 | Existing test proves task-loop tool and verifier behavior unchanged under `runtime.memory.persist=false`. |
| Runtime memory flags remain default-off | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/config/types.openclaw.ts`; `openclaw_runtime/src/config/schema.help.ts`; `tests/unit/runtime-feature-config-schema.test.ts` | defaults lines 129-134; config type lines 151-160; help lines 2003-2012; schema test lines 55-69 | No default-on persistence or runtime authority accepted. |

## Future TaskLoop/Runtime Call-Site Risk Map

| Future Surface | Risk If Cut Over | Required Evidence Before Acceptance |
|---|---|---|
| `openclaw_runtime/src/agents/task-loop-controller.ts` imports/invokes adapter | Memory write/read failures could change TaskLoop phase, completion, retry, checkpoint, evidence verifier, or return payload behavior. | Fresh cutover spec/synthesis; `persist=false` parity with throwing opener; exact before/after TaskLoop result payloads; completion/error/blocked/retry parity; checkpoint/resume/event-log parity; no verifier/security/tool/retry authority; rollback by disabling flags and omitting import. |
| TaskLoop runtime event/checkpoint hooks write memory episodes | Duplicate or misordered writes could corrupt run chronology or add side effects to shadow paths. | Idempotency proof keyed by stable run/session/event ids; no writes on disabled flags; bounded sanitized episode fields only; no raw payload/checkpoint/tool args/output retention; event-log/checkpoint tests proving legacy output unchanged. |
| Gateway server methods import adapter or persistence owner | Gateway RPC behavior could gain latency, persistence side effects, or error mapping drift. | Gateway method tests for disabled parity, timeout/error mapping, no new exposed payload fields, no transport behavior changes, and comms replay/compare. |
| Electron Main, host-api, api-client, shared host contracts add memory routes | Renderer/Main boundary or typed transport policy could be bypassed or widened. | Host-api/api-client facade tests, no renderer direct IPC/Gateway HTTP/WS, schema/contract docs, and comms replay/compare for any transport path touched. |
| Renderer page/component reads runtime memory directly | Renderer could bypass Main-owned transport and runtime policy. | Rejection unless exposed through typed host-api/api-client; renderer boundary scan must stay clean. |
| Security, retry, approval, or tool policy consumes memory | Memory could become runtime authority or permission source. | Rejection unless a later security/tool policy spec explicitly accepts authority; proof must show memory remains advisory or readonly and cannot grant tools, bypass approvals, retry, or alter security decisions. |
| Evidence verifier consumes memory-derived durable facts | Candidate/LLM output could become verifier authority. | Source episode refs, evidence refs, accepted verification status, finite `acceptedAt`, and verifier/human/deterministic-rule promotion evidence; no candidates/rejected/invalidated/expired/unpromoted facts in current-valid defaults. |
| Runtime execution paths hydrate provider context from persisted store | Provider ordering or prompt bytes could change. | Lane B provider-order proof; explicit extra-provider injection only unless accepted later; prompt byte/order diff tests; `runtime.memory.persist` must not enable provider output. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Planning/spec only | This file only; no runtime source edit by this lane. | pass | none |
| No TaskLoop/Gateway/runtime call-site import | `rtk.exe rg -n "memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts` | pass | command returned no matches |
| No provider registration/order cutover | `provider-registry.ts` lines 375-382; `context-provider-registry.test.ts` lines 54-73 | pass | Lane B owns future provider-order map. |
| Flag-off parity plan | Adapter/persistence disabled tests and future map above. | pass | Future cutover must add call-site-specific parity tests. |
| No SQLite open/read/write when disabled plan | Adapter test lines 38-69; persistence test lines 31-61. | pass | Future cutover must prove this from every new call site. |
| Adapter isolation from TaskLoop/Gateway/Electron/renderer/shared/default registry | Runtime authority import scan above. | pass | none |
| Persistence read boundary | `memory-runtime-integration.ts` lines 89-97; `memory-persistence.ts` lines 409-427; adapter hydration test lines 257-292. | pass | Future cutover must not expose raw SQLite rows. |
| Persistence write boundary | `memory-persistence.ts` lines 358-405 and 813-862. | pass | Future cutover must write only accepted Runtime Memory shapes. |
| Store owner and schema preserved | `memory-persistence.ts` lines 42-44; persistence test lines 67-86. | pass | none |
| Migration and idempotency preserved | persistence test lines 67-86 and 185-245. | pass | none |
| Retention and redaction preserved | store tests lines 126-177 and persistence test lines 227-245. | pass | future call sites need equivalent assertions. |
| Raw chat/raw trace rejection | `runtime-memory-context-contracts.test.ts` lines 239-305. | pass | raw scan matches reviewed as rejection/negative fixtures. |
| No raw retention | persistence sanitizer lines 813-862; persistence test lines 227-245. | pass | none |
| No service/exporter/database-service/listener | `rtk.exe rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(|database-service|listener|exporter|service" <focused memory source/tests>` | pass | command returned no matches |
| Provider ordering unchanged | `provider-registry.ts` lines 375-382. | pass | Lane B must own future provider order acceptance. |
| Source episode/evidence refs | `runtime-memory-context-contracts.test.ts` lines 154-236. | pass | Future durable authority must keep both refs mandatory. |
| Durable promotion gate | `memory-context.ts` lines 570-584; adapter candidate test lines 197-251. | pass | none |
| Current-valid query exclusion | `memory-context.ts` lines 900-929 and 1176-1195; store tests lines 294-440. | pass | none |
| Rollback proof plan | Future map requires disable flags, omit imports, omit provider registration, preserve Phase 9 rows. | pass | Lane D owns operator/docs/config proof. |
| Config help/docs sync plan | `schema.help.ts` lines 2003-2012; docs-sync rule read. | pass | Future behavior changes must review README translations. |
| Comms replay/compare requirement | comms-regression rule read; future map requires replay/compare for Main/Gateway/host-api/api-client/provider transport changes. | not-applicable | This lane changed only a handoff submission. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps all Runtime Memory flags false at `memory-context.ts` lines 129-134; config schema test lines 55-69 proves empty config does not become true. |
| No TaskLoop/Gateway/runtime cutover | pass | Runtime authority import scan returned no matches; TaskLoop source has no memory adapter import. |
| No raw chat-log/raw trace memory | pass | Raw-retention scan matches were sanitizer denylist/redaction code or negative fixtures; persistence tests assert raw prompt/stdout absent from DB JSON. |
| No unverified durable facts | pass | Durable fact gate requires accepted status, finite `acceptedAt`, and promotion evidence; candidates stay non-durable. |
| No provider-ordering cutover | pass | Default registry is legacy provider, loop provider, then explicit extras. |
| No runtime authority | pass | Memory provider manifest declares readonly/no completion/verifier/security/retry/tool/runtime authority. |
| No service/exporter/database-service/listener | pass | Focused service/exporter/listener scan returned no matches. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk.exe node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass | Required Phase 12 context/read order | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass | Phase 12 spec validity | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 spec validity | Exact synthesis status checked separately. |
| `rtk.exe node.exe -e "const last=raw.trimEnd().split(/\r?\n/).at(-1); console.log(last === 'Status: accepted')"` | pass | Phase 11 accepted final content line | File has a normal trailing newline. |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 spec validity | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 spec validity | none |
| `rtk.exe node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 9 files / 99 tests | Focused Runtime Memory + TaskLoop parity | none |
| `rtk.exe node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | no diagnostics |
| Renderer boundary scan over `src/pages src/components` | pass | No renderer direct IPC/Gateway HTTP/WebSocket bypass | command returned no matches |
| Runtime authority import scan over TaskLoop/Gateway/Electron/shared/renderer/default registry paths | pass | No adapter/persistence-owner import from authority paths | command returned no matches |
| Raw-retention scan over focused memory source/tests | pass/reviewed | No accepted raw retention | matches are rejection patterns, redaction code, or negative fixtures/assertions |
| Service/exporter/database-service/listener scan over focused memory source/tests | pass | No service/exporter/listener additions | command returned no matches |
| Persistence surface scan | pass/reviewed | Intended Phase 9/11 persistence owner and tests only | broad repository matches include unrelated transcript features; no Lane A cutover |
| Comms replay/compare | not run | Future comms requirement mapped | This lane changed no Main/Gateway/host-api/api-client/provider transport paths. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Phase 11 synthesis has a normal trailing newline after the accepted marker. | Final non-empty content line check returned exactly `Status: accepted`; raw file also has trailing LF. | Treat as pass for the Phase 12 entry marker because the final content line is exact. |
| Phase 11 adapter exists, but Phase 12 must not treat it as runtime authority. | Phase 11 synthesis accepts only isolated default-off adapter wiring; import scans show no runtime authority paths import it. | Future cutover must start from a fresh spec and synthesize disabled parity, rollback, no-authority, and comms proof before any call-site import. |
| `runtime.memory.persist` exists and can enable isolated persistence, but must not enable provider output or TaskLoop/Gateway behavior. | Provider test lines 339-373 proves persist-only keeps provider disabled; TaskLoop test lines 1941-1998 proves disabled persistence leaves task-loop/verifier behavior unchanged. | Any future behavior must use a separately accepted rollout path and cannot reuse `persist` as runtime authority. |

## Lane Decision

Lane A maps the future TaskLoop/Gateway/runtime call-site cutover risks and the proof required before any import can be accepted. Phase 12 adds no runtime import or call site, and no runtime cutover is accepted by this submission.

Status: accepted
