---
id: knowledge-system-ks02-experience-session-truth
title: Knowledge system KS-02 experience write truth and session cascade
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks01-review-bundle-integrity
intent: Make SEKB confirm write exactly one Principle revision and one DCS experience projection, report journaled_degraded honestly, add BlockStore session/source enumeration and hard delete, and make session deletion incomplete/retryable instead of best-effort.
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
  - openclaw_runtime/src/agents/tools/context-agent-tools.test.ts
  - openclaw_runtime/src/context-engine/tools/context-search-tool.test.ts
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
  - Confirming a SEKB principle calls one awaited commit coordinator; retry/concurrency produce one Principle row and one experience projection row.
  - The UI sees persisted only after a real BlockStore write is read back; unavailable BlockStore produces journaled_degraded.
  - Session hard delete coordinates derivative cleanup before transcript mutation and keeps the operation retryable/incomplete on any derivative residual.
  - A new session with the same key cannot recall deleted experience.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md
  - pnpm exec vitest run tests/unit/knowledge-api.test.ts tests/unit/session-cascade-delete.test.ts tests/unit/session-delete-cascade-integration.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/knowledge/sekb/experience-block-bridge.test.ts src/knowledge/sekb/sekb.test.ts src/context-engine/block-store.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/context-agent-tools.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/tools/context-search-tool.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - one-commit-coordinator: confirm_and_save_with_lineage performs exactly one projection commit
  - stable-idempotency: experience block_id = stable principle id + projection schema, upsert idempotent
  - truthful-status: dcsWrite uses persisted/journaled_degraded/rejected/not_attempted; journal never reports persisted
  - readback-verification: persisted requires BlockStore query containing the committed block_id
  - blockstore-owner-api: enumerate/invalidate/hard-delete by session/source ref exist and clear block_entity_map
  - finalizer-before-transcript: session delete runs derivative finalizer first and aborts with incomplete/retryable on failure
  - residual-zero: after successful delete, Principle/trajectory/MemoryCard/context_blocks/journal/archive residual is zero
  - fresh-session-isolation: same session key after delete does not recall old experience blocks
notes:
  - Context-tool test doubles must implement all required BlockStoreApi lifecycle methods introduced by KS-02. This compatibility repair changes only typed fixtures; it must preserve existing recall, tool visibility and mutation assertions.
docs:
  required: true
  files:
    - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
---

# KS-02 Experience Write Truth 与 Session Cascade

## Hard acceptance

1. confirm 并发/重试只产生一个 Principle revision 和一个 experience projection。
2. BlockStore 不可用时 persisted 计数为 0。
3. 删除后 Principle、trajectory、MemoryCard、context_blocks、journal、archive residual 为 0。
4. 使用同一 session key 新建会话不会召回旧 experience。
5. 未确认 suggestion durable write 为 0。

## Implementation notes

- `confirm_and_save_with_lineage` suppresses the fire-and-forget projection from `confirm_and_save` and awaits one `handleConfirmAndSave`.
- `block_id` includes projection schema version and stable principle id; BlockStore upsert provides idempotency.
- `BlockStore` gains `enumerateBySession`, `invalidateBySession`, `deleteBlock`, and `deleteBySession`.
- Electron cascade opens the same `openclaw-state` database used by DCS and performs hard delete + read-back residual verification.
