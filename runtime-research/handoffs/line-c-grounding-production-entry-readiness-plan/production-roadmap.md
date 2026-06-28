# Line C Grounding Production Roadmap

This roadmap defines the required phases after production-entry readiness planning. Every phase requires a fresh accepted task spec before implementation.

## Phase A: Controlled Internal Opt-in Pilot

| Area | Requirement |
| --- | --- |
| Allowed surface | Internal explicit/default-off diagnostics pilot over existing Line C consumers; readonly, local, bounded, summary-only, diagnostics/metadata-only; `authority: "none"` and `rawRetained: false`. |
| Forbidden surface | Default-on, production users, UI/settings, Gateway/Main/renderer/host-api/api-client changes, prompt/model-message/provider-ordering/runtime decision use, persistence, memory promotion, fact acceptance, episode writes, raw retention, untrusted refs, services, listeners, caches, patch apply, workspace edit, symbol mutation. |
| Implementation prerequisites | Fresh task spec; controlled participant list; opt-in owner; disabled-by-default gate; fixture matrix from controlled-internal readiness; no new config or public API unless the spec explicitly accepts it. |
| Tests | Spec context/validate; predecessor spec validates; seven-file grounding diagnostics unit suite; disabled parity tests; explicit opt-in tests; sentinel/raw/untrusted scans; diff check. |
| Metrics | Consumer coverage 5; leak count 0; raw leak count 0; authority grant leak count 0; includeRaw forced false rate 1; includeUntrusted forced false rate 1; provider ordering diff count 0; opt-in sample count; disabled parity count. |
| Rollback | Remove pilot spec/artifacts and close the opt-in gate; no data cleanup because there must be no persistence. |
| Docs/i18n/E2E requirements | Internal handoff docs only unless UI is explicitly accepted by a later spec; README review required; no i18n/E2E unless user-visible surface is introduced by that future spec. |
| Entry criteria | Current production-entry plan accepted; controlled-internal readiness accepted; authority-sentinel effectiveness accepted; no open raw/authority leakage. |
| Exit criteria | Pilot evidence shows disabled parity, explicit-only activation, no raw/untrusted retention, no authority, no provider-ordering drift, no performance regression, and successful rollback drill. |
| Stop conditions | Any default-on drift, runtime authority claim, prompt/model-message/provider payload use, memory write/promotion, persistence, raw/untrusted leak, transport boundary violation, or rollback failure. |

## Phase B: Diagnostics Presentation/Operator Readiness

| Area | Requirement |
| --- | --- |
| Allowed surface | Safe aggregate diagnostics presentation plan and operator runbook; metadata-only summaries; no raw values; no live production UI unless separately accepted. |
| Forbidden surface | Raw prompts/traces/payloads/tool args/output/stdout/stderr/env/secrets/API keys/auth headers/trace-context baggage; untrusted refs; runtime authority; prompt/model-message/provider-ordering/runtime decision use; renderer/Main/Gateway/host-api/api-client changes without a future accepted UI/API spec. |
| Implementation prerequisites | Fresh task spec; display redaction contract; operator vocabulary; aggregate metrics schema; i18n key plan if UI is proposed; E2E plan if UI is proposed. |
| Tests | Redaction tests; aggregate-only snapshot tests; no raw sentinel display tests; docs/i18n completeness if UI exists; E2E if UI exists; predecessor validations. |
| Metrics | Redaction pass rate 1; raw display count 0; authority display count 0; i18n missing key count 0 if UI exists; operator action ambiguity count 0. |
| Rollback | Hide or remove presentation surface; retain internal diagnostics disabled; no migration because presentation must not persist raw data. |
| Docs/i18n/E2E requirements | Operator runbook required; README review required; full en/zh/ja/ru locale coverage and Electron E2E required only if user-visible UI is accepted. |
| Entry criteria | Phase A accepted; aggregate metrics stable; redaction contract approved. |
| Exit criteria | Operators can interpret diagnostics without raw data, authority claims, or runtime action coupling. |
| Stop conditions | Any raw display, ambiguous authority wording, direct renderer IPC/Gateway call, missing locale coverage for user-visible UI, or presentation that implies production authority. |

## Phase C: Limited Production Opt-in, Still Diagnostics-only

| Area | Requirement |
| --- | --- |
| Allowed surface | Narrow limited production opt-in for diagnostics metadata only, with explicit owner approval and bounded sampling. |
| Forbidden surface | Default-on rollout, prompt/model-message/provider-ordering/runtime decision influence, Gateway/provider transport mutation, persistence beyond an explicitly accepted safe aggregate if any, memory promotion/fact acceptance/episode write, raw retention, UI cutover unless separately accepted. |
| Implementation prerequisites | Fresh task spec; production opt-in owner; sampling limits; budget guard; operator escalation path; rollback drill; privacy/security review. |
| Tests | Disabled parity; explicit opt-in; production-like replay; budget/token/performance tests; raw/untrusted/authority sentinel tests; transport boundary scans; comms replay/compare if communication paths are touched. |
| Metrics | Opt-in count; sample volume; p95 overhead; token delta; leak counts all 0; provider ordering diff count 0; rollback time objective met. |
| Rollback | Disable production opt-in gate; remove sampling; verify default behavior parity; clean only accepted aggregate artifacts if a later spec allowed them. |
| Docs/i18n/E2E requirements | Operator docs and rollback runbook required; README review required; user-visible docs/i18n/E2E only if that future spec adds user-visible surface. |
| Entry criteria | Phase B accepted; opt-in owners identified; risk register has no open high-risk blocker. |
| Exit criteria | Limited production diagnostics run with no authority, no raw/untrusted leakage, bounded overhead, and successful rollback proof. |
| Stop conditions | Any production-default activation, raw/sensitive leak, untrusted ref leak, provider ordering drift, runtime decision coupling, performance budget breach, or operator inability to roll back. |

## Phase D: Runtime Shadow Replay Proof

| Area | Requirement |
| --- | --- |
| Allowed surface | Offline or controlled shadow replay proof using sanitized diagnostics metadata and existing accepted consumers. |
| Forbidden surface | Live runtime authority, prompt/model-message/provider transport injection, provider ordering changes, durable memory promotion, persistence of raw replay payloads, services/listeners/exporters, patch or symbol mutation. |
| Implementation prerequisites | Fresh task spec; sanitized replay corpus; deterministic replay harness; no raw artifact retention; baseline provider/order snapshots. |
| Tests | Replay determinism; disabled parity; authority/raw/untrusted sentinel replay; provider ordering snapshot; budget/performance replay; rollback/no-residue scan. |
| Metrics | Replay pass rate; deterministic diff count 0; raw leak count 0; authority leak count 0; provider ordering diff count 0; p95 replay overhead within spec budget. |
| Rollback | Remove replay artifacts and spec; keep runtime paths unchanged; verify no persisted replay payloads exist. |
| Docs/i18n/E2E requirements | Replay report required; README review required; no i18n/E2E unless a later user-visible surface is accepted. |
| Entry criteria | Phase C accepted; replay corpus sanitized and approved; baseline snapshots defined. |
| Exit criteria | Shadow replay proves diagnostics remain non-authoritative and stable under production-like traces without raw retention. |
| Stop conditions | Replay requires raw prompts/traces/payloads, changes runtime behavior, persists raw data, or shows provider/order/runtime drift. |

## Phase E: Cutover Readiness Review

| Area | Requirement |
| --- | --- |
| Allowed surface | Readiness review, veto gates, scorecard, and go/no-go recommendation only. |
| Forbidden surface | Actual cutover, default-on behavior, runtime authority, prompt/model-message/provider-ordering/runtime decision changes, persistence, UI, or transport changes. |
| Implementation prerequisites | Fresh task spec; Phase A-D evidence accepted; owner review; security/privacy review; support and rollback owner approval. |
| Tests | Evidence audit; full required validation matrix; boundary scans; README review; comms replay/compare if any comms path is touched by the review artifacts. |
| Metrics | Scorecard threshold; open blocker count 0; veto count 0; rollback confidence score 1; docs/readiness coverage 1. |
| Rollback | Reject cutover and return to diagnostics-only phase; remove review marker; no runtime cleanup. |
| Docs/i18n/E2E requirements | Cutover readiness report required; docs update only if future behavior/API/UI changes are accepted. |
| Entry criteria | Phase D accepted with zero authority/raw/untrusted drift and acceptable budget/performance. |
| Exit criteria | Explicit recommendation for Phase F, needs_revision, or blocked with evidence. |
| Stop conditions | Any unresolved high-risk item, incomplete rollback proof, missing owner approval, or evidence that diagnostics can influence runtime decisions. |

## Phase F: Controlled Production Opt-in

| Area | Requirement |
| --- | --- |
| Allowed surface | Controlled production opt-in under a fresh accepted implementation spec, still bounded and owner-approved. |
| Forbidden surface | Default-on behavior, unbounded rollout, raw retention, untrusted refs, provider-ordering drift, prompt/model-message injection beyond what a future spec explicitly authorizes, memory promotion without separate accepted authority spec, services/listeners/exporters unless separately accepted. |
| Implementation prerequisites | Fresh task spec; Phase E go recommendation; production owner approval; rollout cohort; hard rollback switch; observability and privacy gates. |
| Tests | Full focused unit suite; production-like replay; transport/comms checks if touched; E2E/i18n if UI exists; performance budget; raw/untrusted/authority sentinel checks; rollback drill. |
| Metrics | Cohort size; error rate; p95 latency/token delta; leak counts 0; rollback time; operator acknowledgement; no provider ordering/runtime decision diff unless explicitly accepted by that future spec. |
| Rollback | Disable opt-in; restore diagnostics-only behavior; verify no default cohorts remain; remove any accepted aggregate presentation surface if unsafe. |
| Docs/i18n/E2E requirements | Operator docs, support docs, and README review required; user-visible docs/i18n/E2E required if the future spec adds UI or settings. |
| Entry criteria | Phase E accepted; production owner approval; no open veto gates. |
| Exit criteria | Controlled opt-in runs within metrics, with no raw/untrusted/authority leakage and proven rollback. |
| Stop conditions | Any default-on drift, operator confusion, leakage, budget breach, provider ordering drift, runtime authority drift, or rollback failure. |

## Phase G: Default-on Proposal, Proposal Only

| Area | Requirement |
| --- | --- |
| Allowed surface | Proposal document only, unless a later task spec explicitly accepts default-on implementation. |
| Forbidden surface | Default-on implementation, silent rollout, automatic provider registration/order change, prompt/model-message/runtime decision authority, memory promotion, persistence, UI/settings default change, or production behavior change. |
| Implementation prerequisites | Fresh proposal spec; accepted Phase F evidence; owner and security review; migration/rollback plan; public docs/i18n/E2E plan if ever implemented. |
| Tests | Proposal validation; evidence completeness audit; default-on risk simulation plan; rollback plan review; no runtime code tests unless a later implementation spec is accepted. |
| Metrics | Evidence completeness; unresolved risk count; rollback confidence; user-impact analysis completeness; leak counts remain 0 in prior evidence. |
| Rollback | Reject proposal and retain controlled opt-in or diagnostics-only status. |
| Docs/i18n/E2E requirements | Proposal docs required; implementation docs/i18n/E2E deferred to a future accepted default-on spec. |
| Entry criteria | Phase F accepted with stable metrics and owner approval to draft a proposal. |
| Exit criteria | Proposal accepted for future implementation planning, needs_revision, or blocked. |
| Stop conditions | Any attempt to treat proposal as implementation approval, any unresolved high-risk item, missing public docs/i18n/E2E plan, or missing rollback plan. |
