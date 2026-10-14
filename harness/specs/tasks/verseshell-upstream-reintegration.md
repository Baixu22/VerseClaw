---
id: verseshell-upstream-reintegration
title: Preserve and reintegrate the pinned VerseShell upstream module
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Absorb the frozen VerseShell implementation and its capabilities through the existing ClawX owners, with source provenance and real host evidence that prevent a rewrite from being reported as a migration.
expectedUserBehavior:
  - The host uses the verified upstream-derived ae binary and preserves existing execution, approval, cancellation, artifact and write-recovery behavior.
  - Batch reading and new failure observations reach the model through the stable host facade with bounded, loss-accounted results.
  - Missing binaries, owner or policy drift and stale writes fail explicitly without an alternate native implementation.
touchedAreas:
  - harness/specs/tasks/verseshell-upstream-reintegration.md
  - harness/specs/rules/verseshell-upstream-preservation.md
  - harness/specs/guides/verseshell-reintegration-playbook.md
  - harness/specs/fixtures/verseshell-reintegration/**
  - scripts/verseshell-reintegration-check.mjs
  - scripts/verseshell-reintegration-check.test.mjs
  - resources/verseshell/**
  - resources/bin/win32-x64/ae.exe
  - scripts/verseshell-bundle.mjs
  - scripts/verseshell-bundle.test.mjs
  - scripts/validate-verseshell-manifest.mjs
  - electron/utils/verseshell-runtime-bundle.ts
  - electron/utils/verseshell-runtime-request.ts
  - shared/verseshell/**
  - openclaw_runtime/src/agents/verseshell/**
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/bash-tools.exec*.ts
  - openclaw_runtime/src/agents/bash-tools.process.ts
  - resources/verseshell-mcp/**
  - tests/unit/verseshell-*.test.ts
  - tests/e2e/*verseshell*.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - verseshell-upstream-preservation
  - backend-communication-boundary
  - contract-first-boundary
  - supply-chain-integrity-pinning
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node --test scripts/verseshell-reintegration-check.test.mjs
  - node scripts/verseshell-reintegration-check.mjs --upstream <frozen-upstream-checkout> --candidate <effective-source-checkout>
  - pnpm run verseshell:rebuild
  - pnpm run verseshell:manifest:validate:package
  - pnpm run verseshell:test
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run verseshell:package:verify
acceptance:
  - The frozen target is c06f406e83566bb968448222d9c8caf429e580a0 and the old effective baseline is c3983694407a9ddb23505e05fad4a9eae653b283 plus its four recorded patches.
  - Protected upstream source, Cargo inputs, attributes and regression inputs match the source lock except for independently registered residual patches; the initial residual is the existing startup patch only.
  - All 32 operations and the cross-cutting behavior inventory have a preserved implementation, explicit owner, behavioral checks and current evidence; no operation is silently dropped or exposed outside its host policy.
  - Standalone target and host-routed target pass the specified deterministic differential checks, with exact allowed field mappings and no ignored error or payload-loss differences.
  - Real host interventions reject an unavailable or wrong binary, wrong catalog, owner, policy, workspace and stale hash, and prove there is no native fallback or side-effect replay.
  - New observation fields, schema bounds, stream shapes and batch pagination work through the real ClawX model-facing tools, preserving body, diagnostics, omissions and artifact recovery.
  - The packaged binary is traced to the protected effective source and two independent builds are byte-identical under the recorded build recipe.
  - Completion is computed from frozen acceptance inputs and on-disk receipts for the final candidate; source-check success, unit-test success, dry-run, historical evidence and writer-edited status fields cannot grant completion.
  - Product defaults, release authority, human-evidence honesty and the ClawX approval, resources and write-journal owners remain intact.
docs:
  required: true
  paths:
    - harness/specs/guides/verseshell-reintegration-playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Read the preservation rule and playbook before implementation. This active spec supersedes the exploratory local plan as execution guidance, without changing archived acceptance records.

The dedicated source checker is a preparation gate only. The current Harness runner selects requiredProfiles; listing commands under requiredTests does not execute them. Run the dedicated commands explicitly and record their exit codes and artifacts. Do not report harness --dry-run as executed acceptance.

Execution is serial: freeze, source reconstruction, contract compatibility, capability consumption, adversarial host acceptance, package replay. Source upgrades and behavior refactors are reviewed separately. The source lock is a planned target, not a change to the currently shipped manifest.
