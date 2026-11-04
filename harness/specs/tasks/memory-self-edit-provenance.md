---
lifecycleStatus: active
id: memory-self-edit-provenance
title: Correct agent provenance for memory self-edit tools
scenario: gateway-backend-communication
task_forest:
  - TF-0741
taskType: runtime-bridge
intent: Correct agent-to-human provenance inflation before any future persistence restoration, without changing product flags or the independent TF-0742 atomicity work.
touchedAreas:
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-adapter.ts
  - tests/unit/memory-self-edit-provenance.test.ts
  - tests/unit/runtime-memory-self-edit.test.ts
  - tests/unit/runtime-memory-self-edit-persistence.test.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - docs/dev/memory-control-plane.md
  - harness/specs/rules/memory-self-edit-provenance.md
  - harness/specs/tasks/memory-self-edit-provenance.md
  - harness/specs/fixtures/memory-self-edit-provenance/**
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Agent memory edits carry agent provenance and cannot claim human approval; retired tools remain unavailable.
requiredRules:
  - memory-self-edit-provenance-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-self-edit-provenance.test.ts tests/unit/runtime-memory-self-edit.test.ts tests/unit/runtime-memory-self-edit-persistence.test.ts tests/unit/memory-self-edit-adapter.test.ts tests/unit/memory-tf0500-persistence-retirement.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts --maxWorkers=1
acceptance:
  - Model update/forget actions generate zero human provenance labels through both the in-memory store and an explicit persistence port.
  - Historical human evidence is preserved as lineage and never reused as approval of changed content.
  - Forged human rejection and contradictory self-edit schema records fail before mutation.
  - Strengthen changes access count without changing fact provenance or approval.
  - Retired persistence stays false for all configured values and the adapter exposes no tools.
docs:
  required: true
  files:
    - docs/dev/memory-control-plane.md
---

This node is independent of TF-0738 prompt accounting. The approved Memory M4
write set permits the additive agent source/episode/status/promotion values.
`agent_approved` retains the existing local edit/recall semantics while separating
agent approval from independently verified or human-approved facts. No database
migration runs: previously persisted bytes keep their original attribution.

Evidence uses direct owner APIs and an in-memory persistence port, not live
SQLite or a model session. Product persistence remains retired. README en/zh/ja
were reviewed; no visible workflow or product availability changes require edits.
