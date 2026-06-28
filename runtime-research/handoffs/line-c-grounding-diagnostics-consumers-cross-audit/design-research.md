# Line C Grounding Diagnostics Consumers Cross-Consumer Boundary Audit Design Research

## Cross-Consumer Comparison

| Consumer | Existing insertion point | Metadata field | Call path status | Boundary decision |
| --- | --- | --- | --- | --- |
| Context Provider Registry | Explicit registry pilot option | `groundingShadow` diagnostic and `groundingShadowSummary` | Already accepted, explicit/default-off | Compare only. No new registry behavior. |
| Trace Context Provider | Explicit provider construction option | `groundingDiagnostics` result metadata and diagnostic metadata | Already accepted, explicit/default-off | Compare only. No trace provider behavior change. |
| Symbol Context Provider | Explicit provider construction option | `groundingDiagnostics` result metadata and diagnostic metadata | Already accepted, explicit/default-off | Compare only. No symbol mutation or provider behavior change. |
| AgentMap Context Provider | Explicit provider construction option | `groundingDiagnostics` result metadata and diagnostic metadata | Already accepted, explicit/default-off | Compare only. No prompt authority or provider ordering change. |
| Runtime Memory Context Provider | Explicit provider construction option | `groundingDiagnostics` result metadata and diagnostic metadata | Already accepted, explicit/default-off | Compare only. No durable fact, promotion, or persistence behavior change. |

## Metadata Marker Comparison

| Marker | Registry groundingShadow | Trace groundingDiagnostics | Symbol groundingDiagnostics | AgentMap groundingDiagnostics | Runtime Memory groundingDiagnostics |
| --- | --- | --- | --- | --- | --- |
| `diagnosticsOnly` | required true | required true | required true | required true | required true |
| `metadataOnly` | required true | required true | required true | required true | required true |
| `summaryOnly` | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary |
| `readonly` | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary |
| `localOnly` | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary |
| `shadowOnly` | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary |
| `diagnosticOnly` | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary | required true from shared summary |
| `authority: "none"` | required | required | required | required | required |
| `rawRetained: false` | required | required | required | required | required |
| `noRuntimeAuthority` | required true | required true | required true | required true | required true |
| `noCompletionAuthority` | required true | required true | required true | required true | required true |
| `noProviderOrderingAuthority` | required true | required true | required true | required true | required true |
| `noMemoryPromotionAuthority` | required true | required true | required true | required true | required true |
| `noPatchMutationAuthority` | required true | required true | required true | required true | required true |
| Provider-specific markers | `runtimeGroundingShadowPilot`, `noContextItemAuthority`, `noProviderResultAuthority` | `runtimeTraceGroundingDiagnostics`, `noContextItemAuthority`, `noProviderResultAuthority` | `symbolGroundingDiagnostics`, `noContextItemAuthority`, `noProviderResultAuthority`, `noSymbolMutationAuthority` | `agentMapGroundingDiagnostics`, `noContextItemAuthority`, `noProviderResultAuthority`, `noPromptAuthority`, `noProviderOrderingAuthority` | `runtimeMemoryGroundingDiagnostics`, `noContextItemAuthority`, `noProviderResultAuthority`, `noPromptAuthority`, `noDurableFactAuthority`, `noMemoryFactPromotionAuthority`, `noFactAcceptanceAuthority`, `noEpisodeWriteAuthority`, `noMemoryPersistenceAuthority` |

## Implementation Recommendation

Prefer no runtime implementation. The existing accepted consumers already route through the shared `GroundingShadowConsumerSummary` marker set and emit diagnostics/result metadata only when explicit options are enabled.

A focused cross-consumer unit test is recommended because the provider metadata mapping functions are intentionally local to each consumer. The test should prove the invariant shape across Registry, Trace, Symbol, AgentMap, and Runtime Memory and should fail if a future consumer drops an authority, retention, summary, or provider-specific no-authority marker.

Runtime code should change only if the cross-consumer test exposes metadata invariant drift. Any such fix must be metadata-only and must not add new call paths, provider registration, provider ordering, prompt assembly, persistence, memory promotion, or mutation behavior.

## Rejected Alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| TaskLoop | Rejected | It is an execution authority surface and could affect completion, blocked/failed status, retry, approval, security, tool policy, runtime state, or memory side effects. |
| Gateway/Main/renderer transport | Rejected | This phase must not expose diagnostics through transport, host API, preload, UI, WebSocket, HTTP, or IPC behavior. |
| Provider ordering/default registration | Rejected | Grounding metadata must not rank, register, select, or order providers. |
| Prompt assembly/model-message | Rejected | Grounding summaries must not become model-visible prompt authority. |
| Memory promotion/persistence | Rejected | Memory refs remain anchors only and cannot promote durable facts, accept facts, write episodes, mutate stores, or accept invalidations. |
| Patch apply/workspace edit | Rejected | Grounding refs may describe patch/source anchors only; they cannot edit files, rename, safe-delete, or apply patches. |
| Symbol mutation | Rejected | Symbol refs remain readonly anchors and cannot mutate symbols or workspace state. |

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence |
| --- | --- | --- | --- |
| Marker drift across providers | A consumer appears less constrained than peers. | Cross-consumer invariant test over all five emitted metadata shapes. | Assert shared marker set and provider-specific no-authority markers. |
| Diagnostics alters `contextItems` or `evidenceRefs` | Metadata becomes context or evidence cutover. | Reuse existing provider tests and add cross-consumer comparison without changing provider code. | Existing provider tests compare enabled results to baseline `contextItems`/`evidenceRefs`. |
| Provider ordering or default registration changes | Grounding becomes runtime selection authority. | Do not touch registry construction or provider manifests. | Existing registry/provider tests and provider/default registration scan. |
| Raw data leaks through metadata | Security/privacy violation. | Reuse accepted shared sanitizer; do not add raw fields. | Existing sentinel tests plus raw-retention scan. |
| Memory facts become promotion authority | Durable state mutation risk. | Keep Runtime Memory markers explicit and compare them cross-consumer. | Runtime Memory metadata assertions and mutation scans. |
| Patch or symbol mutation appears | Grounding becomes a mutation planner. | No mutation code changes; compare no-patch/no-symbol markers only. | Mutation scans and Symbol provider assertions. |

## Test Matrix

| Requirement | Validation |
| --- | --- |
| Fresh spec structural pass | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md --no-diff` |
| Cross-consumer shared markers | Focused unit test in `runtime-grounding-shadow-consumers.test.ts` comparing Registry, Trace, Symbol, AgentMap, and Runtime Memory diagnostics metadata. |
| Registry `groundingShadow` remains diagnostics-only | Existing registry pilot test plus cross-consumer metadata test. |
| Trace/Symbol/AgentMap/Runtime Memory metadata only | Existing provider tests plus cross-consumer metadata test. |
| `contextItems` and `evidenceRefs` unchanged | Existing enabled diagnostics provider tests compare to baseline. |
| Provider ordering/default registration unchanged | Existing registry/provider tests and focused scan. |
| Raw retention absent | Existing sentinel tests plus raw-retention scan. |
| No memory promotion/fact acceptance/episode write/persistence | Runtime Memory tests plus mutation/persistence scans. |
| No TaskLoop/Gateway/Main/renderer/transport changes | Scope review and boundary scans. |
| README review | Focused review concludes no update unless behavior/interface/user-visible docs changed. |

Design Status: accepted
