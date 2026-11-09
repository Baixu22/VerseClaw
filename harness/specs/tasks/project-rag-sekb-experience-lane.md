---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-sekb-experience-lane
title: 接通已确认经验和可观察的采用归因
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-14
intent: 让历史经验帮助实际执行，并知道是否被采用及是否有效。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "electron/services/knowledge-api.ts"
  - "openclaw_runtime/src/knowledge/sekb/**"
  - "openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts"
  - "openclaw_runtime/src/knowledge/retrieval/**"
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
  - "tests/unit/project-rag-sekb-attribution.test.ts"
  - "tests/e2e/project-rag-source-domains.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
  - "rsi-experience-attribution-boundary"
  - "sekb-hermes-write-path-boundary"
requiredTests:
  - "tests/unit/knowledge-api.test.ts"
plannedTests:
  - "tests/unit/project-rag-sekb-attribution.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-source-domains.spec.ts"
expectedUserBehavior:
  - "让历史经验帮助实际执行，并知道是否被采用及是否有效。"
acceptance:
  - "复用 Runtime Lessons 接口，只召回 active confirmed principle；sekb前缀、canonical ID和内容版本精确绑定。"
  - "candidate、revoked、错版本、metadata-only无相关内容的经验不得Auto-read；取消固定0.72。"
  - "UI exposure、context exposure、citation、adoption、operational outcome和independent task grade分别记录。"
  - "adoption必须有同run observed operation，现有事务/去重/删除传播完整；检索和反馈不直接改principle或排序。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 接通已确认经验和可观察的采用归因

所属长期计划：RAG-14。前置工作包：RAG-09、RAG-12。Owner：SEKB / attribution / retrieval。

契约：ExperienceRef/v1、RsiExperienceAttribution/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：关闭experience lane，不撤销已确认principle或历史归因收据。
