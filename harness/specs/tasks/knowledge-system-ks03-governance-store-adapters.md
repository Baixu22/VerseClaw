---
id: knowledge-system-ks03-governance-store-adapters
title: Knowledge system KS-03 GovernanceStore and owner adapters
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks02-experience-session-truth
intent: Migrate JSON governance metadata into openclaw-state SQLite, register Wiki/Role Memory/SEKB governed target adapters, and keep exactly one active memory writer while preserving legacy JSON as read-only compatibility.
touchedAreas:
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/knowledge-steward-registry.test.ts
  - tests/unit/knowledge-steward-notes-injection.test.ts
  - tests/unit/knowledge-roletags.test.ts
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/proposals/TFP-bbe2e21477.json
  - docs/dev/NEXT-GOAL.md
  - openclaw_runtime/src/state/openclaw-agent-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-agent-db.generated.d.ts
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/proposals/TFP-2e92914863.json
  - .agent-workbench/task-forest/todos/todos.json
  - .agent-workbench/task-forest/graph/nodes.json
  - .agent-workbench/task-forest/graph/edges.json
  - .agent-workbench/task-forest/exports/task-forest.todos.json
  - .agent-workbench/task-forest/exports/task-forest.timeline.json
  - .agent-workbench/task-forest/events/events.jsonl
  - .agent-workbench/task-forest/config.json
  - .agent-workbench/task-forest/alignments/alignments.jsonl
  - tests/e2e/knowledge-hub.spec.ts
  - README.ja-JP.md
  - README.zh-CN.md
  - README.md
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/graph/forest.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - WORKTREE.md
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - harness/specs/tasks/knowledge-system-integrity-foundation.md
  - harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md
  - harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md
  - harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md
  - electron/services/knowledge-api.ts
  - electron/services/session-cascade-delete.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - shared/knowledge/governance-contract.ts
  - src/lib/host-api.ts
  - src/pages/Knowledge/index.tsx
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/block-store.ts
  - openclaw_runtime/src/context-engine/knowledge-system-ks02-block-store-owner.test.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/knowledge/sekb/session-cascade-delete.ts
  - openclaw_runtime/src/knowledge/governance-store.ts
  - openclaw_runtime/src/knowledge/governance-store.test.ts
  - openclaw_runtime/src/knowledge/governance-adapters.ts
  - openclaw_runtime/src/knowledge/governance-adapters.test.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/session-cascade-delete.test.ts
expectedUserBehavior:
  - Inbox/Draft/Proposal governance records are persisted in openclaw-state SQLite knowledge_* tables.
  - First access imports legacy JSON in one transaction and emits a parity report; legacy JSON is read-only afterwards.
  - Wiki, Role Memory, and SEKB are registered as governed target adapters; second active memory writer registration is rejected.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md
  - pnpm exec vitest run tests/unit/knowledge-api.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/knowledge/governance-store.test.ts src/knowledge/governance-adapters.test.ts
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm contract:check
  - git diff --check
acceptance:
  - import-parity: imported JSON count/digest parity is 100% in parity report
  - json-writer-zero: governance JSON mutation functions are not used for new records after migration
  - compat-read-only: legacy JSON remains readable with a stated removal window
  - adapters-registered: memory-wiki, active memory slot (Role Memory), and SEKB adapters are registered and contract-tested
  - single-memory-writer: registering a second active memory writer throws
  - runtime-memory-closed: Runtime Memory persist/inject remains closed
docs:
  required: true
  files:
    - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
---

# KS-03 GovernanceStore 与 Owner Adapters

## Hard acceptance

1. 导入 count/digest parity 100%。
2. JSON writer 为 0，compat read 有明确移除日期。
3. adapter contract tests 全绿。
4. Runtime Memory persist/inject 仍关闭。

## Implementation notes

- Tables: `knowledge_candidates`, `knowledge_governance_proposals`, `knowledge_governance_events`, `knowledge_owner_links`.
- Candidate rows store inbox/draft metadata and body; owner links never duplicate Wiki/Memory/Principle payload.
- Legacy JSON import is one immediate transaction; report at `<knowledgeDir>/governance-migration.json`.
