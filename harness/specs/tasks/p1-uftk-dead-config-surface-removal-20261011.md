---
id: p1-uftk-dead-config-surface-removal-20261011
title: Remove the declared-only runtime.coding.uftk config surface with legacy-config tolerance
lifecycleStatus: active
taskType: repo-governance
intent: Close issue #95 by removing the 19 zero-consumer coding.uftk leaves from the runtime config type, the strict zod schema and the exhaustive parity fixture, while keeping config files written before the removal valid through the existing pre-validation strip, and retire the matching guard baseline entries.
touchedAreas:
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/validation.ts
  - openclaw_runtime/src/config/runtime-coding-uftk.test.ts
  - openclaw_runtime/docs/.generated/config-baseline.sha256
  - scripts/check-feature-leaf-consumers.mjs
  - scripts/check-feature-leaf-consumers.d.mts
  - tests/unit/feature-leaf-consumers.test.ts
  - tests/unit/config-schema-parity.test.ts
  - harness/specs/**
  - docs/**
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - A config file written before the removal (the installed workspace config still carries a runtime.coding.uftk block) keeps starting the gateway; the dead subtree is dropped before strict validation instead of failing it.
  - No runtime feature leaf is accepted by the strict schema unless something reads it, and the removed subtree cannot reappear without failing the leaf-consumer guard.
  - Operators reading the config docs see no uftk switches, because the removed surface had no labels or help entries to keep in sync.
requiredProfiles:
  - fast
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/config-schema-parity.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/feature-leaf-consumers.test.ts
  - node scripts/check-feature-leaf-consumers.mjs
  - node scripts/check-feature-leaf-consumers.mjs --self-test
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-no-bom.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-uftk-dead-config-surface-removal-20261011.md
acceptance:
  - Issue #95 - runtime.coding.uftk is absent from types.openclaw.ts, zod-schema.ts and RUNTIME_FEATURE_EXHAUSTIVE; the type/schema parity guard stays green in all three directions.
  - Issue #95 - a config carrying the pre-removal uftk block (including unknown keys inside it) still validates through validateConfigObjectRaw and comes back without the subtree, so the removal cannot reproduce the FP-P0-02 gateway-exit-1 failure.
  - Issue #95 - the leaf-consumer guard pins no uftk leaf, reports the subtree as absent, and a regression assertion fails if the subtree is reintroduced without a reader.
docs:
  required: true
---

# Remove the declared-only `runtime.coding.uftk` surface

Issue #95 reported that 9 of the 12 `coding.uftk` switches had zero runtime
consumers. The measured number was 12/12 (19 leaf paths), and the two detached
implementations it pointed at read injected options or nothing at all — never
the uftk subtree. The issue asked for a two-way choice with no middle state:
wire the implementations to the config, or delete the surface.

Deleting is the honest direction here, and it needs one piece of care the issue
did not have to consider: the strict schema rejects unknown keys, and the
installed workspace config still carries the uftk block, so a plain deletion
would make the gateway exit code=1 on start — exactly the FP-P0-02 defect class
the parity guard exists for. The change therefore removes the surface and routes
legacy files through the existing `stripDeprecatedValidationKeys`
pre-validation strip, following the in-repo precedent set when
`runtime.coding.factViews` and `commands.modelsWrite` were removed.

Wiring was rejected on evidence, not convenience: `commandApproval` would create
a second approval plane, which the coding-runtime contract explicitly forbids
("must never spawn directly or construct a second approval, sandbox, or timeout
plane"), and the capabilities that were supposed to honour the other gates are
already gated by `coding.writeJournal`, `coding.parseOnTouch`,
`coding.staleWriteGuard` and the exec-approval pipeline.
