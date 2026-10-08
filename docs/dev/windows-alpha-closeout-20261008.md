# Windows x64 alpha qualification — 2026-10-08

`driven_by: agent` · `actor: codex-windows-alpha-closeout`

The current source is qualified for the existing controlled Windows x64 alpha
scope. This is local automated acceptance; no release, public artifact, frozen
default change, or macOS/Linux acceptance is declared.

The source candidate is 7ac9cebc9ef7f37d141c4274a24e370d6615b0a1, tree
a7cb805eba4440ef5ec50b970d681c7b38081efe. Root tests, all seven type projects, the complete
build and complete Electron run started from this clean candidate. Dependency
installations were reused; application/runtime/plugin/Main archives were rebuilt.
The final evidence is [report.json](../../artifacts/windows-alpha-closeout-20261008/report.json),
with a credential scan and SHA256SUMS beside it. Raw logs, prior failures and
process/configuration receipts remain at D:/ClawX-work/windows-alpha-closeout-20261008/recovery-final.

| Gate | Executed result |
| --- | --- |
| Complete root unit command | 8067 passed / 50 skipped / 0 failed |
| Root node/web/test and runtime core/extensions/core-test/extensions-test types | Seven exit 0 results |
| Complete Windows Electron | 341 passed / 4 skipped / 0 failed; 47.7 minutes; no global errors |
| Windows build and startup budgets | Passed |
| Readonly lint, communication replay and comparison | Passed |
| VerseConf plugin boundary tests | 14 passed in 5 files |
| Legacy auth-format migration tests | 3 passed in 2 files |
| Agent Dev fresh build / full unit / full types / full E2E | Passed; strict audit 97, grade A |
| Harness CI and task validation | Passed |

Root tests are not the entire OpenClaw test corpus. Their 50 existing skips are
reported as the console runner's aggregate; this record does not invent a
per-case skip inventory. The Electron JSON lists four explicit skips: two paid
live-provider/cache tests, macOS-only titlebar behavior and an opt-in visual-tuning
capture. No retry, assertion or skip budget was relaxed.

## Changes established by this qualification

The installer regression now follows the extracted process-check helper and
retains fail-closed behavior. Complete acceptance also exposed a Gateway recovery
race: stopping an unfinished start left its lock active, so the repair/start
request disappeared while old startup work could still invoke Doctor. Startup
now shares its in-flight promise, stop drains the cancelled flow, readiness
checks cancellation, and stale recovery work cannot change the next lifecycle.
Both new regression cases fail the old implementation; the two files pass all
15 cases after the fix. The full recovery spec plus brand spec also pass 6/6.

Hosted CI now builds the required runtime and the Electron fixture waits for
its first window before fixing native desktop content size. A 1024 x 720 hosted
screen had triggered the app's intended sidebar collapse, hiding desktop test
controls. Responsive tests retain their own explicit sizes. The CI job budget
is 90 minutes based on the measured serial suite; per-test deadlines, retries,
worker count and three-platform matrix remain unchanged.

## Actual Windows delivery

Installer: D:/ClawX-work/windows-alpha-closeout-20261008/recovery-final/release/Verse Claw-0.4.9-alpha.0-win-x64.exe

SHA-256: 7bd7c209728e58278882876cf240f722d1b0759892e7a91f3b457d9806c4f07e

Size: 556180981 bytes. The actual installer was extracted and checked:
4174 dependency resolutions stay in the package, no external
links were found, and all 12 native companions match the
Main ASAR integrity table. A guarded packaged Gateway reaches readiness using
only packaged modules. All 12 CLI probes pass, including the Electron fallback,
with unchanged isolated state. MCP initialization and the health-only
compatibility surface pass; that is not acceptance of every VerseShell operation.

Non-elevated install, same-version replacement and silent uninstall pass. A seeded
obsolete file disappears after replacement and modified CLI bytes are restored.
The actual installed app.asar opens with first and returning isolated profiles.
Those shell probes deliberately disable Gateway auto-start; packaged runtime
readiness is verified independently. The original 11 user JSON files, raw PATH
value/type and two shortcuts match their baseline. No installation directory,
file, registration or CLI PATH entry remains.

## Remaining capability and platform boundaries

- CVK's selector API can compute a denied result, but the production engine reads
  its diagnostics. Execution-boundary enforcement is not implemented by this task.
- PPTX remains a three-record template. Over-capacity export is rejected without
  dropping content; Markdown retains the full outline. Arbitrary pagination and
  long-text visual acceptance remain outside the existing renderer contract.
- JSON-to-SQLite migration, non-overwrite protection and synthetic downgrade-marker
  recovery were executed. Same-version installer replacement is not proof of an
  upgrade between two released product versions.
- Current macOS/Linux execution remains unverified. GitHub run 37763940523 refused
  all three jobs before the first step because recent account payments failed or
  the spending limit needs increasing. No billing setting was changed. Earlier
  incomplete/failed matrix runs remain preserved; they are not converted to passes.

## Preserved evidence history and landing

Earlier installer-assertion failures, missing Node-receipt packaging failure,
incomplete packaging and CI attempts, the complete 340-pass/4-skip/1-failure
Electron run, and the first window-initialization attempt remain available in
D:/ClawX-work/windows-alpha-closeout-20261008. The first final-candidate Electron attempt was
interrupted by a Codex restart at test 133/345; its unfinished log is retained.
The replacement complete run is the result counted above.

Only the current candidate and curated evidence are intended for a fast-forward
onto the existing private main. The fetch-verified ref and source ancestry are
recorded in the local main-landing.json receipt; unrelated branches/worktrees and
Task Forest history are preserved. Task Forest and session handoffs remain local.
