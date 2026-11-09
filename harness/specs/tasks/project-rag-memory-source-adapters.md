---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-memory-source-adapters
title: 接通原生记忆与角色记忆的独立读取
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-13
intent: 综合可用记忆，同时保持各存储域和作用域的边界。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "openclaw_runtime/src/memory/**"
  - "openclaw_runtime/extensions/memory-core/runtime-api.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "shared/knowledge/**"
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
  - "tests/unit/chat-knowledge-scope.test.ts"
  - "tests/unit/project-rag-memory-domains.test.ts"
  - "tests/e2e/project-rag-source-domains.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/chat-knowledge-scope.test.ts"
plannedTests:
  - "tests/unit/project-rag-memory-domains.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-source-domains.spec.ts"
expectedUserBehavior:
  - "综合可用记忆，同时保持各存储域和作用域的边界。"
acceptance:
  - "原生文件/active memory provider与Role Memory card各自精确解析namespace与ID，不按一个memory标签混用。"
  - "原有read/use gates、session/workspace/sensitivity/retention生效；Runtime Memory诊断域不自动转成active lane。"
  - "不复制canonical memory到Wiki或新chunk authority，统一的是只读候选与DCS证据。"
  - "correction/delete/slot切换、禁用和缓存失效真实传播，不访问前一个owner的内容。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 接通原生记忆与角色记忆的独立读取

所属长期计划：RAG-13。前置工作包：RAG-09、RAG-12。Owner：native memory / Role Memory / retrieval adapters。

契约：RetrievalOwnerDescriptor/v1、MemorySourceRef/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：按owner单独关闭adapter，保留原生记忆服务与资料。
