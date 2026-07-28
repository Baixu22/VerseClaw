# Next Goal — TF-0009 wake-up (after overnight prep)

Workspace: `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0`

Overnight prep completed: L0/L1 green, ops pack ready, technical decision **continue** (not GA).

## First commands

```powershell
pnpm run dcs:ops:preflight
pnpm run build:vite
pnpm exec playwright test tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts
```

## Goal

Only TF-0009: fill real profile owners, run L2 E2E if not already recorded, execute minimal recorded L3 live tasks for dcs-coding / sekb-assisted / browser-supervised, then live kill/rollback drill.

## Hard bounds

- Defaults off/fail-closed
- SEKB human confirm; browser private-network deny
- Runtime Memory diagnostics-only
- TF-0006 blocked
- No default-on / liveReady / productApproved / joint GA claims
- No commit/push/PR without new authorization

## Read first

1. `docs/dev/handoffs/LATEST.md`
2. `artifacts/dcs-deep-test-week1/decision.md`
3. `docs/dev/dcs-ops-canary-runbook.md`
