---
id: knowledge-system-ks04-chat-dcs-single-path
title: Knowledge system KS-04 Chat/DCS single consumption path
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks03-governance-store-adapters
intent: Route renderer-selected knowledge references through one untrusted read-only retrieval intent that Gateway resolves via owner source adapters and injects exclusively through the registered DCS knowledge candidate path. Main no longer pre-reads wiki.get or splices reference bodies into the prompt, and denied refs return a visible reason.
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
  - .agent-workbench/task-forest/proposals/TFP-88df65a6ed.json
  - .agent-workbench/task-forest/proposals/TFP-bbe2e21477.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
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
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md
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
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts
  - openclaw_runtime/src/knowledge/sekb/session-cascade-delete.ts
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
  - Chat sends selected knowledge references as typed refs without snippets or pre-read bodies in Main.
  - Gateway resolves refs through owner source adapters and injects only admitted refs through the DCS knowledge candidate path.
  - Denied pinned refs (revoked, stale, ACL denied, not found) produce a visible reason returned on the host result and surfaced by the Chat UI.
  - Renderer keeps using host-api only; no direct IPC or Gateway HTTP calls are introduced.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - docs-sync
  - comms-regression
  - capability-owner-resolution
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks04-chat-dcs-single-path.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks04-chat-dcs-single-path.md
  - pnpm exec vitest run tests/unit/chat-knowledge-scope.test.ts tests/unit/chat-save-to-knowledge.test.tsx tests/unit/host-api-facade.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/chat-knowledge-intent.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/context-candidate.test.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
  - pnpm run test:dcs
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/knowledge-ks04-chat-dcs.spec.ts
  - pnpm --dir openclaw_runtime build
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - main-no-body-splice: electron chat-api does not call wiki.get for sendWithMedia and does not inject snippet or wiki content into the prompt
  - typed-refs-only: chat.send gateway params accept only typed knowledge refs with no snippet/content body
  - dcs-candidate-path: resolved refs are injected as dcs-knowledge ContextCandidate through the production candidate finalizer
  - pinned-active-delivered: all active admitted refs resolve to selected/applied candidates
  - denied-zero: revoked, stale, ACL denied, and not-found refs are never injected and each returns a visible reason
  - denied-toast-e2e: the Chat UI surfaces the visible reason toast for denied knowledge references in an Electron E2E
  - renderer-zero-direct: static grep shows no renderer direct IPC or Gateway HTTP calls added
  - comms-pass: comms replay and compare pass
  - no-product-lock-change: default-off / liveReady=false / productApproved=false / defaultOn=false remain unchanged
docs:
  required: true
  files:
    - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
---

# KS-04 Chat/DCS 单一消费路径

## Hard acceptance

1. Main 不再为 sendWithMedia 调用 wiki.get，也不把 snippet/正文拼进 prompt。
2. Gateway chat.send 只接受 typed ref；拒绝正文字段。
3. 解析后的 refs 通过 dcs-knowledge ContextCandidate 生产路径注入。
4. revoked / stale / ACL denied / not found 的 ref 不注入且返回可见 reason。
5. renderer direct IPC / Gateway HTTP = 0。
6. comms replay/compare PASS，产品锁不变。

## Implementation notes

- 新增 `openclaw_runtime/src/context-engine/chat-knowledge-intent.ts`：normalize/admission/resolve/pack 与 denial reason。
- 新增 `openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts`：memory-wiki / Role Memory / SEKB 三个真实 source adapter。
- Main 将 `knowledgeScope` / `knowledgeMode` / `knowledgeReferences` 作为 RPC 字段转发；Gateway 在 ack 中返回 `knowledgeDenials`。
