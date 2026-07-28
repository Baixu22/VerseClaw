# NEXT-GOAL (wake-up)

## First command after user wakes

```powershell
pnpm run dcs:ops:preflight
```

If PASS, next:

```powershell
pnpm run build:vite
pnpm exec playwright test tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts
```

Then fill real names in `artifacts/dcs-deep-test-week1/profiles.json` roles, and only if E2E green run **one** L3 `dcs-coding` opt-in task per `docs/dev/dcs-ops-canary-runbook.md`.

## Decision stance

Technical prep recommendation: **continue** (not GA). See `artifacts/dcs-deep-test-week1/decision.md`.

## Hard locks

- TF-0006 blocked
- no default-on / liveReady / productApproved
- no unauthorized commit/push/PR

## Single TF node

Execute **TF-0009** only (under TF-0007 in_progress).
