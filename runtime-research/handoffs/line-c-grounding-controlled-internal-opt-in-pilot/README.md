# Line C Grounding Phase A: Controlled Internal Opt-in Pilot

Status: accepted.

## Allowed Surface

- Internal explicit/default-off diagnostics pilot over existing Line C consumers.
- Readonly, local, bounded, summary-only, diagnostics/metadata-only output.
- Required markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, `includeUntrusted: false`.

## Forbidden Surface

- Default-on, production users, UI/settings, Gateway/Main/renderer/host-api/api-client/provider transport changes, prompt/model-message/provider-ordering/runtime decision use, persistence, memory promotion, fact acceptance, episode writes, raw retention, untrusted refs, services/listeners/caches/exporters, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted production-entry readiness plan.
- Controlled participant list, opt-in owner, disabled-by-default gate, rollback owner, and fixture matrix.
- No new public API, config, UI, provider registration, or TaskLoop gate without a later accepted spec.

## Tests

- Harness context and validate for this spec.
- Production-entry spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Disabled parity, explicit activation, raw/untrusted/authority sentinel checks, rollback drill, diff check, README review.

## Metrics

- Consumer coverage: 5.
- Leak count: 0.
- Raw leak count: 0.
- Authority grant leak count: 0.
- Provider ordering diff count: 0.
- `includeRaw` forced false rate: 1.
- `includeUntrusted` forced false rate: 1.

## Rollback

- Close the internal pilot gate and remove cohort opt-in.
- Verify disabled output equals baseline and no persisted artifacts exist.

## Docs/i18n/E2E Requirements

- Internal handoff docs and README review required.
- No i18n/E2E unless a later accepted user-visible surface is introduced.

## Entry Criteria

- Production-entry readiness plan accepted.
- Controlled-internal readiness and authority-sentinel effectiveness accepted.
- No open raw, untrusted, authority, provider-ordering, runtime-decision, or rollback blocker.

## Exit Criteria

- Disabled parity, explicit-only activation, zero raw/untrusted leakage, `authority: "none"`, provider-ordering diff 0, bounded performance/token overhead, and rollback drill pass.

## Stop Conditions

- Any default-on drift, runtime authority claim, prompt/model-message/provider payload use, memory write, persistence, raw/untrusted leak, transport boundary violation, budget breach, or rollback failure.
