---
lifecycleStatus: active
id: versegit-wp7-host-vertical-slice
title: WP7 - real host vertical integration, failure cleanup and continuation
scenario: versegit-validation-layer-extension
taskType: execution
intent: Prove one real host-managed concurrency chain from two worktree/session traces through VerseGit producer-consumer facts and a composed candidate, real VerseShell governed verification and host-authoritative receipt acceptance, then reject a failed receipt and continue with a second successful run.
touchedAreas:
  - harness/specs/tasks/versegit-wp7-host-vertical-slice.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
  - docs/dev/versegit-validation-layer/README.md
  - harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp7-evidence/**
  - artifacts/versegit/wp7/**
  - scripts/versegit-wp7-host-vertical.mts
  - scripts/verify-versegit-wp7.mts
  - tests/unit/versegit-wp7-host-vertical.test.ts
expectedUserBehavior:
  - Two active host worktree/session traces bind distinct producer and consumer identities without crossing.
  - Real VerseGit sessions and observations identify the producer-consumer stale-read fact; an own-write negative control remains silent.
  - VerseGit facts are collected by a fixed-argv host adapter inside the disposable fixture; the composite candidate is verified through real VerseShell governed execution.
  - Only a receipt reconstructed from the actual VerseShell observation and matching every plan/identity/artifact binding is accepted.
  - A wrong-candidate receipt is rejected with host verdict unchanged, and a second run proves continuation.
  - Cleanup removes all disposable worktrees and VerseShell processes while retaining evidence.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - pnpm --dir openclaw_runtime exec tsx ../scripts/versegit-wp7-host-vertical.mts --fixture harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json --out artifacts/versegit/wp7/host-vertical-report.json
  - pnpm --dir openclaw_runtime exec tsx ../scripts/verify-versegit-wp7.mts --artifact artifacts/versegit/wp7/host-vertical-report.json
  - pnpm exec vitest run tests/unit/versegit-wp7-host-vertical.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp7-host-vertical-slice.md
acceptance:
  - The live run uses the frozen vg.exe for fixed-argv repository facts and the bundled ae.exe for real VerseShell verification; native verification fallback is zero.
  - Producer and consumer sessions map to distinct worktrees, sessions, traces and epochs; cross-worktree violations are zero.
  - Real VG `check` returns the producer-consumer `ssi/stale-read` fact and the own-write control remains silent.
  - A composite candidate tree includes both changes and is verified by a real VerseShell process.
  - A host-authoritative receipt with `realVerseshell=true` is accepted only for the exact plan/candidate/epoch/argv/cwd/env/output-digest/cleanup binding.
  - A wrong-candidate receipt is rejected, host verdict remains unchanged, and a second governed continuation run succeeds.
  - Cleanup reports zero worktree, process and temp survivors; evidence and raw failure facts remain.
  - The current planning validator accepts TF-0479 either as optional/proposed or as explicitly completed with MC6 decision evidence.
  - No land/admit, default-on, GA, M4, native verification fallback or real-human evidence is claimed.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
---

# WP7 real host vertical slice

WP7 is the first test that joins the existing services into one host lifecycle instead
of validating each seam independently. It uses disposable repositories and never
mutates the ClawX source tree.

The execution route is:

```text
host ChatRuntimeEvent traces
  -> VerseGitObservationBridge
  -> real VerseGit sessions/checks through VerseShell
  -> producer-consumer fact + composed candidate
  -> real VerseShell verification
  -> host-owned receipt
  -> VerseGitReceiptBridge verdict facts
  -> unchanged host verdict
  -> failure rejection + continuation
  -> cleanup and evidence seal
```
