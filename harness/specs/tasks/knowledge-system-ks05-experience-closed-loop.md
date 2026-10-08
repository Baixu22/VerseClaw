---
id: knowledge-system-ks05-experience-closed-loop
title: Knowledge system KS-05 experience closed loop
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks04-chat-dcs-single-path
intent: Prove the SEKB experience closed loop on real SQLite: failure trajectories produce advisory candidates only, human confirm persists exactly one canonical Principle with lineage, a fresh task recalls it through the production RetrievalEngine, cited/adopted/outcome evidence updates effectiveness, and archive/delete prevents later recall. record_adoption must be evidence-gated and must not be driven by retrieval_count.
touchedAreas:
  - .agent-workbench/task-forest/alignments/alignments.jsonl
  - .agent-workbench/task-forest/config.json
  - .agent-workbench/task-forest/events/events.jsonl
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/exports/task-forest.timeline.json
  - .agent-workbench/task-forest/exports/task-forest.todos.json
  - .agent-workbench/task-forest/graph/edges.json
  - .agent-workbench/task-forest/graph/forest.json
  - .agent-workbench/task-forest/graph/nodes.json
  - .agent-workbench/task-forest/proposals/TFP-2e92914863.json
  - .agent-workbench/task-forest/proposals/TFP-503710a9d8.json
  - .agent-workbench/task-forest/proposals/TFP-88df65a6ed.json
  - .agent-workbench/task-forest/proposals/TFP-bbe2e21477.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/snapshots/0100.json
  - .agent-workbench/task-forest/todos/todos.json
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - WORKTREE.md
  - docs/dev/NEXT-GOAL.md
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
  - docs/dev/knowledge-system-unification/
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - electron/services/chat-api.ts
  - electron/services/knowledge-api.ts
  - electron/services/session-cascade-delete.ts
  - electron/services/sessions-api.ts
  - harness/specs/tasks/knowledge-system-integrity-foundation.md
  - harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md
  - harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md
  - harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md
  - harness/specs/tasks/knowledge-system-ks04-chat-dcs-single-path.md
  - harness/specs/tasks/knowledge-system-ks05-experience-closed-loop.md
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/templating.ts
  - openclaw_runtime/src/context-engine/block-store.ts
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/chat-knowledge-intent.test.ts
  - openclaw_runtime/src/context-engine/chat-knowledge-intent.ts
  - openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts
  - openclaw_runtime/src/context-engine/knowledge-system-ks02-block-store-owner.test.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/knowledge/governance-adapters.test.ts
  - openclaw_runtime/src/knowledge/governance-adapters.ts
  - openclaw_runtime/src/knowledge/governance-store.test.ts
  - openclaw_runtime/src/knowledge/governance-store.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts
  - openclaw_runtime/src/knowledge/sekb/experience-closed-loop.test.ts
  - openclaw_runtime/src/knowledge/sekb/knowledge-store.ts
  - openclaw_runtime/src/knowledge/sekb/sekb.test.ts
  - openclaw_runtime/src/knowledge/sekb/session-cascade-delete.ts
  - openclaw_runtime/src/knowledge/sekb/types.ts
  - openclaw_runtime/src/state/openclaw-agent-db.generated.d.ts
  - openclaw_runtime/src/state/openclaw-agent-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/knowledge/governance-contract.ts
  - src/lib/host-api.ts
  - src/pages/Knowledge/index.tsx
  - src/stores/chat.ts
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-ks04-chat-dcs.spec.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-save-to-knowledge.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-roletags.test.ts
  - tests/unit/knowledge-steward-notes-injection.test.ts
  - tests/unit/knowledge-steward-registry.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - tests/unit/session-cascade-delete.test.ts
expectedUserBehavior:
  - Failure trajectories produce SEKB candidates without durable Principle or experience Block writes.
  - Human confirm persists exactly one canonical Principle with lineage provenance and optional DCS experience projection.
  - A fresh task recalls the confirmed Principle through RetrievalEngine and format_for_injection.
  - Cited/adopted/outcome evidence is required before adoption_count and post_adoption_success change.
  - Archived or deleted Principles are no longer recalled by a fresh task.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - docs-sync
  - capability-owner-resolution
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks05-experience-closed-loop.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks05-experience-closed-loop.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/experience-closed-loop.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts src/knowledge/sekb/golden-path.test.ts src/knowledge/sekb/batch-distillation-assistant.test.ts src/knowledge/sekb/experience-block-bridge.test.ts
  - pnpm run test:dcs
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run build:vite
  - pnpm --dir openclaw_runtime build
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - no-durable-write-before-confirm: suggest_principles_from_trajectories leaves principle and experience Block counts at zero
  - evidence-gated-adoption: record_adoption requires cited/adopted/outcome evidence and throws on retrieval_count-style calls
  - fresh-session-recall: after human confirm, a fresh task recall returns the confirmed principle and formatted injection contains its title
  - effectiveness-update: valid adoption evidence increments adoption_count and post_adoption_success consistently
  - archive-prevents-recall: archived/deleted principles are excluded from fresh recall
  - no-auto-writeback: golden path evaluation still reports noAutoWriteback true and autoWriteback false
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-05 经验闭环

## Hard acceptance

1. 未确认 suggestion durable write = 0（principle 与 DCS experience Block 均不写）。
2. 自动 Principle writeback = 0；confirm/reject 保持人工显式操作。
3. `record_adoption` 只接受真实 cited/adopted/outcome 证据；`retrieval_count` 不得驱动 adoption。
4. 一条真实 SQLite E2E：失败任务 -> candidate -> human confirm -> fresh session recall -> citation -> outcome -> effectiveness 变化。
5. archive/delete 后 fresh session 不召回旧 experience；DCS projection 清理复用 KS-02 cascade。

## Implementation notes

- `KnowledgeStore.record_adoption` 改为证据门禁签名：必须提供 `trigger`（cited|adopted|outcome）与 `taskSucceeded`；非法证据抛错且不改变计数。
- 新增 `experience-closed-loop.test.ts` 用真实 SQLite 串起 capture -> suggest -> confirm -> fresh recall -> cite/outcome -> archive -> no recall。
- 不新增数据表；adoption evidence 写入 `sekb_principles.metadata_json` 的 `sekbAdoptionEvidence` 数组（上限 20 条）。
