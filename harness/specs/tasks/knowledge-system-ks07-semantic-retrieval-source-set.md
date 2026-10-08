---
id: knowledge-system-ks07-semantic-retrieval-source-set
title: Knowledge system KS-07 semantic retrieval and source set
scenario: gateway-backend-communication
taskType: runtime-bridge
implementationStatus: verified
dependsOn:
  - knowledge-system-ks06-governance-lifecycle
intent: Implement and test a DCS single-path Source Set with exact, lexical, and optional semantic hybrid retrieval. Queries are shaped by task context and role/scope, sources are filtered by sensitivity/ACL/status, conflicts are disclosed explicitly, freshness reranks active sources, and synthesis claims always resolve to owner + subjectId + revision/digest citations. grounded / partial / missing_sources are computed from evidence rules and never from a fixed confidence value; Runtime Memory participates only as a shadow comparison.
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
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-ks07-closeout-20260818.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/snapshots/0100.json
  - .agent-workbench/task-forest/snapshots/0101.json
  - .agent-workbench/task-forest/snapshots/0102.json
  - .agent-workbench/task-forest/snapshots/0103.json
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
  - docs/architecture-overview.md
  - docs/dev/knowledge-system-unification/
  - docs/dev/knowledge-system-unification/evidence/KS-00-03-INDEPENDENT-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/knowledge-system-unification/evidence/KS-01-03-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-04-CHAT-DCS-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-05-EXPERIENCE-CLOSED-LOOP-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-06-GOVERNANCE-LIFECYCLE-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md
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
  - tests/unit/knowledge-governance-ui-lifecycle.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-roletags.test.ts
  - tests/unit/knowledge-steward-notes-injection.test.ts
  - tests/unit/knowledge-steward-registry.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - tests/unit/session-cascade-delete.test.ts

expectedUserBehavior:
  - Retrieval produces a SourceSet/v1 derived report with exact pinned ref resolution, deterministic lexical scoring, and semantic reranking only when a real embedding provider is supplied through the existing adapter boundary.
  - archived / revoked / deleted / denied / stale sources are rejected with explicit reasons and never enter grounded claims; sensitivity and ACL failures are rejected the same way.
  - Annotated conflicts appear in the conflict set with both sides cited instead of being silently picked; unknowns and suggested next actions are explicit when sources are missing or partial.
  - Every grounded claim carries a citation that resolves to owner, subjectId, revision, and content digest; missing_sources never emits pseudo citations.
  - Runtime Memory candidates are compared in a shadow-only report and never participate in the active SourceSet answer.
  - The packaged SourceSet travels through the existing dcs-knowledge ContextCandidate path and is not a new canonical store, context authority, or database.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - docs-sync
  - capability-owner-resolution
  - backend-communication-boundary
  - active-config-guards
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks07-semantic-retrieval-source-set.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks07-semantic-retrieval-source-set.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/source-set.test.ts src/context-engine/source-set-quality.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/chat-knowledge-intent.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/context-candidate.test.ts
  - pnpm exec vitest run tests/unit/chat-knowledge-scope.test.ts
  - pnpm --dir openclaw_runtime exec node --import tsx scripts/source-set-ks07-quality.mts
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
  - source-set-deterministic: same query and committed fixture with a fixed clock produce byte-equivalent retrieval/claim/conflict/rejection output on repeated runs
  - conflict-disclosure-100: every conflict annotated in the committed corpus appears in conflictSet with citations for both sides
  - bad-status-zero-grounded: archived / revoked / deleted / denied / stale / sensitivity / ACL rejected sources appear zero times in grounded claims
  - missing-sources-no-pseudo-citation: missing_sources returns zero grounded claims, zero citations, explicit unknowns, and suggested next actions
  - citation-resolvable: every grounded claim citation resolves to owner + subjectId + revision + contentDigest of a materialized source
  - hybrid-lanes: exact pinned refs resolve directly, lexical ranking is deterministic, semantic lane is available only with a real embedding provider and otherwise reports semantic:unavailable with lexical degradation
  - evidence-status-rule: grounded / partial / missing_sources are computed from admitted sources, unresolved pinned refs, and conflict disclosure with no fixed confidence field
  - runtime-memory-shadow-only: Runtime Memory candidates are shadow-compared only and never change admitted sources, claims, or citations
  - ks04-regression: explicit pinned ref resolution stays 100 percent in chat-knowledge-intent tests and denied refs keep visible reasons; chat-knowledge-scope, context-orchestrator, and context-candidate tests do not regress
  - quality-report: committed corpus quality report computes Recall@5, Precision@5, citation validity, stale inclusion, conflict disclosure, latency, token cost, and human usefulness is not-evaluated (E4 missing)
  - dcs-tests: pnpm run test:dcs keeps 344/344 old tests green or records an equivalent non-regression run with the new package tests green
  - no-new-store: no new database, sidecar, vector store, second context authority, or second active memory writer is introduced
  - no-product-lock-change: default-off / liveReady=false / productApproved=false / defaultOn=false remain unchanged
residual:
  - committed corpus quality run is lexical/exact only because no real provider is configured in the offline worktree; semantic lane behavior is covered by deterministic in-process embedding provider tests, not real provider evidence
  - SourceSet has no user-visible Knowledge UI surface yet; making conflict / unknown / next-action / grounded status visible is a KS-08 visibility carry-over
  - human usefulness stays not-evaluated (E4 missing); synthetic corpus is never promoted to E4/E5 or product approval
  - memory-wiki wiki.* lifecycle Main RPC writes and Knowledge lifecycle UI/per-operation Electron E2E remain KS-08 carry-over and are not implemented here
  - full-repository lint/test baseline red is re-checked and recorded; non-KS failures are not fixed and are not claimed as full-green
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-07 Semantic Retrieval 与 Source Set

## Hard acceptance

1. 同 query 同 committed fixture 结果确定；conflict disclosure 100%。
2. archived / revoked / deleted / denied / stale / sensitivity / ACL 拒绝进入 grounded claim 的条数 = 0。
3. missing_sources 时零 claim、零 citation，unknowns 与 suggested next actions 显式。
4. 每个 grounded claim 的 citation 可解析到 owner + subjectId + revision + digest。
5. exact / lexical / semantic 三 lane 行为完整；无 provider 时显式 semantic:unavailable 并降级 lexical。
6. grounded / partial / missing_sources 只由证据规则计算，输出中不存在固定 confidence。
7. Runtime Memory 只 shadow 比较，不参与 active answer。
8. committed corpus 质量报告真实计算 Recall@5、Precision@5、citation validity、stale inclusion、conflict disclosure、latency、token cost；human usefulness 必须为 not-evaluated (E4 missing)。
9. KS-04 既有 chat-knowledge-scope / context-orchestrator / context-candidate 测试不回退。
10. 不新增 DB/sidecar/向量库或第二 context authority；产品锁不变。

## Implementation notes

- 新增 `openclaw_runtime/src/context-engine/source-set.ts`：SourceSet/v1 派生报告、三条检索 lane、证据状态、conflict disclosure、citation 解析、Runtime Memory shadow-only 比较与 `packSourceSetForDcs`。
- 新增 committed corpus fixture 与质量计算器：`source-set-quality.ts`、`fixtures/source-set-ks07-corpus.json`、`scripts/source-set-ks07-quality.mts`。
- SourceSet 只是 DCS 派生产物/报告；DCS 仍是唯一 admission/resolve/pack/compile authority。
