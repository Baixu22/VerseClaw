# Current Windows alpha qualification — 2026-10-08

`driven_by: agent` · `actor: codex-windows-alpha-closeout`

Status: validation in progress. No new full-suite pass, main-branch landing or
release acceptance is claimed by this initial record.

The starting source is clean `dd9ea94dc089ebfc4a457dd9e5eec8e1a0b9b12f`,
containing the three Windows fixes and their earlier scoped evidence. This
qualification records the complete current root tests, Windows Electron suite,
type projects, startup budget, Agent Dev gates and delivered-binary provenance.
Raw runs are kept separately under `D:/ClawX-work/windows-alpha-closeout-20261008/`.
Final results replace this progress text only after their files are inspected.

The target remains controlled Windows x64 alpha. CVK diagnostics do not establish
tool execution-boundary enforcement; the current PPTX renderer accepts at most
three records. Cross-version migration and other operating systems require their
own executed observations. Existing failures, skips and product defaults remain
visible while these boundaries are checked. No package is published by this task.

The task contract is `harness/specs/tasks/windows-alpha-closeout.md`.

The previous main-branch Electron CI run `37107739333` was cancelled at the
20-minute job limit on all three operating systems. Its Windows log records only
54 passing tests before cancellation, with three failures and six skips preserved
in the historical log. The full local suite already measured about 51 minutes.
The job budget is therefore 90 minutes so the existing suite can complete; test
timeouts, assertions, retries, platform matrix and failure uploads are unchanged.
New CI results must be read before making a platform-specific acceptance claim.

The first current root run stopped at one outdated installer assertion: 7,594
passed, 50 skipped, one failed in its first batch; later root/DCS batches did not
execute. The query had moved from inline CIM/tasklist commands to the existing
PowerShell helper. The regression now checks helper packaging and bounded
invocation, exit-code/marker consumption, and refusal unless absence is explicit.
The running-process, absence and script-loading-failure helper tests are retained.
The original failed run remains in `root-unit.log` and its candidate-bound receipt.

The 90-minute CI run `37724745719` also cancelled on all three platforms. Its
Windows setup screenshot is 1024 x 720: the desktop sidebar auto-collapses below
1120 pixels, explaining absent navigation/brand elements. The common Electron
fixture now pins native content to 1280 x 800 before desktop tests; responsive
specs can still resize it. CI also builds the runtime before real Gateway tests,
matching local qualification prerequisites. All old failures are retained; these
corrections require another CI run and do not yet establish a pass.

The first native-size fixture attempt (`2af561402`) resized before BrowserWindow
creation in a focused reproduction. That attempt is retained as failed, including
its teardown timeout. The fixture now waits for the initial window and closes
its owned application if initialization fails, before handing it to the test.

The clean `302865444` full Electron run completed with 340 passed, four skipped
and one failed recovery scenario (50 minutes). A focused run reproduced a real
lifecycle race: after stopping an unfinished start, the repair/start request was
ignored by its old lock, and the superseded start could still run Doctor. The
manager now drains cancelled startup before stop resolves, checks cancellation
during readiness polling, and rejects stale repair work. Two regression cases
fail against the old implementation; all 15 tests in those files pass after the
fix. Complete validation and rebuilt delivery are still required for this code.
README English, Chinese and Japanese capability claims remain applicable: the
fix restores the existing recovery contract without expanding product scope.

The fixed production build passes the complete recovery spec plus the brand
window spec: six passed, no failures/skips, 205.6 seconds. The runtime log shows
the superseded readiness probe exiting before a new child starts. Root node,
web and test type projects, scoped lint and diff-aware task validation pass.
The final clean-candidate qualification and replacement installer evidence are
written separately under the raw directory's `recovery-final/` subdirectory.
