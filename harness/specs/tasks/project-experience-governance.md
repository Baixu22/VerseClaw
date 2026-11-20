---
id: project-experience-governance
title: TF-0687 Govern mission experience through accepted memory owners
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 40bf8b32f
intent: Bind Mission experience to its actual session and prove candidate review, use, revocation and bounded evaluation through existing memory owners.
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - context-family-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - tests/unit/mission-control-loop.test.ts
  - tests/unit/project-experience-governance.test.ts
  - tests/unit/role-memory-context-provider.test.ts
  - tests/e2e/project-experience-governance.spec.ts
  - harness/specs/tasks/project-experience-governance.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/m2/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - Mission outcomes create scoped candidates with source references and expiry; acceptance remains with the existing memory governance owner.
  - Accepted experience is available only in its originating session; archived, expired and superseded content stops appearing in subsequent context reads.
  - Agent-driven canary review uses the same governance path and never changes default automatic writeback or injection settings.
acceptance:
  - Success and failure candidates retain mission/run evidence, actual session scope, sensitivity and bounded TTL, remaining invisible before acceptance.
  - Actual memory owner proposal/review/context-provider/withdrawal flows preserve isolation and reject prompt injection, secrets and conflicting unsafe promotion.
  - Held-out fixture tasks compare before/after retrieval coverage and token cost using the existing memory evaluator; model quality remains a separately measured result.
  - Revocation and replacement invalidate subsequent run inputs, including reads through the same provider object.
  - Fixed candidate tests and an actual Gateway memory lifecycle journey provide agent-labelled evidence with no silent failures or skips.
requiredTests:
  - pnpm exec vitest run tests/unit/mission-control-loop.test.ts tests/unit/project-experience-governance.test.ts tests/unit/role-memory-v2.test.ts tests/unit/role-memory-context-provider.test.ts tests/unit/role-memory-eval-pack.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/project-experience-governance.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/project-experience-governance.md
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

Use Mission's existing candidate producers and Role Memory governance. Do not
introduce a memory store, evaluator or approval bypass. The canary explicitly uses
agent actors and fixture-scoped policy; production defaults remain unchanged.
