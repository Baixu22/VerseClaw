---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-grounded-answer-citation
title: 完成 strict/open 问答、冲突披露与引用回源
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-10
intent: 让用户能区分有证据的事实、推断和未解决的问题。
diffBase: 806855309fb9d0ab4ffcf9f897f42fb0117e4f40
touchedAreas:
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/services/knowledge-source-set-answer.ts"
  - "src/lib/knowledge-librarian.ts"
  - "src/pages/Chat/KnowledgeChat.tsx"
  - "src/pages/Knowledge/**"
  - "shared/host-api/contract.ts"
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
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/knowledge-chat.test.tsx"
  - "tests/unit/project-rag-answer-contract.test.ts"
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
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/knowledge-chat.test.tsx"
plannedTests:
  - "tests/unit/project-rag-answer-contract.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-dcs-citation.spec.ts"
expectedUserBehavior:
  - "让用户能区分有证据的事实、推断和未解决的问题。"
acceptance:
  - "exact quote、source/版本/范围校验和 semantic claim support 分开记录；不把 quote 存在宣称为语义支持。"
  - "strict 缺源/冲突返回unknown，open 的一般知识/推断不伪造引用；provider错误保留partial与原因。"
  - "citation 点击先重验权限，定位正确 raw range；旧版本按 owner 保留策略显示或明确失效。"
  - "创建产物继续走 Inbox/Draft/Proposal/apply；回答不获得工具或写入权限。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 完成 strict/open 问答、冲突披露与引用回源

所属长期计划：RAG-10。前置工作包：RAG-08、RAG-09。Owner：Knowledge QA / citation viewer。

契约：Citation/v2、EvidenceStatus/v2、AnswerClaim/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：关闭综合或新 citation viewer，保留已准入摘录及原有治理动作。
