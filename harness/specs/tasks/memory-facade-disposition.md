---
lifecycleStatus: active
id: memory-facade-disposition
title: Retire the unused Stage5 memory facade from production adoption
scenario: gateway-backend-communication
task_forest:
  - TF-0744
taskType: runtime-bridge
diffBase: 960c48553
intent: Document the retire decision, preserve historical golden-run observations, and enforce zero production consumers.
touchedAreas:
  - openclaw_runtime/src/context-engine/stage5-memory-facade.ts
  - openclaw_runtime/src/agents/stage5-golden-run.ts
  - docs/dev/memory-control-plane.md
  - harness/specs/tasks/context-control-plane-stage5.md
  - harness/specs/tasks/memory-facade-disposition.md
  - tests/unit/memory-facade-disposition.test.ts
  - docs/dev/evidence/semantic-convergence-20261104/tf-0744/**
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - memory-self-edit-provenance-boundary
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Production memory tools keep their existing owners; the historical Stage5 facade is not a production registration surface.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-facade-disposition.test.ts tests/unit/context-control-plane-stage5-contracts.test.ts tests/unit/memory-query-tool.test.ts tests/unit/memory-self-edit-adapter.test.ts --maxWorkers=1
acceptance:
  - The disposition is retire, with its reason recorded in the Memory control-plane guide and the archived Stage5 spec.
  - The facade has zero production importers or barrel exports, excluding tests and the explicit observational golden-run.
  - A negative importer fixture makes the same consumer oracle fail.
  - The facade and golden-run headers agree on deprecated production adoption, historical observation scope, and the unchanged persistence retirement.
humanEvidence: not-required
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/memory-control-plane.md
---

The approved program explicitly allows adopt or retire. Retire preserves the
existing production architecture and requires no default, product-lock, or
persistence change. Keep direct module exports only for tests and historical
golden-run replay; no public production barrel currently exports this facade.
README translations were reviewed: there is no new enabled capability or UI.
