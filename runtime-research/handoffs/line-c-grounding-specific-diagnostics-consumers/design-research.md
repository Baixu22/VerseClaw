# Line C Grounding Specific Diagnostics Consumers Design Research

## Runtime Diagnostics Consumer Comparison

| Candidate insertion point | Shape | Benefits | Boundary risks | Decision |
| --- | --- | --- | --- | --- |
| Runtime Memory provider diagnostics metadata | Optional memory provider option calls `createRuntimeMemoryGroundingShadowSummary()` and appends diagnostics/result metadata. | Exercises memory boundary directly. | Easy to confuse diagnostics with durable fact promotion or memory fact acceptance. Requires extra proof that no memory APIs are called. | Rejected for this phase |
| AgentMap provider diagnostics metadata | Optional AgentMap provider option calls `createAgentMapGroundingShadowSummary()` and appends diagnostics/result metadata. | Good source/symbol anchor coverage and already readonly/shadow-only. | AgentMap provider has runtime flag interaction and richer prompt-adjacent context output, so diagnostics could be mistaken for prompt authority. | Acceptable later |
| Symbol provider diagnostics metadata | Optional Symbol Context Provider option calls `createSymbolGroundingShadowSummary()` and appends diagnostics/result metadata. | Narrowest specific readonly consumer. Existing provider is shadow-only, symbol-mutation-free, and already carries `noSymbolMutation` / `noPromptAuthority` / `noRuntimeAuthority` metadata. | Must not turn grounding refs into symbol context items or symbol edit/apply behavior. | Recommended |
| Trace Context Provider diagnostics metadata | Existing accepted path with `groundingDiagnostics` on Trace provider. | Already proven specific runtime diagnostics expansion. | Repeating it would not expand into another consumer. | Accepted baseline, not expanded here |
| Context Provider Registry diagnostics metadata | Existing accepted pilot with `groundingShadow`. | Already proven runtime pilot call path and provider ordering tests. | Registry-level path is less specific than this phase requires. | Accepted baseline, not expanded here |
| TaskLoop | Call grounding while runtime executes tasks. | Closest to runtime execution. | Violates no-cutover boundary; could affect completion, retry, approval, security, tool policy, prompt assembly, or runtime state. | Rejected |
| Gateway/Main/renderer transport | Surface grounding through host API, Gateway, or UI. | Could make diagnostics visible later. | Violates this phase by touching transport/UI/comms behavior. | Rejected |
| Provider ordering/default registration | Register grounding or grounding-aware providers by default. | Conventional registry shape. | Violates default provider registration and ordering boundaries. | Rejected |
| Prompt assembly/model-message | Put grounding summaries into model context. | Would expose summaries to the model. | Violates explicit diagnostics-only and non-authoritative constraints. | Rejected |

## Recommended Insertion Point

Use Symbol Context Provider diagnostics metadata. It is a concrete runtime diagnostics consumer after the accepted registry pilot and Trace provider expansion, but it is safer than Runtime Memory for this phase because it does not own durable facts or promotion. It is also narrower than AgentMap because it focuses on symbol anchors and readonly overview diagnostics without AgentMap's ranking/prompt-adjacent result shape.

The implementation should add an optional `groundingDiagnostics` provider-construction parameter:

- absent or disabled `groundingDiagnostics` leaves Symbol Context Provider behavior unchanged;
- enabled `groundingDiagnostics` accepts already sanitized `GroundingRef[]`;
- the provider calls `createSymbolGroundingShadowSummary()` with `enabled: true`;
- one diagnostic record and optional result metadata field carry bounded summary metadata;
- `contextItems`, provider registry ordering, prompt text, TaskLoop state, Gateway behavior, renderer transport, provider results used for prompt assembly, memory promotion, symbol mutation, and runtime execution decisions remain unchanged.

## Rejected Alternatives

| Alternative | Rejection reason |
| --- | --- |
| TaskLoop | It is an execution authority surface and can influence completion, blocked/failed status, retry, approval, security, tool policy, or runtime state. |
| Gateway | It is a transport/process boundary and would create user-visible or protocol behavior outside a minimal runtime diagnostic path. |
| Provider ordering/default registration | Grounding must not rank providers, change default registration, or alter ordering. |
| Prompt assembly/model-message | Grounding output must not enter model messages or authoritative context assembly. |
| Memory promotion | Grounding summaries can describe memory refs but cannot promote durable facts. Runtime Memory is deferred to avoid confusing diagnostics with fact promotion. |
| Renderer transport | Renderer/Main/host-api/api-client paths are out of scope and should remain untouched. |
| Symbol mutation/edit/apply | Symbol grounding may describe anchors only; it must not rename, edit, safe-delete, or apply symbol/workspace changes. |

## Data Flow

1. Source/evidence/symbol/memory/trace refs are projected into accepted `GroundingRef` values by the existing grounding spine.
2. A caller explicitly constructs Symbol Context Provider with `groundingDiagnostics: { enabled: true, refs, limit, tokenBudget, query, metadata }`.
3. Symbol Context Provider resolves its normal fallback/overview/diagnostic input and builds `contextItems` exactly as before.
4. The provider calls `createSymbolGroundingShadowSummary(refs, options)` for diagnostics only.
5. The provider appends one `RuntimeRegistryDiagnostic` whose metadata contains bounded summary items and boundary markers.
6. The provider result metadata receives a bounded `groundingDiagnostics` metadata object for inspection only.
7. Runtime output remains shadow-only: `contextItems`, provider ordering, prompt text, TaskLoop, Gateway, renderer transport, provider results used for prompt assembly, memory promotion, symbol mutation, and runtime execution are unchanged by grounding.

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence required |
| --- | --- | --- | --- |
| Default-off behavior changes existing provider output | Existing callers observe new metadata or diagnostics unexpectedly. | Do nothing when `groundingDiagnostics` is absent or disabled. | Compare absent and disabled output to the existing baseline. |
| Grounding output affects context items or prompt material | Diagnostics become an authoritative context cutover. | Emit only diagnostic/result metadata and never map grounding items to `ContextItem`s. | Explicit enabled test asserts `contextItems` are unchanged from baseline. |
| Raw metadata leaks through diagnostic metadata | Security/privacy boundary violation. | Reuse accepted shadow helper sanitizer and emit summary items only. | Raw sentinel test over serialized provider result. |
| Untrusted refs included by default | Trust boundary violation. | Let helper force `includeUntrusted: false`. | Enabled test supplies trusted and untrusted refs and asserts only trusted output. |
| Authority marker drifts | Grounding authority becomes ambiguous. | Copy accepted summary helper markers only. | Unit assertions and authority scan. |
| Provider registry/default ordering changes | Runtime provider behavior changes. | Avoid registry construction changes; update only Symbol provider options. | Registry ordering test remains stable. |
| Memory facts promoted from grounding | Durable state mutation. | Add no memory API calls and preserve no-memory-promotion metadata markers. | Unit assertion and persistence/service scans. |
| Symbol edit/apply behavior appears | Grounding becomes mutation planning. | Add no symbol edit APIs, patch helpers, workspace edit calls, or mutation metadata. | Unit assertion and mutation scan. |

## Test Matrix

| Requirement | Focused test |
| --- | --- |
| Default-off unchanged | `runtime-symbol-context-provider.test.ts` compares absent/disabled diagnostics output with existing provider result. |
| Explicit on diagnostics-only | `runtime-symbol-context-provider.test.ts` asserts one diagnostic metadata summary and unchanged context items. |
| Bounded by limit/tokenBudget | Explicit enabled test uses small budget and limit. |
| Authority always none | Summary items and diagnostic metadata assertions plus authority scan. |
| Raw metadata/sentinel not leaked | Explicit enabled test passes raw sentinel metadata and checks serialized result. |
| Untrusted excluded by default | Explicit enabled test supplies untrusted and trusted refs. |
| Source/symbol refs as anchors | Enabled test uses symbol/source grounding metadata and asserts no context item/prompt/symbol mutation authority. |
| Memory facts not promoted | Metadata assertion and no persistence/service scans. |
| Provider/default ordering unchanged | Existing registry manifest order assertions remain in focused validation. |
| TaskLoop/Gateway/renderer untouched | Scope scans and no touched files in those paths. |

## Implementation Conclusion

The Symbol Context Provider diagnostics metadata path is the smallest accepted next runtime diagnostics consumer. It proves accepted `GroundingRef` / `GroundingQuery` summaries can enter another concrete runtime diagnostics path while remaining explicit, default-off, local, readonly, bounded, summary-only, metadata-only, symbol-mutation-free, and non-authoritative.

Design Status: accepted
