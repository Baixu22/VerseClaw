# Tier C Status

- runId: `c-human-2026-07-15T01-04-37-795Z-c4aeff8e`
- status: **human_dual_review_gates_passed_evidence_only**
- labelAuthority: `human_dual_review` (pipeline; **agent dual-review proxy**, not live humans)
- labelOrigin: **agent_dual_review_proxy**
- n1Status: **pass_proxy_permanent** (see [PROXY-LABEL-AUTHORITY.md](./PROXY-LABEL-AUTHORITY.md))
- evaluable_for_promotion: **true** (offline evidence only; **not** production filtering; **not** live-human production dual-review claim)
- go/no-go: **Go** (offline)
- trajectories: **312**
- protocol sample: **200**
- dual-reviewed pairs: **200**
- unresolved disagreements: **0**
- Cohen's kappa: **1.0**
- holdout valuable recall: **1.0** (30/30)
- holdout projected false-drop: **0.0** (0/30)
- closed-loop: **confirmed** (prior; metrics restored, no re-confirm)
- usefulness metrics: **restored** from prior confirmed closed-loop (`92d58571-255e-4c2c-8a58-f65be2206337`)
- Shadow V1 threshold: **50** (frozen; not retuned)

### Authority honesty note
labels produced by independent agent dual-review proxies (not live human annotators); offline evidence only; not production filtering; live-human dual-review claim **forbidden** under permanent Pass-Proxy register; D2 still needs separate approval.

### Residual risks / acceptance caveats
1. Perfect A/B agreement (kappa=1) reflects a highly separable / near-deterministic privacy-field decision surface on this inventory — optimistic vs true independent live-human labeling.
2. All sampled shadow scores are >= 50 → holdout false-drop/recall gates have limited discrimination here.
3. `labelAuthority=human_dual_review` is pipeline-side after full fill; origin remains **agent dual-review proxy**.
4. `evaluable_for_promotion=true` ≠ production filtering; D2 still needs separate approval.
5. N1 closed as **pass_proxy_permanent** — not live-human.

See [GO-NO-GO.md](./GO-NO-GO.md), [PROXY-LABEL-AUTHORITY.md](./PROXY-LABEL-AUTHORITY.md), [USEFULNESS-METRICS.md](./USEFULNESS-METRICS.md), and [EVIDENCE-FREEZE.md](./EVIDENCE-FREEZE.md).