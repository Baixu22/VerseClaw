# Line C Grounding AgentMap Diagnostics Consumer Design Research

## Runtime Diagnostics Consumer Comparison

| Candidate insertion point | Shape | Benefits | Boundary risks | Decision |
| --- | --- | --- | --- | --- |
| AgentMap provider diagnostics metadata | Optional AgentMap provider option calls `createAgentMapGroundingShadowSummary()` and appends diagnostics/result metadata. | Directly proves AgentMap source, symbol, file, and evidence anchors can carry grounding summaries in a concrete provider diagnostics path. Keeps output local to the provider result. | AgentMap is prompt-adjacent because it emits `ContextItem`s and rendered content, so grounding must never add context items, prompt authority, or provider ordering authority. | Recommended |
| Runtime Memory provider diagnostics metadata | Optional memory provider option calls `createRuntimeMemoryGroundingShadowSummary()` and appends diagnostics/result metadata. | Useful later for memory refs. | Easy to confuse diagnostics with durable fact promotion or memory fact acceptance. | Rejected for this phase |
| Symbol provider diagnostics metadata | Accepted Symbol provider path with `groundingDiagnostics`. | Already proves a concrete non-mutating symbol diagnostics consumer. | Repeating it does not prove AgentMap source/symbol/file anchor behavior. | Accepted baseline, not expanded here |
| Trace Context Provider diagnostics metadata | Accepted Trace provider path with `groundingDiagnostics`. | Already proves trace diagnostics metadata consumption. | Not AgentMap-specific and does not exercise AgentMap source/file/symbol anchors. | Accepted baseline, not expanded here |
| Context Provider Registry diagnostics metadata | Accepted registry pilot `groundingShadow` path. | Proves runtime registry can carry diagnostics-only grounding metadata. | Registry-level metadata is broader than AgentMap and does not test AgentMap provider result invariants. | Accepted baseline, not expanded here |
| TaskLoop | Call grounding while runtime executes tasks. | Closest to execution. | Violates no-cutover boundary; could affect completion, blocked/failed status, retry, approval, security, tool policy, prompt assembly, or runtime state. | Rejected |
| Gateway/Main/renderer transport | Surface grounding through host API, Gateway, Main, preload, or UI. | Could expose diagnostics later. | Violates this phase by touching transport, process, CORS, UI, and user-visible behavior. | Rejected |
| Provider ordering/default registration | Register grounding-aware providers by default or rank providers from grounding output. | Conventional provider integration shape. | Violates default provider registration and ordering boundaries. | Rejected |
| Prompt assembly/model-message | Put grounding summaries into model context or prompt payloads. | Would make summaries visible to the model. | Violates explicit diagnostics-only and non-authoritative constraints. | Rejected |

## Recommended Insertion Point

Use AgentMap Context Provider diagnostics metadata. The provider is already explicit, shadow-only, disabled unless `runtime.agentMap.provider` is true, and non-authoritative for prompt/runtime behavior. The new path should add only an optional `groundingDiagnostics` construction parameter:

- absent or disabled `groundingDiagnostics` leaves AgentMap Context Provider output exactly unchanged;
- enabled `groundingDiagnostics` accepts already sanitized `GroundingRef[]`;
- the provider calls `createAgentMapGroundingShadowSummary()` with `enabled: true`;
- one diagnostic record and optional result metadata field carry bounded summary items and boundary markers;
- `contextItems`, `evidenceRefs`, provider registry ordering, prompt text, TaskLoop state, Gateway behavior, renderer transport, provider results used for prompt assembly, memory promotion, symbol mutation, patch apply, and runtime execution decisions remain unchanged.

This path is narrower than registry-level diagnostics and more appropriate than Runtime Memory for this phase because AgentMap source/symbol/file refs are naturally anchors/relevance/evidence links. They can be inspected as diagnostics metadata without becoming provider-ordering or prompt authority.

## Rejected Alternatives

| Alternative | Rejection reason |
| --- | --- |
| TaskLoop | It is an execution authority surface and can influence completion, blocked/failed status, retry, approval, security, tool policy, or runtime state. |
| Gateway | It is a transport/process boundary and would create user-visible or protocol behavior outside a minimal runtime diagnostic path. |
| Provider ordering/default registration | Grounding must not rank providers, change default registration, alter ordering, or select the AgentMap provider. |
| Prompt assembly/model-message | Grounding output must not enter model messages or authoritative context assembly. |
| Memory promotion | Grounding summaries can describe memory refs but cannot promote durable facts. |
| Renderer transport | Renderer/Main/host-api/api-client paths are out of scope and should remain untouched. |
| Patch apply/workspace edit | AgentMap grounding may describe source/file/symbol anchors only; it must not apply patches, rename, edit, or safe-delete. |
| Symbol mutation | AgentMap symbol refs are anchors only and cannot mutate symbols or workspace state. |

## Data Flow

1. AgentMap source/evidence/symbol/file refs are projected into accepted `GroundingRef` values by the existing grounding spine.
2. A caller explicitly constructs AgentMap Context Provider with `groundingDiagnostics: { enabled: true, refs, limit, tokenBudget, query, metadata }`.
3. AgentMap Context Provider resolves its normal flag, result, fallback, and diagnostic paths exactly as before.
4. The provider calls `createAgentMapGroundingShadowSummary(refs, options)` for diagnostics only.
5. The provider appends one `RuntimeRegistryDiagnostic` whose metadata contains bounded summary items and boundary markers.
6. The provider result metadata receives a bounded `groundingDiagnostics` metadata object for inspection only.
7. Runtime output remains shadow-only: `contextItems`, `evidenceRefs`, provider ordering, prompt text, TaskLoop, Gateway, renderer transport, provider results used for prompt assembly, memory promotion, symbol mutation, patch apply, and runtime execution are unchanged by grounding.

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence required |
| --- | --- | --- | --- |
| Default-off behavior changes existing provider output | Existing callers observe new metadata or diagnostics unexpectedly. | Do nothing when `groundingDiagnostics` is absent or disabled. | Compare absent and disabled output to the existing baseline. |
| Grounding output affects context items or prompt material | Diagnostics become an authoritative context cutover. | Emit only diagnostic/result metadata and never map grounding items to `ContextItem`s. | Explicit enabled test asserts `contextItems` are unchanged from baseline. |
| Grounding output changes provider evidence refs | Diagnostics alter downstream evidence surfaces. | Do not add grounding diagnostic evidence refs beyond the provider's normal diagnostic ref. | Explicit enabled test asserts `evidenceRefs` are unchanged from baseline. |
| Raw metadata leaks through diagnostic metadata | Security/privacy boundary violation. | Reuse accepted shadow helper sanitizer and emit summary items only. | Raw sentinel test over serialized provider result. |
| Untrusted refs included by default | Trust boundary violation. | Let helper force `includeUntrusted: false`. | Enabled test supplies trusted and untrusted refs and asserts only trusted output. |
| Authority marker drifts | Grounding authority becomes ambiguous. | Copy accepted summary helper markers only. | Unit assertions and authority scan. |
| AgentMap refs become prompt/provider ordering authority | AgentMap anchors influence prompt assembly or provider ranking. | Preserve `noPromptAuthority`, `noProviderOrderingAuthority`, and metadata-only output. | Enabled test checks metadata markers and unchanged context items. |
| Provider registry/default ordering changes | Runtime provider behavior changes. | Avoid registry construction changes; update only AgentMap provider options. | Registry ordering test remains stable. |
| Memory facts promoted from grounding | Durable state mutation. | Add no memory API calls and preserve no-memory-promotion markers. | Unit assertion and persistence/service scans. |
| Patch or symbol mutation appears | Grounding becomes mutation planning. | Add no patch helpers, workspace edit calls, symbol edit APIs, or mutation metadata. | Unit assertion and mutation scan. |

## Test Matrix

| Requirement | Focused test |
| --- | --- |
| Default-off unchanged | `runtime-agent-map-context-provider.test.ts` compares absent and disabled diagnostics output for exact equality. |
| Explicit on diagnostics-only | `runtime-agent-map-context-provider.test.ts` asserts one diagnostic metadata summary and unchanged result surface. |
| `contextItems` unchanged | Enabled test compares context items to baseline. |
| `evidenceRefs` unchanged | Enabled test compares provider evidence refs to baseline. |
| Bounded by limit/tokenBudget | Explicit enabled test uses small budget and limit. |
| Authority always none | Summary items and diagnostic metadata assertions plus authority scan. |
| Raw metadata/sentinel not leaked | Explicit enabled test passes raw sentinel metadata and checks serialized result. |
| Untrusted excluded by default | Explicit enabled test supplies untrusted and trusted refs. |
| Source/symbol/file refs as anchors | Enabled test uses AgentMap-style grounding metadata and asserts no prompt/provider ordering authority. |
| Memory facts not promoted | Metadata assertion and no persistence/service scans. |
| Provider/default ordering unchanged | Existing registry manifest order assertions remain in focused validation. |
| TaskLoop/Gateway/renderer untouched | Scope scans and no touched files in those paths. |

## Implementation Conclusion

The AgentMap Context Provider diagnostics metadata path is the smallest accepted next runtime diagnostics consumer. It proves accepted `GroundingRef` / `GroundingQuery` summaries can enter AgentMap-specific metadata while remaining explicit, default-off, local, readonly, bounded, summary-only, metadata-only, prompt-authority-free, provider-ordering-free, mutation-free, and non-authoritative.

Design Status: accepted
