---
lifecycleStatus: active
implementationStatus: implemented
id: project-rag-chat-interactions
title: 完成按需知识交互和安全 Auto-read
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-11
intent: 让知识检索可选择、可解释、可取消，并且不拖住普通聊天。
diffBase: ffe47ae8e40ca518a786e5b0e94e651e10ba3876
touchedAreas:
  - "openclaw_runtime/src/gateway/server-methods/agent.ts"
  - "shared/host-api/contract.ts"
  - "artifacts/agent-dev-deep-test/**"
  - "artifacts/agent-dev-quality/**"
  - "artifacts/agent-dev-workbench/**"
  - "openclaw_runtime/src/gateway/server-methods/chat.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge-intent.ts"
  - "openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts"
  - "tests/unit/chat-store-history-retry.test.ts"
  - "harness/specs/scenarios/gateway-backend-communication.md"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/plan-service.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/gateway.ts"
  - "tests/unit/project-rag-plan-owner.test.ts"
  - "electron/services/knowledge-api.ts"
  - "src/lib/knowledge-interaction.ts"
  - "src/pages/Chat/UsedKnowledge.tsx"
  - "src/pages/Chat/ChatMessage.tsx"
  - "shared/chat/types.ts"
  - "docs/dev/evidence/project-rag/RAG-11/**"
  - "tests/unit/knowledge-api.test.ts"
  - "src/pages/Chat/ChatInput.tsx"
  - "src/pages/Chat/index.tsx"
  - "src/stores/chat.ts"
  - "src/pages/Knowledge/**"
  - "shared/i18n/locales/*/chat.json"
  - "shared/i18n/locales/*/knowledge.json"
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
  - "tests/unit/chat-input.test.tsx"
  - "tests/unit/chat-knowledge-scope.test.ts"
  - "tests/unit/project-rag-chat-policy.test.tsx"
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-rerank.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/chat-store-history-retry.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts"
  - "tests/unit/project-rag-plan-owner.test.ts"
  - "tests/unit/project-rag-chat-policy.test.tsx"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-rerank.spec.ts"
  - "tests/unit/chat-input.test.tsx"
  - "tests/unit/chat-knowledge-scope.test.ts"
plannedTests:
  - "tests/unit/project-rag-chat-policy.test.tsx"
plannedE2E:
  - "tests/e2e/project-rag-chat-modes.spec.ts"
expectedUserBehavior:
  - "让知识检索可选择、可解释、可取消，并且不拖住普通聊天。"
acceptance:
  - "Off/Manual/Suggest/Auto-read 与 retrieval profile 正交；保持 none/suggest 的现有默认组合。"
  - "Preflight 的 inspect/attach/dismiss/当前版本/预算与 Used Knowledge 反映真实结果；无未授权 snippet。"
  - "Auto-read 显式选择；来源确认、新鲜度、唯一精确命中及内容证据或有效相关性校准共同准入，最多3个片段。"
  - "session/scope/query切换、取消、晚到响应、media/queued send、provider超时和missing-index的Electron路径通过；普通发送不被检索无限等待。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/CHAT-INTERACTION-CONTRACT.md
---

# 完成按需知识交互和安全 Auto-read

所属长期计划：RAG-11。前置工作包：RAG-10。Owner：Chat UI / Host。

契约：KnowledgeInteractionPolicy/v2、AutoReadAdmission/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：恢复兼容 Preflight/page 控件，保留原 scope/mode 和未发送草稿。
