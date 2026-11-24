---
lifecycleStatus: active
implementationStatus: in_progress
id: project-rag-packaging-portability
title: 完成跨平台安装、离线运行与升级回滚
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-18
intent: 让目标系统在实际发布平台可安装、可恢复、可持续维护。
diffBase: 5d45cf79f769a1a3d8f994f965e5d63d24d5c40c
touchedAreas:
  - "scripts/lib/project-rag-package.*"
  - "playwright.config.ts"
  - "playwright.rag-packaged.config.ts"
  - "scripts/knowledge-rag-package.ts"
  - "scripts/after-pack.cjs"
  - "electron/gateway/config-sync.ts"
  - "electron-builder.yml"
  - "openclaw_runtime/package.json"
  - "scripts/bundle-openclaw*.mjs"
  - "scripts/build-openclaw-runtime.mjs"
  - "scripts/build-rag-policy-verifier.mjs"
  - "scripts/download-bundled-node.mjs"
  - "scripts/verify-bundled-node.mjs"
  - "scripts/release-integrity-manifest.mjs"
  - "package.json"
  - "scripts/release-*.mjs"
  - "harness/specs/fixtures/project-rag/**"
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
  - "tests/unit/runtime-package-resolution.test.ts"
  - "tests/unit/project-rag-package-manifest.test.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
residualPaths:
  - "electron/services/gateway-api.ts"
  - "electron/services/knowledge-api.ts"
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/services/knowledge-research.ts"
  - "openclaw_runtime/extensions/memory-wiki/index.ts"
  - "openclaw_runtime/extensions/memory-wiki/retrieval-observability-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/retrieval-policy-evaluation.test.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/gateway.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/observability-service.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/plan-service.ts"
  - "openclaw_runtime/src/agents/provider-spend-budget.ts"
  - "openclaw_runtime/src/knowledge/retrieval/offline-policy-package.ts"
  - "openclaw_runtime/src/knowledge/retrieval/plan.ts"
  - "openclaw_runtime/src/knowledge/retrieval/policy.ts"
  - "openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts"
  - "scripts/knowledge-rag-acceptance.ts"
  - "scripts/knowledge-rag-index-probe.ts"
  - "scripts/knowledge-rag-policy-verifier.mjs"
  - "scripts/knowledge-rag-policy.ts"
  - "scripts/knowledge-rag-query-runner.ts"
  - "scripts/knowledge-rag-task-runner.ts"
  - "scripts/lib/project-rag-acceptance.d.mts"
  - "scripts/lib/project-rag-acceptance.mjs"
  - "scripts/lib/project-rag-code-oracle.d.mts"
  - "scripts/lib/project-rag-code-oracle.mjs"
  - "scripts/lib/project-rag-corpus.mjs"
  - "scripts/lib/project-rag-process.d.mts"
  - "scripts/lib/project-rag-process.mjs"
  - "scripts/lib/project-rag-promotion.d.mts"
  - "scripts/lib/project-rag-promotion.mjs"
  - "scripts/lib/project-rag-query-grade.d.mts"
  - "scripts/lib/project-rag-query-grade.mjs"
  - "shared/host-api/contract.ts"
  - "shared/host-api/host-action-timeouts.ts"
  - "shared/i18n/locales/en/settings.json"
  - "shared/i18n/locales/ja/settings.json"
  - "shared/i18n/locales/ru/settings.json"
  - "shared/i18n/locales/zh/settings.json"
  - "shared/knowledge/observability.ts"
  - "shared/knowledge/retrieval.ts"
  - "src/components/settings/KnowledgeOperationsSettings.tsx"
  - "src/components/settings/KnowledgeRetrievalDiagnostics.tsx"
  - "src/lib/host-api/knowledge/library.ts"
  - "tests/e2e/project-rag-settings-operations.spec.ts"
  - "tests/unit/gateway-permissions-api.test.ts"
  - "tests/unit/host-action-timeouts.test.ts"
  - "tests/unit/project-rag-acceptance-readback.test.ts"
  - "tests/unit/project-rag-observability-store.test.ts"
  - "tests/unit/project-rag-offline-package.test.ts"
  - "tests/unit/project-rag-receipts-promotion.test.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "pnpm exec vitest run tests/unit/runtime-package-resolution.test.ts tests/unit/project-rag-package-manifest.test.ts --maxWorkers=1 --cache=false"
  - "pnpm exec playwright test --config playwright.rag-packaged.config.ts --workers=1 --retries=0"
plannedTests:
  - "tests/unit/project-rag-package-manifest.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
expectedUserBehavior:
  - "让目标系统在实际发布平台可安装、可恢复、可持续维护。"
acceptance:
  - "按实际release target矩阵运行原生SDK/模型/FTS/SQLite probe；npm包清单不当作加载成功。"
  - "Intel Mac等缺ANN预编译包的平台具备完整portable语义路径与容量边界；ANN tier仅在实测通过的目标声明。"
  - "有网首次安装、签名/校验、离线重启、低空间、半安装、模型更换、旧binary读取和增量schema回滚通过。"
  - "正式升级不整库覆盖、不丢governance/SEKB/Task Ledger资料；所有临时输出遵守D盘策略。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 完成跨平台安装、离线运行与升级回滚

所属长期计划：RAG-18。前置工作包：RAG-06、RAG-08、RAG-12。Owner：packaging / provider lifecycle / platform validation。

契约：RetrievalPlatformMatrix/v1、RetrievalArtifactManifest/v1、RetrievalUpgradeReceipt/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停用不兼容feature pack，回portable/lexical；保留canonical owner和正常Chat启动。

打包在目标平台依赖清理后封存RetrievalArtifactManifest/v1，安装包source Runtime启动前核验文件与目标。原生probe在隔离目录执行实际SDK、SQLite/FTS、portable vector和可选ANN读写，并逐项报告未测容量/模型。upgrade-check只读现有owner SQLite版本与前后包，拒绝空间不足、旧binary无法读新schema或回滚不兼容；实际安装继续走既有installer，禁止整库覆盖。完整发布矩阵、安装与模型故障验收在实际产物运行后再记通过。

residualPaths精确列出同一工作树中由相邻工作包负责的变更；本叶验收按自身新增测试和接口要求执行，完整门槛与原始失败保留。
