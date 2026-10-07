# Windows delivery blocker fixes — 2026-10-08

`driven_by: agent` · `actor: codex-windows-blockers`

This follow-up repairs TF-0260/0261 and investigates TF-0262 from the rejected
candidate recorded in `frozen-windows-acceptance-20261007.md`. The original
report and installer remain rejected; no package has been published.
The three scoped blockers now have fixes and passing Windows verification.
This does not replace the complete frozen-candidate release qualification.

## CLI dispatch and binary compatibility

The source runtime's entry loaded Gateway at module initialization and sent every
command except Doctor and an internal wake helper to `startGatewayServer`.
This also affected copied CLI commands, shell completion and unsupported device
commands. The common entry now handles version/help before any runtime import,
starts Gateway only for `gateway [run]`, and rejects unsupported commands and
invalid Gateway options. Doctor and the internal wake helper retain their owners.
The pruned runtime does not implement the full upstream CLI; help says so.

The Windows cmd and Git Bash wrappers enforce the declared Node 22.19 minimum
and use the actual `Verse Claw.exe` filename for their existing fallback.
The delivered standalone Node is 24.16.0, chosen to include the Windows TCP fix
described below. Official archive hashes and sizes are pinned for x64 and ARM64.
The downloader records the extracted executable digest; afterPack checks that
digest, target, pinned version and the delivered runtime's engine requirement.
Changing a download pin cannot silently reuse an old executable.

## Non-elevated installer lifecycle

The old optional `Add-MpPreference`/`Remove-MpPreference` commands could block
inside Defender/WMI indefinitely. The shared helper checks the effective token
before calling either command and logs `skipped-not-elevated` for a normal user.
NSIS bounds Defender to 10 seconds and PATH to 15 seconds; process helpers have
a 30-second inactivity timeout. Silent directory deletion gets 10 minutes because
large bundles can take minutes while progressing normally. Helper errors remain visible.
Install paths are file arguments instead of interpolated PowerShell source.
Process-query errors/timeouts retry or abort; only a completed absence result
permits replacement. NSIS patch helpers resolve the actual electron-builder
dependency directory, so pnpm's non-hoisted layout cannot silently miss the
extract/upgrade patches. The current checkout previously had no root
`node_modules/app-builder-lib` even though the packager's dependency existed.
The extraction rollback also referenced an undeclared variable; cached patches
now repair that reference. A real corrupt-archive probe exposed that the shipped
`Nsis7z::Extract` did not signal failure at all. The macro now embeds the existing
packager's Windows 7za tool, checks its exit code, retries failures and restores
the saved directory. A compiled fault probe now exits 2 and restores the old file.
That probe also revealed that trailing-separator directory checks always reported
absence. All eight affected installer checks now use a wildcard. A separate NSIS
probe verifies empty, extensionless-file and subdirectory-only layouts. Original
failed rollback probes remain in the raw record.

The first full lifecycle retry installed and replaced successfully, but uninstall
left 434 files with paths of 260–337 characters despite returning 0. The final
uninstaller overrides NSIS's MAX_PATH-limited removal with bounded native cmd
removal, passing the path through one environment expansion with delayed expansion
disabled. It requires a non-root path and matching install-registry identity.
Before removal it saves the running uninstaller, restoring a byte-identical retry
program on partial failure while leaving registration intact. A compiled probe
covers a 342-character path, literal percent signs, a junction to a preserved
external fixture, and locked-file failure followed by successful retry.

## Native worker investigation

The failure is a **Node Playwright worker** exit, distinct from the separately
observed Electron `0x80000003` dump. A new reproduction on Node 24.15.0 ran 24
Skills cases: 23 passed and the same readiness case exited `0xC0000409`.
Worker 13908 was recorded immediately before the crash at
`2026-10-07T16:11:46.600Z`, using the system Node 24.15.0. Runner cleanup removed
the three orphan Electron processes and left zero owned processes behind.

[Node issue 63620](https://github.com/nodejs/node/issues/63620) describes this
Windows silent fast-fail in the libuv TCP-connect path, including the absence of
ordinary fatal reports/WER events. The maintainer identifies
[fix 62561](https://github.com/nodejs/node/pull/62561), included in Node 24.16.0.
Its patch replaces the unsafe Windows version-query helper. Direct inspection of
official 24.15.0 and 24.16.0 sources confirms that difference; 22.19.0 also still
contains the old helper, so merely raising the bundled minimum was insufficient.

The Windows Playwright configuration now rejects affected Node 24.0–24.15
before launching an app. Test fixtures write worker PID, executable, version,
timestamps and memory samples before tests, and enable native fatal reports with
environment values excluded. This preserves attribution if another native defect
occurs. Development verification uses a checksum-verified local Node 24.16.0;
the machine's global Node installation is unchanged.

A standalone loopback HTTP reproducer is retained as
`scripts/repro-windows-node-connect.cjs`. Its first 60-second runs completed under
both versions (with connection errors), so those runs alone do **not** reproduce
or prove the fix. The actual Skills reproduction and matched-version rerun are
the relevant application evidence. No historical crash stack was recovered.

## Verification

Application changes are committed in `38bc41a6c`; the final long-path installer
fix is `0da489a50`. CLI probe corrections are `ddcc0e110` and `7d4bfb7b7` and do
not change the packaged app. The final NSIS rebuild used a clean `0da489a50` with
the current-session app bundle; seven primary app-file hashes remained identical.

| Check | Final observation |
| --- | --- |
| Focused unit regressions | 29 passed, zero failed/skipped |
| Node/web/test type projects and runtime core types | Passed; uncached projects checked serially |
| Clean-candidate Electron regressions | 4 passed, zero failed/skipped |
| Native comparison | Node 24.15: 23/24, one `0xC0000409`; Node 24.16: 48/48 |
| Installed CLI | 12/12, both wrappers and both execution paths; isolated state unchanged |
| Non-elevated installation | Passed, 145.4 seconds including owned deferred cleanup |
| Same-version replacement | Passed, 167.7 seconds; old marker removed and CLI bytes restored |
| Uninstallation | Passed, 18.0 seconds; zero files, directories or registration remaining |
| User state/environment | 11 profile JSON hashes match; PATH bytes and both shortcut states restored |
| Harness CI / task validation / comms replay and comparison | Passed; Harness CI included 47 passing tests and existing Agent Dev 94/A |
| Independent review | Final product, CLI-driver and long-path follow-ups returned no actionable findings |

All three installer stages required zero agent interventions after launch.
Completion was checked after descendant processes exited and by reading files,
registration and profile hashes; a launcher's exit code alone was insufficient.

The final test installer is 562,237,997 bytes with SHA-256
`4678ed42294d570ac174137a8a8f77109e3a25c9f220c949338d703873e186bb`.
It remains local. Full root unit and complete 345-case Electron suites were not
rerun; no cross-version migration, ARM64/macOS/Linux execution or paid-provider
acceptance is claimed. The repository-wide landing check remains nonzero with
53 findings; unrelated history was not integrated and these commits were not
pushed. The earlier default OpenClaw four-task/four-delivery migration was not
rolled back.

Commands, candidate identities, digests and limitations are recorded in
`artifacts/windows-delivery-blocker-fixes/report.json`. Raw runs stay private at
`D:/ClawX-work/windows-blocker-fixes-20261007/`, including setup failures and stale
build rejections. They are not rewritten as successful tests.
