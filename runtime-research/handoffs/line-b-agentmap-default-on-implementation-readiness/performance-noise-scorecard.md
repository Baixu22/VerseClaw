# Performance Noise Scorecard

| Category | Score | Notes |
|---|---:|---|
| Runtime hot-path change | 15/15 | No runtime code change intended. |
| Default-path prompt overhead | 15/15 | Default path remains byte-identical legacy prompt. |
| Candidate budget behavior | 14/15 | Budget exhaustion fails closed; future telemetry should expose counters. |
| Shadow report noise | 14/15 | Shadow report is diagnostic and hash/length only. |
| Operator/UI noise | 15/15 | No UI or operator surface added. |
| Validation noise | 14/15 | Dirty tree may require clean overlay proof. |
| Total | 87/90 | Normalized to 96.7/100 if validation passes. |

Performance/noise is implementation-spec ready only if focused tests and typecheck pass.
