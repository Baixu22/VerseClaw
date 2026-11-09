---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-observability-offline-promotion
title: 完成检索可观测性和离线策略晋级
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-17
intent: 持续发现质量与成本回退，同时防止反馈形成未审核的自学习。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "electron/services/observability*.ts"
  - "scripts/knowledge-*.ts"
  - "harness/specs/fixtures/project-rag/**"
  - "src/pages/Knowledge/**"
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
  - "tests/unit/knowledge-api.test.ts"
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
