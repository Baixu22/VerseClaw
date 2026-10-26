# TF-0570 Harness and Codex Active Verification

> Agent-driven evidence. This receipt checks verification definitions and retained evidence; it does not approve, schedule, land or complete work.

## Verdict

- S1-S11 are present with command, input, expected result, negative case, owner and readable artifact.
- Matrix result: **6 pass, 5 partial, 0 failed, 0 stale**.
- `partial` rows retain their exact limitation instead of being promoted to pass.
- A full harness dry-run completed for all 11 scenarios.
- Positive and negative smoke evidence is retained from real VB/VG, VS governed-process and failure-path runs.
- Source, package and evidence freshness is content-addressed by SHA256. Missing or changed inputs make the receipt stale.

## Scenario matrix

| ID | Scenario | Status | Evidence level | Primary readback |
|---|---|---|---|---|
| S1 | ordinary chat native | partial | runtime-reachable | product-integration receipt and policy test |
| S2 | normal Codex turn | partial | runtime-reachable | managed-runtime receipt; authenticated turn not-run |
| S3 | explicit `/codex` control | partial | runtime-reachable | command-source + explicit missing-harness negative |
| S4 | packaged desktop launch | pass | packaged-available | packaged-runtime receipt |
| S5 | CI / headless | pass | runtime-reachable | coding-run protocol test |
| S6 | ACP alternative | partial | runtime-reachable | adapter-pilot initialize; generic selection/cancel not exercised |
| S7 | alternate harness evaluation | partial | effect-verified | real-turn fixture; OpenCode failed before turn |
| S8 | VerseBrowser task | pass | effect-verified | real embedded browser E2E |
| S9 | VerseShell execution | pass | effect-verified | real Job Object limit run |
| S10 | VerseGit candidate | pass | effect-verified | candidate apply report |
| S11 | failure / fallback | pass | runtime-reachable | missing binary/harness/auth and staged-observation negatives |

## Smoke and freshness

- Full matrix dry-run: `node harness/src/cli.mjs run --spec harness/specs/tasks/harness-codex-active-verification.md --dry-run`.
- VB/VG smoke: 3/3 Playwright tests passed, including private-network/forged-approval and binary-mismatch negatives.
- VS real-process smoke: 2/2 tests passed with bundled `ae.exe`; Job Object limits were enforced.
- `matrix.json`, evidence files, source directories and packaged inputs are fingerprinted. Any byte change or missing path fails `scripts/verify-harness-active-matrix.mjs`.

## Boundary

- No product selector, scheduler, task or approval authority is added.
- No default path, release lock or publication state changed.
- No credentials or private prompts are retained.
- Windows x64 is the only runtime environment observed here; authenticated quality/latency/cost comparisons remain outside this receipt.
