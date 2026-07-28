# FP-P0-05 accounting debt: 5.125x vs 4.5x tool-call reduction

Two artifacts reported a different "tool-call reduction" for the same C1 view-tools
work. Both numbers are arithmetically correct; the reports were missing the corpus
and formula that make them comparable. Neither is deleted and neither is silently
overwritten — the definitions are now stamped into both files.

## Verdict

**Same formula, different corpus.** Nothing was wrong with either computation; the
debt was undocumented scope.

Formula, identical in both: `reduction = mean(offArm toolCalls) / mean(onArm toolCalls)`
— a **ratio of means**, not a mean of per-fixture ratios. (For these datasets the two
happen to coincide, because every on-arm fixture used exactly 1 call.)

| artifact | corpus | fixtures | mean off calls | mean on calls | reduction |
|---|---|---|---|---|---|
| `artifacts/coding-c1/ab-metrics.json` (`avgReduction`) | hand-authored C1-2 navigation fixtures (impact / understand / verify / registration) | 4 | 4.5 | 1.0 | **4.5x** |
| `artifacts/dcs-canary/c1/{ab-metrics,decision}.json` (`reductionFactor`) | synthetic-agent generated corpus, seed 42 | 32 | 5.125 | 1.0 | **5.125x** |

Verified by recomputing from the stored `pairs` in `coding-c1/ab-metrics.json`:
mean off = (5+5+4+4)/4 = 4.5, mean on = 1.0, ratio of means = 4.5, mean of ratios = 4.5.

## Why they differ

The 4-fixture hand set contains two 4-call baselines out of four (`verify`,
`registration`), pulling the mean to 4.5. The 32-fixture synthetic corpus has a
higher mean baseline call count (5.125). Neither corpus is a superset of the other,
so the two figures are not expected to agree and neither supersedes the other.

## What changed

- Both artifacts now carry an explicit `reductionDefinition` block naming the
  formula, the corpus, and the fixture count, so a reader cannot mistake one scope
  for the other.
- `artifacts/dcs-visible-production/p1-01-live-ab-report.json` already attributes
  its 5.125x to `artifacts/dcs-canary/c1/decision.json`; that pointer is correct and
  is left as-is.

## What did NOT change

- No gate verdict moved. `coding-c1` stays `meetsGate: false` (4.5x < 5x target) and
  `dcs-canary/c1` stays `recommendation: keep-off`, `meetsGate: false`,
  `productApproved: false`, `live: false`.
- No production default was touched.
- The 5.125x figure remains **synthetic**, not live A/B. It must not be cited as
  evidence of product usability.

## Residual

The two corpora should be unified into one gate corpus so a single reduction number
exists for the C1 flag decision. That is a canary-methodology change, out of scope
for FP-P0-05 (which owns injection budget and precedence). Tracked as **FP-P4-05**
(see FP-P0-05 `## Residuals`).
