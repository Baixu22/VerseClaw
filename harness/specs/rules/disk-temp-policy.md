---
id: disk-temp-policy
title: Keep build and test temp files off the C: drive
type: ai-coding-rule
severity: error
---

# Disk and temp-file policy

## Why

The development host's `C:` volume runs near zero free space. When it fills, builds
and tests fail while writing temporary output (`磁盘空间不足` / `ENOSPC` /
`no space left on device`), which reads as a code failure but is an environment
failure. The `D:` volume holds the checkouts and has ample headroom, so process
temporary directories belong there.

## Rule

Before running any command that produces large temporary output — `pnpm install`,
`pnpm test`, `pnpm run test:e2e`, `pnpm run build:*`,
`pnpm --dir openclaw_runtime run build`, vitest, playwright, tsgo — point the process
temp directories at `D:`:

- PowerShell (the default shell for this repo on Windows): set `TEMP` and `TMP` to
  `D:\tmp` and create the directory first.
- Bash / Git Bash: `export TMPDIR=/d/tmp` and create it first.

Also:

- Do not `Tee-Object` or redirect long build/test logs into `%TEMP%` (it is on `C:`).
  Write them under `D:\tmp`, or read them from the command output.
- Keep scratch scripts, fixtures, traces and screenshots under `D:\tmp` or an
  already-ignored repo path rather than a new unignored directory in the checkout.
- Playwright's `test-results/` and `playwright-report/` are ignored; if their output
  directories are overridden, point them at `D:` too.
- Low-integrity checkout exception: if the checkout that hosts the executable carries a
  Low mandatory integrity label (this `D:\ClawX` tree does), processes it spawns cannot
  write into a Medium-integrity `D:\tmp`. Point `TEMP`/`TMP` at an ignored scratch
  directory *inside* the checkout. Playwright global setup defaults its run root to
  `D:\ClawX\.tmp\e2e-runs`; set `CLAWX_E2E_RUN_ROOT_BASE` or `CLAWX_E2E_RUN_ROOT` to
  another ignored directory only for an intentionally isolated run. Global setup creates a
  unique `verse-claw-e2e-run-*` child rather than overwriting the caller's path.
  Verified 2026-10-15: `governed-exec.real.test.ts` and
  `tests/e2e/agent-dev-quality.spec.ts` both fail under `D:\tmp` (missing artifact /
  `EPERM: mkdir <userData>\logs` leading to "Application initialization failed") and
  both pass under an in-checkout scratch directory. Verified 2026-10-20:
  `structural-loading-pilot.spec.ts` similarly reached Electron 40.8.4 but waited
  forever for `firstWindow` with `userData` under `D:\tmp`; moving
  `CLAWX_E2E_RUN_ROOT` under `D:\ClawX\.local` restored BrowserWindow creation without
  changing product behavior; the only main-process change is an env-gated startup trace.

## Verification and interpretation

- On a disk-space error, check the `C:` free space before treating the failure as a
  code defect, move the temp directory to `D:`, and re-run.
- A disk-space failure is never evidence for a product claim. Record it as an
  environment failure and re-run; do not weaken a gate or bake the failure into
  acceptance evidence.
- Temp on `D:` is not slower on this host. Measured `pnpm run build:vite` on
  2026-10-14 with four alternating runs on the same machine: `D:\tmp` produced
  58.6s and 59.9s, while the `C:` temp directory produced 62.4s and 144.0s. A build
  budget breach under load (for example the Agent Dev `e2e-build` limit) therefore
  reads as a load artifact: re-run it, and do not move temp back to `C:` to chase it.
- This rule does not authorize deleting user data, other worktrees, or untracked
  files to reclaim space. Removing large transient output the agent itself produced
  is fine; anything else needs its own authorization.
