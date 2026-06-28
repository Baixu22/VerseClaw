# Line C Grounding Diagnostics Consumers Drift Guard Design Research

## Negative Boundary Matrix

| Consumer | Insertion point | Accepted metadata field | Negative boundary | Decision |
| --- | --- | --- | --- | --- |
| Context Provider Registry groundingShadow | Explicit `groundingShadow.enabled` pilot option | `groundingShadowSummary` plus registry diagnostic metadata | Must not add `contextItems`, provider results, provider registration, provider ordering, prompt text, or runtime authority. | Compare and test only. No new registry behavior. |
| Trace Context Provider groundingDiagnostics | Explicit provider construction option | result `metadata.groundingDiagnostics` plus diagnostic metadata | Must not change trace `contextItems`, `evidenceRefs`, trace ranking, prompt assembly, provider ordering, or runtime execution. | Compare and test only. |
| Symbol Context Provider groundingDiagnostics | Explicit provider construction option | result `metadata.groundingDiagnostics` plus diagnostic metadata | Must not change symbol `contextItems`, `evidenceRefs`, or introduce symbol mutation/workspace edit authority. | Compare and test only. |
| AgentMap Context Provider groundingDiagnostics | Explicit provider construction option | result `metadata.groundingDiagnostics` plus diagnostic metadata | Must not change AgentMap `contextItems`, `evidenceRefs`, prompt authority, provider ordering authority, or patch authority. | Compare and test only. |
| Runtime Memory Context Provider groundingDiagnostics | Explicit provider construction option | result `metadata.groundingDiagnostics` plus diagnostic metadata | Must not change memory `contextItems`, `evidenceRefs`, fact promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, persistence, prompt authority, or provider ordering authority. | Compare and test only. |

## Required Negative Cases

| Negative case | Registry | Trace | Symbol | AgentMap | Runtime Memory |
| --- | --- | --- | --- | --- | --- |
| absent diagnostics option | Existing provider-specific baseline tests; drift guard preserves as a prerequisite. | Existing baseline comparison. | Existing baseline comparison. | Existing baseline comparison. | Existing baseline comparison. |
| disabled diagnostics option | Existing provider-specific disabled tests compare exactly to absent baseline. | Existing disabled test. | Existing disabled test. | Existing disabled test. | Existing disabled test. |
| enabled trusted ref | Cross-consumer drift-guard fixture includes a trusted ref that may produce one summary item. | Same fixture shape. | Same fixture shape. | Same fixture shape. | Same fixture shape. |
| enabled untrusted ref | Cross-consumer drift-guard fixture includes an untrusted ref and expects it excluded. | Same. | Same. | Same. | Same. |
| query `includeRaw` / `includeUntrusted` attempted true | Sanitized query metadata must report both as false. | Same. | Same. | Same. | Same. |
| raw-like metadata sentinel | Raw keys and sentinel text must not survive JSON output. | Same. | Same. | Same. | Same. |
| provider-specific authority sentinel | Metadata must retain only no-authority markers, not authority-bearing markers. | Same. | Same. | Same. | Same. |
| source/evidence refs as anchors only | Metadata may state refs are anchors/links only; no context/evidence mutation. | Existing trace source-ref tests plus drift guard. | Drift guard plus symbol no-mutation marker. | Drift guard checks source/evidence relevance markers. | Drift guard checks memory anchors only. |
| memory fact/promotion sentinel | Not applicable except no memory-promotion marker. | Not applicable except no memory-promotion marker. | Not applicable except no memory-promotion marker. | Not applicable except no memory-promotion marker. | Required no durable fact, promotion, fact acceptance, episode write, and persistence markers. |
| patch/symbol mutation sentinel | Required no patch mutation. | Required no patch mutation. | Required no patch and no symbol mutation authority. | Required no patch mutation and no prompt/provider-ordering authority. | Required no patch mutation and no durable memory mutation authority. |

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
| `noContextItemAuthority` | required true | required true | required true | required true | required true |
| `noProviderResultAuthority` | required true | required true | required true | required true | required true |
| provider-specific no-authority markers | `runtimeGroundingShadowPilot` | `runtimeTraceGroundingDiagnostics` | `symbolGroundingDiagnostics`, `noSymbolMutationAuthority` | `agentMapGroundingDiagnostics`, `noPromptAuthority`, `noProviderOrderingAuthority` | `runtimeMemoryGroundingDiagnostics`, `noPromptAuthority`, `noProviderOrderingAuthority`, `noDurableFactAuthority`, `noMemoryFactPromotionAuthority`, `noFactAcceptanceAuthority`, `noEpisodeWriteAuthority`, `noMemoryPersistenceAuthority` |

## Implementation Recommendation

Prefer no production runtime implementation. The accepted consumers already call the shared grounding shadow summary helper through explicit/default-off options, and existing provider-specific tests cover absent/disabled and enabled metadata behavior.

Add only a focused cross-consumer negative/boundary regression test. The test should feed all five consumers the same hostile diagnostic payload: trusted ref, untrusted ref, attempted `includeRaw` and `includeUntrusted`, raw-like metadata keys, raw sentinel values, source/evidence anchor markers, provider-specific no-authority markers, memory promotion sentinels, and patch/symbol mutation sentinels.

Make a metadata-only production fix only if the focused test exposes marker drift. Any such fix must not add new runtime call paths, provider registration, provider ordering, prompt assembly, persistence, memory promotion, or mutation behavior.

## Rejected Alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| TaskLoop | Rejected | TaskLoop is an execution authority surface and could affect completion, blocked/failed status, retry, approval, security, tool policy, runtime state, or memory side effects. |
| Gateway/Main/renderer transport | Rejected | This phase must not expose diagnostics through transport, host API, preload, UI, WebSocket, HTTP, or IPC behavior. |
| Provider ordering/default registration | Rejected | Grounding metadata must not rank, register, select, or order providers. |
| Prompt assembly/model-message | Rejected | Grounding summaries must not become model-visible prompt authority. |
| Memory promotion/persistence/fact acceptance/episode write | Rejected | Memory refs remain anchors only and cannot promote durable facts, accept facts, write episodes, mutate stores, persist state, or accept invalidations. |
| Patch apply/workspace edit | Rejected | Grounding refs may describe patch/source anchors only; they cannot edit files, rename, safe-delete, or apply patches. |
| Symbol mutation | Rejected | Symbol refs remain readonly anchors and cannot mutate symbols or workspace state. |

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence |
| --- | --- | --- | --- |
| Marker drift across consumers | A consumer appears less constrained than peers. | Cross-consumer invariant test over all five emitted metadata shapes. | Assert shared and provider-specific no-authority markers. |
| Untrusted refs become visible | Trust boundary violation. | Use hostile fixture with trusted and untrusted refs and forced `includeUntrusted: true`. | Assert item count and no untrusted item. |
| Raw-like metadata leaks | Security/privacy violation. | Use sentinel raw keys and secret-like metadata across refs/options. | Assert serialized results omit sentinel and raw keys. |
| Diagnostics alters `contextItems` or `evidenceRefs` | Metadata becomes context/evidence cutover. | Compare enabled results to baseline for Trace, Symbol, AgentMap, and Runtime Memory. | Assert `contextItems` and `evidenceRefs` unchanged. |
| Provider ordering/default registration changes | Grounding becomes runtime selection authority. | Do not touch registry construction or provider manifests. | Assert default registry order and scan provider registration/order terms. |
| Memory facts become promotion authority | Durable state mutation risk. | Keep Runtime Memory markers explicit and compare output to baseline. | Assert no durable fact, promotion, fact acceptance, episode write, and persistence markers. |
| Patch or symbol mutation appears | Grounding becomes a mutation planner. | No mutation code changes; compare no-patch/no-symbol markers only. | Mutation scans and Symbol provider assertions. |

## Test Matrix

| Requirement | Validation |
| --- | --- |
| Fresh spec structural pass | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md --no-diff` |
| Cross-consumer negative payload | Focused unit test in `tests/unit/runtime-grounding-shadow-consumers.test.ts`. |
| Disabled/absent baseline | Existing Registry/Trace/Symbol/AgentMap/Runtime Memory tests plus unchanged focused suite. |
| Enabled diagnostics metadata only | Cross-consumer drift-guard test compares enabled provider results to baseline `contextItems`/`evidenceRefs`. |
| `includeRaw` and `includeUntrusted` forced false | Cross-consumer drift-guard metadata query assertions. |
| Raw-like metadata absent | Cross-consumer drift-guard sentinel serialization assertions. |
| `authority` and `rawRetained` fixed | Cross-consumer metadata and item assertions. |
| Memory promotion and persistence absent | Runtime Memory provider-specific markers plus boundary scans. |
| Patch/symbol mutation absent | Symbol/provider-specific markers plus mutation scans. |
| No TaskLoop/Gateway/Main/renderer/transport changes | Scope review and boundary scans. |
| README review | Focused review concludes no update unless behavior/interface/user-visible docs changed. |

Design Status: accepted
