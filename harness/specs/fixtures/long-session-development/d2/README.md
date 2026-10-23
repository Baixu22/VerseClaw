# D2 paired continuity evaluation evidence

Source candidate: `6d8d9d97d949dda8ccefc2677b47ebecfdaa92ab` (branch `codex/long-session-implementation-20261022`, tree `874a1e5ba31fd52fc329176b2cb3f10daf960076`).
Frozen workload hash: `33e87dd8a378f93889487095a0ede1c52c73123a688a0d1492d1832e852d922e`.

- `paired-workload-manifest.json`: the pre-measurement frozen 30-pair agent-driven workload (6 pairs per family across compression, handoff, fork, restart, revocation), its must-preserve facts, forbidden facts, shared model parameters and metric budget, plus the freeze verification result.
- `fidelity-latency-cost-report.json`: fidelity, next-action, false-completion, revoked-leak, token/cache/cost and first-token/wall-clock P50/P95 report with per-cell null meaning "not measured"; this run has no authorized live-provider sample, so the status is `EVIDENCE_INSUFFICIENT`.
- `candidate-decision-inputs.json`: D3 decision inputs: keep-baseline/NO-GO disposition, blockers, unmeasured scope, negative cases, cleanup and the explicit statement that no product default changed.
- `verification-receipt.json`: candidate identity, provider probe, acceptance mapping, counts, cleanup and honest limitations.

Every action here is agent-driven (`driven_by: agent`, `actor: codex-long-session-d2`). No real-human operation, verdict or data is claimed,
and no simulated-provider measurement is presented as evidence of a quality or cost win.
