# Line C Grounding Phase E: Cutover Readiness Review

Status: accepted.

## Allowed Surface

- Readiness scorecard, veto gates, owner/security/support review, and explicit Phase F go/no-go recommendation.
- Evidence audit for accepted Phase A-D outputs.
- Required output markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Actual cutover, default-on behavior, runtime authority, prompt/model-message/provider-ordering/runtime decision changes, persistence, UI, transport changes, raw/untrusted retention, memory promotion, fact acceptance, episode write, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase A-D evidence.
- Owner, security/privacy, support, and rollback owner review.
- Scorecard threshold and veto gate definitions.

## Tests

- Harness context and validate for this spec.
- Phase D spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Evidence audit, boundary scans, diff check, README review, comms replay/compare if communication paths are touched.

## Metrics

- Scorecard threshold met.
- Open blocker count: 0.
- Veto count: 0.
- Rollback confidence score: 1.
- Docs/readiness coverage: 1.

## Rollback

- Reject cutover or mark needs_revision/blocked and return to diagnostics-only phase.
- No runtime cleanup because this phase must not change runtime behavior.

## Docs/i18n/E2E Requirements

- Cutover readiness report and README review required.
- Public docs/i18n/E2E only if a later accepted spec changes behavior/API/UI.

## Entry Criteria

- Phase D accepted with zero authority/raw/untrusted drift and acceptable budget/performance.

## Exit Criteria

- Explicit Phase F go/no-go, needs_revision, or blocked decision with evidence.

## Stop Conditions

- Any unresolved high-risk item, incomplete rollback proof, missing owner approval, or evidence that diagnostics can influence runtime decisions.
