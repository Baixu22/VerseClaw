# Line C Grounding Phase G: Default-on Proposal

Status: accepted.

## Allowed Surface

- Proposal document for possible future default-on implementation criteria.
- Evidence completeness, risk analysis, migration/rollback planning, owner/security/support review, and docs/i18n/E2E plan.
- Required output markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Default-on implementation, silent rollout, automatic provider registration/order change, prompt/model-message/runtime decision authority, runtime authority, memory promotion, fact acceptance, episode write, persistence, UI/settings default change, production behavior change, raw/untrusted retention, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase F evidence.
- Owner/security/support approval to draft proposal.
- Migration/rollback plan and public docs/i18n/E2E plan if default-on is ever implemented.

## Tests

- Harness context and validate for this spec.
- Phase F spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Proposal completeness audit, no-runtime-change scans, rollback plan review, diff check, README review.

## Metrics

- Evidence completeness.
- Unresolved risk count.
- Rollback confidence.
- User-impact analysis completeness.
- Prior leak counts remain 0.

## Rollback

- Reject or revise proposal and retain controlled opt-in or diagnostics-only status.
- No runtime cleanup because this phase must not change runtime behavior.

## Docs/i18n/E2E Requirements

- Proposal docs required.
- Implementation docs/i18n/E2E deferred to a later accepted default-on implementation spec.

## Entry Criteria

- Phase F accepted with stable metrics and owner approval to draft a proposal.

## Exit Criteria

- Proposal accepted for future implementation planning, needs_revision, or blocked.

## Stop Conditions

- Treating proposal as implementation approval, unresolved high-risk item, missing public docs/i18n/E2E plan, missing rollback plan, or any default-on implementation attempt.
