# Frozen Windows acceptance — 2026-10-07

`driven_by: agent` · `actor: codex-frozen-acceptance`

Product candidate: `cb33fad04fb3e98d0cd252f5f61afb542db7c349`.
**Verdict: NOT ACCEPTED.** The full regression and installer observations found
unresolved delivery blockers. No release is authorized. Test-only corrections
in `ae79a41af` and qualification documentation in `3436b9bb7` do not change the
product code or the installer built from the frozen candidate.

| Check | Observed result |
| --- | --- |
| Complete root `pnpm test` | 8,047 passed / 50 skipped / zero failed; exit 0 |
| Root three projects and runtime four type projects | All passed; root projects ran serially without changing coverage |
| Complete Electron suite | 345 discovered; 339 passed / 2 failed / 4 skipped; exit 1, 51.4 minutes |
| Focused Electron rerun | 4 passed; does not resolve the native root cause or make the full run green |
| Full ESLint | One unused test import fixed; rerun exit 0, zero errors / 116 warnings |
| Fresh Windows build / NSIS | Exit 0; 554,500,662-byte installer produced |
| Extracted delivery | Zero external links, 4,174 dependency checks passed; Main ASAR and 12 native companions verified |
| Packaged desktop and Gateway | Passed separately with isolated state; desktop probe uses E2E mode and exits gracefully |
| Agent Dev fresh/full and strict audit | Passed, 94/A, no hard vetoes; control-plane scope only |
| Harness CI and qualification task validation | Passed |

The preview screenshot failure was confined to the intentional B2 brand width
and label position. Its single baseline and obsolete comment were updated;
tolerances, masks and retry settings were not relaxed. The original failed
full-run report remains unchanged.

## Delivery blockers

1. **Bundled CLI dispatch and compatibility.** Running `openclaw --version`
   started Gateway rather than printing a version. The wrapper points to the
   gateway-oriented `openclaw-runtime/dist/entry.js`. Its bundled Node is
   22.16.0, below the runtime's declared `>=22.19.0`; its fallback names
   `ClawX.exe`, while the package contains `Verse Claw.exe`.
2. **Non-elevated installer/uninstaller stalls.** The previous verified package,
   used to establish the replacement baseline, stopped at `Add-MpPreference`.
   Uninstall stopped at `Remove-MpPreference`. Their installer-owned subprocesses
   were terminated only after recording prolonged stalls. Both flows therefore
   required agent intervention and are **not unassisted passes**. The new
   candidate has the same installer script; its installation/replacement stage
   was not reached. The uninstaller launcher's immediate exit 0 was not treated
   as completion while its child was still working.
3. **Native worker exit.** `0xC0000409` recurred in the complete suite at the
   Skills readiness case. Runner-owned cleanup reclaimed the orphan Electron
   processes, so the run finished. The focused case passed, but the native
   cause remains open. A separate Electron dump from a different time was not
   asserted to explain that worker failure.

## State impact and cleanup

The erroneous CLI query used the default OpenClaw state before its unexpected
Gateway startup was recognized. Logs record migration of four task registry
rows and four task delivery rows. That process was stopped and logs retained;
those database changes were not blindly rolled back. This incident must not be
described as a read-only version probe or as untouched user state.

The installer test itself used a dedicated D: application directory without
elevation. After the required interventions, no installed files, install
registration or CLI PATH entry remained. PATH and shortcuts were restored, and
all 11 pre-recorded Verse Claw profile JSON hashes matched. This cleanup result
is separate from the default OpenClaw migration incident above.

The generated installer has SHA-256
`248a08faa684092f486d057a8709d3d0ba3584184bc7455b3d7742f2057ec543`.
It is retained as a **rejected candidate**, not recommended for deployment.
The mutable `win-unpacked` tree was exposed to the unintended CLI startup;
package integrity checks instead used a fresh extraction of the unchanged NSIS.

The machine report is
`artifacts/frozen-windows-acceptance-20261007/report.json`, accompanied by a
credential marker scan and SHA256SUMS. Raw evidence is under
`D:/ClawX-work/frozen-acceptance-20261007/`; registry/PATH snapshots remain private.
Replacing one alpha candidate with another at the same version would not prove
cross-version data migration, and that replacement was blocked in this run.
Full upstream runtime-unit, paid-provider, macOS/Linux and publication acceptance
are not claimed.
