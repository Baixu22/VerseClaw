---
lifecycleStatus: active
implementationStatus: in_progress
id: project-rag-knowledge-adaptation-baseline
title: 建立当前知识库的检索质量基线
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-A1
intent: 修正评测语义，依据实际知识库选择有效的单次检索基线，为 Research 和策略晋级提供可信输入。
diffBase: c2a0245459d53454339df7c2689d3a058fbe69cc
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
  - "openclaw_runtime/src/knowledge/retrieval/projection-store.ts"
  - "openclaw_runtime/src/knowledge/retrieval/projection-store.test.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/query.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval-rerank.ts"
  - "openclaw_runtime/src/knowledge/retrieval/rerank.ts"
  - "tests/e2e/project-rag-dcs-citation.spec.ts"
  - "tests/e2e/project-rag-rerank.spec.ts"
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
  - "pnpm exec vitest run tests/unit/project-rag-rerank-provider.test.ts --maxWorkers=1 --cache=false"
  - "pnpm exec vitest run tests/unit/project-rag-query-grade.test.ts tests/unit/project-rag-knowledge-adaptation.test.ts tests/unit/project-rag-owner-read.test.ts tests/unit/knowledge-source-set-answer.test.ts tests/unit/project-rag-corpus-integrity.test.ts tests/unit/project-rag-acceptance-readback.test.ts tests/unit/project-rag-offline-package.test.ts tests/unit/project-rag-receipts-promotion.test.ts --maxWorkers=1 --cache=false"
  - "pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/knowledge/retrieval/projection-store.test.ts"
  - "pnpm exec playwright test tests/e2e/project-rag-dcs-citation.spec.ts tests/e2e/project-rag-rerank.spec.ts --workers=1 --retries=0"
plannedTests:
  - tests/unit/project-rag-query-grade.test.ts
  - tests/unit/project-rag-knowledge-adaptation.test.ts
plannedE2E:
  - tests/e2e/project-rag-dcs-citation.spec.ts
  - tests/e2e/project-rag-rerank.spec.ts
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

项目文档实测补充：长段落按 token/字符上限可以在同一来源行内切分。索引发布按原始字节连续性核对，只有前一片段以换行结束时才要求下一片段起始行递增；同一行的合法相邻片段可发布。

结构化 claim 没有正文出现位置坐标时，所有精确文本出现位置都必须落在当前 owner 读取范围内，才向 SourceSet 传递其身份。部分读取遇到范围外的相同文本时省略该 claim，完整读取仍可识别冲突。UTF-8、CRLF 和真实 SourceSet 路径进入回归，Electron 旅程通过 knowledge.get 核对部分与完整读取。

重排用量兼容顶层 `tokens.input_tokens` 和 SiliconFlow 的 `meta.tokens.input_tokens`。所有 batch 都返回非负安全整数且总和有效时才报告总 inputTokens；单批缺失或非法时总量保持 unknown。保存的原始响应按摘要复读恢复历史用量，原始空用量回执保留。

近重复检查对少于五个词的正文使用完整词序列指纹，防止仅大小写、空白或标点不同的短文档进入不同来源族。已有字节读取器继续拒绝空支持范围。
