---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-config-and-operations
title: 交付完整配置、索引运维和能力状态界面
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-12
intent: 让长期运行中的来源、模型、索引、预算和失败都可管理。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "openclaw_runtime/src/config/**"
  - "shared/dcs/component-disposition-catalog.ts"
  - "shared/component-authority-manifest.ts"
  - "src/components/settings/**"
  - "src/pages/Knowledge/**"
  - "shared/i18n/locales/*/knowledge.json"
  - "shared/i18n/locales/*/settings.json"
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
  - "tests/unit/host-api-facade.test.ts"
  - "tests/unit/project-rag-config-parity.test.ts"
  - "tests/e2e/project-rag-settings-operations.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/host-api-facade.test.ts"
plannedTests:
  - "tests/unit/project-rag-config-parity.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-settings-operations.spec.ts"
expectedUserBehavior:
  - "让长期运行中的来源、模型、索引、预算和失败都可管理。"
acceptance:
  - "config type/schema/help/defaults/catalog/doctor一致；scope/mode不双存，未知配置不能静默放行。"
  - "界面能选择owner/source set/profile/provider与回答策略，并展示enabled/ready/degraded/disabled及原因。"
  - "重建、暂停、恢复、模型/维度换代、空间预算、索引滞后、逻辑删除与物理cleanup状态可回读。"
  - "所有用户文案四语言与设计token覆盖；操作复用Host API，不由renderer直接访问DB、FS或provider。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 交付完整配置、索引运维和能力状态界面

所属长期计划：RAG-12。前置工作包：RAG-11。Owner：Settings / runtime config / retrieval operations。

契约：ProjectRagConfig/v2、RetrievalCapabilitySnapshot/v1、IndexStatus/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：doctor迁移与profile关闭恢复旧有效配置，保留owner数据和有效generation。
