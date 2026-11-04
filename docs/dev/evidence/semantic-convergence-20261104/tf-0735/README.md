# TF-0735 knowledge embedding deadline evidence (curated)

- driven_by: agent
- actor: codex/mainline
- node: TF-0735 知识 embedding 总 deadline 与取消传播
- parent commit: `6b49a10a9`

Files:

- `report.json` — metrics, tests, changes, limitations.
- `embedding-before.json` — source-derived baseline at `6b49a10a9`: EMB-1=390000, EMB-2=1.
- `embedding-after.json` — fixed tree: EMB-1=120000, EMB-2=0.
- `unit-tests.json` — Vitest JSON for the deadline + embedding suites (25 tests, 0 failed).

Behavioural gate: `tests/unit/knowledge-embedding-deadline.test.ts` (100 texts /
13 batches fake-clock run, abort-before-next-batch, shared query+batch budget,
partial-failure rejection, deadline parsing).

Reproduce:

```powershell
$env:SEMANTIC_CONVERGENCE_SOURCE='git-head'
$env:SEMANTIC_CONVERGENCE_REF='6b49a10a9'
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\embedding-before.json'
node scripts/semantic-convergence-baseline.mjs
Remove-Item Env:SEMANTIC_CONVERGENCE_SOURCE
Remove-Item Env:SEMANTIC_CONVERGENCE_REF
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\embedding-after.json'
node scripts/semantic-convergence-baseline.mjs
```

No live third-party provider was contacted; no real-human evidence is claimed.
