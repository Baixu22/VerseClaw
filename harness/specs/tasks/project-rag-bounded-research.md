---
lifecycleStatus: active
implementationStatus: implemented
id: project-rag-bounded-research
title: 实现有预算、能停止的 Research 检索
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-16
intent: 完成跨来源研究、证据缺口追查与关系分析。
diffBase: 159d7d2450e3776814e0ea83e03e2db1698dceb7
touchedAreas:
  - "openclaw_runtime/src/knowledge/retrieval/**"
  - "openclaw_runtime/src/agents/provider-spend-budget.ts"
  - "openclaw_runtime/src/agents/command/shared-types.ts"
  - "openclaw_runtime/src/agents/command/types.ts"
  - "openclaw_runtime/src/agents/command/attempt-execution.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/run.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts"
  - "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts"
  - "openclaw_runtime/src/gateway/server-methods/agent.ts"
  - "openclaw_runtime/packages/gateway-protocol/src/schema/agent.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/gateway.ts"
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/plan-service.ts"
  - "electron/services/knowledge-api.ts"
  - "electron/services/knowledge-research.ts"
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/utils/verseshell-runtime-bundle.ts"
  - "resources/verseshell/**"
  - "scripts/verseshell-bundle.mjs"
  - "scripts/verseshell-bundle.test.mjs"
  - "harness/specs/fixtures/verseshell-reintegration/source-lock.json"
  - "src/lib/knowledge-research.ts"
  - "src/lib/host-api/knowledge/routing.ts"
  - "shared/knowledge/research.ts"
  - "src/pages/Chat/**"
  - "shared/host-api/contract.ts"
  - "shared/i18n/locales/*/knowledge.json"
  - "shared/dcs/prod-flags-catalog.ts"
  - "shared/component-authority-manifest.ts"
  - "shared/dcs/component-disposition-catalog.ts"
  - "docs/generated/catalogs/prod-flags.md"
  - "docs/dev/evidence/project-rag-decision-20261109/source-review.json"
  - "docs/dev/project-rag/**"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/modules/knowledge-base.md"
  - "docs/modules/verse-tools.md"
  - "docs/dev/verseshell-foundation/STATUS.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/scenarios/gateway-backend-communication.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - ".gitattributes"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "tests/unit/knowledge-evidence-qa.test.ts"
  - "tests/unit/autonomy-provider-spend.test.ts"
  - "tests/unit/component-authority-manifest.test.ts"
  - "tests/unit/component-disposition-catalog.test.ts"
  - "tests/unit/project-rag-research-controller.test.ts"
  - "tests/unit/verseshell-runtime-bundle.test.ts"
  - "tests/unit/verseshell-manifest.test.ts"
  - "tests/e2e/project-rag-research.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
  - "e2e"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
  - "verseshell-upstream-preservation"
requiredTests:
  - "pnpm exec vitest run tests/unit/knowledge-evidence-qa.test.ts tests/unit/project-rag-research-controller.test.ts tests/unit/autonomy-provider-spend.test.ts tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts --maxWorkers=1 --cache=false"
  - "pnpm exec playwright test tests/e2e/project-rag-research.spec.ts --workers=1 --retries=0"
  - "node --test scripts/verseshell-bundle.test.mjs scripts/verseshell-reintegration-check.test.mjs"
  - "pnpm exec vitest run tests/unit/verseshell-runtime-bundle.test.ts tests/unit/verseshell-manifest.test.ts --maxWorkers=1 --cache=false"
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
    - docs/dev/project-rag/RESEARCH-CONTRACT.md
---

# 实现有预算、能停止的 Research 检索

所属长期计划：RAG-16。前置工作包：RAG-08、RAG-10、RAG-13、RAG-14、RAG-15。Owner：research retrieval planner / DCS / UI。

契约：ResearchPlan/v1、ResearchStep/v1、EvidenceGap/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

工程验收的 VerseShell 资格构建应用 `binary-test-targets.patch`：两个 CLI 入口没有单测，
Cargo 为其设置 `test=false`。完整锁定的库、12 个集成目标和文档测试继续执行，集成测试
仍构建并调用真实 CLI。源码锁登记该 Cargo 残留补丁，Main 和打包校验器绑定新的源码身份；
当前上游测试源码和锁定测试命令保持原字节。重建后按新候选刷新双角色工程验收。

回滚：停止research controller，已选scope保留，恢复单query local/quality路径。
