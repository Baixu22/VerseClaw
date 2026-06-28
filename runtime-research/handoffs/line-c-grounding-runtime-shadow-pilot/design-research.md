# Line C Grounding Runtime Shadow Pilot Design Research

## Runtime Insertion Point Comparison

| Candidate insertion point | Shape | Benefits | Boundary risks | Decision |
| --- | --- | --- | --- | --- |
| Context Provider Registry pilot diagnostics | Optional parameter on `runContextProviderRegistryPilot()` calls accepted grounding shadow summary helper and appends one diagnostic/metadata record only when explicitly enabled. | Already shadow-only, registry pilot is explicit, diagnostics are non-authoritative, and provider ordering can be asserted unchanged. | Must not add default providers, context items, prompt text, or runtime decisions. | Recommended |
| Trace Context Provider diagnostics | Extend `createRuntimeTraceContextProvider()` diagnostics with grounding summary metadata. | Trace provider is readonly and already budgeted. | Narrows pilot to trace only and requires provider flag interaction; less representative for Runtime Memory/AgentMap/Symbol refs. | Acceptable later, not first pilot |
| Runtime Memory provider diagnostics | Attach grounding summary to memory provider result metadata. | Good memory-promotion boundary coverage. | Easy to confuse with memory fact promotion and requires provider flag interaction. | Rejected for first pilot |
| AgentMap/Symbol provider diagnostics | Attach grounding summary to readonly provider metadata. | Good source/symbol anchor coverage. | Too consumer-specific and duplicates readiness layer. | Rejected for first pilot |
| TaskLoop | Call grounding during task execution loop. | Closest to runtime execution. | Violates no-cutover boundary; could affect completion, retry, approval, prompt, or runtime state. | Rejected |
| Gateway/Main/renderer transport | Surface grounding through host or Gateway routes. | User-observable diagnostics could be displayed later. | Violates this phase by touching transport/UI and comms behavior. | Rejected |
| Provider ordering/default registration | Register grounding as a default context provider. | Conventional registry shape. | Violates default provider registration and ordering boundaries. | Rejected |

## Recommended Insertion Point

Use the Context Provider Registry pilot because it is already an explicit shadow runtime path. The implementation should add an optional `groundingShadow` parameter to `runContextProviderRegistryPilot()` and do nothing when that parameter is absent or disabled.

When `groundingShadow.enabled === true`, runtime may:

- accept already sanitized `GroundingRef[]`;
- call `createGroundingShadowConsumerSummary()` with a Context Provider Registry consumer id;
- append a single `RuntimeRegistryDiagnostic` whose metadata contains bounded summary items and boundary markers;
- expose the same summary on the result as optional diagnostics metadata for test inspection.

The call must not add `ContextItem`s, provider results used for prompt assembly, registry entries, default providers, TaskLoop state, Gateway events, renderer transport, or provider ordering changes.

## Rejected Alternatives

| Alternative | Rejection reason |
| --- | --- |
| TaskLoop | It is an execution authority surface and can influence completion, blocked/failed status, retry, approval, security, tool policy, or runtime state. |
| Gateway | It is a transport/process boundary and would create user-visible or protocol behavior outside a minimal runtime diagnostic pilot. |
| Provider ordering | Grounding must not rank providers, change default registration, or alter ordering. |
| Prompt assembly | Grounding output must not enter model messages or authoritative context assembly. |
| Memory promotion | Grounding summaries can describe memory refs but cannot promote durable facts. |
| Renderer transport | Renderer/Main/host-api/api-client paths are out of scope and should remain untouched. |

## Data Flow

1. Producer refs: accepted `GroundingRef` values from grounding spine or shadow consumer readiness callers.
2. Explicit runtime pilot option: caller passes `groundingShadow: { enabled: true, refs, limit, tokenBudget, query, metadata }` to `runContextProviderRegistryPilot()`.
3. Shadow helper: registry pilot calls `createGroundingShadowConsumerSummary(refs, options)`.
4. Diagnostics metadata: registry pilot appends a `RuntimeRegistryDiagnostic` with `authority: "none"`, `rawRetained: false`, item counts, budget fields, and bounded `summary.items`.
5. Runtime output remains shadow-only: `contextItems`, provider ordering, provider results, prompt text, TaskLoop, Gateway, renderer transport, and memory promotion are unchanged by grounding.

## Risk Matrix

| Risk | Impact | Mitigation | Test evidence required |
| --- | --- | --- | --- |
| Default-off behavior changes existing registry output | Existing callers observe new diagnostics unexpectedly. | Do nothing when `groundingShadow` is absent or disabled. | Compare flag-off/default result diagnostics, provider results, context items, and registry order. |
| Grounding output affects prompt/context | Runtime cutover by accident. | Emit diagnostics metadata only; never create `ContextItem`s from grounding. | Explicit enabled test asserts context items unchanged and no provider result added. |
| Raw metadata leaks through diagnostic | Security/privacy boundary violation. | Reuse accepted shadow helper sanitizer and emit summary items only. | Raw sentinel test over diagnostic/result JSON. |
| Untrusted refs are included by default | Trust boundary violation. | Force `includeUntrusted: false` through helper query. | Test untrusted ref omitted and count recorded. |
| Authority marker drifts | Grounding becomes ambiguous. | Use existing `GROUNDING_REF_AUTHORITY` and summary helper output. | Authority scan and unit assertions. |
| Provider ordering/default registration changes | Runtime behavior change. | Avoid `createContextProviderRegistryPilot()` defaults; only `runContextProviderRegistryPilot()` optional result metadata. | Registry ordering test. |
| Memory facts promoted from grounding | Durable state change. | Metadata includes no-memory-promotion markers; no memory APIs called. | Unit assertion and persistence scan. |

## Test Matrix

| Requirement | Focused test |
| --- | --- |
| Default-off unchanged | `context-provider-registry.test.ts` compares no-option/disabled grounding runs with existing output shape. |
| Explicit on diagnostics-only | `context-provider-registry.test.ts` asserts one diagnostic metadata summary and unchanged context items/provider results. |
| Bounded by limit/tokenBudget | Explicit enabled test uses small budget and limit. |
| Authority always none | Summary items and diagnostic metadata assertions plus authority scan. |
| Raw metadata/sentinel not leaked | Explicit enabled test passes raw sentinel metadata and checks serialized result. |
| Untrusted excluded by default | Explicit enabled test supplies untrusted and trusted refs. |
| Source/symbol refs as anchors | Explicit enabled test uses source/symbol grounding fixtures and asserts no context item/prompt authority. |
| Memory facts not promoted | Metadata assertion and no persistence/service scans. |
| Provider/default ordering unchanged | Registry manifest order assertions. |
| TaskLoop/Gateway/renderer untouched | Scope scan and no touched files in those paths. |

## Implementation Conclusion

The Context Provider Registry pilot diagnostic path is the smallest accepted runtime shadow pilot. It gives runtime an explicit call to the accepted grounding shadow summary helper while keeping output diagnostics/metadata-only, default-off, local, readonly, bounded, summary-only, and non-authoritative.

Design Status: accepted
