---
lifecycleStatus: active
implementationStatus: implemented
id: project-rag-code-graph-task-context
title: 接通代码关系和任务事实的受控检索线索
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-15
intent: 支持跨文件关系与任务相关证据发现，避免创建通用图权威。
diffBase: f2438fed1f3e041d1a669696e7af6657ceaac87f
touchedAreas:
  - "artifacts/agent-dev-deep-test/history.json"
  - "artifacts/agent-dev-deep-test/report.json"
  - "artifacts/agent-dev-deep-test/report.md"
  - "artifacts/agent-dev-quality/report.json"
  - "artifacts/agent-dev-workbench/evidence.json"
  - "openclaw_runtime/src/agents/tools/context-agent-tools.ts"
  - "openclaw_runtime/src/context-engine/views/pack/context-pack-view.ts"
  - "shared/knowledge/code-task-context.ts"
  - "shared/component-authority-manifest.ts"
  - "shared/task-system/store.ts"
  - "shared/dcs/component-disposition-catalog.ts"
  - "tests/unit/component-disposition-catalog.test.ts"
  - "shared/host-api/contract.ts"
  - "src/lib/host-api.ts"
  - "harness/specs/scenarios/gateway-backend-communication.md"
  - "openclaw_runtime/src/context-engine/views/retrieval/**"
  - "openclaw_runtime/src/context-engine/factstore/**"
  - "openclaw_runtime/src/context-engine/views/impact/impact-parity.test.ts"
  - "harness/specs/fixtures/codegraph-retirement/impact-parity-inputs-v1.json"
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
  - "docs/dev/evidence/project-rag/RAG-15/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "tests/unit/task-ledger-reference.test.ts"
  - "tests/unit/project-rag-graph-task-context.test.ts"
  - "tests/unit/component-disposition-catalog.test.ts"
  - "tests/unit/dcs-prod-flags-catalog.test.ts"
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
  - "tests/unit/project-rag-graph-task-context.test.ts"
  - "openclaw_runtime/src/context-engine/factstore/factstore.test.ts"
  - "openclaw_runtime/src/context-engine/views/impact/impact-parity.test.ts"
  - "tests/unit/component-disposition-catalog.test.ts"
  - "tests/unit/dcs-prod-flags-catalog.test.ts"
  - "tests/e2e/project-rag-research.spec.ts"
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
    - docs/dev/project-rag/CODE-TASK-CONTEXT-CONTRACT.md
---

# 接通代码关系和任务事实的受控检索线索

所属长期计划：RAG-15。前置工作包：RAG-09、RAG-12。Owner：FactStore / Task Ledger / retrieval。

契约：RelationshipExpansion/v1、TaskContextHint/v1。

本文件定义精确代码关系与当前任务只读线索的实现合同。新增回归与正常 Chat 旅程已列入 requiredTests；验收结果绑定同一干净候选，并回读工具结果、任务快照和代码 chunk 数据。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：关闭关系扩展和任务hint，代码/任务canonical stores保持工作。
