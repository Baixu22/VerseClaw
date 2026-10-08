---
id: knowledge-system-ks09-canary-optimization-graduation
title: Knowledge system KS-09 canary optimization and graduation
scenario: system-maturity-traceability
taskType: runtime-shadow
implementationStatus: verified
dependsOn:
  - knowledge-system-ks08-ui-observability
intent: Produce six reproducible per-surface canary/graduation reports (explicit/pinned Knowledge refs, automatic Knowledge retrieval, Role Memory retrieval, SEKB experience retrieval, semantic Source Set synthesis, post-task candidate capture). Each surface independently reports its current stage (shadow -> opt-in -> canary -> soak -> product approval -> consider-default-on), evidence level E1-E5, measured metrics, residual, and the next promotion gate. E4/E5 remain not-evaluated or blocked without real provider/user-task/soak/product-approval evidence, and no report may claim default-on, GA, or productApproved while product locks are false.
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
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-ks09-closeout-20260818.json
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
  - .agent-workbench/task-forest/snapshots/0097.json
  - .agent-workbench/task-forest/snapshots/0098.json
  - .agent-workbench/task-forest/snapshots/0099.json
  - .agent-workbench/task-forest/snapshots/0100.json
  - .agent-workbench/task-forest/snapshots/0101.json
  - .agent-workbench/task-forest/snapshots/0102.json
  - .agent-workbench/task-forest/snapshots/0103.json
  - .agent-workbench/task-forest/snapshots/0104.json
  - .agent-workbench/task-forest/snapshots/0105.json
  - .agent-workbench/task-forest/todos/todos.json
  - README.ja-JP.md
  - artifacts/sekb-golden-path/evidence.json
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
  - docs/dev/knowledge-system-unification/evidence/KS-09-CANARY-GRADUATION-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-FULL-INTEGRATION-ACCEPTANCE.md
  - docs/dev/knowledge-system-unification/evidence/KS-REAL-PROVIDER-E2E.md
  - docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json
  - docs/dev/knowledge-system-unification/surface-reports/**
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
  - harness/specs/tasks/knowledge-system-ks09-canary-optimization-graduation.md
  - openclaw_runtime/extensions/memory-wiki/src/apply-lifecycle.test.ts
  - openclaw_runtime/extensions/memory-wiki/src/apply.ts
  - openclaw_runtime/extensions/memory-wiki/src/gateway.ts
  - openclaw_runtime/extensions/memory-wiki/src/markdown.ts
  - openclaw_runtime/extensions/memory-wiki/src/query.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/scripts/knowledge-surface-reports.mts
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
  - openclaw_runtime/src/knowledge/fixtures/ks09-surface-plan.json
  - openclaw_runtime/src/knowledge/governance-adapters.test.ts
  - openclaw_runtime/src/knowledge/governance-adapters.ts
  - openclaw_runtime/src/knowledge/governance-lifecycle.test.ts
  - openclaw_runtime/src/knowledge/governance-lifecycle.ts
  - openclaw_runtime/src/knowledge/governance-store.test.ts
  - openclaw_runtime/src/knowledge/governance-store.ts
  - openclaw_runtime/src/knowledge/ks09-surface-report.test.ts
  - openclaw_runtime/src/knowledge/ks09-surface-report.ts
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
  - Six committed surface reports are generated by one reproducible evaluator script and written into the knowledge evidence tree.
  - Each report shows a single explicit current stage and evidence level; no synthetic fixture is promoted to E4/E5.
  - Reports that lack real provider, real user task, soak, or product approval are written as not-evaluated or blocked and never as default-on/GA.
  - Product locks stay liveReady=false, productApproved=false, defaultOn=false; Runtime Memory remains shadow/benchmark; DCS remains the only context authority.
requiredProfiles:
  - fast
requiredRules:
  - active-config-guards
  - docs-sync
  - system-maturity-traceability
  - capability-owner-resolution
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-ks09-canary-optimization-graduation.md
  - pnpm harness validate --spec harness/specs/tasks/knowledge-system-ks09-canary-optimization-graduation.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/ks09-surface-report.test.ts
  - pnpm --dir openclaw_runtime exec node --import tsx scripts/knowledge-surface-reports.mts --include-e2e
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
  - six-reports-complete: all six surface reports exist with explicit stage and evidence level
  - no-false-graduation: zero reports claim default-on / GA / productApproved while product locks are false
  - e3-not-e4e5: E1-E3 reports are never relabeled as E4/E5
  - reproducible-evaluator: evaluator exits zero with the committed surface plan and rewrites the reports
  - metric-real: report metrics come from real committed test runs (unit/integration plus optional Electron E2E evidence) and are captured per surface
  - product-locks: liveReady=false, productApproved=false, defaultOn=false remain unchanged
  - no-new-store: no new database, sidecar, vector store, context authority, or second active memory writer
  - regression: test:dcs, typecheck node/web, contract, db check, build:vite, runtime build, comms replay/compare, and changed-file ESLint pass
residual:
  - E4 is not-evaluated for every surface: no real provider or real user-task evidence was captured in this worktree
  - E5 is blocked for every surface: no soak run and no product approval exist
  - real canary/soak/product approval are explicit post-KS-09 product gates and do not become engineering conclusions here
  - full-repository lint/test baseline red is re-checked and recorded; non-KS failures are not fixed and are not claimed as full-green
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# KS-09 Canary、优化与毕业

## Hard acceptance

1. 六个表面报告齐全，无一缺失；每个表面有明确档位和证据等级。
2. 0 个报告宣称未获批准的 default-on/GA/productApproved；0 个 E3 报告被写成 E4/E5。
3. 所有可复跑评测脚本/测试 PASS；typecheck node/web、contract、build、comms、changed-file ESLint PASS。
4. 全仓 lint/test baseline 红照实复核；非 KS 红不修复。
5. 产品锁仍为 `liveReady=false`、`productApproved=false`、`defaultOn=false`。

## Implementation notes

- 新增 `openclaw_runtime/src/knowledge/ks09-surface-report.ts`：表面报告 schema、档位判定、E1-E5 判定与禁止 default-on/GA 断言。
- 新增 committed surface plan `openclaw_runtime/src/knowledge/fixtures/ks09-surface-plan.json` 与 runner `scripts/knowledge-surface-reports.mts`。
- 报告写入 `docs/dev/knowledge-system-unification/surface-reports/`；本包不修改 canary/graduation decision 生产代码。
