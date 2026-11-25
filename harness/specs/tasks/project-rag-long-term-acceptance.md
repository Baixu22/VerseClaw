---
lifecycleStatus: active
implementationStatus: in_progress
id: project-rag-long-term-acceptance
title: 验收长期版本的完整能力、稳定性与任务收益
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-19
intent: 证明长期目标已经交付，并结束临时并行实现。
diffBase: c6d47704411a5b4ee86dd5ec82bb8070987486fd
touchedAreas:
  - "docs/dev/project-rag/EVALUATION-CONTRACT.md"
  - "scripts/knowledge-rag-vector-capacity.ts"
  - "scripts/lib/project-rag-acceptance.d.mts"
  - "scripts/lib/project-rag-acceptance.mjs"
  - "scripts/lib/project-rag-adaptation-readback.mjs"
  - "scripts/lib/project-rag-capacity-input.ts"
  - "tests/unit/project-rag-adaptation-readback.test.ts"
  - "scripts/lib/project-rag-acceptance.*"
  - "scripts/lib/project-rag-query-grade.*"
  - "scripts/lib/project-rag-process.*"
  - "scripts/lib/project-rag-code-oracle.*"
  - "scripts/lib/project-rag-corpus.mjs"
  - "scripts/lib/project-rag-package.*"
  - "scripts/lib/project-rag-promotion.*"
  - "playwright.rag-packaged.config.ts"
  - "scripts/knowledge-*.ts"
  - "harness/specs/fixtures/project-rag/**"
  - "docs/dev/project-rag/**"
  - "README*.md"
  - "docs/modules/knowledge-base.md"
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "shared/dcs/prod-flags-catalog.ts"
  - "docs/generated/catalogs/prod-flags.md"
  - "docs/dev/evidence/project-rag-decision-20261109/source-review.json"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "tests/unit/knowledge-retrieval.test.ts"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/harness-specs.test.ts"
  - "tests/unit/project-rag-acceptance-readback.test.ts"
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-research.spec.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
residualPaths:
  - "electron/gateway/config-sync.ts"
  - "electron/services/gateway-api.ts"
  - "electron/services/knowledge-api.ts"
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/services/knowledge-research.ts"
  - "openclaw_runtime/extensions/memory-wiki/index.ts"
  - "openclaw_runtime/extensions/memory-wiki/retrieval-observability-api.ts"
  - "openclaw_runtime/extensions/memory-wiki/retrieval-policy-evaluation.test.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/gateway.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/observability-service.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/plan-service.ts"
  - "openclaw_runtime/src/agents/provider-spend-budget.ts"
  - "openclaw_runtime/src/plugin-sdk/knowledge-retrieval.ts"
  - "package.json"
  - "playwright.config.ts"
  - "scripts/after-pack.cjs"
  - "scripts/build-openclaw-runtime.mjs"
  - "scripts/build-rag-policy-verifier.mjs"
  - "scripts/bundle-openclaw-runtime.mjs"
  - "scripts/download-bundled-node.mjs"
  - "scripts/knowledge-rag-policy-verifier.mjs"
  - "scripts/release-integrity-manifest.mjs"
  - "scripts/verify-bundled-node.mjs"
  - "shared/host-api/contract.ts"
  - "shared/host-api/host-action-timeouts.ts"
  - "shared/i18n/locales/en/settings.json"
  - "shared/i18n/locales/ja/settings.json"
  - "shared/i18n/locales/ru/settings.json"
  - "shared/i18n/locales/zh/settings.json"
  - "shared/knowledge/observability.ts"
  - "shared/knowledge/retrieval.ts"
  - "src/components/settings/KnowledgeOperationsSettings.tsx"
  - "src/components/settings/KnowledgeRetrievalDiagnostics.tsx"
  - "src/lib/host-api/knowledge/library.ts"
  - "tests/e2e/project-rag-settings-operations.spec.ts"
  - "tests/unit/gateway-permissions-api.test.ts"
  - "tests/unit/host-action-timeouts.test.ts"
  - "tests/unit/project-rag-observability-store.test.ts"
  - "tests/unit/project-rag-offline-package.test.ts"
  - "tests/unit/project-rag-package-manifest.test.ts"
  - "tests/unit/project-rag-receipts-promotion.test.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "pnpm exec vitest run tests/unit/project-rag-adaptation-readback.test.ts tests/unit/project-rag-capacity-input.test.ts --maxWorkers=1 --cache=false"
  - "pnpm exec vitest run tests/unit/knowledge-retrieval.test.ts tests/unit/knowledge-evidence-qa.test.ts tests/unit/harness-specs.test.ts tests/unit/project-rag-acceptance-readback.test.ts --maxWorkers=1 --cache=false"
  - "pnpm exec playwright test tests/e2e/project-rag-chat-modes.spec.ts tests/e2e/project-rag-research.spec.ts --workers=1 --retries=0"
  - "pnpm exec playwright test --config playwright.rag-packaged.config.ts --workers=1 --retries=0"
plannedTests:
  - "tests/unit/project-rag-acceptance-readback.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-chat-modes.spec.ts"
  - "tests/e2e/project-rag-research.spec.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
expectedUserBehavior:
  - "证明长期目标已经交付，并结束临时并行实现。"
acceptance:
  - "当前Windows-only资格验证显式绑定qualificationScope和win32-x64原件，macOS/Linux四目标记deferred；节点按Windows顺序执行，其余完整能力、质量、费用、稳定性和工程门槛保持。"
  - "RAG-01至RAG-18每项能力都有当前候选真实接线与失败路径证据；仅完成FTS阶段不得关闭长期目标。"
  - "固定240query评测、完整Electron旅程、实际provider、20k/100k容量和72小时agent驱动soak完成，失败/partial/unknown保留。"
  - "60任务×3repeats×3arms结果封存；按profile冻结门槛判定质量、成本与任务收益，区间/费用缺失不能晋级。"
  - "临时score/confidence路径和重复装配收敛，page direct read成为永久显式ref/故障兼容入口，不保留第二排序或上下文权威。"
  - "源码/规格/证据同候选可复算、clean工作树、回滚可演练；RAG范围验收与产品发布授权分别记录。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
  - "最终资格同时读回原 240 查询/540 任务槽/72 小时与 RAG-A1 实际知识库质量证据；普通知识问答效果与代码/诊断/研究任务收益分项报告。"
  - "按 evaluator 新版本复算部分、完整、重复和错版本证据；最终 DCS 覆盖、回答正确性、引用语义支持、冲突及无答案拒答均有固定判据与原始结果。"
  - "同候选完成 Research 语义覆盖、本地/远端有效能力、质量/费用和 Windows 包回归；开发回归、质量实验、完整集成三层证据分别登记，原工程门禁和双角色验收保持。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 验收长期版本的完整能力、稳定性与任务收益

所属长期计划：RAG-19。前置工作包：RAG-02、RAG-17、RAG-18。Owner：independent evaluation / integration。

契约：ProjectRagAcceptance/v1、ProjectRagPromotionPolicy/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：保持前一已验证profile与所有者服务，记录未达标项，修复后新版本重测。

最终读回入口scripts/knowledge-rag-acceptance.ts读取同候选各叶接线/失败路径、五平台原生探针、20k/100k容量、完整三臂测量、工程双角色和实际72小时soak。证据的candidate、candidate.commit与candidateCommit并存时必须一致匹配冻结候选，冲突字段不能重标旧证据。原始540槽位沿既有ProjectRagAttemptReceipt/v1、独立grader、experiment及negative safety证据逐hash验证。soak以墙钟和单调时钟共同累计，探针断档、候选变化、丢作业、重复发布或撤销泄漏均保留失败；不能用缩短时长或修改时间戳代替。

任务队列执行入口scripts/knowledge-rag-task-runner.ts绑定原540槽位、固定argv adapter及输入digest，生成与oracle隔离的participant工作区；每槽执行后独立重新分级并追加唯一attempt，原期限内捕获实际费用/用量，缺证据或基础设施错误立即停队列。中断、超时和无产物保持原状态，不覆盖旧跑次；实际provider资源仅在明确执行命令时消费。

查询入口scripts/knowledge-rag-query-runner.ts对固定240query执行page/full两臂，逐臂原子保存queries.json检查点。完整查询与当前partialQuery分别保留；failure绑定queryId、arm、失败阶段和原始原因，启动或终止未确认的命令结果保留null。原始日志和捕获保留，任何失败立即停止并返回非零退出码，只有全部240query完成才标记complete。持续回归覆盖非零退出、原期限超时、缺失/损坏捕获、候选/策略漂移、工作树变化及启动失败。

所有者于2026-11-24指定Windows优先。当前manifest显式采用qualificationScope=windows-only，仅平台原件范围收敛为win32-x64，结果保留四个deferred目标；18叶接线/失败路径、固定评测、容量、费用、安全、完整双角色及72小时条件照常验证。省略范围或指定all-platforms沿用五平台读回，未知范围拒绝。重新规划的节点与后继补验见docs/dev/project-rag/WINDOWS-FIRST-PLAN.md。

residualPaths精确列出同一工作树中由相邻工作包负责的变更；本叶验收按自身新增测试和接口要求执行，完整门槛与原始失败保留。

2026-11-25 知识库适配补充：复用 RAG-A1 的实际知识库快照和版本化评测。具体输入和执行顺序见 `docs/dev/project-rag/EVALUATION-CONTRACT.md` 与 `WINDOWS-FIRST-PLAN.md`；以上新增验收项随本叶实现。
