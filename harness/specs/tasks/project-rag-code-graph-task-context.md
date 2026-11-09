---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-code-graph-task-context
title: 接通代码关系和任务事实的受控检索线索
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-15
intent: 支持跨文件关系与任务相关证据发现，避免创建通用图权威。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "openclaw_runtime/src/context-engine/views/retrieval/**"
  - "openclaw_runtime/src/context-engine/factstore/**"
  - "electron/services/task-ledger-api.ts"
  - "openclaw_runtime/src/knowledge/retrieval/**"
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
  - "tests/unit/task-ledger-reference.test.ts"
  - "tests/unit/project-rag-graph-task-context.test.ts"
  - "tests/e2e/project-rag-research.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/task-ledger-reference.test.ts"
plannedTests:
  - "tests/unit/project-rag-graph-task-context.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-research.spec.ts"
expectedUserBehavior:
  - "支持跨文件关系与任务相关证据发现，避免创建通用图权威。"
acceptance:
  - "代码图复用FactStore，先修复/约束文件stem歧义，边绑定repo/revision与实际符号路径。"
  - "graph仅为relationship/research扩展召回，一跳默认、两跳硬上限、节点数有界；每个落点重新owner准入。"
  - "Task Ledger只提供任务revision、约束与证据refs，不进入长期chunk表，不创造或改写任务事实。"
  - "cross-workspace、stale edge、同名文件、缺Ledger与无关系请求均有负例和明确降级。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 接通代码关系和任务事实的受控检索线索

所属长期计划：RAG-15。前置工作包：RAG-09、RAG-12。Owner：FactStore / Task Ledger / retrieval。

契约：RelationshipExpansion/v1、TaskContextHint/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：关闭关系扩展和任务hint，代码/任务canonical stores保持工作。
