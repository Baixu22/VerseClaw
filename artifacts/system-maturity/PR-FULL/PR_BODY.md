# System Maturity complete seal (P0–P8 + ORCH)

## Summary

Reseals **system-maturity** on `codex/maturity-p4` after orchestration-gap-closure so the program is **PR-ready**:

- Phase **P0–P8** STATUS: all `done` / `allTasksDone=true`
- **ORCH-001..004** wave: `done`
- Control-plane fix: evidence validator uses `sha256CanonicalEvidenceFile`
- `pnpm maturity:seal` green
- `gates.json` **prFull** commands all exit 0 (evidence under `artifacts/system-maturity/PR-FULL/`)

HEAD at packaging time: `067579cbafd0e891e66b584d21fce866d242cd94`

## What is done

| Area | Status |
|------|--------|
| P0 foundation | done |
| P1–P6 feature/control phases | done (pre-existing + retained) |
| P7 continuous governance | resealed done |
| P8 residual closure | resealed done |
| Orchestration gap closure | done |
| maturity:seal | OK |
| prFull gates | OK |

### prFull evidence

| Gate | Exit | Log |
|------|------|-----|
| maturity:baseline | 0 | pr-baseline.stdout.txt |
| maturity:plan | 0 | pr-plan.stdout.txt |
| maturity:security | 0 | pr-security.stdout.txt |
| contract:check | 0 | pr-contract.stdout.txt |
| typecheck | 0 | pr-typecheck.stdout.txt |
| harness:ci | 0 | pr-harness-ci.stdout.txt |
| agent-dev:fast | 0 | pr-agent-dev-fast.stdout.txt |

Also recorded: maturity:seal / maturity:validate / maturity:orchestration-status / maturity:evidence / maturity:residual.

## Residuals (honest, still open under governance)

These are **not** unfinished plan work; they remain **Partial + Act-now** in `plans/system-maturity/residual-register.json`:

1. **F-SEC-001** — OpenClaw secret-input co-read / migration deferred
2. **F-REL-004** — multi-implementation surface residual

Do **not** treat this PR as closing those findings; only as keeping them register-governed with valid reviewBy.

## Non-goals (explicitly not claimed)

- Merge to `main` (this PR prepares merge; does not force it)
- Full **release** loop (full unit suite / lint:check / cold agent-dev:deep-test / full e2e quality)
- OpenClaw secret-input migration implementation

## Ancestry / worktree notes

- Integration branch: `codex/maturity-p4` in worktree `ClawX-maturity-p0`
- `p45-repair` ancestor check (`c9677af97`): **true**
- Planning copy under other trees is **not** the product truth source; product STATUS lives in this branch's `plans/system-maturity/**`

## Test plan executed

1. Wave 0: evidence validator + unit probe (prior commits)
2. Wave 1: orchestration-status + focused ORCH units (prior)
3. Wave 2–3: P7/P8 reseal STATUS + traceability/security/privacy/residual (prior + this packaging)
4. Wave 4: `pnpm maturity:seal` OK
5. Wave 5: prFull 7 commands exit 0 + summary packaging
6. Final local: hash-sync + evidence + residual + plan + baseline + orch

## Reviewer checklist

- [ ] `summary.json` has `"ok": true`
- [ ] phase0–8 + ORCH STATUS all done
- [ ] residual-register still covers F-SEC-001 / F-REL-004
- [ ] No claim of release-full or main-merged
