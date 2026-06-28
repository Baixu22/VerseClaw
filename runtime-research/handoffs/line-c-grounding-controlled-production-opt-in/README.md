# Line C Grounding Phase F: Controlled Production Opt-in

Status: accepted.

## Allowed Surface

- Controlled production opt-in for diagnostics-only Line C runtime use after Phase E go recommendation.
- Explicit/default-off, owner-approved, cohort-limited, bounded, privacy-reviewed, support-reviewed, and rollbackable diagnostics metadata.
- Required output markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Default-on behavior, unbounded rollout, raw retention, untrusted refs, provider-ordering drift, runtime decision drift, prompt/model-message injection, memory promotion, fact acceptance, episode write, persistence, services/listeners/exporters, UI/settings without full i18n/E2E, transport changes without comms validation, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase E go recommendation.
- Production owner approval, cohort, hard rollback switch, observability/privacy/support gates, budget guardrails, and rollback drill.

## Tests

- Harness context and validate for this spec.
- Phase E spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Production-like replay, transport/comms checks if touched, E2E/i18n if UI exists, performance budget, raw/untrusted/authority sentinel checks, rollback drill, diff check, README review.

## Metrics

- Cohort size and opt-in count.
- Error rate.
- p95 latency and token delta within budget.
- Leak counts: 0.
- Provider ordering diff count: 0.
- Runtime decision diff count: 0.
- Rollback drill pass and rollback time objective met.

## Rollback

- Disable opt-in, verify cohort count 0, restore diagnostics-only or disabled behavior, and record rollback time.
- Remove any accepted aggregate presentation surface if unsafe; raw artifacts must not exist.

## Docs/i18n/E2E Requirements

- Operator docs, support docs, and README review required.
- User-visible docs/i18n/E2E required if a later implementation adds UI or settings.

## Entry Criteria

- Phase E accepted with go recommendation.
- Production owner approval and zero open veto gates.

## Exit Criteria

- Controlled opt-in runs within metrics with no raw/untrusted/authority leakage, no provider ordering/runtime decision drift, and proven rollback.

## Stop Conditions

- Default-on drift, operator confusion, leakage, budget breach, provider ordering drift, runtime authority drift, runtime decision drift, or rollback failure.
