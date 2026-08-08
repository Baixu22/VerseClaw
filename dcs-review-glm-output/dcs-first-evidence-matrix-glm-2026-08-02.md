# DCS-first 评审证据矩阵 — GLM

**评审 agent**：GLM-5.2
**评审日期**：2026-08-02
**证据最高等级**：E2（受控测试）；无 E4/E5；STATUS.md `liveReady=false`

---

## 1. 场景证据矩阵

| 场景 | 入口 | Context authority | Mem path | 最终 bundle | 副作用 | 恢复边界 | 当前证据等级 |
|---|---|---|---|---|---|---|---|
| 桌面 coding | ChatInput→Host API→Main→Gateway chat.send→dispatch.ts:476-529（只做 delivery 编排，不接触 systemPrompt）→dispatchReplyFromConfig→agentCommandFromIngress→runEmbeddedAttempt→attempt.ts:2000 computeContextExtraSystemPrompt→finalizeContextOrchestratorTurn | Orchestrator(memory+vtoken)+Assembler(knowledge/working_memory/tool_registry 走 candidate 路径正确)+CVK(走 candidate 路径正确)+attempt.ts 6 处直接覆盖(subagent/hooks-legacy/hooks-prepend-append/media/model-identity/runtime-context) — **多 authority** | chat-turn-memory-injection.ts: shouldInjectChatTurnMemory(L106-121) 是开关式 gate 非 admission; default-off; 无压缩/去重/冲突判断; 只是 wiring seam 渲染 `## Memory Context` 块 | **不存在唯一 bundle**; attempt.ts L2180 systemPromptText 经 setActiveSessionSystemPrompt 闭包(L2537-2540)被覆盖 7 次; gateway agent.ts:2527-2529 干净透传 | write journal(fail-open)+approvals+trajectory | transcript 可恢复(持久化); bundle 不可恢复(进程内 Map turn 后删除); 外部副作用不可恢复 | E1/E2; 无 E4 |
| cron agentTurn | Cron→SQLite queue→agentTurn job→embedded turn→同 attempt.ts 路径 | 同桌面(共享 attempt.ts) | 同桌面; chat-turn-memory-injection.ts:106-121 session key 正则 `^(agent|cron):[^:]+:main$` 证明 cron 与 agent 共享 memory pilot 路径 | 同桌面(6 处覆盖) | 同桌面+cron lease/allowlist | 同桌面; cron 队列持久化但 bundle 不持久化 | E1/E2; 无 E4 |
| compact/fork/handoff | sessions.compact / fork / handoff | compact:Gateway 重编译; fork:transcript clone 但 in-process Map<turnId,ledger> 不可克隆; handoff:新会话从头编译 | N/A | 无 bundle 可恢复; in-process Map turn 后 endContextCandidateCollection 删除 | compact 不撤销文件/进程/网络/delivery; fork 不复制外部副作用; handoff 不恢复外部副作用 | checkpoint rollback HEAD 上 restore RPC 不可达(WIP 未注册); 即使注册只恢复 write journal pre-image, 不恢复 transcript/runtime/网络 | E1/E2; checkpoint restore=E0(WIP) |

---

## 2. 必读材料证据等级矩阵

| 类 | 项 | 文件 | 证据等级 | 对"DCS 生产就绪"的指向 |
|---|---|---|---|---|
| A1 | AGENTS.md | 工作区规则 | E1 | 项目规则；Agent Dev Ecosystem 状态；非 DCS 生产就绪证据 |
| A2 | Sustained-Development-Playbook.md | `docs/dev/` | E1 | 长期成熟度工作流；非 DCS 生产就绪证据 |
| A3 | full-chain-maturity-audit-2026-08-02.md | `docs/dev/` | E1 | 全链路审计；checkpoint restore WIP 未注册 |
| A4 | default-config-matrix.md | `docs/dev/` | E1 | 默认配置矩阵；VToken/Memory/SEKB 全 default-off |
| B5 | star-principles-and-development-philosophy-2026-08-02.md | `docs/dev/` | E1 | 设计哲学 |
| B6 | dcs-first-context-engineering.md | `docs/dev/` | E1 | DCS 设计文档；§7 自陈"成本门控在生产之后" |
| B7 | architecture-philosophy-and-maturity-research-2026-08-02.md | `docs/dev/` | E1 | 架构哲学研究 |
| B8 | context-orchestrator.md | `docs/dev/` | E1 | Orchestrator 设计文档 |
| C9 | context-orchestrator.ts | `openclaw_runtime/src/context-engine/` | E0 | DEFAULT_STAGES=["memory","vtoken"]；只管 2 stage |
| C10 | context-candidate.ts | 同上 | E0 | ContextCandidate/v1 只有 text/authority/sourceId/channel/target；无 kind/epistemic/priority |
| C11 | turn-injection-budget.ts | 同上 | E0 | TURN_INJECTION_CHAR_BUDGET=6000 字符 flat pool；precedence 正确 |
| C12 | chat-turn-memory-injection.ts | 同上 | E0 | **wiring seam 非 semantic processor**；无压缩/去重/冲突判断；default-off；shouldInjectChatTurnMemory 是开关 gate |
| C13 | chat-turn-vtoken-injection.ts | 同上 | E0 | VToken packing layer；内部 token 预算 600（64-32000）；maxSourceChars=24000/maxSourceFiles=12 截断；default-off |
| C14 | assembler.ts | 同上 | E0 | 管 compass/role-memory/working-memory/tool-registry；**不拼 systemPrompt**（push {role:user}）；deferProjection 模式正确；消费共享 turn ledger |
| C15 | attempt.ts | `agents/embedded-agent-runner/run/` | E0 | **6 处 post-orchestrator systemPrompt 覆盖**：L3204(subagent)/L3923-3926(hooks-legacy 完整替换)/L3928-3940(hooks-prepend-append)/L3941-3952(media)/L3959-3968(model-identity+cache-boundary)/L4176-4184(runtime-context)；CVK L3283-3297 走 candidate 路径正确 |
| C16 | dispatch.ts | `auto-reply/` | E0 | 只做 delivery 编排；**不接触 systemPrompt/context authority**；间接共享 attempt.ts |
| C17 | gateway/server-methods/agent.ts | `gateway/` | E0 | **不直接调 attempt.ts**；通过 agentCommandFromIngress；L2527-2529 注释"Context Orchestrator runs on embedded attempt. Gateway passes base extraSystemPrompt through unchanged"——**干净透传，无第二拼接点** |
| C18 | prod-flags-catalog.ts | `shared/dcs/` | E0 | 14 flag；assertCatalogDefaultHonesty() 强制 8 个 default=false + worktree-backend='inprocess' + isolation-request='shared'；唯一 baseline-on 是 write-journal |
| D19 | context-candidate.test.ts | `context-engine/` | E2 | 4 用例；只测 dedup/precedence/budget-truncate/skip；**未测 kind/epistemic.status/priority/freshness/sensitivity/merge/evidenceRefs/admission 四态/receipt replay** |
| D20 | context-orchestrator.test.ts | 同上 | E2 | 9 用例全单轮 mock；**无 tool loop/retry/compact/fork/handoff 测试**；未用 ScriptedLlmDriver 或真实 provider；未验证"一次编译"契约 |
| D21 | default-config-matrix.test.ts | `tests/unit/` | E2/E3 | 锁定 VToken/Memory/SEKB 全 default-off；md↔fixture↔实现 byte-for-byte 三方比对（FP-P0-07）；无 default-ON 测试（除 browser-private-network DENY） |
| D22 | first-product-controlled-preview/STATUS.md | `docs/dev/` | E1 | **liveReady=false / productApproved=false / defaultOn=false（硬锁）**；L3 真人 0/10；agent-surrogate 10/10/10 降级为 degraded-agent-complete；Hard lock #4 禁止用单测/E2E 冒充 live 证据 |
| D23 | agent-dev-audit/report.json | `artifacts/` | E3（age-stale） | 97/100 grade A release-grade；**但只覆盖 Agent Dev 控制面非 DCS 生产就绪**；生成 2026-07-03 超 24h 窗口 age-stale；disqualifiers=[] |
| D24 | uas-06-single-local-exec-canary/real-cohort-report.json | `artifacts/` | E2/E3 | **qualification: no-live-observations**；liveObservations=0/providerReceipts=0/humanReviews=0/realProviderUsage=0；9 engineering scenarios 通过但 0 live；status: needs-real-canary；productGraduationAuthorized: false |
| E25-27 | codex-main/docs/{sandbox,execpolicy,agents_md}.md | 本地 | E0（stub） | **全部占位 stub，纯外链零本地内容**；要对照需读 codex-rs/ Rust 源码 |
| E29 | aider-main/aider/repomap.py | 本地 | E0 | 867 行；PageRank+personalization+二分 token 拟合（默认 1024）；单源（代码符号）无多源去重/冲突/lineage/epistemic |
| E30 | aider-main/aider/coders/base_coder.py | 本地 | E0 | 2485 行；format_chat_chunks() 8 段拼接非编译；无 IR/pass/优化器；summarize_start 替换原历史非并行记忆通道 |

---

## 3. attempt.ts systemPrompt 覆盖点精确矩阵

| Line | 赋值主体 | 路径类型 | 是否绕过 Orchestrator |
|---|---|---|---|
| L2052 | `orchestratedExtraSystemPrompt = contextOrchestration.extraSystemPrompt` | orchestrator 输出 | 否（这是 orchestrator 本身） |
| L2053-2059 | `effectiveExtraSystemPrompt = [orchestrated, runtimeIntensity, degradationNotice].join` | orchestrator+intensity 拼接 | 部分（intensity 在 orchestrator 后追加） |
| L2123 | `appendPrompt = attemptSystemPrompt.systemPrompt` | 快照变量 | 否（只读快照） |
| L2180 | `let systemPromptText = attemptSystemPrompt.systemPrompt` | 主变量声明 | 否（首次赋值） |
| L2537-2540 | `setActiveSessionSystemPrompt = (next) => { systemPromptText = next; ... }` | 闭包 setter | —（这是后续覆盖的入口） |
| L2541 | `setActiveSessionSystemPrompt(systemPromptText)` | 首次应用 | 否 |
| **L2557** | `setActiveSessionSystemPrompt("")` | raw-model 清空 | **是** |
| **L3204-3216** | `setActiveSessionSystemPrompt(prependSystemPromptAddition({..., systemPromptAddition: activeSubagentPromptAddition}))` | subagent prepend | **是** |
| L3283-3297 | `collectContextOrchestratorCandidate(injectionTurnId, {...text: assembled.systemPromptAddition})` | CVK candidate 收集 | **否（唯一正确路径）** |
| **L3923-3926** | `if (legacySystemPrompt) setActiveSessionSystemPrompt(legacySystemPrompt)` | hooks-legacy 完整替换 | **是（最强破坏点）** |
| **L3928-3940** | `setActiveSessionSystemPrompt(composeSystemPromptWithHookContext({baseSystemPrompt: systemPromptText, prependSystemContext, appendSystemContext}))` | hooks-prepend-append | **是** |
| **L3941-3952** | `setActiveSessionSystemPrompt(prependSystemPromptAddition({systemPrompt: ensureSystemPromptCacheBoundary(systemPromptText), systemPromptAddition: mediaTaskSystemPromptAddition}))` | media-task | **是** |
| **L3959-3968** | `if (modelAwareSystemPrompt !== systemPromptText) setActiveSessionSystemPrompt(modelAwareSystemPrompt)` | model-identity+cache-boundary | **是** |
| **L4176-4184** | `setActiveSessionSystemPrompt(composeSystemPromptWithHookContext({baseSystemPrompt: systemPromptText, appendSystemContext: runtimeSystemContext}))` | runtime-context | **是** |

**结论**：7 处覆盖（L2557/L3204/L3923/L3928/L3941/L3959/L4176），其中 6 处绕过 Orchestrator；CVK（L3283）是唯一正确路径。

---

## 4. 测试覆盖缺口矩阵

| 缺口 | context-candidate.test.ts | context-orchestrator.test.ts | default-config-matrix.test.ts | 需补测试 |
|---|---|---|---|---|
| kind 字段 | ❌ 未测 | ❌ 未测 | N/A | Phase 1 |
| epistemic.status 字段 | ❌ 未测 | ❌ 未测 | N/A | Phase 1 |
| priority 字段 | ❌ 未测 | ❌ 未测 | N/A | Phase 1 |
| freshness/sensitivity/merge/evidenceRefs | ❌ 未测 | ❌ 未测 | N/A | 推迟 |
| admission 四态 (pass_fast/pass_mem/defer/drop) | ❌ 未测 | ❌ 未测 | N/A | Phase 2 |
| receipt replay / bit-for-bit prompt 重建 | ❌ 未测 | ❌ 未测 | N/A | Phase 1 |
| tool loop | N/A | ❌ 未测（9 用例全单轮） | N/A | Phase 1 |
| retry | N/A | ❌ 未测 | N/A | Phase 1 |
| compact | N/A | ❌ 未测 | N/A | Phase 2 |
| fork | N/A | ❌ 未测 | N/A | Phase 2 |
| handoff | N/A | ❌ 未测 | N/A | Phase 2 |
| 真实 provider (非 mock) | N/A | ❌ 未用 | N/A | Phase 2 E4 |
| default-off 锁定 | N/A | N/A | ✅ 测（VToken/Memory/SEKB 全 default-off + 三方比对） | 已覆盖 |

---

## 5. 成熟产品对照矩阵

| 维度 | ClawX DCS-first | Aider | Codex CLI（本地可见） |
|---|---|---|---|
| context compiler | 有（设计目标） | **无**（format_chat_chunks 8 段拼接） | 不可见（docs 是 stub） |
| 多源去重 | 有（contentDigest sha256） | **无**（to_tree 单向跳过） | 不可见 |
| 冲突解决 | 有（设计目标，未实现） | **无**（放任 LLM 自辨） | 不可见 |
| lineage | 有（disposition+reason+degradationOrder） | **无**（消息只有 role） | 不可见 |
| epistemic status | 有（设计目标，未实现） | **无**（所有消息平等） | 不可见 |
| admission 分流 | 有（设计目标，未实现） | **无**（只有 check_tokens 超限问用户） | 不可见 |
| fast-path / mem-path | 有（设计目标，未实现） | **无**（只有 map_refresh=manual 缓存返回） | 不可见 |
| token 预算 | 6000 char flat pool | 1024 token + 二分拟合 | 不可见 |
| 相关性排序 | precedence（correctness 优先） | PageRank + personalization | 不可见 |

**结论**：DCS 想解决的 4 维度（多源去重/冲突/lineage/epistemic）在 Aider 完全不存在。DCS-first 不是"对 Aider 的复杂化"，是填补 Aider 回避的空白。代价是 ClawX 无法通过"简化 Aider 实现"得到 DCS。

---

## 6. 关键事实 vs 设计目标 vs 未验证假设

| 类型 | 事实 | 证据 |
|---|---|---|
| **当前已实现的事实** | ContextCandidate/v1 只有 text/authority/sourceId/channel/target | context-candidate.ts:15-28（E0） |
| **当前已实现的事实** | Orchestrator 只管 memory+vtoken 2 stage | context-orchestrator.ts:128（E0） |
| **当前已实现的事实** | 6000 char flat pool 字符截断 | turn-injection-budget.ts:67（E0） |
| **当前已实现的事实** | attempt.ts 6 处 post-orchestrator 覆盖 | attempt.ts:2557/3204/3923/3928/3941/3959/4176（E0） |
| **当前已实现的事实** | chat-turn-memory-injection 是 wiring seam 非 semantic processor | chat-turn-memory-injection.ts:8-16 自陈（E0） |
| **当前已实现的事实** | gateway 干净透传无第二拼接点 | agent.ts:2527-2529 注释（E0） |
| **当前已实现的事实** | CVK 走 candidate 路径正确 | attempt.ts:3283-3297 + 注释（E0） |
| **当前已实现的事实** | 8 flag default=false 断言守卫 | prod-flags-catalog.ts:261-288（E0） |
| **当前已实现的事实** | STATUS.md liveReady=false 硬锁 | STATUS.md（E1） |
| **当前已实现的事实** | real-cohort no-live-observations | real-cohort-report.json（E2/E3） |
| **设计目标（未实现）** | ContextUnit/v1 的 kind/epistemic.status/priority/freshness/sensitivity/merge/evidenceRefs | 设计文档 §4；代码中不存在 |
| **设计目标（未实现）** | admission 在成本之前的 fast/mem/defer/drop 分流 | 设计文档 §7 自陈"在生产之后" |
| **设计目标（未实现）** | 一次编译、一个不可变 bundle | 设计文档 §1；attempt.ts 6 处覆盖反证 |
| **设计目标（未实现）** | Mem 是选择性语义处理器 | 设计文档；chat-turn-memory-injection.ts 是 wiring seam |
| **设计目标（未实现）** | Working Context 是 task-scoped 统一对象 | 设计文档；代码中不存在容器 |
| **设计目标（未实现）** | unit-aware packing | 设计文档 §5.1 推到 P2；当前是字符截断 |
| **未验证假设** | bundle 可重放 | 无 receipt replay 测试；进程内 Map turn 后删除 |
| **未验证假设** | agent-dev-audit 97/100 = DCS 生产就绪 | 范围不符（只 Agent Dev）+ 30 天 age-stale |
| **未验证假设** | agent-surrogate 10/10/10 可外推为真人证据 | STATUS.md 显式降级 degraded-agent-complete |
