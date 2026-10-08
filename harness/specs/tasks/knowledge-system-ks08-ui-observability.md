---
id: knowledge-system-ks08-ui-observability
title: Knowledge system KS-08 UI and observability convergence
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks07-semantic-retrieval-source-set
intent: Close the two KS-06 carry-over items and the KS-07 SourceSet visibility carry-over. memory-wiki becomes reachable through real Main RPC lifecycle mutations for update/merge/archive/revoke/delete/restore with real owner mutation and read-back evidence. The Knowledge page exposes a single lifecycle workflow with preview/diff, policy decision, user confirmation, expectedRevision CAS, idempotency, EffectReceipt, compensation or unrecoverable notes, and receipt history. Chat why-included reasons, degraded write truth, delete residual, and SourceSet status become user-visible through host-api only with four-locale i18n and Electron E2E coverage.
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
  - .agent-workbench/task-forest/proposals/TFP-c250f2cbab.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-ks07-closeout-20260818.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-ks08-closeout-20260818.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/snapshots/0100.json
  - .agent-workbench/task-forest/snapshots/0101.json
  - .agent-workbench/task-forest/snapshots/0102.json
  - .agent-workbench/task-forest/snapshots/0103.json
  - .agent-workbench/task-forest/snapshots/0104.json
  - .agent-workbench/task-forest/todos/todos.json
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - WORKTREE.md
  - docs/dev/NEXT-GOAL.md
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - docs/dev/handoffs/KS-07-09-DEVELOPMENT-PROMPT.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
  - docs/dev/knowledge-system-unification/
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-08-UI-OBSERVABILITY-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json
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
  - harness/specs/tasks/knowledge-system-ks07-semantic-retrieval-source-set.md
  - harness/specs/tasks/knowledge-system-ks08-ui-observability.md
  - openclaw_runtime/extensions/memory-wiki/src/apply-lifecycle.test.ts
  - openclaw_runtime/extensions/memory-wiki/src/apply.ts
  - openclaw_runtime/extensions/memory-wiki/src/gateway.ts
  - openclaw_runtime/extensions/memory-wiki/src/markdown.ts
  - openclaw_runtime/extensions/memory-wiki/src/query.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/scripts/source-set-ks07-quality.mts
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
  - openclaw_runtime/src/context-engine/fixtures/source-set-ks07-corpus.json
  - openclaw_runtime/src/context-engine/knowledge-system-ks02-block-store-owner.test.ts
  - openclaw_runtime/src/context-engine/source-set-quality.test.ts
  - openclaw_runtime/src/context-engine/source-set-quality.ts
  - openclaw_runtime/src/context-engine/source-set.test.ts
  - openclaw_runtime/src/context-engine/source-set.ts
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
  - shared/i18n/locales/en/knowledge.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/knowledge.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/knowledge.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/knowledge.json
  - shared/knowledge/governance-contract.ts
  - src/lib/host-api.ts
  - src/pages/Knowledge/index.tsx
  - src/stores/chat.ts
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-ks04-chat-dcs.spec.ts
  - tests/e2e/knowledge-lifecycle.spec.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-save-to-knowledge.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-governance-ui-lifecycle.test.ts
  - tests/unit/knowledge-lifecycle.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-roletags.test.ts
  - tests/unit/knowledge-steward-notes-injection.test.ts
  - tests/unit/knowledge-steward-registry.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - tests/unit/session-cascade-delete.test.ts

expectedUserBehavior:
  - Lifecycle proposals for update/merge/archive/revoke/delete/restore are created through the ReviewBundle workflow with target wiki pages, preview/diff, policy decision, and explicit user confirmation.
  - Applying a lifecycle proposal goes from renderer through host-api to Main, then to a real memory-wiki wiki.* RPC with expectedRevision CAS and idempotencyKey; duplicate retry succeeds without a second owner mutation.
  - Every lifecycle apply returns an EffectReceipt-shaped result with owner, subjectId, revision, digest, idempotencyKey, and compensation status or an explicit unrecoverable note; receipt history is visible in the Knowledge page.
  - Chat admitted/denied refs keep visible why-included/denied reasons and denied refs never enter the prompt.
  - Runtime confirm results show persisted versus journaled_degraded truth and never present degraded writes as persisted; lifecycle delete residual is visible as an unrecoverable note.
  - SourceSet grounded/partial/missing_sources, conflict set, unknowns, and suggested next actions from KS-07 are visible without creating a second context authority.
  - Renderer never calls IPC/Gateway directly and all new user text is en/zh/ja/ru localized; every supported lifecycle operation has an Electron E2E.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - docs-sync
  - capability-owner-resolution
  - backend-communication-boundary
  - renderer-main-boundary
  - active-config-guards
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks08-ui-observability.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks08-ui-observability.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-memory.config.ts extensions/memory-wiki/src/apply-lifecycle.test.ts
  - pnpm exec vitest run tests/unit/knowledge-lifecycle.test.ts tests/unit/knowledge-governance-ui-lifecycle.test.ts tests/unit/knowledge-api.test.ts
  - pnpm exec vitest run tests/unit/chat-knowledge-scope.test.ts
  - pnpm run test:dcs
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/knowledge-lifecycle.spec.ts
  - pnpm --dir openclaw_runtime build
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - wiki-lifecycle-rpc: memory-wiki gateway registers wiki.update / wiki.merge / wiki.archive / wiki.revoke / wiki.delete / wiki.restore and each operation performs a real vault mutation with revision CAS
  - owner-mutation-readback: each lifecycle operation has a real temp-vault mutation followed by wiki.get read-back proving owner state changed
  - stale-zero: stale expectedRevision accepted = 0 for every lifecycle operation
  - idempotency: same idempotencyKey plus same digest duplicate success without a second owner mutation; different digest conflicts
  - main-rpc-wiring: electron applyReviewedChange routes each lifecycle operation to the matching wiki.* RPC through gatewayManager.rpc, never direct plugin import or renderer IPC
  - receipt-visible: apply result contains EffectReceipt-shaped receipt and receipt history is readable through host-api and rendered in Knowledge UI
  - degraded-write-honest: sekb confirm result renders journaled_degraded as degraded, never persisted
  - source-set-visible: KS-07 grounded/partial/missing_sources plus conflict/unknown/next-action sections are rendered in Knowledge UI through host-api
  - e2e-per-operation: Electron E2E covers UI -> Main -> wiki RPC -> EffectReceipt visible -> page status/read-back change for update/merge/archive/revoke/delete/restore
  - no-regression: knowledge-hub E2E and chat-knowledge-scope / knowledge-api / knowledge-page tests do not regress
  - renderer-zero-direct: static grep shows zero renderer direct IPC or Gateway HTTP calls
  - no-second-writer: no second active memory writer, no JSON governance dual-write, no new DB/sidecar
  - no-product-lock-change: default-off / liveReady=false / productApproved=false / defaultOn=false remain unchanged
residual:
  - Lifecycle preview is computed from proposal diff/draft text; real three-way diff rendering is not implemented
  - Compensation is explicit unrecoverable/compensated metadata; automatic rollback for wiki update/merge is not attempted
  - Full-repository lint/test baseline red is re-checked and recorded; non-KS failures are not fixed and are not claimed as full-green
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-08 UI 与 Observability 收敛

## Hard acceptance

1. memory-wiki 六种 lifecycle operation 每种至少一条真实 owner mutation + read-back 测试；stale revision/digest 接受 = 0；同 key 同 digest duplicate success，异 digest conflict。
2. 每种已支持 operation 至少 1 条 Electron E2E，覆盖 UI 操作 -> Main -> wiki RPC -> EffectReceipt 可见 -> 页面状态/read-back 变化。
3. `tests/e2e/knowledge-hub.spec.ts` 不回退；新增或扩展现有 E2E，不伪造跳过。
4. Chat why-included：admitted/denied ref 的 reason 对用户可见；denied ref 不得进入 prompt。
5. degraded write 状态与 delete residual、receipt history 在 UI 中可见；不得把 journaled_degraded 显示成 persisted。
6. 静态检查：renderer direct IPC/Gateway fetch = 0；不新增第二 active memory writer、不新增 JSON governance 双写。
7. `pnpm contract:check`、typecheck node/web、`db:kysely:check`、build:vite、runtime build、comms replay/compare、changed-file ESLint 全部门禁 PASS。
8. 所有新增 UI 文案四语 i18n 齐全，ESLint 无本包新增 error。

## Implementation notes

- memory-wiki plugin 是 wiki page canonical mutation owner：在 `extensions/memory-wiki/src/apply.ts` 增加 lifecycle mutation，`gateway.ts` 注册六个 `wiki.*` RPC。
- Main `applyReviewedChange` 将 lifecycle proposal 路由到真实 `wiki.update/merge/archive/revoke/delete/restore`，写入 governance operation receipt；renderer 只经 host-api。
- Knowledge 页面增加 lifecycle 面板与 receipt history；runtime confirm 结果显示真实 `dcsWrite`；SourceSet 状态面板复用 KS-07 已实现类型。
