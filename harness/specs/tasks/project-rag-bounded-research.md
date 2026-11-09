---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-bounded-research
title: 实现有预算、能停止的 Research 检索
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-16
intent: 完成跨来源研究、证据缺口追查与关系分析。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "electron/services/knowledge-api.ts"
  - "src/pages/Chat/**"
  - "shared/host-api/contract.ts"
  - "shared/i18n/locales/*/knowledge.json"
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
  - "tests/unit/project-rag-research-controller.test.ts"
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
  - "tests/unit/knowledge-evidence-qa.test.ts"
plannedTests:
  - "tests/unit/project-rag-research-controller.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-research.spec.ts"
expectedUserBehavior:
  - "完成跨来源研究、证据缺口追查与关系分析。"
acceptance:
  - "显式单次调用，最多3轮/8检索query/2次规划模型调用；deadline、token、费用和graph预算在开始前冻结。"
  - "查询拆解和证据缺口决定后续检索；重复、无新证据、足够覆盖、超时和取消都能停止。"
  - "所有子查询继承同一scope与owner权限；Research不自动扩外网、跨项目或工具/写权限。"
  - "返回真实证据、推断、冲突与缺口，DCS预算截取后仍可复算；Electron展示进度、取消与partial结果。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 实现有预算、能停止的 Research 检索

所属长期计划：RAG-16。前置工作包：RAG-08、RAG-10、RAG-13、RAG-14、RAG-15。Owner：research retrieval planner / DCS / UI。

契约：ResearchPlan/v1、ResearchStep/v1、EvidenceGap/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停止research controller，已选scope保留，恢复单query local/quality路径。
