# Agent Dev Audit

Generated: 2026-11-15T18:20:04.754Z

Status: pass

Grade: A

Maturity: review-ready

Confidence: high - Required generated evidence is present, parseable, and within the freshness window.

Score: 91/100

Policy: pass >= 90, warn >= 80, generated evidence freshness <= 24h. Hard veto findings force fail.

## Dimensions

| Status | Dimension | Score | Findings |
|---|---|---:|---:|
| pass | Gate Integrity | 20/20 | 0 |
| pass | Evidence Completeness | 20/20 | 0 |
| pass | Coverage Breadth | 20/20 | 0 |
| fail | Performance Discipline | 11/20 | 3 |
| pass | Docs And Runbook | 10/10 | 0 |
| pass | Maintainability | 10/10 | 0 |

## Priority Findings

| Priority | Severity | Dimension | Id | Message |
|---|---|---|---|---|
| P1 | warn | performance-discipline | latest-needs-full-gate | Latest deep-test is daily-loop evidence and still requires full gates. |
| P1 | warn | performance-discipline | performance-watch:contract | contract exceeded target: 1536ms > 1000ms. |
| P1 | warn | performance-discipline | performance-watch:playwright-agent-dev | playwright-agent-dev exceeded target: 16226ms > 15000ms. |

## Score Breakdown

| Status | Dimension | Score | Deducted | Reason |
|---|---|---:|---:|---|
| pass | Gate Integrity | 20/20 | 0 | No findings deducted points for this dimension. |
| pass | Evidence Completeness | 20/20 | 0 | No findings deducted points for this dimension. |
| pass | Coverage Breadth | 20/20 | 0 | No findings deducted points for this dimension. |
| fail | Performance Discipline | 11/20 | 9 | 3 finding(s) deducted 9 point(s). |
| pass | Docs And Runbook | 10/10 | 0 | No findings deducted points for this dimension. |
| pass | Maintainability | 10/10 | 0 | No findings deducted points for this dimension. |

## Findings

- **Performance Discipline / warn**: Latest deep-test is daily-loop evidence and still requires full gates. Run decision.requiredFullGates before PR/release review.
- **Performance Discipline / warn**: playwright-agent-dev exceeded target: 16226ms > 15000ms. Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- **Performance Discipline / warn**: contract exceeded target: 1536ms > 1000ms. Keep contract scanning text-based and bounded to host-api/service sources.

## Evidence Inventory

| Status | Source | Path | Exists | Timestamp | Age hours | Newer source |
|---|---|---|---|---|---:|---|
| fresh | workbench | artifacts/agent-dev-workbench/evidence.json | yes | 2026-11-15T18:17:41.249Z | 0.04 | no |
| fresh | deep-test | artifacts/agent-dev-deep-test/report.json | yes | 2026-11-15T18:17:41.300Z | 0.04 | no |
| fresh | deep-test-history | artifacts/agent-dev-deep-test/history.json | yes | 2026-11-15T18:17:41.300Z | 0.04 | no |
| fresh | quality | artifacts/agent-dev-quality/report.json | yes | 2026-11-15T18:17:40.627Z | 0.04 | no |
| fresh | package-scripts | package.json | yes | 2026-11-15T14:06:45.940Z | 4.22 | no |
| fresh | agent-dev-runbook | docs/agent-dev-control-plane.md | yes | 2026-11-15T02:39:05.437Z | 15.68 | no |
| fresh | agent-instructions | AGENTS.md | yes | 2026-11-15T02:39:02.183Z | 15.68 | no |
| fresh | scenario-registry | shared/agent-dev/scenarios.ts | yes | 2026-11-15T02:40:11.074Z | 15.66 | no |
| fresh | regularization-tests | tests/unit/agent-dev-regularization.test.ts | yes | 2026-11-15T02:40:13.805Z | 15.66 | no |

## Recommendations

- Run decision.requiredFullGates before PR/release review.
- Keep contract scanning text-based and bounded to host-api/service sources.
- Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
