# Line C Grounding Diagnostics Authority Sentinel Hardening Design Research

## Authority Sentinel Negative Matrix

| Consumer | Accepted field | Authority sentinels exercised | Required negative proof | Decision |
| --- | --- | --- | --- | --- |
| Context Provider Registry groundingShadow | Registry diagnostic `metadata` and optional `groundingShadowSummary` | Runtime, completion, provider ordering, prompt, durable fact, memory promotion, fact acceptance, episode write, memory persistence, patch mutation, symbol mutation | Sentinels may enter only as sanitized input attempts; emitted Registry diagnostics keep diagnostics-only/no-authority markers and do not add context items, provider results, provider ordering, or registry entries. | Test only; no production runtime implementation. |
| Trace Context Provider groundingDiagnostics | `metadata.groundingDiagnostics` and diagnostic metadata | Same sentinel matrix plus source/evidence anchor attempts | Sentinels may not alter trace `contextItems`, `evidenceRefs`, trace ranking, prompt assembly, provider ordering, or runtime execution. | Test only; no production runtime implementation. |
| Symbol Context Provider groundingDiagnostics | `metadata.groundingDiagnostics` and diagnostic metadata | Same sentinel matrix plus symbol mutation attempt | Sentinels may not alter symbol `contextItems`, `evidenceRefs`, symbol diagnostics, symbol mutation, workspace edit, prompt assembly, or runtime execution. | Test only; no production runtime implementation. |
| AgentMap Context Provider groundingDiagnostics | `metadata.groundingDiagnostics` and diagnostic metadata | Same sentinel matrix plus prompt/provider-ordering and patch mutation attempts | Sentinels may not alter AgentMap `contextItems`, `evidenceRefs`, prompt authority, provider ordering authority, patch authority, symbol mutation, or provider ranking. | Test only; no production runtime implementation. |
| Runtime Memory Context Provider groundingDiagnostics | `metadata.groundingDiagnostics` and diagnostic metadata | Same sentinel matrix plus durable fact, memory promotion, fact acceptance, episode write, and persistence attempts | Sentinels may not alter memory `contextItems`, `evidenceRefs`, durable facts, fact candidates, promotion, fact acceptance, episode writes, memory store writes, persistence, prompt authority, or provider ordering authority. | Test only; no production runtime implementation. |

## Required Negative Cases

| Negative case | Registry | Trace | Symbol | AgentMap | Runtime Memory |
| --- | --- | --- | --- | --- | --- |
| absent diagnostics option | Existing provider-specific baseline tests remain required; this phase does not change absent paths. | Existing baseline comparison remains required. | Existing baseline comparison remains required. | Existing baseline comparison remains required. | Existing baseline comparison remains required. |
| disabled diagnostics option | Existing disabled comparison must stay identical to absent baseline. | Same. | Same. | Same. | Same. |
| enabled trusted ref | Shared authority-sentinel fixture includes a trusted ref that may produce one summary item. | Same. | Same. | Same. | Same. |
| enabled untrusted ref | Shared authority-sentinel fixture includes an untrusted ref and expects it excluded by default. | Same. | Same. | Same. | Same. |
| query `includeRaw` / `includeUntrusted` attempted true | Sanitized query metadata must report both as false. | Same. | Same. | Same. | Same. |
| raw-like metadata sentinel | Raw keys and sentinel text must not survive serialized output. | Same. | Same. | Same. | Same. |
| `runtimeAuthority:true` / `runtimeAuthority=yes` / `runtimeAuthority=grant` | Must not survive output; `noRuntimeAuthority` remains true. | Same. | Same. | Same. | Same. |
| `completionAuthority:true` | Must not survive output; `noCompletionAuthority` remains true. | Same. | Same. | Same. | Same. |
| `providerOrderingAuthority:true` | Must not survive output; `noProviderOrderingAuthority` remains true. | Same. | Same. | Same. | Same. |
| `promptAuthority:true` | Must not survive output; provider-specific no-prompt marker remains true where applicable. | Same. | Same. | Same. | Same. |
| `durableFactAuthority:true` | Must not survive output; no durable fact marker remains true where applicable. | Same. | Same. | Same. | Same. |
| `memoryPromotionAuthority:true` | Must not survive output; no memory promotion marker remains true. | Same. | Same. | Same. | Same. |
| `factAcceptanceAuthority:true` | Must not survive output; no fact acceptance marker remains true where applicable. | Same. | Same. | Same. | Same. |
| `episodeWriteAuthority:true` | Must not survive output; no episode write marker remains true where applicable. | Same. | Same. | Same. | Same. |
| `memoryPersistenceAuthority:true` | Must not survive output; no memory persistence marker remains true where applicable. | Same. | Same. | Same. | Same. |
| `patchMutationAuthority:true` | Must not survive output; no patch mutation marker remains true. | Same. | Same. | Same. | Same. |
| `symbolMutationAuthority:true` | Must not survive output; no symbol mutation marker remains true where applicable. | Same. | Same. | Same. | Same. |
| source/evidence refs as anchors only | Refs remain anchors/evidence links only; no context/evidence mutation. | Same. | Same. | Same. | Same. |
| memory fact/promotion sentinel | Not applicable except no-memory-promotion marker. | Same. | Same. | Same. | Required no durable fact, promotion, fact acceptance, episode write, and persistence markers. |
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
| `noPromptAuthority` | not required | not required | not required in diagnostics metadata, present in symbol context items | required true | required true |
| `noDurableFactAuthority` | not required | not required | not required | not required | required true |
| `noFactAcceptanceAuthority` | not required | not required | not required | not required | required true |
| `noEpisodeWriteAuthority` | not required | not required | not required | not required | required true |
| `noMemoryPersistenceAuthority` | not required | not required | not required | not required | required true |
| `noSymbolMutationAuthority` | not required | not required | required true | not required | not required |
| provider-specific no-authority markers | `runtimeGroundingShadowPilot` | `runtimeTraceGroundingDiagnostics` | `symbolGroundingDiagnostics`, `noSymbolMutationAuthority` | `agentMapGroundingDiagnostics`, `noPromptAuthority`, `noProviderOrderingAuthority` | `runtimeMemoryGroundingDiagnostics`, `noPromptAuthority`, `noProviderOrderingAuthority`, `noDurableFactAuthority`, `noMemoryFactPromotionAuthority`, `noFactAcceptanceAuthority`, `noEpisodeWriteAuthority`, `noMemoryPersistenceAuthority` |

## Implementation Recommendation

Prefer no production runtime implementation. The accepted consumers already use explicit/default-off diagnostics paths and the accepted drift guard already hardened authority-like metadata text.

Add only a focused cross-consumer authority-sentinel regression test by expanding the hostile diagnostics fixture. The fixture should feed all five consumers trusted and untrusted refs, attempted `includeRaw`/`includeUntrusted`, raw-like metadata, source/evidence anchor markers, memory promotion sentinels, patch/symbol mutation sentinels, and the full authority-grant sentinel matrix.

Make a metadata-only production fix only if the focused test exposes sanitizer or marker drift. Any such fix must not add runtime call paths, provider registration, provider ordering, prompt assembly, persistence, memory promotion, fact acceptance, episode writes, memory store writes, symbol mutation, workspace mutation, or patch application.

## Rejected Alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| TaskLoop | Rejected | TaskLoop is an execution authority surface and could affect completion, blocked/failed status, retry, approval, security, tool policy, runtime state, or memory side effects. |
| Gateway/Main/renderer transport | Rejected | This phase must not expose diagnostics through transport, host API, preload, UI, WebSocket, HTTP, IPC, or renderer-owned protocol behavior. |
| Provider ordering/default registration | Rejected | Grounding metadata must not rank, register, select, or order providers. |
| Prompt assembly/model-message | Rejected | Grounding summaries must not become model-visible prompt authority. |
| Memory promotion/persistence/fact acceptance/episode write | Rejected | Memory refs remain anchors only and cannot promote durable facts, accept facts, write episodes, mutate stores, persist state, or accept invalidations. |
| Patch apply/workspace edit | Rejected | Grounding refs may describe patch/source anchors only; they cannot edit files, rename, safe-delete, or apply patches. |
| Symbol mutation | Rejected | Symbol refs remain readonly anchors and cannot mutate symbols or workspace state. |

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence |
| --- | --- | --- | --- |
| Authority sentinel text survives output | A consumer appears to grant runtime/prompt/provider/memory/mutation authority. | Cross-consumer invariant test serializes all metadata and rejects every grant sentinel string. | Focused hostile fixture assertions. |
| Marker drift across consumers | A consumer appears less constrained than peers. | Compare shared and provider-specific no-authority markers across all five metadata shapes. | Cross-consumer metadata assertions. |
| Untrusted refs become visible | Trust boundary violation. | Use hostile fixture with trusted and untrusted refs and forced `includeUntrusted: true`. | Assert item count and no untrusted item. |
| Raw-like metadata leaks | Security/privacy violation. | Use raw keys and secret-like sentinel values across refs/options. | Assert serialized results omit sentinel and raw keys. |
| Diagnostics alters `contextItems` or `evidenceRefs` | Metadata becomes context/evidence cutover. | Compare enabled results to baseline for Trace, Symbol, AgentMap, and Runtime Memory. | Assert `contextItems` and `evidenceRefs` unchanged. |
| Provider ordering/default registration changes | Grounding becomes runtime selection authority. | Do not touch registry construction or provider manifests. | Assert default registry order and scan provider registration/order terms. |
| Memory facts become promotion authority | Durable state mutation risk. | Keep Runtime Memory markers explicit and compare output to baseline. | Assert no durable fact, promotion, fact acceptance, episode write, and persistence markers. |
| Patch or symbol mutation appears | Grounding becomes a mutation planner. | No mutation code changes; compare no-patch/no-symbol markers only. | Mutation scans and Symbol provider assertions. |

## Test Matrix

| Requirement | Validation |
| --- | --- |
| Fresh spec structural pass | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md --no-diff` |
| Cross-consumer authority-sentinel payload | Focused unit test in `tests/unit/runtime-grounding-shadow-consumers.test.ts`. |
| Disabled/absent baseline | Existing Registry/Trace/Symbol/AgentMap/Runtime Memory tests plus unchanged focused suite. |
| Enabled diagnostics metadata only | Cross-consumer authority-sentinel test compares enabled provider results to baseline `contextItems`/`evidenceRefs`. |
| `includeRaw` and `includeUntrusted` forced false | Cross-consumer query metadata assertions. |
| Raw-like metadata absent | Cross-consumer sentinel serialization assertions. |
| Authority-grant metadata absent | Cross-consumer grant-sentinel serialization assertions. |
| `authority` and `rawRetained` fixed | Cross-consumer metadata and item assertions. |
| Memory promotion and persistence absent | Runtime Memory provider-specific markers plus boundary scans. |
| Patch/symbol mutation absent | Symbol/provider-specific markers plus mutation scans. |
| No TaskLoop/Gateway/Main/renderer/transport changes | Scope review and boundary scans. |
| README review | Focused review concludes no update unless behavior/interface/user-visible docs changed. |

Design Status: accepted
