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
