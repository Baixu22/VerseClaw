---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-retrieval-plan-fusion
title: 实现按策略检索、融合和候选解释
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-07
intent: 统一精确、词法、语义候选，避免分数和权限混为一谈。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "openclaw_runtime/src/context-engine/source-set.ts"
  - "electron/services/knowledge-api.ts"
  - "shared/host-api/contract.ts"
  - "src/lib/host-api/knowledge/**"
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
  - "tests/unit/knowledge-source-set-answer.test.ts"
  - "tests/unit/project-rag-plan-fusion.test.ts"
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
  - "tests/unit/knowledge-source-set-answer.test.ts"
plannedTests:
  - "tests/unit/project-rag-plan-fusion.test.ts"
expectedUserBehavior:
  - "统一精确、词法、语义候选，避免分数和权限混为一谈。"
acceptance:
  - "按 mode/profile/owner scope 分配 lanes 和一个总 deadline；provider 失败沿剩余预算退化。"
  - "显式 refs 精确解析；普通结果按 lane rank 做 RRF、去重与 parent 配额，多 query 不重复放大同一信号。"
  - "不沿用 score/100、0.55 或固定 0.72；提供 scoreKind、lane rank、贡献、过滤与fallback原因。"
  - "SourceSet 不二次覆盖 RRF 排名，不恢复 sticky-denied 来源；query tokens 参数化转义。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 实现按策略检索、融合和候选解释

所属长期计划：RAG-07。前置工作包：RAG-06。Owner：retrieval planner。

契约：RetrievalPlan/v2、RankSignals/v2、RetrievalResult/v2。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：关闭新 plan reader，沿相同 owner 准入回到 page 检索。
