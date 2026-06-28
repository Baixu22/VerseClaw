# Line C Grounding Phase B: Diagnostics Presentation Operator Readiness

Status: accepted.

## Allowed Surface

- Operator runbook and aggregate/summary-only diagnostics presentation requirements.
- Metadata-only summaries with no raw values or untrusted refs.
- Wording that keeps diagnostics non-authoritative.
- Required output markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Raw prompt/trace/payload/tool args/output/stdout/stderr/env/secrets/API keys/auth headers/traceparent/tracestate/baggage display or retention.
- Runtime authority wording, prompt/model-message/provider-ordering/runtime-decision use, UI/settings implementation without full i18n/E2E, transport changes, persistence, memory writes, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase A synthesis.
- Redaction contract, operator vocabulary, aggregate metrics schema, and UI/i18n/E2E plan if a later spec proposes user-visible UI.

## Tests

- Harness context and validate for this spec.
- Phase A spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Redaction tests, aggregate-only tests, no-raw/no-authority display scans, diff check, README review.

## Metrics

- Redaction pass rate: 1.
- Raw display count: 0.
- Authority display count: 0.
- Untrusted ref display count: 0.
- Missing locale key count: 0 if UI is later accepted.

## Rollback

- Hide or remove presentation/runbook artifacts and return to internal diagnostics-only operation.
- Verify no raw display cache, stale authority wording, or missing-locale user-visible surface remains.

## Docs/i18n/E2E Requirements

- Operator runbook required.
- README review required.
- en/zh/ja/ru locale coverage and Electron E2E required only if a later accepted UI spec adds user-visible UI.

## Entry Criteria

- Phase A accepted.
- Aggregate metrics and redaction contract approved.

## Exit Criteria

- Operators can interpret diagnostics using aggregate metadata only, without raw data, authority claims, or runtime action coupling.

## Stop Conditions

- Any raw display, ambiguous authority wording, direct renderer IPC/Gateway call, missing locale coverage for user-visible UI, or presentation that implies production authority.
