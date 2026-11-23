---
lifecycleStatus: active
implementationStatus: in_progress
id: project-rag-observability-offline-promotion
title: 完成检索可观测性和离线策略晋级
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-17
intent: 持续发现质量与成本回退，同时防止反馈形成未审核的自学习。
diffBase: 5d45cf79f769a1a3d8f994f965e5d63d24d5c40c
touchedAreas:
  - "shared/knowledge/**"
  - "shared/host-api/contract.ts"
  - "shared/host-api/host-action-timeouts.ts"
  - "src/lib/host-api/knowledge/**"
  - "src/components/settings/Knowledge*"
  - "shared/i18n/locales/*/settings.json"
  - "electron/services/knowledge*.ts"
  - "electron/services/gateway-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/**"
  - "openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts"
  - "openclaw_runtime/src/agents/provider-spend-budget.ts"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "electron/services/observability*.ts"
  - "scripts/knowledge-*.ts"
  - "scripts/lib/project-rag-promotion.*"
  - "scripts/knowledge-rag-policy-verifier.mjs"
  - "src/components/settings/KnowledgeRetrievalDiagnostics.tsx"
  - "harness/specs/fixtures/project-rag/**"
  - "src/pages/Knowledge/**"
  - "shared/dcs/prod-flags-catalog.ts"
  - "docs/generated/catalogs/prod-flags.md"
  - "docs/dev/evidence/project-rag-decision-20261109/source-review.json"
  - "docs/dev/project-rag/**"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/modules/knowledge-base.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/project-rag-receipts-promotion.test.ts"
  - "tests/unit/project-rag-offline-package.test.ts"
  - "tests/unit/host-action-timeouts.test.ts"
  - "tests/unit/gateway-permissions-api.test.ts"
  - "tests/unit/project-rag-observability-store.test.ts"
  - "tests/e2e/project-rag-settings-operations.spec.ts"
residualPaths:
  - "electron/gateway/config-sync.ts"
  - "package.json"
  - "playwright.config.ts"
  - "playwright.rag-packaged.config.ts"
  - "scripts/after-pack.cjs"
  - "scripts/build-openclaw-runtime.mjs"
  - "scripts/build-rag-policy-verifier.mjs"
  - "scripts/bundle-openclaw-runtime.mjs"
  - "scripts/download-bundled-node.mjs"
  - "scripts/lib/project-rag-acceptance.d.mts"
  - "scripts/lib/project-rag-acceptance.mjs"
  - "scripts/lib/project-rag-code-oracle.d.mts"
  - "scripts/lib/project-rag-code-oracle.mjs"
  - "scripts/lib/project-rag-corpus.mjs"
  - "scripts/lib/project-rag-package.d.mts"
  - "scripts/lib/project-rag-package.mjs"
  - "scripts/lib/project-rag-process.d.mts"
  - "scripts/lib/project-rag-process.mjs"
  - "scripts/lib/project-rag-query-grade.d.mts"
  - "scripts/lib/project-rag-query-grade.mjs"
  - "scripts/release-integrity-manifest.mjs"
  - "scripts/verify-bundled-node.mjs"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
  - "tests/unit/project-rag-acceptance-readback.test.ts"
  - "tests/unit/project-rag-package-manifest.test.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "pnpm exec vitest run tests/unit/knowledge-api.test.ts tests/unit/project-rag-receipts-promotion.test.ts tests/unit/gateway-permissions-api.test.ts tests/unit/project-rag-observability-store.test.ts tests/unit/project-rag-offline-package.test.ts tests/unit/host-action-timeouts.test.ts --maxWorkers=1 --cache=false"
  - "pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs extensions/memory-wiki/retrieval-policy-evaluation.test.ts"
  - "pnpm exec playwright test tests/e2e/project-rag-settings-operations.spec.ts --workers=1 --retries=0"
plannedTests:
  - "tests/unit/project-rag-receipts-promotion.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-settings-operations.spec.ts"
expectedUserBehavior:
  - "持续发现质量与成本回退，同时防止反馈形成未审核的自学习。"
acceptance:
  - "request/plan/source/model/generation/DCS lineage可关联，阶段延迟、token/费用、fallback、索引滞后、删除积压和calibration漂移可查询。"
  - "默认日志只存refs/digests/status/usage；raw evidence需要明确的测试/诊断保留政策，删除传播覆盖反馈与缓存。"
  - "attach/dismiss仅记弱反馈，新的排序参数经离线封存评测与版本化晋级；旧RSI verdict保持原含义。"
  - "回滚能恢复前一policy，不改变owner确认权限、scope和产品锁。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 完成检索可观测性和离线策略晋级

所属长期计划：RAG-17。前置工作包：RAG-12、RAG-14、RAG-16。Owner：observability / evaluation / policy release。

契约：RetrievalReceipt/v1、RetrievalSlo/v1、OfflinePolicyPromotion/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：回到上一冻结policy并停止新增诊断采集；保留必要审计。

检索回执沿现有 memory-wiki SQLite plugin state 持久化，只保存 refs/digests/status/usage。未知费用与token保留null；来源撤销/修改会使收据失效并删除弱反馈。Main选取策略包文件，owner在有界Node校验器中读回240查询、540任务原件和实际执行的策略digest，重算统计后原子比较当前policy digest并晋级。backend/admin的wiki.retrieval.evaluate沿同一owner读取与预算路径执行manual候选评测，普通wiki.retrieve拒绝策略覆盖。重复操作内容相异拒绝，回滚保留前一policy；排序候选、重排、来源数和最终条数保持既有profile上限。

本次所有者指示优先完成RAG17～19代码、暂缓完整验收。residualPaths精确列出同一工作树中由相邻工作包负责的变更；本叶验收仍按自身新增测试和接口要求执行，正式状态待实际证据收口。
