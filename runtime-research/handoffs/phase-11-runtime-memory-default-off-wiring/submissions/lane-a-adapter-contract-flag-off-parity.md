# Lane A: Adapter Contract And Flag-Off Parity

## Decision

Accepted for Lane A only: an isolated default-off Runtime Memory runtime integration adapter was added with focused tests proving disabled parity. The adapter is not imported by TaskLoop, Gateway, Electron Main, renderer, shared host contracts, the default provider registry, verifier, security, retry, tool permission, provider ordering, or runtime authority paths.

## Scope Implemented

- Added `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`.
- Added `tests/unit/runtime-memory-runtime-integration.test.ts`.
- Updated `runtime-research/agent-runtime-index.md` pointers for the new lane-scoped adapter/test.
- Added this Lane A submission.

The adapter exposes explicit `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, and `loadStore` methods. Each method resolves `runtime.memory.persist` before delegating to the Phase 9 persistence owner. When disabled, it returns skipped results locally and `loadStore` returns a new empty `RuntimeMemoryStore` without opening SQLite.

## Prior Phase Boundary Proof

Phase 10 synthesis was accepted only as boundary/readiness. Its decision states that accepted scope is planning and validation evidence for future integration boundaries and explicitly rejects TaskLoop cutover, Gateway cutover, provider ordering cutover, default-on persistence, default provider registration, raw retention, service/exporter/database-service/listener work, memory-derived runtime authority, and implemented runtime read/write wiring.

Phase 9 synthesis was accepted only as a default-off local sanitized persistence foundation. Its decision accepts the standalone `openclaw_runtime.runtime-core.memory-persistence` SQLite proof for sanitized episode/fact/invalidation records and explicitly rejects runtime cutover, default-on memory recording/provider/persistence/extraction/promotion, provider ordering cutover, raw retention, unverified durable facts, service/exporter/database-service/listener work, and memory-derived runtime authority.

## Disabled Parity Evidence

`tests/unit/runtime-memory-runtime-integration.test.ts` injects an `openDatabase` function that increments `openCalls` and throws. With `runtime.memory.persist: false`, the test calls `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, and `loadStore`; all return skipped results, the loaded store is empty, and `openCalls` remains `0`.

The existing Phase 9 persistence owner still has its own disabled proof in `tests/unit/runtime-memory-persistence.test.ts`, so the new adapter proves flag-off parity before the persistence owner is even reached.

## Import And Authority Evidence

The adapter imports only Runtime Memory context types/flag resolution, the Phase 9 persistence owner, and `RuntimeMemoryStore`.

Runtime-authority import scan:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts
```

Result: no matches.

Adapter import scan:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'from .*memory-runtime-integration|memory-runtime-integration\.js' openclaw_runtime/src electron shared src tests/unit
```

Result: the only import is `tests/unit/runtime-memory-runtime-integration.test.ts`.

No TaskLoop, Gateway, Electron, renderer, shared host contract, default provider registry, verifier, security, retry, tool permission, provider ordering, or runtime authority path imports the adapter.

## Raw Retention And Service Evidence

Service/exporter/listener scan over Lane A code/test files:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-runtime-integration.ts tests/unit/runtime-memory-runtime-integration.test.ts
```

Result: no matches.

Retention-risk scan over Lane A code/test files:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-runtime-integration.ts tests/unit/runtime-memory-runtime-integration.test.ts
```

Result: no matches.

The adapter accepts only existing Runtime Memory episode/fact/invalidation record shapes and never inspects TaskLoop payloads, conversation text, prompts, tool args/output, environment data, secrets, trace context, or checkpoint payloads.

Renderer bypass scan:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
```

Result: no matches.

## Validation

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
```

Result: pass; read order loaded.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
```

Result: pass.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
```

Result: pass.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
```

Result: pass.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts
```

Result: pass, 8 files / 43 tests.

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
```

Result: pass.

Comms replay/compare were not run for this lane because the Lane A changes did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, or fallback paths.

README translation updates are not required for this lane because there is no user-visible behavior, UI surface, operator workflow, or host contract change. Runtime research/index documentation was updated instead.

Status: accepted
