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
  - "openclaw_runtime/extensions/memory-wiki/src/retrieval/vector-backends.ts"
  - "electron/services/knowledge-api.ts"
  - "electron/services/knowledge-research.ts"
  - "electron/services/knowledge-evidence-qa.ts"
  - "electron/utils/verseshell-runtime-bundle.ts"
  - "resources/verseshell/**"
  - "scripts/verseshell-bundle.mjs"
  - "scripts/verseshell-bundle.test.mjs"
  - "scripts/check-evidence-refs.mjs"
  - "scripts/lib/rsi-candidate-evolution.mjs"
  - "harness/specs/fixtures/ontology-lite-existing-contracts/report/default-stdout-rag16.expected.txt"
  - "harness/specs/fixtures/rsi-evidence-loop/tf0592-source-inputs.json"
  - "harness/specs/fixtures/verseshell-reintegration/source-lock.json"
  - "artifacts/agent-dev-workbench/evidence.json"
  - "artifacts/agent-dev-deep-test/report.json"
  - "artifacts/agent-dev-deep-test/report.md"
  - "artifacts/agent-dev-deep-test/history.json"
  - "artifacts/agent-dev-quality/report.json"
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
  - "tests/unit/chat-message.test.tsx"
  - "tests/unit/chat-render-reachability.test.tsx"
  - "tests/unit/context-folding-result.test.ts"
  - "tests/unit/conversation-resource-cards.test.tsx"
  - "tests/unit/evidence-refs-exist.test.ts"
  - "tests/unit/long-session-continuity-context.test.ts"
  - "tests/unit/openclaw-auth.test.ts"
  - "tests/unit/project-rag-corpus-integrity.test.ts"
  - "tests/unit/rsi-tf0592-statistical-adjudication.test.ts"
  - "tests/unit/runtime-grounding-shadow-consumers.test.ts"
  - "tests/unit/semantic-authority-consistency.test.ts"
  - "tests/unit/session-task-scope-completion.test.ts"
  - "tests/unit/task-loop-controller.test.ts"
  - "tests/unit/versebrowser-boundary-repair.test.ts"
  - "tests/unit/verseshell-runtime-bundle.test.ts"
  - "tests/unit/verseshell-manifest.test.ts"
  - "tests/e2e/project-rag-research.spec.ts"
  - "tests/e2e/fixtures/fp-p1-harness.ts"
  - "eslint.config.mjs"
  - "openclaw_runtime/src/agents/execution-checkout-admission.ts"
  - "openclaw_runtime/src/agents/execution-checkout-tools.ts"
  - "openclaw_runtime/src/agents/persistent-task-acceptance.ts"
  - "openclaw_runtime/src/gateway/server-methods/chat.ts"
  - "src/components/layout/SessionFolderTree.tsx"
  - "src/hooks/use-message-viewport.ts"
  - "tests/e2e/chat-viewport-budget.spec.ts"
  - "tests/e2e/project-rag-owner-read.spec.ts"
  - "tests/e2e/session-task-state-guidance.spec.ts"
  - "tests/e2e/session-worker-task-journey.spec.ts"
  - "tests/unit/execution-migration-process.test.ts"
  - "tests/unit/runtime-memory-context-provider.test.ts"
  - "tests/unit/runtime-memory-eval-budget-pressure.test.ts"
  - "tests/unit/runtime-memory-eval-conflict-resolution.test.ts"
  - "tests/unit/runtime-memory-eval-temporal-evolution.test.ts"
  - "tests/unit/runtime-memory-eval-topic-drift.test.ts"
  - "tests/unit/runtime-memory-interleaved-read-write.test.ts"
  - "tests/unit/runtime-memory-locomo-benchmark.test.ts"
  - "tests/unit/runtime-memory-long-conversation-real.test.ts"
  - "tests/unit/runtime-memory-persistence.test.ts"
  - "tests/unit/runtime-memory-proposal-shadow.test.ts"
  - "tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts"
  - "tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts"
  - "tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts"
  - "tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts"
  - "tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts"
  - "tests/unit/runtime-memory-read-hydration-shadow-command.test.ts"
  - "tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts"
  - "tests/unit/runtime-memory-read-hydration-shadow.test.ts"
  - "tests/unit/runtime-memory-write-path-semantic-real.test.ts"
  - "tests/unit/unified-effect-admission.test.ts"
  - "harness/src/profiles.mjs"
  - "harness/src/profiles.test.mjs"
  - "harness/specs/guides/scoped-development-validation.md"
  - "openclaw_runtime/src/config/runtime-context-block-compass.test.ts"
  - "openclaw_runtime/src/config/runtime-context-block-role-memory.test.ts"
  - "openclaw_runtime/src/config/runtime-context-block-sekb.test.ts"
  - "openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts"
  - "openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts"
  - "electron/utils/private-file-permissions.ts"
  - "electron/utils/session-files.ts"
  - "harness/specs/fixtures/rsi-evidence-loop/decision-source-inputs.json"
  - "harness/specs/fixtures/rsi-evidence-loop/task-corpus-source-inputs.json"
  - "harness/specs/guides/session-lifecycle-worktree-and-node-development.md"
  - "harness/specs/tasks/performance-resource-governance-20261107.md"
  - "openclaw_runtime/src/context-engine/assembler.kill-switch.test.ts"
  - "openclaw_runtime/src/context-engine/assembler.ts"
  - "openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts"
  - "scripts/check-local-paths.mjs"
  - "scripts/check-runtime-deep-refs.mjs"
  - "scripts/context-folding-real-task-eval.mjs"
  - "scripts/knowledge-quality-eval.ts"
  - "scripts/measure-gateway-startup.mjs"
  - "scripts/rsi-adoption-export.mjs"
  - "scripts/semantic-convergence-benefit.mjs"
  - "scripts/verify-adaptive-resource-pressure.mjs"
  - "src/components/task-ledger/TaskLedgerSummaryPanel.tsx"
  - "tests/helpers/frozen-source-replay.ts"
  - "tests/unit/app-version-rollback.test.ts"
  - "tests/unit/chat-artifact-panel-layout.test.tsx"
  - "tests/unit/chat-save-to-knowledge.test.tsx"
  - "tests/unit/chat-session-status-rail.test.tsx"
  - "tests/unit/context-authority-closeout.test.ts"
  - "tests/unit/cross-layer-closed-loop.v01.test.ts"
  - "tests/unit/dcs-preview-switch.test.ts"
  - "tests/unit/gateway-p4-001-auth-binding.test.ts"
  - "tests/unit/harness-codex-active-verification.test.ts"
  - "tests/unit/harness-spec-portability.test.ts"
  - "tests/unit/ke-integration-full-chain.test.ts"
  - "tests/unit/ke-p1-1-candidate-wiring.test.ts"
  - "tests/unit/knowledge-roletags.test.ts"
  - "tests/unit/local-path-docs.test.ts"
  - "tests/unit/models-page.test.tsx"
  - "tests/unit/project-rag-rerank-provider.test.ts"
  - "tests/unit/rsi-decision-check.test.ts"
  - "tests/unit/rsi-historical-task-corpus.test.ts"
  - "tests/unit/runbook-task-graph.test.ts"
  - "tests/unit/runtime-deep-refs.test.ts"
  - "tests/unit/runtime-memory-benefit-real-model.test.ts"
  - "tests/unit/session-cascade-delete-p3-004.test.ts"
  - "tests/unit/session-files.test.ts"
  - "tests/unit/versegit-product-acceptance.test.ts"
  - "tests/unit/versegit-wp2-profile.test.ts"
  - "tests/unit/versegit-wp6-closeout.test.ts"
  - "tests/unit/project-rag-memory-domains.test.ts"
  - "tests/unit/agent-engineering-acceptance.test.ts"
  - "scripts/lib/agent-engineering-acceptance.mjs"
  - "tests/unit/versegit-wp9-global-acceptance.test.ts"
  - "scripts/rc00-acceptance-bootstrap.mjs"
  - "tests/unit/runtime-lifecycle-governance.test.ts"
  - "tests/unit/chat-history-reply-while-sending.test.tsx"
  - "electron/services/knowledge-read-scope.ts"
  - "openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts"
  - "openclaw_runtime/src/gateway/server-methods/sessions.read.ts"
  - "tests/unit/knowledge-session-identity.test.ts"
  - "docs/dev/evidence/project-rag/RAG-16/20261120-f286cf276/**"
  - "scripts/typecheck-agent-dev.mjs"
  - "tests/unit/typecheck-gate.test.ts"
  - "docs/dev/evidence/project-rag/RAG-16/20261120-r9-0144b1725/**"
  - "scripts/validate-runtime-authority-convergence.mjs"
  - "package.json"
  - "tests/unit/chat-api-workspace-fingerprint.test.ts"
  - "tests/unit/shared-watchers-native.test.ts"
  - "openclaw_runtime/src/agents/tools/context-agent-tools.test.ts"
  - "docs/dev/evidence/project-rag/RAG-16/20261120-r10-e32a06779/**"
  - "scripts/runtime-deep-refs-baseline.json"
  - "tests/unit/chat-leading-orphan-tools.test.tsx"
  - "openclaw_runtime/src/process/os-containment.ts"
  - "tests/unit/os-containment-windows-token.test.ts"
  - "openclaw_runtime/src/process/supervisor/supervisor.ts"
  - "tests/unit/process-supervisor-exit-observation.test.ts"
  - "tests/unit/long-session-runtime-resource-inventory.test.ts"
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
  - "node --test scripts/verseshell-bundle.test.mjs scripts/verseshell-reintegration-check.test.mjs harness/src/profiles.test.mjs"
  - "pnpm exec vitest run tests/unit/verseshell-runtime-bundle.test.ts tests/unit/verseshell-manifest.test.ts tests/unit/chat-viewport.test.tsx tests/unit/session-folder-tree.test.tsx --maxWorkers=1 --cache=false"
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

工程验收同时核对本叶继承的仓库 lint 基线。历史证据和封存评测程序保留原字节，由哈希合同核验；活动测试的未使用私有名称与冗余初始化已整理，断言和跳过预算保持原值。会话树在提交子节点前处理选择切换，阅读位置的 ref 在 layout effect 中复位；既有 Electron 旅程新增跨会话回读断言。

全量单测暴露的加载错误通过真实文件系统路径与既有 `.js` 到 `.ts` loader 修复。
活动夹具按已落地的 workspace owner、Task System 注册和 TF-0500 provider 退休状态绑定；
冻结 Wiki 的正文、版本、digest 与 policy 继续核验，临时 vault 的 namespace 在读取前绑定。
引用输出固定为本叶的 194 项，语义目录固定为当前 28 个 flags，其他计数与负向诊断保持。
复制 TF-0592 统计包时使用 `tf0592-source-inputs.json` 保存的 17 项原始源码，
逐项核验原始与 canonical SHA-256 以及报告绑定的 `dfed8b83b5c07774ae14532bff4151487ae84f32`；
统计包、SHA256SUMS、oracle 与裁决阈值沿用封存字节。

历史验收回归绑定原始 Git revision、tree 和逐项字节摘要。Harness 历史包缺失及目录摘要不一致保持 stale，VerseGit F5 在稀疏独立检出重放并核验源码漂移负例。WP2 使用当前已校验包在临时仓库运行；旧报告与 SHA256SUMS 保留原字节。

上下文增强关闭时，Context Ladder 同步停止 BlockStore 查询；环境变量与配置两条入口均有回归。已退休 Runtime Memory 收益入口验证无读取和无持久化；rerank 默认四语言夹具明确标注 scripted-fixture，显式 live 输出要求实际凭据。正式测试启用 RESOURCE_GOVERNANCE_STRESS=1 执行资源压力产物检查，固定 50/10/0 跳过预算保持。

工程验收沿用现有25门禁，资源准备同时绑定并复制VerseGit包的原始SHA与bytes。验收框架回归复用只读初始仓库模板，每个测试仍有独立.git目录并执行真实commit/worktree/ancestry/篡改校验。大型依赖在测试收集时加载，单用例和门禁超时不变。

候选源码校验以单次Git ls-tree和NUL分隔diff批量读取，保留逐项blob、存在性与脏改判定；空格/方括号路径、删除、前导空白路径正文变化均有负例。路径列表使用未trim原始输出，跨次校验不缓存工作区。

Knowledge身份复验使用sessions.describe的identityOnly投影，直接从同一session owner读取canonical key、generation和status，省略模型/转录装饰；每次读取均重新校验，旧完整describe默认响应保留。

单次验收计划复用已验证的比较基准，并将真实差异绑定到本次读取的候选 commit；后续调用重新解析移动 ref 和 ancestry。NUL 差异保留前导空白路径。

类型检查的指纹读取按32文件批量执行，仍按原排序逐字节计算相同SHA-256，读取错误直接失败；测试覆盖跨批次的测试文件与runtime输入变更使缓存失效。

收敛验收按单次Git树与NUL差异批量核对来源blob，literal pathspec保留空格/方括号路径；正文恢复、修改和删除均重新读取。仓库身份的commit/tree在同次Git调用中解析并校验完整SHA，工作树和ref继续独立读取。

进程迁移回归在子进程退出时清理等待计时器，超时则移除退出监听；真实终止/重启、17项断言及10/25秒等待上限保持。

根测试首段最多3个worker；原三个权限/原生检查文件保持单worker隔离，随后完整执行DCS，整条1800秒与50/10/0跳过合同不变。Chat协调器测试使用独立临时workspace，避免读取仓库共享Task数据库；实际generation和权限拒绝仍按原断言执行。

原生目录监听回归分别等待删除失效和重建后的新通知，再断言后续文件事件；null仍是失效提示，不能用删除通知当作重建完成。原事件/句柄清理断言和15秒测试总上限保持。

DCS工具注册测试显式传入各自临时workspace，FactStore测试复用已有repoRoot；Task owner入口和schema拒绝逻辑继续真实执行，避免默认cwd读取开发仓库共享数据库。

生命周期夹具按完整换行累计stdout后识别真实child PID，前缀与数字跨分片均有回归；10秒握手、15秒drain、50周期和堆/活动记录阈值保持。

源码index/vector worker显式绑定同一Runtime tsconfig路径映射，仅作用于.ts入口，干净未构建检出不再依赖workspace package的dist残留；打包.js入口保持原行为。生成物引用按既有精确file-target清单登记，原构建/哈希读取仍拒绝缺失产物，其他来源文件或目标路径继续报错。Chat orphan旅程的模块加载移到收集期，原交互断言和单用例30秒上限保持。

Windows OS进程身份将PowerShell FILETIME与WMIC带时区/微秒创建时间归一到精确FILETIME ticks。跨探测器回退不再误报同一进程为复用；真正创建时间变化仍unknown，不终止或接纳新进程。无效创建时间返回unknown，错误详情保留比较的两个token。

Windows CIM查询只请求进程ID、父进程ID和创建时间，三列身份合同与原5秒探测预算保持。

进程adapter完成后立即清理终止计时器并停止向该PID发信号，OS验证仍继续，active记录和manifest仍按原验证结果清理。重复cancel与Windows drain直接强杀共用同一完成边界；未退出的进程仍按原5秒升级。

资源清单夹具固定空runtime配置，并将durable-helper与worktree状态绑定到每项独立临时数据库；真实owner查询和原4项断言、30/60秒时限保持。

独立memory-domain夹具在写入session前绑定已有cfg快照与本项临时state路径，使session maintenance和owner读取使用同一测试配置；真实session/role数据库、50项断言和原hook超时保持。

生命周期50-cycle文件完整移入既有单worker隔离段，避免首段Git密集测试与它并行创建进程；原7项/50循环/泄漏断言与超时保持。数字进程token按BigInt精确排序，同刻子进程保留、早1微秒的旧PID关系排除。

规划器重复建议已排队的Markdown链接时，复用该查询的来源绑定、原路径和深度。查询规范化后的重复也遵循同一规则，后续扩展按原两跳预算停止；单测和既有Research Electron旅程覆盖这条链。

规划回执中的token/费用为无效数值或超出本次预留时，结束本次Research，保留已准入来源和原预留，并将实际用量保持为unknown。后续链接不再触发新的规划；正常和缺少实际用量的回执继续遵循原预算。单测与现有Electron旅程的模拟usage异常覆盖停止行为。

规划调用等待期间，进度中的实际token与费用总量为unknown；有效回执返回后累计已结算用量。取消、超时或owner切换发生在等待中时，保留预留和unknown，迟到回执不能改写终态。单测覆盖第二次规划中断及迟到结算，既有Electron取消旅程校验首次规划的用量与预留。

规划等待回执先执行调用方的实际用量校验，再校验运行状态、DCS与回答正文；空回答、无效JSON/引文或失败状态不能吞掉预算超额停止信号。Main与模型等待单测覆盖错误优先级，既有Electron预算异常旅程同时返回无效JSON和超额用量。
