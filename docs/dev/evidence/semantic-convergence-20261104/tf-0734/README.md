# TF-0734 provider network policy evidence (curated)

- driven_by: agent
- actor: codex/mainline
- node: TF-0734 验证与推理共享请求策略、SSRF 与 deadline
- parent commit: `9d50e8ca1`

Files:

- `report.json` — node metrics, tests, static checks, changes, limitations.
- `network-before.json` — source-derived baseline at `9d50e8ca1`: NET-1/2/3/4 = 0.
- `network-after.json` — same script against the fixed tree: NET-1=1, NET-2=1, NET-3=4, NET-4=1.
- `unit-tests.json` — Vitest JSON for 10 provider/network suites (170 tests, 0 failed).

Behavioural gates live in source:

- `tests/unit/semantic-convergence-provider-network-parity.test.ts` — shared
  resolver parity, ordered fingerprints, fail-closed targets, deadline signals.
- `tests/unit/semantic-convergence-provider-validation-matrix.test.ts` — the
  12-scenario validation matrix from TF-0733 still passes.

Reproduce:

```powershell
$env:SEMANTIC_CONVERGENCE_SOURCE='git-head'
$env:SEMANTIC_CONVERGENCE_REF='9d50e8ca1'
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\network-before.json'
node scripts/semantic-convergence-baseline.mjs
Remove-Item Env:SEMANTIC_CONVERGENCE_SOURCE
Remove-Item Env:SEMANTIC_CONVERGENCE_REF
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\network-after.json'
node scripts/semantic-convergence-baseline.mjs
```

No live third-party provider was contacted; no real-human evidence is claimed.
