---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-vector-projection-backends
title: 交付可移植向量检索与规模化 ANN
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-06
intent: 用统一契约覆盖普通项目与大语料，并明确平台能力。
diffBase: d491594941b811a917bb0646d50197039072dc81
touchedAreas:
  - "electron/services/knowledge-api.ts"
  - "electron/services/gateway-api.ts"
  - "electron/services/workspace-permissions.ts"
  - "shared/host-api/contract.ts"
  - "shared/knowledge/vector.ts"
  - "src/lib/host-api/knowledge/**"
  - "src/components/settings/KnowledgeVectorSettings.tsx"
  - "src/pages/Models/index.tsx"
  - "shared/i18n/locales/*/settings.json"
  - "scripts/contract-check.mjs"
  - "scripts/knowledge-rag-vector-probe.ts"
  - "scripts/knowledge-rag-vector-capacity.ts"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "openclaw_runtime/src/state/openclaw-state-*"
  - "openclaw_runtime/package.json"
  - "openclaw_runtime/tsdown.config.ts"
  - "openclaw_runtime/pnpm-lock.yaml"
  - "openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval-*.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/gateway.ts"
  - "openclaw_runtime/extensions/memory-wiki/index.ts"
  - "pnpm-lock.yaml"
  - "scripts/bundle-openclaw-runtime.mjs"
  - "scripts/copy-runtime-package.mjs"
  - "tests/unit/copy-runtime-package.test.ts"
  - "openclaw_runtime/extensions/memory-wiki/package.json"
  - "openclaw_runtime/extensions/memory-wiki/runtime-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/**"
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
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/project-rag-vector-backends.test.ts"
  - "tests/unit/project-rag-vector-generation.test.ts"
  - "tests/unit/project-rag-vector-service.test.ts"
  - "tests/unit/project-rag-embedding-lifecycle.test.ts"
  - "tests/unit/knowledge-vector-settings.test.tsx"
  - "tests/e2e/project-rag-vector-backends.spec.ts"
  - "artifacts/agent-dev-deep-test/history.json"
  - "artifacts/agent-dev-deep-test/report.json"
  - "artifacts/agent-dev-deep-test/report.md"
  - "artifacts/agent-dev-quality/report.json"
  - "artifacts/agent-dev-workbench/evidence.json"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/knowledge-vector-settings.test.tsx"
  - "tests/unit/project-rag-embedding-lifecycle.test.ts"
  - "tests/unit/copy-runtime-package.test.ts"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/project-rag-vector-backends.test.ts"
  - "tests/unit/project-rag-vector-generation.test.ts"
  - "tests/unit/project-rag-vector-service.test.ts"
  - "tests/e2e/project-rag-vector-backends.spec.ts"
plannedTests:
  - "tests/unit/project-rag-vector-backends.test.ts"
  - "tests/unit/project-rag-vector-generation.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-vector-backends.spec.ts"
expectedUserBehavior:
  - "用统一契约覆盖普通项目与大语料，并明确平台能力。"
acceptance:
  - "SQLite 精确向量路径与 LanceDB Embedded ANN 均实现同一 id/filter/space/generation 契约；每 namespace 仅一条 active backend。"
  - "LanceDB 使用库级只读检索 adapter，不加载 memory-lancedb 的 recall/capture/store hooks；向量行不承载可直接回答的正文。"
  - "有条件前滤、未索引新行、删除、模型替换、后台 optimize、旧版本 cleanup、切换中断和重启均验证，旧授权不能复活。"
  - "20k portable tier 和 100k ANN tier 分别测 Recall/latency/RSS/disk；缺 native 包明确展示 capability，fallback 保持普通 Chat 可用。"
  - "向量库依赖归实际owner-side检索适配实现，core只消费public SDK/owner seam；ANN是本ADR登记的派生索引例外，SQLite继续拥有系统状态。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/VECTOR-BACKEND-CONTRACT.md
---

# 交付可移植向量检索与规模化 ANN

所属长期计划：RAG-06。前置工作包：RAG-05。Owner：vector projection。

契约：VectorProjection/v1、VectorGeneration/v1、IndexBackendCapabilities/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：按已发布 generation 回切；LanceDB 不可用时使用合格 portable backend 或 lexical，禁止整库状态倒回。
