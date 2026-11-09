---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-index-lifecycle
title: 实现增量索引、撤销传播与崩溃恢复
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-04
intent: 让长期索引跟随真实来源变化，而非逐渐过期的缓存。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "openclaw_runtime/src/state/openclaw-state-*"
  - "openclaw_runtime/src/resources/background-work-gate.ts"
  - "openclaw_runtime/extensions/memory-wiki/runtime-api.ts"
  - "electron/services/knowledge-source-sync.ts"
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
  - "tests/unit/knowledge-source-sync.test.ts"
  - "openclaw_runtime/src/knowledge/retrieval/projection-store.test.ts"
  - "tests/unit/project-rag-index-recovery.test.ts"
  - "tests/e2e/project-rag-index-lifecycle.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/knowledge-source-sync.test.ts"
plannedTests:
  - "openclaw_runtime/src/knowledge/retrieval/projection-store.test.ts"
  - "tests/unit/project-rag-index-recovery.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-index-lifecycle.spec.ts"
expectedUserBehavior:
  - "让长期索引跟随真实来源变化，而非逐渐过期的缓存。"
acceptance:
  - "SQLite FTS5 和 chunk 投影以 source generation/CAS 发布；未完成构建不会成为 active。"
  - "create/update/revoke/delete/权限变更、停止期间变化及重启均可恢复；撤销立即取消可读资格，后台清理不能恢复授权。"
  - "owner 事件、启动对账和既有 watcher 复用同一入口；失败与重试有游标、幂等键、总预算与退出清理。"
  - "FTS 缺失/索引损坏不影响共享状态和普通 Chat 启动；后台构建不阻塞主线程。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 实现增量索引、撤销传播与崩溃恢复

所属长期计划：RAG-04。前置工作包：RAG-03。Owner：retrieval projection / shared state / background work。

契约：ProjectionGeneration/v1、IndexJob/v1、SourceInvalidation/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停止新 jobs、切回有效 generation 或 page 路径，只清理派生索引。
