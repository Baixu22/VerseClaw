# Line C Grounding Controlled Internal Opt-in Readiness Design Research

## Design Question

Can Line C move from authority-sentinel effectiveness evaluation to controlled internal opt-in readiness without widening its production surface?

## Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Stage shape | accepted: readiness/report-only | The existing five diagnostics consumers and quantitative effectiveness test already prove the relevant behavior; this stage needs registration and validation evidence, not new runtime code. |
| Opt-in boundary | accepted: internal explicit/default-off diagnostics only | Existing `groundingShadow` and `groundingDiagnostics` options require explicit enablement and are absent from default behavior. |
| Runtime authority | rejected | Diagnostics must remain non-authoritative and carry `authority: "none"` rather than influencing decisions. |
| Prompt/model-message/provider ordering | rejected | Those surfaces would turn diagnostics into execution inputs; they require a later, narrower accepted spec and are not authorized here. |
| Persistence/service/cache/exporter/listener | rejected | Readiness evidence must not create durable state, sidecars, listeners, or background services. |
| UI/public API/settings | rejected | Controlled internal readiness is not user-visible and does not add settings, commands, routes, or public API contracts. |
| Deep validation | accepted | Reuse the quantitative sentinel effectiveness metrics, required focused unit tests, boundary scans, and README review. |
| Rollback | accepted: delete docs/spec/index entry only | No runtime code, data, migration, cache, or sidecar is added by this stage. |

## Evidence Chain

Predecessor accepted stages established:

- GroundingRef/GroundingQuery spine with raw-retention boundaries.
- Explicit shadow consumer helper.
- Registry runtime shadow diagnostics.
- Trace, Symbol, AgentMap, and Runtime Memory diagnostics consumers.
- Cross-consumer audit and drift guard.
- Authority sentinel hardening.
- Quantitative effectiveness evaluation across all five consumers.

## Accepted Readiness Definition

Controlled internal opt-in readiness means Line C can be referenced by internal diagnostics callers that explicitly enable existing diagnostics paths. It does not mean default-on readiness, production readiness, UI readiness, prompt-readiness, provider-ordering readiness, runtime-decision readiness, persistence readiness, or memory-promotion readiness.

Design Status: accepted
