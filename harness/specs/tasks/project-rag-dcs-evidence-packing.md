---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-dcs-evidence-packing
title: 让 DCS 保序装配完整证据并记录实际引用
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-09
intent: 保证检索到的证据以可追踪、预算内且完整的形式进入模型。
diffBase: a529c082f3af034c428ac395501936842de6f439
touchedAreas:
  - "openclaw_runtime/src/context-engine/context-candidate.ts"
  - "openclaw_runtime/src/context-engine/turn-injection-budget.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-intent.ts"
  - "openclaw_runtime/src/context-engine/project-rag-packing.ts"
  - "openclaw_runtime/src/runtime-core/knowledge-packing-types.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts"
  - "openclaw_runtime/src/context-engine/context-final-snapshot.ts"
  - "openclaw_runtime/src/agents/command/types.ts"
  - "openclaw_runtime/src/agents/command/attempt-execution.ts"
  - "openclaw_runtime/src/gateway/server-methods/agent.ts"
  - "openclaw_runtime/src/gateway/server-methods/chat.ts"
  - "openclaw_runtime/src/plugin-sdk/memory-owner-read-types.ts"
  - "openclaw_runtime/packages/gateway-protocol/src/schema/agent.ts"
  - "openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts"
  - "shared/knowledge/packing.ts"
  - "shared/host-api/contract.ts"
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/services/knowledge-api.ts"
  - "electron/services/chat-api.ts"
  - "src/pages/Chat/ChatInput.tsx"
  - "src/stores/chat.ts"
  - "src/stores/chat/runtime-send-actions.ts"
  - "shared/chat/types.ts"
  - "electron/services/knowledge-source-set-answer.ts"
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
  - "docs/dev/evidence/project-rag/RAG-09/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - "harness/specs/scenarios/gateway-backend-communication.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "artifacts/agent-dev-workbench/**"
  - "artifacts/agent-dev-deep-test/**"
  - "artifacts/agent-dev-quality/**"
  - "tests/unit/chat-knowledge-scope.test.ts"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/chat-store-history-retry.test.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-intent.test.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-packing.test.ts"
  - "tests/e2e/project-rag-dcs-citation.spec.ts"
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
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/chat-store-history-retry.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-packing.test.ts"
  - "tests/e2e/project-rag-dcs-citation.spec.ts"
plannedTests:
  - "openclaw_runtime/src/context-engine/project-rag-packing.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-dcs-citation.spec.ts"
expectedUserBehavior:
  - "保证检索到的证据以可追踪、预算内且完整的形式进入模型。"
acceptance:
  - "同通道知识候选保留经 DCS 接受的 ordinal，不由 candidateId 意外改序；跨通道优先级仍由 DCS 决定。"
  - "以 chunk/冲突组为原子装配单元，token/字符估算与最终用量可回读，余量不足整片丢弃。"
  - "source/chunk/projection 三种 digest 分开；citation manifest 仅覆盖实际 retained bytes。"
  - "普通 Chat、media、queue、retry、model-only QA 共享准入与知识装配路径；kill switch 和重复模型调用不会晚到或重复注入。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/DCS-EVIDENCE-PACKING-CONTRACT.md
---

# 让 DCS 保序装配完整证据并记录实际引用

所属长期计划：RAG-09。前置工作包：RAG-07。Owner：DCS。

契约：KnowledgeCandidatePacking/v2、RetainedEvidenceManifest/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停用 chunk producer，使用同样受 DCS 控制的 page adapter。
