---
lifecycleStatus: completed
id: memory-control-plane-authority
title: Converge Memory into one product control plane with domain-specific stores
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close TF-0497 by defining one product Memory concept and one accepting/update authority for every memory data type, scope and operation while preserving Role, Runtime, embedding and derived Dreaming stores.
dependsOnTasks:
  - TF-0493
diffBase: 291c4abd1
ownedPaths:
  - harness/specs/tasks/memory-control-plane-authority.md
  - docs/dev/memory-control-plane.md
  - docs/clawx-product-semantics.md
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/dev/runtime-control-planes.md
  - shared/memory/control-plane.ts
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - tests/unit/memory-control-plane-authority.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - tests/unit/component-disposition-catalog.test.ts
  - tests/unit/model-capability-profile.test.ts
  - harness/specs/fixtures/memory-control-plane/**
touchedAreas:
  - harness/specs/tasks/memory-control-plane-authority.md
  - docs/dev/memory-control-plane.md
  - docs/clawx-product-semantics.md
  - docs/dev/component-disposition-matrix-20261021.md
  - shared/memory/control-plane.ts
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - tests/unit/memory-control-plane-authority.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - tests/unit/component-disposition-catalog.test.ts
  - harness/specs/fixtures/memory-control-plane/**
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - The product exposes one Memory concept while Role Memory, Runtime Memory, embeddings, native retrieval and Dreaming caches keep distinct implementation owners.
  - Candidates and derived caches never become retrievable or prompt-injectable accepted memory without the owning approval path.
  - Existing stores remain in place; consolidation is by authority and lifecycle mapping, not forced database clustering.
requiredTests:
  - pnpm exec vitest run tests/unit/memory-control-plane-authority.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-fact-survival-e2e.test.ts tests/unit/runtime-memory-relations.test.ts tests/unit/runtime-memory-background-consolidation.test.ts tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/model-capability-profile.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-src.config.ts src/memory/memory-policy.test.ts src/memory/root-memory-files.test.ts src/runtime-core/memory-hybrid-retrieval.cjk.test.ts src/runtime-core/memory-runtime-config.test.ts src/runtime-core/memory-effect-receipt.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm catalogs:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/memory-control-plane-authority.md
  - git diff --check
plannedTests:
  - tests/unit/memory-control-plane-authority.test.ts
acceptance:
  - The authority manifest specifies one accepting/update authority for each memory data type, scope and operation.
  - Role, Runtime, Dreaming and Embedding lifecycle semantics cover scope, retention, delete, invalidation and retrieval consistently.
  - Migration and compatibility retain existing stores and avoid data loss; multiple databases remain valid.
  - The model profile exposes one Memory product concept and an accepted-only prompt boundary.
docs:
  required: true
  files:
    - docs/dev/memory-control-plane.md
    - docs/clawx-product-semantics.md
    - docs/dev/component-disposition-matrix-20261021.md

---

# Converge Memory into one product control plane

TF-0497 defines a product-level Memory control plane over the existing stores. It does not create a new memory database, cluster multiple stores, enable automatic writeback, or merge distinct data domains.

The canonical manifest is `shared/memory/control-plane.ts`. It distinguishes accepted role cards, accepted Runtime Memory facts/timelines/episodes, the candidate queue, embedding indexes, native-file query adapters, and rebuildable Dreaming caches. The existing component-authority manifest remains the enforcement source for component/data-type/scope/operation assignments.

Candidates may persist but are neither retrievable nor injectable. Derived embeddings and Dreaming caches may consume accepted inputs but cannot accept memory or inject directly. The model-safe product concept describes Memory as one reviewable concept with an explicit approval boundary.
