# TF-0733 provider validation evidence (curated)

- driven_by: agent
- actor: codex/mainline
- node: TF-0733 拆分 provider validation 状态并修正 UI 语义
- candidate: `7330d18db` on `codex/semantic-convergence-20261104` (clean worktree)
- parent: `35a2f6aae`

Files:

- `report.json` — node report: metrics, tests, static checks, changes, limitations.
- `validation-before.json` — source-derived baseline read from `SEMANTIC_CONVERGENCE_REF=35a2f6aae` (pre-fix): VALID-1=3, VALID-2=1. The script records the checkout HEAD in `candidate`; the measured source ref is the environment variable.
- `validation-after.json` — same script against the fixed working tree: VALID-1=0, VALID-2=6.
- `unit-tests.json` — Vitest JSON for the six provider validation suites (75 tests, 0 failed).

Behavioural gate lives in source: `tests/unit/semantic-convergence-provider-validation-matrix.test.ts`
(12 scenarios + empty model list) and `tests/e2e/setup-first-run-fp-p1-01.spec.ts`
(429 + non-auth 400 fixtures against a real local HTTP endpoint).

Reproduce:

```powershell
$env:SEMANTIC_CONVERGENCE_SOURCE='git-head'
$env:SEMANTIC_CONVERGENCE_REF='35a2f6aae'
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\validation-before.json'
node scripts/semantic-convergence-baseline.mjs
Remove-Item Env:SEMANTIC_CONVERGENCE_SOURCE
Remove-Item Env:SEMANTIC_CONVERGENCE_REF
$env:SEMANTIC_CONVERGENCE_OUT='D:\tmp\validation-after.json'
node scripts/semantic-convergence-baseline.mjs
```

No live third-party provider was contacted; no real-human evidence is claimed.
