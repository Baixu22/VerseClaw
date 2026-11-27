---
lifecycleStatus: active
implementationStatus: in_progress
id: project-rag-mainline-integration
title: 将经过验证的 G2 检索修复接入主线
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 确保来源撤权、模型取消、语义支持与费用判断在日常运行版本生效。
diffBase: 4085cd46b9a604e0617e91feff33f6ee8c24d7f0
touchedAreas:
  - openclaw_runtime/src/knowledge/retrieval/**
  - openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts
  - openclaw_runtime/src/agents/provider-spend-budget.ts
  - openclaw_runtime/src/plugins/*embedding*.ts
  - openclaw_runtime/extensions/memory-wiki/**
  - electron/services/knowledge*.ts
  - shared/knowledge/**
  - shared/host-api/contract.ts
  - shared/host-api/host-action-timeouts.ts
  - src/lib/host-api/knowledge/library.ts
  - src/lib/knowledge-research.ts
  - tests/unit/project-rag-*.test.ts
  - tests/unit/host-action-timeouts.test.ts
  - tests/unit/knowledge-evidence-qa.test.ts
  - tests/e2e/project-rag-*.spec.ts
  - scripts/knowledge-rag-*
  - scripts/lib/project-rag-*
  - scripts/build-rag-policy-verifier.mjs
  - scripts/build-openclaw-runtime.mjs
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/download-bundled-node.mjs
  - scripts/verify-bundled-node.mjs
  - harness/specs/fixtures/project-rag/**
  - harness/specs/tasks/project-rag-*.md
  - docs/dev/project-rag/**
  - docs/modules/knowledge-base.md
  - README*.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - project-rag-long-term-boundary
  - knowledge-source-set-read-admission
requiredTests:
  - tests/unit/project-rag-rerank-provider.test.ts
  - tests/unit/project-rag-plan-owner.test.ts
  - tests/unit/project-rag-research-controller.test.ts
expectedUserBehavior:
  - 查询期间失去读取权限的来源退出当前候选。
  - 取消、替换或禁用模型后，旧请求停止发送并丢弃迟到结果。
  - 多轮检索给出可核对的证据支持与费用状态。
  - 部分问题有冲突时保留其他已获支持的问题，并继续显示未解决的缺口。
acceptance:
  - 重排成功、失败、缺少模型、超时和撤权都有明确结果。原始来源及兄弟片段一同接受复验。
  - 预算、语义支持及最终保留源在对应集成路径有效，查询、语料、成本与来源的读回绑定候选。
  - 代码与定向回归对齐 G2 来源提交并通过当前候选的 Harness 和通信检查。
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/project-rag/OPTIMIZATION-20261126.md
    - docs/dev/project-rag/RESEARCH-CONTRACT.md
---

对应 TF-0974。主线的实际合入和原 G2 的 Windows 完整验收分别按磁盘产物记录。
