# Line C Grounding Runtime Memory Diagnostics Consumer Design Research

## Runtime Diagnostics Consumer Comparison

| Candidate insertion point | Shape | Benefits | Boundary risks | Decision |
| --- | --- | --- | --- | --- |
| Runtime Memory provider diagnostics metadata | Optional Runtime Memory provider option calls `createRuntimeMemoryGroundingShadowSummary()` and appends diagnostics/result metadata. | Directly proves memory/source/evidence refs can carry grounding summaries in the provider's existing diagnostics metadata path. Keeps output local to the provider result and away from memory writes. | Runtime Memory is close to durable fact promotion, fact acceptance, episode writes, and memory persistence, so grounding must never become fact authority or persistence input. | Recommended |
| AgentMap provider diagnostics metadata | Accepted AgentMap provider path with `groundingDiagnostics`. | Already proves a concrete provider diagnostics consumer for source/symbol/file anchors. | Does not exercise Runtime Memory source/evidence refs or durable fact boundary. | Accepted baseline, not expanded here |
| Symbol provider diagnostics metadata | Accepted Symbol provider path with `groundingDiagnostics`. | Already proves non-mutating symbol diagnostics metadata consumption. | Not memory-specific and does not cover fact promotion boundaries. | Accepted baseline, not expanded here |
| Trace Context Provider diagnostics metadata | Accepted Trace provider path with `groundingDiagnostics`. | Already proves trace diagnostics metadata consumption. | Not memory-specific and does not cover durable fact or episode boundaries. | Accepted baseline, not expanded here |
| Context Provider Registry diagnostics metadata | Accepted registry pilot `groundingShadow` path. | Proves runtime registry can carry diagnostics-only grounding metadata. | Registry-level metadata is broader than the Runtime Memory provider and does not test provider result invariants. | Accepted baseline, not expanded here |
| TaskLoop | Call grounding while runtime executes tasks. | Closest to runtime execution and memory-producing events. | Violates no-cutover boundary; could affect completion, blocked/failed status, retry, approval, security, tool policy, prompt assembly, runtime state, or memory side effects. | Rejected |
| Gateway/Main/renderer transport | Surface grounding through host API, Gateway, Main, preload, or UI. | Could expose diagnostics later. | Violates this phase by touching transport, process, CORS, UI, and user-visible behavior. | Rejected |
| Provider ordering/default registration | Register grounding-aware providers by default or rank providers from grounding output. | Conventional provider integration shape. | Violates default provider registration and ordering boundaries. | Rejected |
| Prompt assembly/model-message | Put grounding summaries into model context or prompt payloads. | Would make summaries visible to the model. | Violates explicit diagnostics-only and non-authoritative constraints. | Rejected |
| Memory persistence/fact promotion | Use grounding refs to accept facts, write episodes, mutate stores, or accept invalidation proposals. | Would make grounding durable and operationally useful. | Violates the core boundary: memory refs are anchors/evidence links only and must not become durable fact authority. | Rejected |

## Recommended Insertion Point

Use Runtime Memory Context Provider diagnostics metadata. The provider already returns explicit readonly/shadow results and metadata, and it already keeps memory facts as bounded context summaries when the memory provider flag is enabled. The new path should add only an optional `groundingDiagnostics` construction parameter:

- absent or disabled `groundingDiagnostics` leaves Runtime Memory Context Provider output exactly unchanged;
- enabled `groundingDiagnostics` accepts already sanitized `GroundingRef[]`;
- the provider calls `createRuntimeMemoryGroundingShadowSummary()` with `enabled: true`;
- one diagnostic record and optional result metadata field carry bounded summary items and boundary markers;
- `contextItems`, `evidenceRefs`, provider registry ordering, prompt text, TaskLoop state, Gateway behavior, renderer transport, provider results used for prompt assembly, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, patch apply, and runtime execution decisions remain unchanged.

This path is narrower than registry-level diagnostics and more appropriate than a persistence or TaskLoop hook because it proves Runtime Memory can inspect grounding metadata without creating durable state, promotion authority, or runtime authority.

## Rejected Alternatives

| Alternative | Rejection reason |
| --- | --- |
| TaskLoop | It is an execution authority surface and can influence completion, blocked/failed status, retry, approval, security, tool policy, runtime state, or memory side effects. |
| Gateway | It is a transport/process boundary and would create user-visible or protocol behavior outside a minimal runtime diagnostic path. |
| Provider ordering/default registration | Grounding must not rank providers, change default registration, alter ordering, or select the Runtime Memory provider. |
| Prompt assembly/model-message | Grounding output must not enter model messages or authoritative context assembly. |
| Memory promotion | Grounding summaries can describe memory refs but cannot promote durable facts. |
| Memory persistence | This phase must not write episodes, stores, sidecars, caches, or database rows. |
| Renderer transport | Renderer/Main/host-api/api-client paths are out of scope and should remain untouched. |
| Patch apply/workspace edit | Runtime Memory grounding may describe source/evidence anchors only; it must not apply patches, rename, edit, or safe-delete. |
| Symbol mutation | Memory source refs are anchors only and cannot mutate symbols or workspace state. |

## Data Flow

1. Memory/evidence/source refs are projected into accepted `GroundingRef` values by the existing grounding spine.
2. A caller explicitly constructs Runtime Memory Context Provider with `groundingDiagnostics: { enabled: true, refs, limit, tokenBudget, query, metadata }`.
3. Runtime Memory Context Provider resolves its normal flag, query, fact ranking, summary, and diagnostic paths exactly as before.
4. The provider calls `createRuntimeMemoryGroundingShadowSummary(refs, options)` for diagnostics only.
5. The provider appends one `RuntimeRegistryDiagnostic` whose metadata contains bounded summary items and boundary markers.
6. The provider result metadata receives a bounded `groundingDiagnostics` metadata object for inspection only.
7. Runtime output remains shadow-only: `contextItems`, `evidenceRefs`, provider ordering, prompt text, TaskLoop, Gateway, renderer transport, provider results used for prompt assembly, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, patch apply, and runtime execution are unchanged by grounding.

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence required |
| --- | --- | --- | --- |
| Default-off behavior changes existing provider output | Existing callers observe new metadata or diagnostics unexpectedly. | Do nothing when `groundingDiagnostics` is absent or disabled. | Compare absent and disabled output to the existing baseline. |
| Grounding output affects context items or prompt material | Diagnostics become an authoritative context cutover. | Emit only diagnostic/result metadata and never map grounding items to `ContextItem`s. | Explicit enabled test asserts `contextItems` are unchanged from baseline. |
| Grounding output changes provider evidence refs | Diagnostics alter downstream evidence surfaces. | Use the provider's normal diagnostic evidence ref only; do not add grounding diagnostic refs to provider `evidenceRefs`. | Explicit enabled test asserts `evidenceRefs` are unchanged from baseline. |
| Raw metadata leaks through diagnostic metadata | Security/privacy boundary violation. | Reuse accepted shadow helper sanitizer and emit summary items only. | Raw sentinel test over serialized provider result. |
| Untrusted refs included by default | Trust boundary violation. | Let helper force `includeUntrusted: false`. | Enabled test supplies trusted and untrusted refs and asserts only trusted output. |
| Authority marker drifts | Grounding authority becomes ambiguous. | Copy accepted summary helper markers only. | Unit assertions and authority scan. |
| Memory refs become durable fact/promotion authority | Grounding changes memory behavior or durable state. | Preserve `noMemoryPromotionAuthority`, add no fact acceptance or persistence calls, and keep output metadata-only. | Enabled test checks metadata markers and scans for mutation calls. |
| Provider registry/default ordering changes | Runtime provider behavior changes. | Avoid registry construction changes; update only Runtime Memory provider options. | Registry ordering test remains stable. |
| Fact acceptance or episode writes appear | Durable state mutation. | Add no memory persistence, store mutation, fact acceptance, or episode APIs. | Persistence/mutation scans. |
| Patch or symbol mutation appears | Grounding becomes mutation planning. | Add no patch helpers, workspace edit calls, symbol edit APIs, or mutation metadata. | Unit assertion and mutation scan. |

## Test Matrix

| Requirement | Focused test |
| --- | --- |
| Default-off unchanged | `runtime-memory-context-provider.test.ts` compares absent and disabled diagnostics output for exact equality. |
| Explicit on diagnostics-only | `runtime-memory-context-provider.test.ts` asserts one diagnostic metadata summary and unchanged result surface. |
| `contextItems` unchanged | Enabled test compares context items to baseline. |
| `evidenceRefs` unchanged | Enabled test compares provider evidence refs to baseline. |
| Bounded by limit/tokenBudget | Explicit enabled test uses small budget and limit. |
| Authority always none | Summary items and diagnostic metadata assertions plus authority scan. |
| Raw metadata/sentinel not leaked | Explicit enabled test passes raw sentinel metadata and checks serialized result. |
| Untrusted excluded by default | Explicit enabled test supplies untrusted and trusted refs. |
| Memory/source refs as anchors | Enabled test uses memory-style grounding metadata and asserts no durable fact, prompt, or provider ordering authority. |
| Memory facts not promoted | Metadata assertion and no persistence/service/mutation scans. |
| No fact acceptance / episode write / persistence side effect | No new API calls plus focused mutation scans over touched files. |
| Provider/default ordering unchanged | Existing registry manifest order assertions remain in focused validation. |
| TaskLoop/Gateway/renderer untouched | Scope scans and no touched files in those paths. |

## Implementation Conclusion

The Runtime Memory Context Provider diagnostics metadata path is the smallest accepted next runtime diagnostics consumer. It proves accepted `GroundingRef` / `GroundingQuery` summaries can enter Runtime Memory-specific metadata while remaining explicit, default-off, local, readonly, bounded, summary-only, metadata-only, durable-fact-authority-free, promotion-free, persistence-free, prompt-authority-free, provider-ordering-free, mutation-free, and non-authoritative.

Design Status: accepted
