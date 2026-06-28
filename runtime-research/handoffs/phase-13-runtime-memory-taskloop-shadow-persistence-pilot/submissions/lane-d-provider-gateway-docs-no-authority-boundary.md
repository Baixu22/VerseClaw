# Lane D: Provider, Gateway, Docs, And No-Authority Boundary

## Decision

Accepted.

Phase 13 Lane D proves the TaskLoop shadow persistence pilot adds no Gateway,
Electron Main, renderer, shared host contract, provider default registration,
provider ordering change, or memory-derived runtime authority. No config or
README docs edits are needed for this lane because existing operator-visible
runtime memory help already states the default-off, no-provider-output,
no-cutover, no-authority boundaries.

## Files Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/README.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/parallel-lanes.md`
- `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/config/types.openclaw.ts`
- `openclaw_runtime/src/config/schema.help.ts`
- `openclaw_runtime/src/config/zod-schema.ts`
- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/runtime-feature-config-schema.test.ts`
- `tests/unit/task-loop-controller.test.ts`

## Files Changed

- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-d-provider-gateway-docs-no-authority-boundary.md`

No production, config, schema, locale, README, Gateway, Electron, renderer, or
shared host-contract files were changed.

## Prerequisite Boundary Proof

| Phase | Result | Evidence |
|---|---|---|
| Phase 12 | accepted, planning/spec/evidence only | `phase-12.../synthesis.md` ends `Status: accepted` and explicitly rejects TaskLoop, Gateway, provider ordering, default registration, raw retention, service/listener/exporter, and memory-derived runtime authority cutover. |
| Phase 11 | accepted, isolated default-off adapter only | `phase-11.../synthesis.md` accepts `memory-runtime-integration.ts` and explicit extra-provider hydration proof only; it rejects TaskLoop/Gateway/runtime/provider-ordering/default-provider cutover. |
| Phase 10 | accepted, default-off integration boundary/readiness only | `phase-10.../synthesis.md` rejects implemented runtime read/write wiring, Gateway cutover, provider ordering cutover, default registration, and runtime authority. |
| Phase 9 | accepted, default-off local sanitized persistence foundation only | `phase-9.../synthesis.md` accepts the standalone local persistence owner and rejects runtime cutover, default-on behavior, provider ordering cutover, raw retention, services/listeners/exporters, and runtime authority. |

## Provider Order And Registration

Provider order is unchanged: legacy provider, loop provider, then explicit
extras.

- `openclaw_runtime/src/context-engine/provider-registry.ts:375` constructs
  `RuntimeContextProviderRegistry([createLegacyContextEngineProvider(),
  createLoopContextPackProvider(), ...extraProviders])`.
- `tests/unit/context-provider-registry.test.ts:215` proves enabling registry
  flags with `runtime.memory.persist=false` and `provider=false` keeps manifests
  `[legacy-context-engine, loop-context-pack]`, does not resolve
  `runtime-memory`, and returns provider results in the same order.
- `tests/unit/runtime-memory-context-provider.test.ts:32` proves the memory
  provider appears only when explicitly passed as an extra provider, after legacy
  and loop.

No default Runtime Memory provider registration was found. The focused scan:

```text
rg -n "createRuntimeMemoryContextProvider|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|runtime-memory|memory context provider|context\\.memory" openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/gateway electron shared src src/lib tests/unit/context-provider-registry.test.ts
```

returned only the registry test import/assertion that `runtime-memory` is absent
from the default registry.

## Runtime Memory Provider Flag Separation

`runtime.memory.provider` remains separate and default false.

- `openclaw_runtime/src/context-engine/memory-context-provider.ts:65` sets
  `enabledByDefault: false`.
- `openclaw_runtime/src/context-engine/memory-context-provider.ts:66` keeps
  `shadowOnly: true`.
- `openclaw_runtime/src/context-engine/memory-context-provider.ts:91` resolves
  memory flags and `:94` returns fallback/empty output when `flags.provider` is
  false.
- `openclaw_runtime/src/config/types.openclaw.ts:151` defines runtime memory
  flags as default-off; `:155` is the readonly provider gate and `:160` is the
  separate persistence gate.
- `openclaw_runtime/src/config/zod-schema.ts:123` through `:130` keeps
  `shadow`, `provider`, `proposeFacts`, and `persist` as optional strict
  booleans with no synthesized true default.
- `tests/unit/runtime-feature-config-schema.test.ts:53` proves omitted runtime
  memory flags do not become true.
- `tests/unit/runtime-memory-context-provider.test.ts:66` proves the provider
  returns only a skipped diagnostic and no context items when
  `runtime.memory.provider` is disabled.

`runtime.memory.persist` does not enable provider output. The provider checks
only `runtime.memory.provider`, and the registry test at
`tests/unit/context-provider-registry.test.ts:215` keeps provider order and
provider output unchanged with persistence disabled/provider disabled. There is
no code path that maps `persist` or `shadow` to provider registration.

## TaskLoop Pilot Boundary

The intended Phase 13 TaskLoop pilot remains dual-flag and non-authoritative.

- `openclaw_runtime/src/agents/task-loop-controller.ts:1814` requires
  `flags.shadow === true && flags.persist === true`.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1824` returns before any
  writer is created when either flag is not explicitly true.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1833` catches write
  failures; the comment at `:1834` states shadow persistence failures must not
  perturb TaskLoop results.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1908` through `:1918`
  stamps persisted episode metadata as `shadowOnly`, `legacyDecisionUnaffected`,
  `noProviderHydration`, `noFactExtraction`, and no completion/verifier/security
  retry/tool/runtime authority.
- `tests/unit/task-loop-controller.test.ts:661` proves omitted flags,
  `shadow=false`, `persist=false`, and `persist=true` with shadow omitted do not
  call `appendEpisode` and do not open SQLite.
- `tests/unit/task-loop-controller.test.ts:723` proves the enabled path writes
  exactly one sanitized episode only when both flags are true and does not retain
  request text or self-check summary.
- `tests/unit/task-loop-controller.test.ts:2133` proves task_loop tool result
  policy and evidence verifier behavior remain unchanged when runtime memory
  persistence is disabled.

## Gateway, Electron, Renderer, Shared Host Contract Scans

Renderer/Main boundary scan:

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
```

Result: no matches.

Runtime Memory integration/persistence import scan:

```text
rg -n "memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER" openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
```

Result: no matches.

Broader memory boundary scan:

```text
rg -n "runtime\.memory|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|createRuntimeMemoryContextProvider|runtime-memory|memory-runtime|memory-persistence|RuntimeMemory|runtime memory" openclaw_runtime/src/gateway electron shared src/lib src/pages src/components
```

Reviewed matches: existing shared i18n strings for role memory cards/read-only
memory, existing gateway memory-search plugin startup/doctor imports, and no
Runtime Memory provider/default-registration/integration/persistence route in
Gateway, Electron Main, renderer host-api/api-client, or shared host contracts.

## No Memory-Derived Runtime Authority

- Memory provider manifest metadata at
  `openclaw_runtime/src/context-engine/memory-context-provider.ts:76` through
  `:85` declares readonly memory context, no memory dump, and no
  completion/verifier/security/retry/tool/runtime authority.
- Provider output metadata at `memory-context-provider.ts:145` through `:152`
  repeats the no-authority markers for successful readonly output.
- `tests/unit/runtime-memory-context-provider.test.ts:32` asserts the provider is
  optional, default-off, shadow-only, readonly, and non-authoritative.
- `tests/unit/runtime-memory-context-provider.test.ts:285` proves the readonly
  `queryFacts` callback exposes no runtime/tool authority.

Authority scan:

```text
rg -n "noCompletionAuthority|completionAuthority|noVerifierAuthority|verifierAuthority|noSecurityAuthority|securityAuthority|noRetryAuthority|retryAuthority|noToolAuthority|toolAuthority|noRuntimeAuthority|runtimeAuthority|provider ordering|providerOrdering|tool permission|completion gate" openclaw_runtime/src/context-engine openclaw_runtime/src/gateway electron shared src/lib tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts
```

Reviewed matches are no-authority metadata/assertions in memory, trace, symbol,
and agent-map context providers plus the provider-ordering regression test. No
memory-derived completion gate, verifier authority, security policy, retry
policy, tool permission authority, runtime execution authority, or provider
ordering authority was found.

## Raw Retention And Service/Listener Scan

Focused raw-retention scan over Lane D files:

```text
rg -n "rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate" openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/context-engine/memory-context-provider.ts openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/schema.help.ts openclaw_runtime/src/config/zod-schema.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

Reviewed matches are existing config/schema/help secret/transcript fields and
schema entries outside Runtime Memory; Runtime Memory help explicitly rejects raw
chat logs, raw trace dumps, transcripts, tool payloads, and prompt dumps.

Focused service/exporter/listener scan:

```text
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service" openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/context-engine/memory-context-provider.ts openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/schema.help.ts openclaw_runtime/src/config/zod-schema.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

Reviewed matches are pre-existing unrelated config/help entries and a negative
schema strict-key test using `exporter`; no Phase 13 memory service, exporter,
database-service, listener, HTTP server, WebSocket server, OTLP collector, or
Temporal service was added.

## Docs And Config Sync Decision

No docs/config update is required by Lane D.

Reasoning:

- The Phase 13 TaskLoop pilot remains default-off and requires both
  `runtime.memory.shadow` and `runtime.memory.persist`.
- Existing help for `runtime.memory.shadow` at
  `openclaw_runtime/src/config/schema.help.ts:2005` states sanitized diagnostics
  only and no raw chat/trace/transcript/tool/prompt dumps.
- Existing help for `runtime.memory.provider` at
  `schema.help.ts:2007` says provider output requires explicit provider
  registration, does not register the provider by default, does not change
  ordering, and does not make memory authoritative.
- Existing help for `runtime.memory.persist` at `schema.help.ts:2011` says the
  gate is default false, explicit persistence/adapter paths only, and does not
  enable TaskLoop/Gateway cutover, provider output, default-on memory, fact
  extraction/promotion, user-facing persistence flows, or runtime authority.
- No renderer/Main/Gateway/shared host contract or operator-facing UI route was
  added by this lane; therefore README.md, README.zh-CN.md, README.ja-JP.md, and
  README.ru-RU.md do not need changes for Lane D.

## Validation

RTK note: `C:\Users\27933\.codex\RTK.md` was reviewed, but bare `rtk` was not
available in this shell. Direct Node equivalents were used.

| Command | Result |
|---|---|
| `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-feature-config-schema.test.ts` | pass, 3 files / 19 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts -t "Runtime Memory\|runtime memory persistence"` | pass, 1 file / 7 selected tests |

Status: accepted
