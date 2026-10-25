# TF-0502 A/B v1 measurement defect note

- Recorded: 2026-10-23 (agent-driven, actor `codex`); written after the v1 run.
- Status: the frozen v1 verdict **stands as recorded** and is **not** rewritten.
- Purpose: explain why the v1 `firstCallNonInferior` failure cannot be used as
  evidence that the treatment is inferior, and what a corrected protocol must
  predeclare.

## What the protocol predeclared

`ab-protocol.json` (frozen before the run): `firstCallNonInferiority` =
"paired treatment-control first-call success lower CI >= -0.05".

## What `run-ab.mts` (v1) actually computed

```js
const diffs = pairs.map((pair) => (pair.B.pass ? 1 : 0) - (pair.A.pass ? 1 : 0));
const ci = { lower: quantile(diffs, 0.025), upper: quantile(diffs, 0.975) };
```

`quantile(diffs, q)` returns the element at `floor(q * (n - 1))` of the
sorted *diff sample*. The 2.5%/97.5% quantiles of a 40-element binary-difference
sample are the minimum and (near-)maximum observed values. This is the **range
of observed paired differences**, not the sampling distribution of the paired
mean; it is not the 95% confidence interval the protocol declared.

## Recomputed from the frozen run (no new calls)

Source: `ab-run-v1.json` (80 records = 40 fixtures x 2 arms; 0 provider errors,
0 parse failures), paired by `fixtureId` + `arm`.

| quantity | value |
|---|---|
| fixtures | 40 |
| control-only win (A pass, B fail) | 1 |
| treatment-only win (A fail, B pass) | 8 |
| both pass / both fail | 0 / 31 |
| mean paired difference (B - A) | +0.175 |
| observed diff min / max | -1 / +1 |
| recorded `firstCallDeltaCi95` | [-1, 1] |

Because at least one control-only win exists, `lower = -1 < -0.05`, so the
check fails *deterministically for any run* in which a single fixture favors
control. The recorded `decision.reasons = ["firstCallNonInferior"]` therefore
documents the implemented statistic, not a measured non-inferiority failure.

## Standing and required correction

- TF-0502 remains **non-graduated**; acceptance criterion 5 is not satisfied by
  v1 evidence (the verdict is void as a non-inferiority measurement; the frozen
  files are preserved as historical record).
- Resolution requires a **newly frozen v2 protocol** (now frozen as
  the run: the paired CI method (e.g. exact / McNemar-based, or a paired
  bootstrap with fixed seed and resample count), the same n=40 strata, the same
  thresholds, and the stopping rule; then exactly one live run.
- v1 artifacts (`ab-protocol.json`, `ab-run-v1.json`) are immutable.
- Runner provenance: the v1 run was executed by `run-ab.mts` at
  `sha256:46520dddaeebc32fddc445ab6d214b091a3fd0b4a94d80fa82cb0c8417b212fd`.
  After the run the script received **type annotations only** (no runtime
  change) so the repo typecheck gate can accept it; the current hash therefore
  differs from the run-time hash above.
- Minor additional finding: the JSON field named `pairs` in `ab-run-v1.json`
  holds the flat 80-call list, not paired records; pairing must be reconstructed
  via `fixtureId` + `arm`. v2 should emit true pairs.

## Resolution

- v2.1 was frozen (amended from v2 before any completed run, with the aborted
  attempt recorded inside `ab-protocol-v2.json`), executed exactly once, and
  decided `pass` on the predeclared thresholds.
- The v1 artifacts remain byte-identical and their `fail` verdict is preserved as
  historical record; v1 is not the deciding evidence.
- Residual limitation recorded in `README.md`: invocation-form answers were
  scored as failures in both arms and were deliberately not re-scored after the
  verdict was observed.

## Non-claims

No human evidence; no public release, GA, liveReady or productApproved claim; no
product default was changed by this note.
