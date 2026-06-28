# Quantitative Replay Scorecard

Status: accepted

| Category | Max | Current |
|---|---:|---:|
| Replay corpus coverage | 25 | 25 |
| Determinism | 15 | 15 |
| Default behavior parity | 20 | 20 |
| Boundary/no authority/no leakage | 20 | 20 |
| Fail-closed and rollback | 15 | 15 |
| Maintainability/auditability | 5 | 5 |
| Total | 100 | 100 |

Thresholds:

- 95-100: can enter Phase B Cutover Readiness Review.
- 85-94: keep pilot and add replay/failure samples.
- 70-84: keep pilot only, do not expand invocation surface.
- below 70: needs_revision; consider rollback to diagnostics-only.

Decision: 100/100, can enter Phase B Cutover Readiness Review. This is not production-ready approval, not default-on AgentMap, and not default cutover.
