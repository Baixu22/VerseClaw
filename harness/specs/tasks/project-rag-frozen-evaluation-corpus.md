---
lifecycleStatus: active
implementationStatus: partial
id: project-rag-frozen-evaluation-corpus
title: 冻结真实语料、独立判据和对照协议
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-02
intent: 在调参前固定怎样证明完整检索系统有效。
diffBase: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0
integratedMainCommit: ea4bff4423b7c2d2f16fe0c1b1856f850e8ecd15
touchedAreas:
  - "scripts/knowledge-*.ts"
  - "scripts/lib/project-rag-*.mjs"
  - "scripts/lib/project-rag-*.d.mts"
  - "scripts/lib/paired-ablation.mjs"
  - "harness/specs/fixtures/project-rag/**"
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
  - "scripts/duplicate-assets-allowlist.json"
  - "README*.md"
  - "docs/dev/evidence/project-rag/RAG-02/**"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/project-rag-corpus-integrity.test.ts"
  - "tests/unit/project-rag-code-oracle.test.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/project-rag-corpus-integrity.test.ts"
  - "tests/unit/project-rag-code-oracle.test.ts"
plannedTests:
  - "tests/unit/project-rag-corpus-integrity.test.ts"
  - "tests/unit/project-rag-code-oracle.test.ts"
expectedUserBehavior:
  - "在调参前固定怎样证明完整检索系统有效。"
acceptance:
  - "240 个查询按来源族分为 calibration/validation/held-out 各 80；同源改写不跨 split，覆盖中英日俄及六种任务意图。"
  - "安全/无答案/权限/版本负例独立封存；gold 引用真实 owner 版本和字节范围，标明 agent 编写与复核。"
  - "60 个执行任务、3 repeats、Off/page/full 三臂与各 profile 成本预算在运行前冻结；oracle 对被测模型隐藏。"
  - "A1/B1 共享安全修复和预算条件，保留当前强 page/semantic 基线，不用弱化基线制造收益。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/EVALUATION-CONTRACT.md
---

# 冻结真实语料、独立判据和对照协议

所属长期计划：RAG-02。前置工作包：RAG-01。Owner：evaluation。

契约：ProjectRagCorpus/v1、ProjectRagPromotionPolicy/v1、SourceSpanGold/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：保留原协议和旧 verdict；修订数据产生新版本，不原地改 gold 或阈值。
