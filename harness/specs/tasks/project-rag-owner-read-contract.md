---
lifecycleStatus: active
implementationStatus: partial
id: project-rag-owner-read-contract
title: 统一来源读取的身份、权限与版本
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-01
intent: 确保检索、预览、模型调用和引用使用同一份 owner 读取约束。
diffBase: ca1ba25b27ccd3783d199d2416d8a81bcf799c2e
integratedMainCommit: c308b60e1e8dc6849628c524ff8d8e1f0ce0a522
touchedAreas:
  # Committed main integration, recorded separately from the RAG implementation.
  - "docs/modules/multi-agent-and-tasks.md"
  - "electron/services/sessions-api.ts"
  - "harness/specs/fixtures/session-intent-recovery/**"
  - "harness/specs/tasks/session-handoff-recovery.md"
  - "shared/i18n/locales/**/chat.json"
  - "src/pages/Chat/ChatMessage.tsx"
  - "tests/e2e/fixtures/windows-process.ts"
  - "tests/e2e/session-fork-intent.spec.ts"
  - "tests/e2e/session-task-scope-derivation.spec.ts"
  - "tests/unit/chat-message.test.tsx"
  - "tests/unit/host-services.test.ts"
  - "tests/unit/session-handoff-recovery.test.ts"
  - "shared/knowledge/**"
  - "shared/host-api/contract.ts"
  - "electron/services/knowledge*.ts"
  - "electron/services/chat-api.ts"
  - "openclaw_runtime/src/context-engine/chat-knowledge*.ts"
  - "openclaw_runtime/src/context-engine/source-set.ts"
  - "openclaw_runtime/src/runtime-core/knowledge-owner-read.ts"
  - "openclaw_runtime/src/knowledge/sekb/knowledge-store.ts"
  - "openclaw_runtime/src/memory/memory-store.ts"
  - "electron/services/gateway-api.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts"
  - "openclaw_runtime/src/plugin-sdk/memory-host-core.ts"
  - "openclaw_runtime/src/gateway/server-methods/chat.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts"
  - "src/pages/Chat/ChatInput.tsx"
  - "src/stores/chat.ts"
  - "src/pages/Knowledge/**"
  - "src/lib/host-api.ts"
  - "src/lib/knowledge-librarian.ts"
  - "src/components/file-preview/MonacoViewer.tsx"
  - "src/components/layout/Sidebar.tsx"
  - "shared/i18n/locales/**/knowledge.json"
  - "docs/dev/evidence/project-rag/RAG-01/**"
  - "openclaw_runtime/extensions/memory-wiki/runtime-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/**"
  - "openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts"
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
  - "tests/unit/knowledge-source-set-answer.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/project-rag-owner-read.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts"
  - "tests/e2e/project-rag-owner-read.spec.ts"
  - "tests/e2e/project-rag-owner-read.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/knowledge-source-set-answer.test.ts"
  - "tests/unit/knowledge-api.test.ts"
  - "tests/unit/project-rag-owner-read.test.ts"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts"
plannedTests:
  - "tests/unit/project-rag-owner-read.test.ts"
  - "openclaw_runtime/src/context-engine/project-rag-owner-adapters.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-owner-read.spec.ts"
expectedUserBehavior:
  - "确保检索、预览、模型调用和引用使用同一份 owner 读取约束。"
acceptance:
  - "可信 session/workspace 身份派生 read context；renderer 的 scope、ACL 和 score 不能扩大权限。"
  - "source revision、完整内容 digest、policy epoch、namespace 与 range 经 Host/Gateway/runtime 往返保持；显式 pin 漂移拒绝。"
  - "真实 Wiki adapter 保留 status/privacy/ACL/retention，拒绝源在 UI、embedding、rerank 和 prompt 中出现次数为零。"
  - "所引用的 owner 版本按既有 owner 保留策略读取或明确失效；索引不能复活已删除或撤销的内容。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 统一来源读取的身份、权限与版本

所属长期计划：RAG-01。前置工作包：RAG-00。Owner：knowledge owners / Host / Gateway。

契约：ReadAdmissionContext/v1、SourceRef/v2、OwnerReadSnapshot/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：保留安全修复并禁用新 reader，回到同样准入的 page 读取。
