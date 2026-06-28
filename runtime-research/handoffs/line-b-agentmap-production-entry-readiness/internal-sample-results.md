# Internal Sample Results

Evidence source: existing accepted Phase A/Phase B replay proof, focused unit tests, production-entry sentinel unit test, and boundary scans. Samples use replay or simulated replay evidence; no production telemetry automation is introduced.

## Aggregate Metrics

| Metric | Result | Notes |
|---|---:|---|
| Sample count | 30 | Meets minimum of 30. |
| Pass count | 30 | No sample records a failed production-entry gate. |
| Fail count | 0 | No hard veto observed in sample evidence. |
| Coverage | 12/12 required coverage families | Successful, failed, blocked, long-context, multi-file, large-candidate, budget-exhausted, prompt-present, invalid-result, gate rollback, provider-ordering-sensitive, lifecycle/checkpoint-sensitive. |
| Candidate relevance | 28/30 useful or intentionally none | Gated-off/default-on blocker/comms samples do not expect candidate content. |
| Noise rate | 2/30 medium-noise samples | Long-context and large-candidate samples carry known budget/noise risk. |
| Token cost | bounded per sample | Budgets remain explicit; budget exhaustion fails closed. |
| Latency cost | diagnostics-only | No service, listener, queue, background worker, or production sampler added. |
| Fail-closed rate | 100 percent | Invalid, missing, gated-off, explicitInvocation=false, and budget-exhausted cases return legacy prompt bytes. |
| Leakage count | 0 | Candidate and production-entry sentinel tests plus scans. |
| Provider ordering drift | 0 | Registry tests preserve default provider order. |
| Rollback success | 8/8 drill cases | See `rollback-drill-report.md`. |

## Per-sample Results

| ID | Result | Candidate relevance | Noise | Token/latency cost | Fail-closed | Leakage | Provider drift | Rollback |
|---|---|---|---|---|---|---|---|---|
| PE-01 | pass | high | low | bounded/none | n/a | 0 | 0 | pass |
| PE-02 | pass | high | low | bounded/none | n/a | 0 | 0 | pass |
| PE-03 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-04 | pass | high | low | bounded/none | n/a | 0 | 0 | pass |
| PE-05 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-06 | pass | low | low | bounded/none | pass | 0 | 0 | pass |
| PE-07 | pass | medium | medium | bounded/none | n/a | 0 | 0 | pass |
| PE-08 | pass | high | low | bounded/none | n/a | 0 | 0 | pass |
| PE-09 | pass | medium | medium | budgeted/none | pass | 0 | 0 | pass |
| PE-10 | pass | none expected | low | budgeted/none | pass | 0 | 0 | pass |
| PE-11 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-12 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-13 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-14 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-15 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-16 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-17 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-18 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-19 | pass | n/a | low | none | n/a | 0 | 0 | pass |
| PE-20 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-21 | pass | metadata only | low | bounded/none | n/a | 0 | 0 | pass |
| PE-22 | pass | metadata only | low | bounded/none | n/a | 0 | 0 | pass |
| PE-23 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-24 | pass | medium | low | bounded/none | n/a | 0 | 0 | pass |
| PE-25 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-26 | pass | metadata only | low | bounded/none | n/a | 0 | 0 | pass |
| PE-27 | pass | none expected | low | none | pass | 0 | 0 | pass |
| PE-28 | pass | hash only | low | bounded/none | n/a | 0 | 0 | pass |
| PE-29 | pass | n/a | low | none | n/a | 0 | 0 | pass |
| PE-30 | pass | n/a | low | none | n/a | 0 | 0 | pass |

## Gaps

This evidence is readiness evidence, not a claim of production-ready default behavior. It does not include public production telemetry, automatic sampling, production UI, default-on behavior, or default cutover.
