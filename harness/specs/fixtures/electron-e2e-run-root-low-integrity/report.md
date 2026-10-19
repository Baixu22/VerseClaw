# Electron E2E low-integrity run-root acceptance

Agent-driven acceptance for `electron-e2e-run-root-low-integrity`.

## Result

The caller-selected `CLAWX_E2E_RUN_ROOT` is now honored as the base for a unique
Playwright run root. On the low-integrity Windows checkout, this moved isolated
Electron profiles out of the Medium-integrity `D:\tmp` and allowed the main
window to be created.

- Electron: `40.8.4`
- Node: `24.19.0`
- Focused command: `node node_modules/@playwright/test/cli.js test tests/e2e/structural-loading-pilot.spec.ts --reporter=list`
- Exit code: `0`
- Result: `2 passed`, `0 failed`, `0 skipped` (`20.2s`)
- Startup trace: `BrowserWindow` creation completed for both launches.
- Cleanup: `survivors: []`, CIM sweep `status: ok`.
- Screenshots: `screenshots/slow-stable.png`, `screenshots/fast-ready.png`.

## Evidence

`process-run.json` records both the caller base and the unique
`verse-claw-e2e-run-*` child. `last-run.json` records Playwright's passed
status. `startup-trace.txt` records the path through version reconciliation,
window creation, and renderer load. `process-cleanup.json` records the reaping
ledger and empty survivor set.

## Boundaries

This is focused E2E evidence, not a full-suite, cross-platform, installer, or
release claim. The product defaults, transport policy, and product locks are
unchanged. The original Electron binary already matched the official release
SHA256; the defect was the E2E run-root handoff under the low-integrity host.