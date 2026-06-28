# Line C Grounding Phase C: Limited Production Opt-in Diagnostics-only

Status: accepted.

## Allowed Surface

- Small production cohort with explicit diagnostics-only opt-in.
- Owner-approved sampling ceiling, budget ceiling, privacy review, support path, and rollback owner.
- Non-authoritative metadata only with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Default-on rollout, prompt/model-message/provider-ordering/runtime decision influence, Gateway/provider transport mutation, persistence without a later accepted spec, memory promotion, fact acceptance, episode write, raw/untrusted retention, UI cutover without i18n/E2E, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase B synthesis.
- Production owner, cohort, sampling and budget guardrails, privacy/security review, operator escalation, and rollback drill plan.

## Tests

- Harness context and validate for this spec.
- Phase B spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Disabled parity, explicit opt-in, production-like replay, budget/token/performance checks, raw/untrusted/authority sentinels, transport scans, diff check, README review.

## Metrics

- Cohort size and opt-in count.
- Sample volume and sampling ceiling.
- p95 overhead and token delta within budget.
- Leak counts: 0.
- Provider ordering diff count: 0.
- Rollback time objective met.

## Rollback

- Disable production opt-in gate and remove sampling.
- Verify disabled/default parity and clean only safe aggregate artifacts if a later spec allowed them.

## Docs/i18n/E2E Requirements

- Operator docs and rollback runbook required.
- README review required.
- User-facing docs/i18n/E2E only if a later spec adds user-visible UI or settings.

## Entry Criteria

- Phase B accepted.
- Owner, cohort, privacy, budget, and rollback gates identified.
- No high-risk blocker open.

## Exit Criteria

- Limited production diagnostics run with no authority, no raw/untrusted leakage, bounded overhead, provider-ordering diff 0, and rollback proof.

## Stop Conditions

- Production-default activation, raw/sensitive leak, untrusted ref leak, provider ordering drift, runtime decision coupling, performance budget breach, or rollback failure.
