# DCS T0 Baseline Acceptance

**Status**: COMPLETE
**Date**: 2026-07-14
**Branch**: `main` (no branch / worktree / rebase / reset / stash / push)
**Commits**:
- `4ba392a57` `fix(validation): restore root lint and test baseline`
- `f3b6a967b` `fix(validation): stabilize knowledge source-set unit test`

---

## Intent

Restore the root validation baseline that was historically red (`lint:check` hundreds of errors; root Vitest assertion/load failures) so T2/T3 could be verified against a trustworthy green floor. Keep all T2 product work unstaged during baseline commits.

## Scope Landed

- Minimal baseline repairs retained: merge-damage cleanups, Vitest runtime-redaction alias, eslint ignore of clear generated artifacts only (`.tmp`, Runtime `.artifacts`, CodeGraph built `dist`), no blanket rule kill-switch.
- Follow-up flaky/source-set unit stabilization in knowledge page test (`f3b6a967b`).
- Explicit committer commits with file lists only; T2 working tree kept separate until T2 commit.

## Gate Evidence (baseline serial run `serial-gates12`)

Evidence under `artifacts/validation-baseline/` (not committed):

| Gate | Command | Exit | Duration | Notes |
|------|---------|------|----------|-------|
| typecheck | `pnpm run typecheck` | **0** | ~26.3s (`gate-typecheck12.done`) | node+web parallel success JSON |
| lint:check | `pnpm run lint:check` | **0** | ~312s (`gate-lint12.done`) | 0 ESLint errors; warnings only; `lint:dcs` via chain |
| test | `pnpm test` | **0** | ~450s (`gate-test12.done`) | Vitest root + `test:dcs` |
| aggregate | `serial-gates12.done` | **TYPECHECK=0 LINT=0 TEST=0** | n/a | first clean baseline after repairs |

Root Vitest snapshot from `gate-test12.out` / later re-runs:

- Test Files: **585 passed** | 3 skipped (588)
- Tests: **5382 passed** | 52 skipped (5434)

## Encoding / Integrity Notes

- Baseline commit is mechanical validation/hygiene; UTF-8 structural convergence is T2.
- No conflict markers; clean `main` after baseline commits relative to intended baseline files.
- Committer helper used; no force push / stash.

## Review

| Severity | Count |
|----------|------:|
| Critical | 0 |
| Important | 0 |

**Verdict**: T0 baseline COMPLETE. Root `lint:check` / `pnpm test` / `typecheck` exit 0 with real evidence.

---

## Handoff

T2 may proceed with dirty T2 files only. Do not re-open baseline lint ignores for convenience.