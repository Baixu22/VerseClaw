---
lifecycleStatus: active
implementationStatus: planning
id: project-rag-knowledge-adaptation-baseline
title: 建立当前知识库的检索质量基线
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-A1
intent: 修正评测语义，依据实际知识库选择有效的单次检索基线，为 Research 和策略晋级提供可信输入。
diffBase: 731c6659e7d7dca4c1e5c9ac92bb22d05fb85170
touchedAreas:
  - "scripts/knowledge-*.ts"
  - "scripts/lib/project-rag-*.mjs"
  - "scripts/lib/project-rag-*.d.mts"
  - "scripts/lib/paired-ablation.mjs"
  - "harness/specs/fixtures/project-rag/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - "docs/dev/project-rag/**"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "tests/unit/project-rag-*.test.ts"
  - "README*.md"
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - knowledge-source-set-read-admission
  - project-rag-long-term-boundary
requiredTests:
  - "pnpm exec vitest run tests/unit/project-rag-corpus-integrity.test.ts tests/unit/project-rag-acceptance-readback.test.ts --maxWorkers=1 --cache=false"
plannedTests:
  - tests/unit/project-rag-query-grade.test.ts
  - tests/unit/project-rag-knowledge-adaptation.test.ts
expectedUserBehavior:
  - 根据当前知识库的真实来源和问题分布选定可验证的检索配置。
acceptance:
  - "评分器分别报告字节重叠、完整支持事实覆盖与排名质量；单字节命中不得计为完整召回，后续完整命中、合法片段联合覆盖、重复与错版本输入有可执行回归。"
  - "通过当前 workspace 的 owner 只读接口生成实际知识库快照及来源、语言、结构、长度、更新、重复、冲突和权限分布；记录缺失来源，保留当前知识库身份和每项摘要。"
  - "agent 依据实际快照编写并独立复核问题、支持事实及无答案/冲突/时效/权限负例；来源族和近重复不跨 calibration、validation、held-out，盲测 gold 对被测模型隔离。"
  - "以相同生成器、owner 安全和预算配对比较 page、BM25、dense、hybrid、hybrid+rerank；按实际知识库切片报告召回、DCS 后证据覆盖、回答及引用支持、延迟、费用与降级。"
  - "冻结 evaluator、语料、模型、chunker 和策略版本；在盲测释放前确定样本量、判据及费用 envelope；保留旧 v4 gold、原始结果和首次失败，未知用量单列。"
  - "复用现有 owner、检索、评分与执行器，产物全部标为 agent 驱动；计划内回归实际进入 requiredTests 后执行，证据可从磁盘复算。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/project-rag/EVALUATION-CONTRACT.md
    - docs/dev/project-rag/WORK-PACKAGES.md
    - docs/dev/project-rag/WINDOWS-FIRST-PLAN.md
---

# 建立当前知识库的检索质量基线

RAG-A1 是 RAG-16 的质量前置，依赖已完成的 RAG-02、RAG-08、RAG-09 和 RAG-12。复用既有只读 owner 与评测入口；先修评分并验证负例，再生成知识库画像、冻结问题集、比较强单次基线。

新增测试在实现时加入 requiredTests，运行时接口变化按原 Host/Gateway 边界补契约与对应旅程。模型实验按冻结 candidate、输入、provider、费用与资源计划执行。节点完成要求实际质量结果，文档和夹具通过只登记对应证据。

回滚：保留旧 evaluator 与冻结数据，通过版本选择恢复旧策略；不修改来源正文或旧 gold。
