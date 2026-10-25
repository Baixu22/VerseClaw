# VerseBrowser current candidate evidence (2026-10-25)

Status: **pass**

- Driven by: `agent`
- Actor: `codex-browser-closeout-20261025`
- Source commit: `b61d8a48a5f431a187e4395e02ab800b291392ab`
- Source tree: `a3a6930bbbab67b2159359c212a1089798b5f3b8`
- Platform: Windows x64, `win-unpacked`

## Results

- Package archives: both ASAR integrity/load checks pass; `devPathHits=0`.
- Packaged flow: 8/8 checks pass, including loopback default-deny and explicit agent approval.
- Stability: 10/10 cold starts, 30/30 full loops, 3/3 interrupt/recovery pairs.
- Cleanup: 46/46 final run directories reclaimed; final residual process count is 0 in every row.
- Electron E2E: 3/3 specs pass.

## Private-network policy

Private navigation remains denied by default. The probe first records `private-network-default-deny`, then uses an agent-driven approval bound to the exact session and origin. No global bypass or human evidence is involved.

## Boundaries

- Windows x64 only; macOS and Linux are unmeasured.
- The NSIS installer and uninstaller bodies were not executed.
- No publication, GA, product lock/default change, or real-human evidence is claimed.
