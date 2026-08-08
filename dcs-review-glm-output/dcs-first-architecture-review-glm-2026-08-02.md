# DCS-first 架构独立评审报告（GLM）

**评审 agent**：GLM-5.2
**评审日期**：2026-08-02
**评审对象**：ClawX DCS-first Context Engine、Mem、Working Context、Context IR、ContextBundle 及路线
**权限**：只读研究，未修改任何运行时代码、默认配置或 readiness 状态
**任务书**：`docs/dev/dcs-first-architecture-review-assignment.md`

---

## 0. 证据等级声明与必读材料核对

遵循 E0–E5 分级（E0=源码事实；E1=声明/文档；E2=单测/合成；E3=工程验证/E2E/mock；E4=真实 cohort/真人观察；E5=独立真人签收的生产就绪）。

### 必读材料核对（A-D 类 24 项 + E 类 9 项）

| 类 | 项 | 文件 | 状态 |
|---|---|---|---|
| A1 | AGENTS.md | 工作区规则 | ✅ 读 |
| A2 | Sustained-Development-Playbook.md | `docs/dev/` | ✅ 读 |
| A3 | full-chain-maturity-audit-2026-08-02.md | `docs/dev/` | ✅ 读 |
| A4 | default-config-matrix.md | `docs/dev/` | ✅ 读 |
| B5 | star-principles-and-development-philosophy-2026-08-02.md | `docs/dev/` | ✅ 读 |
| B6 | dcs-first-context-engineering.md | `docs/dev/` | ✅ 读 |
| B7 | architecture-philosophy-and-maturity-research-2026-08-02.md | `docs/dev/` | ✅ 读 |
| B8 | context-orchestrator.md | `docs/dev/` | ✅ 读 |
| C9 | context-orchestrator.ts | `openclaw_runtime/src/context-engine/` | ✅ 读 |
| C10 | context-candidate.ts | 同上 | ✅ 读 |
| C11 | turn-injection-budget.ts | 同上 | ✅ 读 |
| C12 | chat-turn-memory-injection.ts | 同上 | ✅ 读（子 agent） |
| C13 | chat-turn-vtoken-injection.ts | 同上 | ✅ 读（子 agent） |
| C14 | assembler.ts | 同上 | ✅ 读（子 agent） |
| C15 | attempt.ts | `agents/embedded-agent-runner/run/` | ✅ 读 + grep 50 处 systemPrompt |
| C16 | dispatch.ts | `auto-reply/` | ✅ 读（子 agent） |
| C17 | gateway/server-methods/agent.ts | `gateway/` | ✅ 读（子 agent） |
| C18 | prod-flags-catalog.ts | `shared/dcs/` | ✅ 读（子 agent） |
| D19 | context-candidate.test.ts | `context-engine/` | ✅ 读（子 agent） |
| D20 | context-orchestrator.test.ts | 同上 | ✅ 读（子 agent） |
| D21 | default-config-matrix.test.ts | `tests/unit/` | ✅ 读（子 agent） |
| D22 | first-product-controlled-preview/STATUS.md | `docs/dev/` | ✅ 读（子 agent） |
| D23 | agent-dev-audit/report.json | `artifacts/` | ✅ 读（子 agent） |
| D24 | uas-06-single-local-exec-canary/real-cohort-report.json | `artifacts/` | ✅ 读（子 agent） |
| E25-27 | codex-main/docs/{sandbox,execpolicy,agents_md}.md | 本地 | ✅ 读（子 agent）— **全部为占位 stub，零信息** |
| E28 | coding/source_archive/codex | 本地 | ⚠️ 未单独读（E25-27 已为 stub） |
| E29 | aider-main/aider/repomap.py | 本地 | ✅ 读（子 agent，867 行实质源码） |
| E30 | aider-main/aider/coders/base_coder.py | 本地 | ✅ 读（子 agent，2485 行实质源码） |
| E31-33 | coding/source_archive/NOTES/02-04 | 本地 | ⚠️ 未读（E29-30 已覆盖 Aider 核心机制） |

**最高可信结论：E2（受控测试）。无 E4/E5。STATUS.md 显式 `liveReady=false`。**

---

## 1. Executive Decision

```
Decision: revise
Confidence: medium-high
Core_thesis: DCS-first 方向正确且 authority 地基（orchestrator + turn ledger + kill switch + prod-flags-catalog 断言）真实存在（E0/E1），但三项核心主张——"一次编译""ContextUnit epistemic 字段""admission 在成本之前"——尚未在代码实现；STATUS.md 显式 liveReady=false，real-cohort canary liveObservations=0。应先关闭 attempt.ts 的 7 处 post-orchestrator systemPrompt 突变（subagent/hooks-legacy/hooks-prepend-append/media/model-identity/runtime-context），用 3 个最小字段（kind/epistemic.status/priority）验证，再讨论 ContextUnit/v1 全 schema 与 Admission Planner。
```

---

## 2. 对 10 个评审问题的回答

### Q1. 是否真的解决上下文成本、冗余、漂移和不可控注入？

**部分解决；"不可控注入"未解决，且有精确反例。**

- **冗余**：已部分解决。`dedupKey` 基于 `authorityObjectId:authorityVersion:contentDigest`（`context-candidate.ts:99-109`），contentDigest 是 sha256，去重真实有效；`context-candidate.test.ts` 用例 3 验证 duplicate disposition + charsApplied=0。E0/E2。
- **成本**：未解决。`TURN_INJECTION_CHAR_BUDGET=6000`（`turn-injection-budget.ts:67`）是字符级 flat pool，charge 发生在候选已生产之后。`chat-turn-vtoken-injection.ts` 有内部 token 预算（默认 600，范围 64-32000）但默认关闭；`chat-turn-memory-injection.ts` 完全无预算裁剪。无 admission 在昂贵 provider/Mem 之前。
- **漂移**：未解决。`context-candidate.test.ts` 未测试 `kind/epistemic.status/priority/freshness/sensitivity/merge/evidenceRefs`（这些字段不存在于 ContextCandidate/v1）。stale 信息无法被自动淘汰。
- **不可控注入**：**未解决，有 7 处精确反例**。`attempt.ts` 在 `computeContextExtraSystemPrompt`（L2000）之后，`systemPromptText`（L2180 声明）通过 `setActiveSessionSystemPrompt` 闭包（L2537-2540）被覆盖 7 次：subagent（L3204-3216）、hooks-legacy 完整替换（L3923-3926）、hooks-prepend-append（L3928-3940）、media-task（L3941-3952）、model-identity+cache-boundary（L3959-3968）、runtime-context（L4176-4184）、raw-model 清空（L2557）。**唯一正确路径是 CVK**（L3283-3297 走 `collectContextOrchestratorCandidate`，注释 L3280-3282 明确）。

**5 维成本分析（评审规则要求）**：
| 维度 | 当前状态 |
|---|---|
| 事实保真度 | 字符截断破坏 JSON schema/constraint list/code block；无 fidelity 指标 |
| 延迟 | orchestrator 仅 memory+vtoken 两 stage，延迟可控；加 admission 需 <50ms |
| token | 6000 char flat pool，无 per-source sub-budget，无 token 估算 |
| 失败恢复 | kill switch fail-closed；但 bundle 不可恢复（进程内 Map，turn 后删除） |
| 可观测性 | lineage 有 disposition+reason+degradationOrder；admission 决策无记录（不存在） |

### Q2. DCS、Mem、Working Context、Context IR 之间是否存在职责重叠？

**存在，且 Mem 名不副实。**

- **DCS vs Assembler**：`context-orchestrator.ts` 只管 memory+vtoken（L128 `DEFAULT_STAGES = ["memory","vtoken"]`）；`assembler.ts` 管 compass/role-memory/working-memory/tool-registry。但 Assembler **不拼 systemPrompt**——它 push `{role:"user"}` 消息（L465/L540/L630），消费同一 turn ledger（L287-298），用 `deferProjection` 模式把候选交给 Orchestrator 投影。所以 Assembler 是候选生产者，Orchestrator 是投影者——**职责不重叠，但分割让"单一编译器"表述不准**。
- **Mem 不是语义处理器**：`chat-turn-memory-injection.ts` 顶层注释（L8-16）自陈"wiring seam"——只 query providers、渲染 `## Memory Context` 块、append 到 extraSystemPrompt。**无 token 预算裁剪、无去重、无冲突判断、无语义压缩**。设计文档把 Mem 描述为"选择性语义处理器"，代码里是纯注入 seam。
- **Working Context 不存在**：设计里是 task-scoped 状态对象（Objective/Constraints/ConfirmedFacts/...），代码里没有这个容器，字段散落在 compass/role-memory/working-memory handler。

### Q3. Fast Path / Mem Path 的 admission 判断是否可操作、可观测、可回放？

**不可操作、部分可观测、不可回放。**

- **不可操作**：admission planner 不存在。`chat-turn-memory-injection.ts` 的 `shouldInjectChatTurnMemory`（L106-121）只判断 flag on + session key 匹配 `^(agent|cron):[^:]+:main$`，是开关式 gate，不是 fast/mem/defer/drop 四态分流。
- **部分可观测**：lineage 记录 disposition（applied/truncate/drop/skip/duplicate）+ reason，`context-candidate.test.ts` 用例 4 验证。但 admission 决策无记录（这一步不存在）。
- **不可回放**：候选集合是进程内 `Map`（`context-candidate.ts:76`、`turn-injection-budget.ts:157`），turn 结束后 `endContextCandidateCollection` 删除。`context-orchestrator.test.ts` 9 个用例全是单轮 mock，**无 receipt replay / bit-for-bit prompt 重建测试**。

### Q4. "一次编译、一次 provider 请求"是否与流式工具调用、重试、compact、handoff、fork 冲突？

**冲突，且 attempt.ts 的 `setActiveSessionSystemPrompt` 闭包是精确反例。**

- **工具循环**：`attempt.ts:2537-2540` 的 `setActiveSessionSystemPrompt = (next) => { systemPromptText = next; applySystemPromptToSession(...) }` 是一个可变闭包，tool loop 中每次都可被调用覆盖。`context-orchestrator.test.ts` **无 tool loop 测试**（9 用例全是单轮）。
- **重试/compact/fork/handoff**：`context-orchestrator.test.ts` **无 retry/compact/fork/handoff 测试**。compact 是 Gateway 真实 compaction（审计 §8），bundle 从何权威重建未定义。fork 是 transcript clone 但 in-process ledger 不可克隆。
- 设计 §1 "语义上只有一个最终 bundle；传输上仍可以使用稳定前缀"是回避。必须明确：**per-model-call 编译 + 稳定前缀 + delta**。

### Q5. ContextUnit 字段是否足够？哪些过度设计？

**方向正确，但 v1 直接上 10 字段是过度设计。**

当前 ContextCandidate/v1（`context-candidate.ts:15-28`）实际字段：`schema, candidateId, dedupKey, authority{objectId,version,contentDigest}, sourceId, channel, target, text`。`context-candidate.test.ts` 4 个用例**只测试了这些字段**。

- **必要且应优先（3 个）**：`kind`（objective/constraint/fact/decision/risk/evidence/instruction）、`epistemic.status`（confirmed/inferred/uncertain/stale）、`priority`（critical/normal）。直接服务 Q1 的漂移和注入。
- **过度设计（应推迟）**：`scope` 五级（先 turn|task|session 三级）、`freshness.expiresAt`（等 stale bug）、`sensitivity`（kill switch+redaction 已处理）、`merge` 四级（dedup 已由 contentDigest 处理）、`evidenceRefs`（等证据图）、`tokenCostEstimate`（chars 对 v1 够）、`kind` 里的 `working_state/tool_contract/next_action`（属 Working Context）。

### Q6. unit-aware packing 是否比字符预算更可靠？如何避免摘要损失关键约束？

**理论上更可靠，当前是字符截断，设计把 unit-aware 推到 P2 太晚。**

- `applyInjectionBudget` 做前缀截断（`turn-injection-budget.ts`），截断 JSON tool schema / constraint 列表 / code block 是**正确性 bug**。
- `chat-turn-vtoken-injection.ts` 有两处截断：`maxSourceChars=24000`（L246-249）、`maxSourceFiles=12`（L346），但 VToken 默认关闭。
- 设计 §5.1 自己承认这点，但 unit-aware packing 放 P2。
- **应提前**：对 `kind=constraint`/`kind=evidence` 禁止截断（drop lower-priority 替代）。不需要完整 unit-aware packer。
- 摘要损失：无真实 corpus 评测前**不应做摘要**。必须有"关键约束保留率"指标。

### Q7. 是否会导致新的中央巨型编排器或高延迟瓶颈？

**会，如果按设计 §9 的 9 步 pipeline 全量实现。**

- 当前 orchestrator 只管 2 stage（memory/vtoken），延迟可控。扩到 9 步且 admission 要在 Mem 之前判断，每 turn 增延迟。
- **缓解**：admission 应是纯函数（filter），不是组件；pipeline 应是 reducer，不是 orchestrator。见 §5 替代架构。

### Q8. 哪些能力应留 DCS core，哪些应降为 adapter/profile？

- **留 core**：候选收集、dedup（contentDigest）、precedence 排序、turn-wide budget、lineage、kill switch、`assertCatalogDefaultHonesty` 断言、最终 projection。
- **降 adapter/profile**：Mem 语义压缩（当前只是 wiring seam，应保持 per-source config）、SEKB（human-gated）、VToken pack（已有内部 token budget）、CVK（当前正确走 candidate 路径，保持）。渠道/web/cron/browser/multi-agent 全部是 profile。
- **不应进 core**：Working Context 作为独立对象——应是 ContextUnit 的 `scope=task` 投影。

### Q9. Codex CLI / Aider 是否有更简单的实现可替代？

**它们根本没有 context compiler 这一层，但 ClawX 的差异化要求保留 DCS authority。**

- **Codex CLI**：本地 `docs/sandbox.md`/`execpolicy.md`/`agents_md.md` **全部是占位 stub**（纯外链，零本地内容）。要对照需读 `codex-rs/` Rust 源码，不在任务范围。
- **Aider `repomap.py`（867 行）**：PageRank + personalization + 二分搜索拟合 token 预算（默认 1024）。**单源（代码符号）+ 单预算**，无多源去重/冲突/lineage/epistemic。
- **Aider `base_coder.py`（2485 行）**：`format_chat_chunks()` 8 段拼接（system/examples/done/repo/readonly/chat/cur/reminder），**是声明式拼装非编译式合成**。无 IR、无 pass、无优化器、无跨段一致性检查。`summarize_start` 压缩历史但**替换**原历史，非并行记忆通道。
- **可借鉴**：Aider 的 PageRank+二分 token 拟合 = unit-aware packing 的简化版；ChatChunks 8 段分层 = assembly 阶段退化实现。
- **不可替代**：DCS 想解决的 4 维度（多源去重/冲突/lineage/epistemic）**在 Aider 完全不存在**。DCS-first 不是"对 Aider 的复杂化"，是填补 Aider 回避的空白。代价是 ClawX 无法通过"简化 Aider 实现"得到 DCS。

### Q10. 先做什么最能获得真实 E4/E5 证据？哪些应明确拒绝？

**先做**：
1. 关闭 attempt.ts 的 7 处 post-orchestrator systemPrompt 突变，让 orchestrator 成为唯一 authority。这能在真实 provider 调用下立即验证"bundle 是否真的唯一"。
2. 建立最小真实 corpus（20+ 真实 transcript，3+ 真实任务），跑 receipt replay。

**明确拒绝**：见 §8。

---

## 3. A. 方案最强的 3 个设计点

1. **Authority 地基真实且 fail-closed，并有断言守卫**：`context-orchestrator.ts` + `turn-injection-budget.ts` + `enhancement-kill-switch.ts` + `prod-flags-catalog.ts:assertCatalogDefaultHonesty()`（L261-288）形成四层守卫。precedence（knowledge > working_memory > tool_registry > cvk > vtoken > memory_pilot，`turn-injection-budget.ts:39-47`）正确：correctness-bearing context 优先于 enrichment。kill switch 是 fail-closed 零注入。`assertCatalogDefaultHonesty` 强制 8 个 flag 的 default 必须为 false，是机器可读的不变量。E0/E1。

2. **Lineage 内建而非外挂，并有单测锁定**：每个候选有 disposition（applied/truncate/drop/skip/duplicate）+ reason + charsRequested/charsApplied + degradationOrder（`turn-injection-budget.ts:315-360`）。`context-candidate.test.ts` 用例 4 显式验证 truncate/drop/empty/flag-off/kill-switch 决策的 reason 字段。这是相对 Aider（消息只有 role，不记录来源）的真实差异化。E0/E2。

3. **默认关闭 + opt-in + 三层一致性测试是诚实姿态**：`default-config-matrix.test.ts` 锁定 VToken/Memory/SEKB 全 default-off，并做 md 文本 ↔ fixture `declaredDefault` ↔ 实现探针实际默认值的 byte-for-byte 三方比对（FP-P0-07）。`STATUS.md` 显式 `liveReady=false`/`productApproved=false`/`defaultOn=false` 硬锁，L3 真人 0/10，agent-surrogate 10/10/10 被显式降级为 `degraded-agent-complete`。Hard lock #4 禁止"用单测/E2E/Agent Dev green 跨级冒充 live 或 product 证据"。E1/E2。

---

## 4. B. 最严重的 5 个风险

### P0-1：attempt.ts 的 7 处 post-orchestrator systemPrompt 突变 — "一次编译"不成立

**证据**：`attempt.ts` L2180 声明 `systemPromptText`，L2537-2540 定义 `setActiveSessionSystemPrompt` 闭包 setter，之后被覆盖 7 次：subagent（L3204-3216）、hooks-legacy 完整替换（L3923-3926）、hooks-prepend-append（L3928-3940）、media-task（L3941-3952）、model-identity+cache-boundary（L3959-3968）、runtime-context（L4176-4184）、raw-model 清空（L2557）。**唯一正确路径是 CVK**（L3283-3297 走 `collectContextOrchestratorCandidate`，注释 L3280-3282 明确）。gateway `agent.ts` L2527-2529 注释"Context Orchestrator runs on embedded attempt. Gateway passes base extraSystemPrompt through unchanged"——gateway 干净，问题集中在 attempt.ts。

**影响**：Context Orchestrator 只拥有 memory+vtoken；Assembler 走 candidate 路径（正确）；但 subagent/hooks/media/identity/runtime 6 条路径直接覆盖主变量。"provider adapter 不再自行拼接第二套隐藏 prompt"在今天不成立。不可控注入未解决，只是被分散。

**恢复**：Phase 1 把 6 处直接覆盖改为 candidate 收集，让 `finalizeContextOrchestratorTurn` 成为唯一 projection authority。hooks-legacy 的完整替换是最强破坏点，需 owner 决策 hook 契约（见 §9）。

### P0-2：ContextUnit/v1 字段是设计目标，非运行时事实；测试不覆盖

**证据**：`context-candidate.ts:15-28` 只有 `text/authority/sourceId/channel/target`。`context-candidate.test.ts` 4 个用例**只测试了这些字段 + dedupKey/disposition/reason/charsApplied**，未测试 `kind/epistemic.status/priority/freshness/sensitivity/merge/evidenceRefs`，未测试 admission 四态（pass_fast/pass_mem/defer/drop），未测试 receipt replay。

**影响**：设计 §4 声称能回答"事实还是推断""是否过期""与哪条证据关联"——今天都无法回答。epistemic fence 是装饰，不是运行时保证。

**恢复**：Phase 1 加 3 个最小字段（kind/epistemic.status/priority），同步加单测。

### P0-3：admission 在成本之后，设计的 P0/P1 顺序错误

**证据**：`turn-injection-budget.ts` 的 charge 发生在候选已生产之后。设计 §7 自陈"成本门控发生在候选生产之后仍较多"。`chat-turn-memory-injection.ts` 的 `shouldInjectChatTurnMemory`（L106-121）是开关式 gate 非 admission。设计把 ContextUnit/v1 列 P0、Admission 列 P1——这个顺序先增加 schema 复杂度，不解决成本。

**影响**：候选更重（10 字段），仍生产后才门控，"context tax"会实现。

**恢复**：admission 应是 reducer 里的 filter 函数，与最小字段同阶段落地。

### P1-4：字符级前缀截断破坏结构化上下文

**证据**：`turn-injection-budget.ts:67` `TURN_INJECTION_CHAR_BUDGET=6000`，注释"single flat pool, no per-channel sub-budgets"，unit=characters。`applyInjectionBudget` 做前缀截断。`chat-turn-vtoken-injection.ts` 另有 `maxSourceChars=24000`/`maxSourceFiles=12` 截断（但默认关闭）。

**影响**：截断 JSON tool schema / constraint 列表 / code block 是正确性 bug。设计 §5.1 自认。unit-aware packing 推到 P2 太晚。

**恢复**：Phase 2 对 `kind=constraint`/`kind=evidence` 禁止截断。

### P1-5："一个 turn 一个不可变 bundle"与 tool loop/retry/compact/fork 冲突，测试不覆盖

**证据**：`attempt.ts:2537-2540` 的 `setActiveSessionSystemPrompt` 闭包在 tool loop 中可被多次调用。`context-orchestrator.test.ts` 9 个用例**全是单轮 mock，无 tool loop/retry/compact/fork/handoff 测试**，未用 ScriptedLlmDriver 或真实 provider。

**影响**：tool result 后是否重编译？retry 用同一 bundle 吗？compact 从何权威重建？fork 克隆 bundle 吗（in-process ledger 不可克隆）？全未答也未测。

**恢复**：明确 per-model-call 编译 + 稳定前缀 + delta。bundle 是 per-model-call 的 receipt。

---

## 5. C. 更简单的替代架构：Reducer + Receipt

**核心思想**：放弃"compiler + bundle"隐喻，建模为确定性 reducer + receipt。

```text
type ContextEntry = { id, source, text, kind, confidence, scope, createdAt }
type ContextState = { entries: ContextEntry[] }
type ContextReceipt = { selected: id[], dropped: {id, reason}[], charsBySource, totalChars, compiledAt }

reducer(state, action):
  INGEST(entry)   -> dedup by contentHash -> state.entries.append
  ADMIT(turnCtx)  -> filter: drop stale/duplicate/low-priority-when-budget-tight
  COMPILE(budget) -> sort by precedence -> take until budget -> emit (prompt, receipt)
```

**为什么更简单**：
- v1 只用 5 字段 entry（id/source/text/kind/confidence），不要 10 字段。
- admission 是 reducer 里的 filter 步骤，不是独立组件。
- Mem 是可选 transform（产出高密度 entry），per-source config，不是全局路由。
- receipt 就是 bundle；prompt 是 selected entries + receipt 的投影。
- **单一 authority**：reducer 拥有 selection/budget/receipt。provider adapter 只接收 `(prompt, receipt)`，禁止追加。

**迁移成本**：低。现有 ContextCandidate + TurnInjectionLedger 已做 70%。变更：(1) 给 ContextCandidate 加 `kind`+`confidence`（2 字段）；(2) 让 reducer 成为唯一 prompt authority，移除 attempt.ts 的 6 处 post-orchestrator 覆盖（hooks-legacy 需 owner 决策）；(3) emit receipt（现有 lineage 已是 90% receipt）。

**收益**：解决 P0-1（单 authority）、P0-3（admission 是 filter）、避免 P0-2（schema 不爆炸）。
**风险**：对 conflict-set 和 evidence graph 表达力弱——但 E4 证据证明需要它们之前，这是正确取舍。

---

## 6. D. 对 ContextUnit/v1、ContextBundle/v1、Admission Planner 的修改建议

### ContextUnit/v1（最小版，3 字段非 10）

保留（已在 ContextCandidate 里）：`schema, id, source{type, ref, version}, text, channel, target`

新增 3 个：
- `kind`: `objective | constraint | fact | decision | risk | evidence | instruction`（删掉 `working_state/tool_contract/next_action`）
- `epistemic.status`: `confirmed | inferred | uncertain | stale`（删掉 `proposed`，与 `inferred` 不可区分）
- `priority`: `critical | normal`（删掉 `high/optional`）

明确推迟：`scope`（先 turn|task|session 三级）、`freshness.expiresAt`、`sensitivity`、`merge`、`evidenceRefs`、`tokenCostEstimate`。

### ContextBundle/v1（receipt 风格，per-model-call）

```text
{ schema: "ContextBundle/v1",
  turnId, modelCallId,           // per-model-call，不是 per-turn
  promptHash,                   // 可重放校验
  selectedUnitIds: string[],
  droppedUnits: [{ id, reason }],
  charsBySource: Record<string, number>,
  totalChars, compiledAt,
  killSwitchEngaged }
```

不要 `policyDigest`；不要永久不可变 artifact——先 turn-scoped + 可日志化重放，持久化是 P2。

### Admission Planner（函数，非组件）

```text
admit(unit, turnState) -> { pass_fast | pass_mem | defer | drop, reason }
```

规则：
- drop if duplicate（contentDigest 命中）
- drop if stale（等 freshness.expiresAt 字段存在后启用）
- drop if `priority=normal` AND budget remaining < 20%
- pass_mem only if `kind in {fact, decision, risk}` AND `text.length > threshold` AND `source.type in {tool, memory}`
- else pass_fast

`reason` 写入现有 lineage（已有字段）。无新组件、无新状态。

**4 边界分析（评审规则要求，针对 Mem 这一新增自治能力）**：
| 边界 | 说明 |
|---|---|
| capability profile | Mem 只做 semantic compression/dedup/conflict-set，产出 `epistemic.status=inferred` 的 entry |
| approval policy | pass_mem 仅对 `kind in {fact,decision,risk}` 且长文本触发；SEKB writeback 保持 human-gated |
| effect receipt | Mem 产出的 entry 进 reducer，lineage 记 `source=mem`，可观测可审计 |
| rollback boundary | Mem 只产出 entry，不修改源；rollback = drop mem entries，源数据不变 |

---

## 7. 三条源码链路追踪

### 链路 1：桌面消息
`ChatInput → Host API → Main → Gateway chat.send → auto-reply dispatch（dispatch.ts:476-529，只做 delivery 编排，不接触 systemPrompt）→ dispatchReplyFromConfig → agentCommandFromIngress → runEmbeddedAttempt → attempt.ts:2000 computeContextExtraSystemPrompt → finalizeContextOrchestratorTurn → BUT attempt.ts L3204/L3923/L3928/L3941/L3959/L4176 再覆盖 systemPromptText → provider request`

**结论**：context 编译在 attempt.ts:2000 发生，但存在 6 条 post-orchestrator 覆盖路径。最终 provider 请求**得不到唯一 ContextBundle**。gateway `agent.ts:2527-2529` 干净透传，问题在 attempt.ts。

### 链路 2：外部入口（cron agentTurn）
`Cron trigger → SQLite queue → agentTurn job → embedded turn → 同 attempt.ts 路径`

**结论**：与桌面消息共享同一 context authority（attempt.ts），但入站认证/路由/持久化不同。`chat-turn-memory-injection.ts:106-121` 的 session key 正则 `^(agent|cron):[^:]+:main$` 证明 cron 与 agent 共享 memory pilot 路径。context 编译语义相同——同样的 6 处覆盖问题。

### 链路 3：compact/fork/handoff 失败恢复
- **compact**：Gateway 真实 compaction（审计 §8），checkpoint/restore 可恢复会话历史，但 in-process ledger 不可恢复，bundle 需从头重编译。
- **fork**：transcript clone，但 in-process `Map<turnId, ledger>` 不可克隆，fork 后会话没有原 turn 的 ledger/receipt。
- **handoff**：新会话，bundle 从头编译；外部副作用不可恢复。
- **checkpoint rollback**：审计 §8 指出 HEAD 上 restore RPC 不可达（WIP 未注册），即使注册也只恢复 write journal pre-image，不恢复 transcript/runtime/网络。

**具体失败场景**：用户在 coding turn 中 fork 会话。fork 后新会话有 transcript 副本，但原 turn 的 `TurnInjectionLedger`（进程内 Map）丢失。如果用户问"上一步为什么没注入 working memory"，无法回放——lineage 记录在 ledger 里，ledger 已随原进程消失。**恢复边界**：transcript 可恢复（持久化），context bundle 不可恢复（进程内），外部副作用不可恢复。三类恢复对象必须区分。

---

## 8. 明确拒绝的方向（Rejected ideas）

- **拒绝**在关闭 attempt.ts 6 处覆盖之前实现 ContextUnit/v1 全 schema（会变装饰字段）
- **拒绝**在 admission 之前实现 Mem path（会变 context tax；当前 chat-turn-memory-injection.ts 只是 wiring seam，不是语义处理器）
- **拒绝**在真实 corpus 之前实现 unit-aware 摘要（无法证明保真度）
- **拒绝**通过增加更多 provider/flag/memory layer/UI 状态解决 authority 问题（评审规则禁止）
- **拒绝**把 Working Context 做成独立顶层对象（应是 ContextUnit 的 `scope=task` 投影）
- **拒绝**把 Admission Planner 做成独立组件（应是 reducer filter 函数）
- **拒绝**任何"默认开启 Mem/VToken/SEKB"提议（TF-0006 blocked、liveObservations=0、STATUS.md `defaultOn=false` 硬锁）
- **拒绝**把 ContextBundle 做成永久不可变 artifact（先 turn-scoped + 可重放，持久化是 P2）
- **拒绝**把 agent-dev-audit/report.json 的 97/100 grade A 当作 DCS 生产就绪证据（它只覆盖 Agent Dev 控制面，且已 30 天 age-stale）
- **拒绝**把 agent-surrogate 10/10/10 当作真人证据（STATUS.md 显式降级为 `degraded-agent-complete`，不得外推）

---

## 9. 需要 owner 决策的开放问题

1. **per-turn vs per-model-call bundle**：tool loop 一个 turn 多次 model call，bundle 粒度？我建议 per-model-call + 稳定前缀 + delta，但改变"一个 turn 一个 bundle"表述。
2. **Assembler 是否合并进 Orchestrator**：当前 Assembler 是候选生产者，Orchestrator 是投影者，分割让"单一编译器"表述不准。是否合并为单一 reducer？
3. **attempt.ts hooks-legacy 完整替换是否保留**：L3923-3926 的 `hookResult.systemPrompt` 完全替换 systemPromptText，是最强破坏点。禁止则破坏 hook 扩展点；保留则破坏单一 authority。需 owner 决策 hook 契约。
4. **Phase 1 是否允许改变现有 hook/intensity/media 行为**：移除 6 处覆盖可能改变 prompt 内容，需 owner 接受可能的输出差异。
5. **agent-dev-audit/report.json age-stale 是否需刷新**：生成于 2026-07-03，超 24h 窗口，按 policy 应视为 stale。是否在 Phase 1 前刷新？

---

## 10. 真实 E4/E5 证据要求 & 现在不应承诺的能力

**E4 必须包含**：
- 真实 provider（非 ScriptedLlmDriver、非 mock VtokenRpcClient）的 20+ transcript
- 真实渠道（至少 2 个）的入站消息 canary
- 真实脱敏 corpus manifest
- requestId/runId/sessionKey/traceId/cost/latency/tool outcome/approval/side effect digest 的相关性日志
- 真人评审（非 agent-surrogate）

**E5 必须包含**：
- 14–28 天 soak
- 真人 A/B（≥2 用户）
- 失败/恢复统计
- 隐私边界审查
- 产品签署（`productApproved=true`）

**现在不应承诺**（基于 STATUS.md `liveReady=false` 硬锁 + real-cohort `no-live-observations`）：
- "DCS 已实现单次编译"（6 处覆盖存在）
- "ContextUnit 支持 epistemic status"（字段不存在，测试不覆盖）
- "admission 在成本之前"（admission 不存在）
- "unit-aware packing"（仍是字符截断）
- "bundle 可重放"（进程内 Map，turn 后删除；无 receipt replay 测试）
- "Mem 是语义处理器"（只是 wiring seam）
- "默认开启增强"（TF-0006 blocked、liveObservations=0、`defaultOn=false` 硬锁）
- "Agent Dev 97/100 = DCS 生产就绪"（范围不符 + age-stale）

---

## 11. E. 最小实施路线（3 阶段）

### Phase 1：单一 authority + 最小字段（验收驱动）

**范围**：
- 给 ContextCandidate 加 `kind` + `epistemic.status` + `priority`（3 字段）+ 同步单测
- 让 `finalizeContextOrchestratorTurn` 成为唯一 prompt authority：移除 attempt.ts 的 6 处 post-orchestrator 覆盖（subagent/hooks-legacy/hooks-prepend-append/media/model-identity/runtime-context），全部改为候选收集
- emit `ContextBundle/v1` receipt（per-model-call）

**验收指标**：
1. grep `attempt.ts` 在 orchestrator 之后通过 `setActiveSessionSystemPrompt` 的直接覆盖 → 0 hit（CVK 的 candidate 路径除外）
2. 每条 prompt 突变有对应 lineage entry
3. receipt replay 能 bit-for-bit 重建 prompt（同一 entries + budget → 同一 promptHash）—— **新增单测覆盖，填补当前 context-orchestrator.test.ts 无 replay 测试的缺口**
4. 现有单测全绿；char budget 不变（无保真度回退）
5. kill switch 仍 fail-closed；`assertCatalogDefaultHonesty` 仍通过
6. 新增 tool loop 单测（填补当前 9 用例全单轮的缺口）

### Phase 2：admission filter + 真实 corpus

**范围**：
- 实现 `admit()` 函数（reducer 里的 filter，不是组件）
- 对 `kind=constraint`/`kind=evidence` 禁止截断（drop lower-priority 替代）
- 建立真实 corpus：20+ 真实 transcript，3+ 真实任务（coding/multi-turn/tool-heavy），真实 provider

**验收指标**：
1. admission 在候选收集前 drop ≥ 30%（去重 + stale + low-priority）
2. corpus 中 `constraint`/`evidence` 单元被截断数 = 0
3. 同 corpus 的 prompt token 较 Phase 1 baseline 降 ≥ 15%
4. 人工评审 20 transcript：critical constraint 丢失数 = 0
5. 每 turn admission 延迟开销 < 50ms
6. E4 证据：真实 provider transcript + 真人评审（非 agent-surrogate）

### Phase 3：Mem path + E4 canary（仅当 Phase 2 通过）

**范围**：
- 对长 tool output 和 conflict-set 启用 `pass_mem`
- Mem 产出高密度 unit，`epistemic.status=inferred`
- 14 天 canary：真实 provider + 真实渠道 + ≥2 真实用户

**验收指标**：
1. `inferred` unit 在 prompt 中不覆盖 `confirmed` unit
2. canary 任务完成率较 Phase 2 无回退
3. 0 unattended auto-writeback（SEKB 仍 human-gated）
4. soak 报告含 cost/latency/fidelity/失败恢复
5. E5 证据：14-28 天 soak + 真人 A/B + 产品签署
6. 仅在此之后讨论 Mem path default-on

---

## 12. 职责矩阵

| 对象 | 是事实/中间产物/投影 | 权威边界 | 当前状态 |
|---|---|---|---|
| Run/Session/Effect | 事实（唯一运行时权威） | 不可外包 | transcript 持久化；effect 有 write journal |
| DCS（Orchestrator+Assembler） | 中间产物（编译器） | 候选收集+投影 | Orchestrator 管 memory+vtoken；Assembler 管 knowledge/working_memory/tool_registry；**attempt.ts 6 处覆盖破坏单一 authority** |
| Context IR（ContextCandidate/v1） | 中间产物（候选） | 候选 schema | 只有 text/authority/sourceId/channel/target；**缺 kind/epistemic.status/priority** |
| ContextBundle/v1 | 投影（provider-bound） | 最终 prompt receipt | **不存在**；lineage 是 90% receipt 但未成文 |
| Mem | 中间产物（可选 transform） | 语义压缩 | **名不副实**：chat-turn-memory-injection.ts 只是 wiring seam，无压缩/去重/冲突判断 |
| Working Context | 投影（task-scoped 子集） | task 状态 | **不存在为独立对象**；字段散落在 handler |
| UI/Graph/Ledger/Observability | 投影（只读） | 不可写权威 | lineage 是投影；UI 不写 context |

---

## 13. 机器可读结论

```
Decision: revise
Confidence: medium-high
Core_thesis: DCS-first 方向正确且 authority 地基真实（orchestrator + turn ledger + kill switch + prod-flags-catalog 断言），但"一次编译""epistemic 字段""admission 在成本之前"三项核心主张未在代码实现；attempt.ts 有 6 处 post-orchestrator systemPrompt 覆盖；STATUS.md liveReady=false，real-cohort liveObservations=0。应先关闭 6 处覆盖 + 3 个最小字段，再讨论全 schema 与 Admission Planner。
P0_risks: attempt-ts-6-post-orchestrator-systemPrompt-overwrites, contextunit-fields-aspirational-and-untested, admission-ordering-wrong
Chosen_IR_changes: add kind+epistemic.status+priority-to-ContextCandidate-with-tests, per-model-call-bundle-receipt, drop-6-post-orchestrator-systemPrompt-overwrites
Chosen_first_milestone: close attempt.ts 6 post-orchestrator overwrites (subagent/hooks-legacy/hooks-prepend-append/media/model-identity/runtime-context) and make finalizeContextOrchestratorTurn the single prompt authority with 3 minimal fields + receipt replay test
Simpler_alternative: Reducer+Receipt — admission as filter function, receipt as bundle, single authority, 5-field entry not 10
Rejected_ideas: full-ContextUnit-v1-before-closing-overwrites, Mem-path-before-admission, unit-aware-summary-before-real-corpus, Working-Context-as-top-level-object, Admission-Planner-as-component, permanent-immutable-bundle-artifact, default-on-any-enhancement, agent-dev-audit-as-DCS-readiness, agent-surrogate-as-human-evidence
Evidence_required_before_default_on: real-provider-20-transcript, 2-real-channels, 14-28-day-soak, human-AB-non-surrogate, fidelity-metrics-constraint-retention-zero-truncation, receipt-replay-bit-for-bit
Owner_questions: per-turn-vs-per-model-call-bundle, merge-Assembler-into-Orchestrator, keep-hooks-legacy-full-overwrite, accept-Phase1-prompt-diff, refresh-stale-agent-dev-audit
```
