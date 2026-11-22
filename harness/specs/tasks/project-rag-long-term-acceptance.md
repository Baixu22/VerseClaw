---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-long-term-acceptance
title: 验收长期版本的完整能力、稳定性与任务收益
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-19
intent: 证明长期目标已经交付，并结束临时并行实现。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "scripts/knowledge-*.ts"
  - "harness/specs/fixtures/project-rag/**"
  - "docs/dev/project-rag/**"
  - "README*.md"
  - "docs/modules/knowledge-base.md"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "shared/dcs/prod-flags-catalog.ts"
  - "docs/generated/catalogs/prod-flags.md"
  - "docs/dev/evidence/project-rag-decision-20261109/source-review.json"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/harness-specs.test.ts"
  - "tests/unit/project-rag-acceptance-readback.test.ts"
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-research.spec.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/harness-specs.test.ts"
plannedTests:
  - "tests/unit/project-rag-acceptance-readback.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-research.spec.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
expectedUserBehavior:
  - "证明长期目标已经交付，并结束临时并行实现。"
acceptance:
  - "RAG-01至RAG-18每项能力都有当前候选真实接线与失败路径证据；仅完成FTS阶段不得关闭长期目标。"
  - "固定240query评测、完整Electron旅程、实际provider、20k/100k容量和72小时agent驱动soak完成，失败/partial/unknown保留。"
  - "60任务×3repeats×3arms结果封存；按profile冻结门槛判定质量、成本与任务收益，区间/费用缺失不能晋级。"
  - "临时score/confidence路径和重复装配收敛，page direct read成为永久显式ref/故障兼容入口，不保留第二排序或上下文权威。"
  - "源码/规格/证据同候选可复算、clean工作树、回滚可演练；RAG范围验收与产品发布授权分别记录。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 验收长期版本的完整能力、稳定性与任务收益

所属长期计划：RAG-19。前置工作包：RAG-02、RAG-17、RAG-18。Owner：independent evaluation / integration。

契约：ProjectRagAcceptance/v1、ProjectRagPromotionPolicy/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：保持前一已验证profile与所有者服务，记录未达标项，修复后新版本重测。
