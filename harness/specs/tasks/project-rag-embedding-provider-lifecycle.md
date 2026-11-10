---
lifecycleStatus: active
implementationStatus: implemented
id: project-rag-embedding-provider-lifecycle
title: 接通本地与远端 embedding 的完整生命周期
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-05
intent: 使语义召回可离线工作，并能安全切换获授权的模型服务。
diffBase: e58bc2b8cb0266e4b904d32fcf5f7e451e253f4b
touchedAreas:
  - "AGENTS.md"
  - "openclaw_runtime/src/plugin-sdk/embedding-providers.ts"
  - "openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts"
  - "openclaw_runtime/src/plugin-sdk/memory-core-host-engine-embeddings.ts"
  - "openclaw_runtime/src/plugins/*embedding*.ts"
  - "openclaw_runtime/packages/memory-host-sdk/**"
  - "openclaw_runtime/src/embeddings/**"
  - "openclaw_runtime/src/runtime-core/memory-embedding-provider.ts"
  - "openclaw_runtime/src/context-engine/source-set.ts"
  - "openclaw_runtime/src/context-engine/source-set.test.ts"
  - "openclaw_runtime/extensions/memory-core/runtime-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/**"
  - "openclaw_runtime/pnpm-lock.yaml"
  - "electron/services/knowledge-api.ts"
  - "electron/services/gateway-api.ts"
  - "electron/services/workspace-permissions.ts"
  - "shared/knowledge/embedding.ts"
  - "shared/host-api/contract.ts"
  - "src/lib/host-api/knowledge/**"
  - "src/components/settings/KnowledgeEmbeddingSettings.tsx"
  - "src/pages/Models/index.tsx"
  - "shared/i18n/locales/*/settings.json"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "electron/services/knowledge-embedding-provider.ts"
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
  - "scripts/contract-check.mjs"
  - "README*.md"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/knowledge-source-set-answer.test.ts"
  - "tests/unit/knowledge-embedding-deadline.test.ts"
  - "tests/unit/project-rag-embedding-lifecycle.test.ts"
  - "tests/e2e/project-rag-provider-settings.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "openclaw_runtime/src/context-engine/source-set.test.ts"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/knowledge-source-set-answer.test.ts"
  - "tests/unit/project-rag-embedding-lifecycle.test.ts"
  - "tests/e2e/project-rag-provider-settings.spec.ts"
plannedTests:
  - "tests/unit/project-rag-embedding-lifecycle.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-provider-settings.spec.ts"
expectedUserBehavior:
  - "使语义召回可离线工作，并能安全切换获授权的模型服务。"
acceptance:
  - "复用现有 provider registry/public API，区分 query/document 输入；不启用或替换 memory slot。"
  - "本地 EmbeddingGemma 768 维与配置的 Qwen3/兼容服务形成实际向量；维度、模型 revision、tokenizer、prompt format、normalization 不符拒绝混用。"
  - "首次模型安装、校验、warmup、取消、重试、离线重启、磁盘/RAM 预算与凭据轮换完整；前台发送不触发整库 embedding。"
  - "外部 embedding 需 owner egress 准入，缓存隔离不泄露凭据或跨项目内容。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/EMBEDDING-LIFECYCLE-CONTRACT.md
---

# 接通本地与远端 embedding 的完整生命周期

所属长期计划：RAG-05。前置工作包：RAG-04。Owner：embedding provider registry / retrieval source。

契约：EmbeddingSpace/v1、EmbeddingJob/v1、ProviderCapabilitySnapshot/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停止 embedding jobs，使用已有合格 space 或 lexical；已生成向量不作为知识真相源。
