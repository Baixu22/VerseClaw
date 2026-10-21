---
lifecycleStatus: active
id: versegit-mc6-extraction-decision
title: MC6 - sidecar-only versus selective source extraction decision
scenario: versegit-validation-layer-extension
taskType: decision
intent: Record the optional MC6 disposition from measured integration evidence without allowing stable contracts alone to trigger source extraction.
touchedAreas:
  - harness/specs/tasks/versegit-mc6-extraction-decision.md
  - harness/specs/tasks/versegit-wp6-merged-closeout.md
  - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
  - harness/specs/fixtures/versegit-planning-correction/mc6-extraction-decision-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc6-evidence/**
  - artifacts/versegit/mc6/**
  - scripts/versegit-wp6-closeout.mjs
  - scripts/verify-versegit-mc6.mjs
  - tests/unit/versegit-wp6-closeout.test.ts
expectedUserBehavior:
  - The decision remains sidecar-only because no measured performance or security requirement proves in-process code is necessary.
  - No VerseGit source tree, crate, history, build output or private evidence is copied into ClawX.
  - The rollback path disables the optional host integration while preserving the standalone provider.
  - Reopening requires measured sidecar limitation evidence plus a separate Task Forest ownership decision.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/verify-versegit-mc6.mjs --artifact artifacts/versegit/mc6/decision.json
  - pnpm exec vitest run tests/unit/versegit-wp6-closeout.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc6-extraction-decision.md
acceptance:
  - MC4 differential, MC5 gate, WP2 seam availability and WP5 replay facts are read from on-disk evidence.
  - Decision=sidecar-only, sourceExtractionTriggered=false and measuredInProcessRequirement=false are digest-bound.
  - Migration files remain empty and the provider standalone product is preserved.
  - Reopen conditions require measured necessity and a separate decision; contract stability alone is insufficient.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
---

# MC6 optional extraction decision

MC6 is not a mandatory implementation step. It is triggered only when measured sidecar
limitations prove that an in-process implementation is necessary. The current evidence
does not contain that proof.

The decision therefore remains **sidecar-only**, with an explicit rollback and a new
decision requirement before any future extraction.
