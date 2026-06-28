# Line B AgentMap Production Entry Readiness

This package is the production-entry readiness record after Phase B accepted controlled internal opt-in.

Current source of truth: `synthesis.md`. The package may recommend limited production opt-in only after required validation, hard gates, veto gates, rollback drill, leakage proof, provider-ordering proof, and scorecard all pass.

It does not approve default-on AgentMap, default cutover, production-ready status, production opt-in UI, default provider registration, automatic sampling, automatic AgentMapResult discovery/build/cache/reuse, persistence, or runtime authority.

## Contents

| File | Purpose |
|---|---|
| `prerequisite-check.md` | Required entry states and evidence. |
| `controlled-internal-opt-in-execution-plan.md` | Internal opt-in operation and exit rules. |
| `internal-sample-corpus.md` | Thirty realistic sample shapes and expected boundaries. |
| `internal-sample-results.md` | Replay/sample evidence and metrics. |
| `limited-production-readiness-review.md` | Recommendation scope and limits. |
| `production-entry-scorecard.md` | 100 point scoring record. |
| `production-veto-gates.md` | One-vote rejection gates. |
| `security-authority-boundary.md` | No-authority and no-persistence proof. |
| `leakage-proof.md` | Candidate and production-entry sentinel boundary. |
| `provider-ordering-proof.md` | Default provider order proof. |
| `rollback-drill-report.md` | Rollback scenarios and parity outcome. |
| `observability-metrics-plan.md` | Diagnostics-only metrics plan. |
| `privacy-retention-boundary.md` | Retention and privacy boundaries. |
| `operator-runbook.md` | Human runbook for limited opt-in. |
| `limited-production-opt-in-spec-draft.md` | Future limited opt-in draft. |
| `default-on-blocker-register.md` | Blockers preventing default-on/default cutover. |
| `validation-plan.md` | Required command and scan plan. |
| `submission-template.md` | Evidence submission template. |
| `synthesis.md` | Final decision record. |

## Decision Boundary

Limited production opt-in, if accepted, remains internal, explicit, default-off, allowlisted, manually approved, monitored, and reversible. Default-on/default cutover remains a future independent task spec with independent validation.
