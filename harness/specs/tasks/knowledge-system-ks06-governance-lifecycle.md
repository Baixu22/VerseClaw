---
id: knowledge-system-ks06-governance-lifecycle
title: Knowledge system KS-06 complete governance lifecycle
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks05-experience-closed-loop
intent: Complete the governance lifecycle for create/update/merge/archive/revoke/delete/restore with preview, policy decision, user confirmation, expectedRevision CAS, idempotency, EffectReceipt, projection invalidation/rebuild, and compensation where recoverable. UI must not expose unsupported operations.
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
  - .agent-workbench/task-forest/proposals/TFP-c250f2cbab.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/snapshots/0100.json
  - .agent-workbench/task-forest/snapshots/0101.json
  - .agent-workbench/task-forest/snapshots/0102.json
  - .agent-workbench/task-forest/todos/todos.json
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - WORKTREE.md
  - docs/dev/NEXT-GOAL.md
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - docs/dev/handoffs/LATEST.md
  - docs/architecture-overview.md
  - docs/dev/knowledge-system-unification/
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md
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
  - harness/specs/tasks/knowledge-system-ks06-governance-lifecycle.md
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
  - openclaw_runtime/src/knowledge/governance-lifecycle.test.ts
  - openclaw_runtime/src/knowledge/governance-lifecycle.ts
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
  - tests/unit/knowledge-governance-ui-lifecycle.test.ts
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
  - Governance proposals may be created for create/update/merge/archive/revoke/delete/restore with a stable idempotency key and expectedRevision.
  - stale revision or digest is rejected; duplicate idempotencyKey with same digest is a duplicate success, different digest is a conflict.
  - Supported operations have preview/diff, policy decision, user confirmation, and commit path through a governed target adapter.
  - Unsupported operations have no usable UI entry and are rejected by the host contract.
  - Each commit emits an EffectReceipt or an explicit unrecoverable note; recoverable failures can be compensated.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - docs-sync
  - capability-owner-resolution
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks06-governance-lifecycle.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks06-governance-lifecycle.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/governance-lifecycle.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/governance-store.test.ts src/knowledge/governance-adapters.test.ts
  - pnpm exec vitest run tests/unit/knowledge-governance-ui-lifecycle.test.ts
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
  - proposal-lifecycle: GovernanceStore supports status transitions for all seven operations with event audit
  - stale-zero: stale revision/digest accepted = 0
  - idempotency: same idempotencyKey + same digest duplicate success; different digest conflict
  - ui-unsupported-hidden: static grep shows no usable UI entry for unsupported operations
  - effect-receipt: commit success emits EffectReceipt-shaped result; failure is explicit
  - compensation: recoverable commit failure can call compensate and return compensated/partial/unrecoverable
  - no-json-dual-write: no new governance JSON writer introduced
  - no-second-memory-writer: governed adapter registry still rejects a second active memory writer
residual:
  - memory-wiki update/merge/archive/revoke/delete/restore real Main RPC write entry is not connected; KS-06 only provides the host-owned adapter boundary
  - lifecycle UI and per-operation Electron E2E are not implemented; KS-06 only provides the static UI hidden gate
  - both items are mandatory KS-08 carry-over and do not count as KS-06 full-green evidence
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-06 完整治理生命周期

## Hard acceptance

1. GovernanceStore proposal lifecycle covers create/update/merge/archive/revoke/delete/restore with audit events.
2. stale revision/digest 被接受 = 0；同 idempotencyKey 同 digest duplicate success，异 digest conflict。
3. UI 不得出现未实现 operation 的可用入口。
4. commit 成功返回 EffectReceipt 形状结果；失败显式。
5. 补偿路径有反例测试。
6. 不新增 JSON governance writer；不注册第二 active memory writer。

## Implementation notes

- 新增 `governance-lifecycle.ts`：`GovernanceLifecycleCoordinator`，封装 prepare -> commit -> compensate 控制流。
- `GovernanceStore` 增加 `transitionProposal`：带 status 前置状态、expectedRevision CAS 与 `saveEvent` 审计。
- 不新增数据表；治理事件仍写 `knowledge_governance_events`。
