---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-structure-chunk-citation
title: 实现来源标准化、结构切块与精确定位
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-03
intent: 让相关信息可被召回，并能回到准确原文位置。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "openclaw_runtime/src/runtime-core/memory-tokenization.ts"
  - "openclaw_runtime/extensions/memory-wiki/runtime-api.ts"
  - "shared/knowledge/**"
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
  - "tests/unit/knowledge-retrieval.test.ts"
  - "openclaw_runtime/src/knowledge/retrieval/chunker.test.ts"
  - "tests/unit/project-rag-citation-locator.test.ts"
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
plannedTests:
  - "openclaw_runtime/src/knowledge/retrieval/chunker.test.ts"
  - "tests/unit/project-rag-citation-locator.test.ts"
expectedUserBehavior:
  - "让相关信息可被召回，并能回到准确原文位置。"
acceptance:
  - "标题、列表、步骤、代码围栏和表格有结构边界；raw UTF-8 offset、frontmatter、CRLF 和多字节字符可往返校验。"
  - "检索文本与可引用正文分离，CJK bigram 和标识符保留通过中英日俄 fixture；生成前缀不能成为原文引文。"
  - "chunkId 绑定 source/version/span/chunker；同输入可重建相同片段，父文档/section/read range 始终可追踪。"
  - "既有文件、目录与GitHub来源经owner标准化，记录parser/编码/来源版本与归一化映射；解析失败明确报错，不能当空文档；新材料仍经过既有确认链。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 实现来源标准化、结构切块与精确定位

所属长期计划：RAG-03。前置工作包：RAG-01、RAG-02。Owner：knowledge retrieval source / Wiki owner。

契约：KnowledgeChunk/v2、CitationLocator/v2、ChunkerProfile/v1、NormalizedSourceDocument/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：切换到已验证 chunker generation 或 owner page read，旧来源不迁移。
