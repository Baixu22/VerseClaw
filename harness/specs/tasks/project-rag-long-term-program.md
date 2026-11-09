---
lifecycleStatus: active
implementationStatus: planning
id: project-rag-long-term-program
title: 冻结长期决策、研究依据与工作树规划
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-00
intent: 把完整目标、实现顺序、验证和工作树归属变成可执行合同。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/project-rag/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "docs/modules/knowledge-base.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "tests/unit/harness-specs.test.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/harness-specs.test.ts"
expectedUserBehavior:
  - "把完整目标、实现顺序、验证和工作树归属变成可执行合同。"
acceptance:
  - "长期目标覆盖 RAG-01 至 RAG-19，所有功能包有 owner、前置依赖、验证与回滚。"
  - "一手资料、源码锚点和依赖平台元数据可回读；最终选择不依赖未定义的后续架构决定。"
  - "本次改动已提交至 main 派生的专用工作树，任务提案通过预校验，节点绑定同一执行工作树。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 冻结长期决策、研究依据与工作树规划

所属长期计划：RAG-00。前置工作包：无。Owner：architecture / harness。

契约：ProjectRagProgram/v2、TaskForestWorktreeBinding/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：回到规划前提交；不修改运行时默认与用户资料。
