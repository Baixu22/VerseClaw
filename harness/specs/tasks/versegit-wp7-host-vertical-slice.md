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
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
  - harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md
  - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
  - docs/dev/versegit-validation-layer/README.md
  - harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json
  - harness/specs/fixtures/versegit-planning-correction/mc4-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/mc6-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/wp2-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/wp3-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/wp6-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp7-evidence/**
  - artifacts/versegit/**
  - scripts/versegit-wp7-host-vertical.mts
  - scripts/verify-versegit-wp7.mts
  - scripts/validate-versegit-planning-correction.mjs
  - electron/services/versegit-module.ts
  - electron/services/versegit-observation.ts
  - electron/services/versegit-behavior-coverage.ts
  - electron/services/versegit-receipt-bridge.ts
  - electron/services/versegit-receipt-evidence.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/policy-profile.ts
  - tests/unit/versegit-wp7-host-vertical.test.ts
  - tests/unit/versegit-receipt-authority.test.ts
expectedUserBehavior:
  - Two active host worktree/session traces bind distinct producer and consumer identities without crossing.
  - Real VerseGit sessions and observations identify the producer-consumer stale-read fact; an own-write negative control remains silent.
  - VerseGit facts are collected by the typed host-owned fixed-argv adapter, which records real process/output evidence but cannot execute user code or verification; the composite candidate is verified through real VerseShell governed execution.
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
  - The live run uses the frozen vg.exe through the typed host-owned fixed-argv provider adapter for repository facts and the bundled ae.exe through VerseShell for candidate verification; native verification fallback is zero.
  - Producer and consumer sessions map to distinct worktrees, sessions, traces and epochs; cross-worktree violations are zero.
  - Real VG `check` returns the producer-consumer `ssi/stale-read` fact and the own-write control remains silent.
  - A composite candidate tree includes both changes and is verified by a real VerseShell process.
  - A host-authoritative receipt with `realVerseshell=true` is accepted only for the exact plan/candidate/input-manifest/epoch/argv/cwd/env/observation/output-digest/cleanup binding, with the receipt reconstructable from retained host evidence.
  - A wrong-candidate receipt is rejected, host verdict remains unchanged, and a second governed continuation run succeeds.
  - Cleanup reports zero worktree, process and temp survivors; plan, receipt, observation, output, candidate input, cleanup and failure evidence remain digest-bound.
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
  -> real VerseGit facts through fixed-argv host adapter
  -> producer-consumer fact + composed candidate
  -> real VerseShell verification
  -> host-owned receipt
  -> VerseGitReceiptBridge verdict facts
  -> unchanged host verdict
  -> failure rejection + continuation
  -> cleanup and evidence seal
```

## Evidence authority

The typed VerseGit fact adapter is not a second verifier. It owns only the
provider-domain calls listed by the frozen allowlist and records host-observed
process facts. The host-owned evidence bundle retains plans, receipts, raw
VerseShell observations, bounded stdout/stderr, candidate input manifests and
cleanup attachments. `VerseGitReceiptBridge` promotes a live receipt to
`observed` only after the file-backed authority re-reads those artifacts.
