---
id: knowledge-system-ks01-review-bundle-integrity
title: Knowledge system KS-01 ReviewBundle and governance integrity
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-integrity-foundation
intent: Remove Draft/Proposal cross-selection, add single ReviewBundle read model, and make governance JSON writes atomic, serialized, revisioned, and journaled so mismatch/concurrent/orphan state is zero.
touchedAreas:
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
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
  - docs/architecture-overview.md
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
  - Knowledge review tab selects one ReviewBundle only; Draft and Proposal are never selected independently.
  - Approve-and-apply validates draftId/proposalId/reviewedDigest/expectedRevision/workspace/status before wiki.apply.
  - Editing a draft after approval invalidates the stale bundle and apply returns a conflict.
  - Concurrent automatic captures with the same captureKey create exactly one candidate.
  - Governance JSON writes use same-directory temp file + fsync + atomic rename and are serialized through one writer queue.
  - Multi-file review->apply transitions leave a retryable operation journal.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md
  - pnpm exec vitest run tests/unit/knowledge-api.test.ts tests/unit/knowledge-page.test.tsx tests/unit/knowledge-steward-semantic-pass.test.ts tests/unit/host-api-facade.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm contract:check
  - git diff --check
acceptance:
  - review-bundle-read-model: Host returns one bundle per draft/proposal pair with digest and expectedRevision
  - ui-single-selection: page state has selectedReviewBundleId only for review/apply flow
  - apply-invariants: applyReviewedChange rejects mismatched draft/proposal, stale revision, stale digest, wrong workspace, and non-approved status
  - atomic-json: writeJsonFileAtomic uses temp file in target directory, fsyncs before rename
  - serialized-writer: governance mutations execute through a single in-process writer queue
  - capture-key-critical-section: captureKey dedupe check and insert occur in the same critical section
  - operation-journal: apply transition writes intent/committed/failed journal entries and is retryable
  - semantic-steward-di: createKnowledgeApi no longer overwrites an explicitly injected SemanticStewardInvoker
  - legacy-read-compat: legacy {id}-based applyReviewedChange remains readable where safe; new mutation path uses reviewBundleId
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-01 ReviewBundle 与 Governance Integrity

## Hard acceptance

1. 10 个 Draft/Proposal 交叉排列不会错配。
2. stale approval 100% conflict-fail。
3. 并发相同 captureKey 只产生一个 candidate。
4. 任意写入点 crash 后不存在 applied proposal + unapproved draft。
5. Semantic Steward 10/10 通过。

## Implementation notes

- `ReviewBundle` is a read model derived from Host governance records.
- Draft and proposal records carry `revision` and `contentDigest`.
- `reviewDraft approve` stores `reviewedDigest` and `expectedRevision` on the linked proposal in the same critical section.
- `applyReviewedChange({ reviewBundleId })` re-reads bundle, recomputes digest, and verifies status/revision/workspace before calling `wiki.apply`.
- Operation journal lives in `<knowledgeDir>/operations/<operationId>.json`.
