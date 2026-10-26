# Final merged Browser candidate

Actor: codex; driven_by: agent. Source: 96f589cbb609a3eab29b7fa93283c423bdd84cf8.

N8: 8/8; N9: 10 cold starts, 30 loops, 3 interrupts and 3 recoveries; 46/46 reclaimed and no final process residue. Approval regressions: 32; integration units: 125; package service tests: 15; Electron: 3/3. Uncached typecheck and comms pass. Model positioning preserves the verified GLM 24/24 candidate and rejects five tamper classes.

Main approves a sessionKey and exact origin; caller approval claims are ignored. The opening grant is consumed once, transferred to the real Browser session, and revoked on close.

This is Windows x64 local unsigned win-unpacked development evidence. Dependencies and the main-runtime archive were reused by exact identity. Full Playwright, remote CI, installer/uninstaller execution, other platforms and GA remain unmeasured. Historical failed runs retain their original identities.
