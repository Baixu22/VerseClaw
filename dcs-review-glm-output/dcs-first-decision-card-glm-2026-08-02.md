# DCS-first 架构评审决策卡 — GLM
# 生成时间: 2026-08-02
# 评审 agent: GLM-5.2
# 评审对象: ClawX DCS-first Context Engine
# 证据最高等级: E2 (受控测试); 无 E4/E5

```yaml
decision: revise
confidence: medium-high

core_thesis: >-
  DCS-first 方向正确且 authority 地基真实存在 (orchestrator + turn ledger + kill switch,
  E1/E2), 但三项核心主张 ("一次编译一次 provider 请求" / ContextUnit epistemic 字段 /
  admission 在成本之前) 尚未在代码中实现; 应先关闭 provider boundary 的多 systemPrompt
  突变点并加入 3 个最小字段验证, 再讨论 ContextUnit/v1 全 schema 与 Admission Planner。

strengths:
  - "Authority 地基真实且 fail-closed: context-orchestrator + turn-injection-budget + enhancement-kill-switch 已接线, precedence (knowledge>working_memory>tool_registry>cvk>vtoken>memory_pilot) 正确, kill switch 零注入"
  - "Lineage 内建: 每候选有 disposition+reason+charsRequested/charsApplied+degradationOrder, 可观测 '预算耗尽时牺牲了什么'"
  - "默认关闭 + opt-in + 测试锁定是诚实姿态: VToken/Memory/SEKB 全 default-off, 无 E4/E5 时不假装生产就绪"

p0_risks:
  - id: P0-1
    name: provider-boundary-multi-mutation-points
    evidence: "attempt.ts 在 computeContextExtraSystemPrompt (line 2000) 之后有 15+ 处 systemPrompt 赋值: 1984/2052/2123/2166/2538/3213/3923/3948/3960/4260/4329"
    impact: "一次编译不成立; orchestrator 只管 memory+vtoken, Assembler 单独管 knowledge/working_memory/tool_registry, CVK 是第三路径, hooks/intensity/identity/media 是第四五六路径; 不可控注入未解决只是被分散"
    fix: "Phase 1 移除所有 post-orchestrator 突变点, 全部改为候选收集, 让 finalizeContextOrchestratorTurn 成为唯一 projection authority"
  - id: P0-2
    name: contextunit-fields-aspirational
    evidence: "context-candidate.ts:15-28 只有 text/authority/sourceId/channel/target; 无 kind/epistemic.status/freshness/sensitivity/merge/evidenceRefs"
    impact: "无法区分 confirmed vs inferred, 无法过期 stale, 无法关联证据; epistemic fence 是装饰非运行时保证"
    fix: "Phase 1 加 3 个最小字段 (kind/epistemic.status/priority), 不要一次上 10 个"
  - id: P0-3
    name: admission-ordering-wrong
    evidence: "turn-injection-budget charge 发生在候选已生产之后; 设计 §7 自己承认 '成本门控发生在候选生产之后仍较多'; 设计把 ContextUnit/v1 列 P0, Admission 列 P1"
    impact: "先增加 schema 复杂度不解决成本; context tax (设计 §3.2 警告) 会实现"
    fix: "admission 应是 reducer 里的 filter 函数, 与最小字段同阶段落地, 不是单独 P1 组件"

p1_risks:
  - id: P1-4
    name: char-level-prefix-truncation-corrupts-structured-context
    evidence: "turn-injection-budget.ts:67 TURN_INJECTION_CHAR_BUDGET=6000, 'single flat pool, no per-channel sub-budgets', unit=characters, applyInjectionBudget 做前缀截断"
    impact: "截断 JSON tool schema / constraint 列表 / code block 是正确性 bug; 设计 §5.1 自己承认; unit-aware packing 被推到 P2 太晚"
    fix: "Phase 2 对 kind=constraint/evidence 禁止截断, drop lower-priority 替代"
  - id: P1-5
    name: one-bundle-per-turn-conflicts-with-tool-loop-retry-compact-fork
    evidence: "attempt.ts:2538 nextSystemPrompt 在工具调用间被重设; 一个 turn 多次 model call; 设计 §1 '语义上只有一个最终 bundle' 是回避"
    impact: "tool result 后是否重编译/retry 用同一 bundle/compact 从什么权威重建/fork 克隆 bundle (in-process ledger 不可克隆) 全未答"
    fix: "明确选择 per-model-call 编译 + 稳定前缀 + delta; bundle 是 per-model-call 的 receipt 不是 per-turn 不可变 artifact"

p2_risks:
  - "多 authority (Assembler vs Orchestrator vs CVK vs attempt.ts hooks) 中央编排器漂移风险"
  - "无真实 E4 证据: real-cohort-report.json liveObservations=0/providerReceipts=0/humanReviews=0"
  - "Working Context 设计为 task-scoped 统一对象, 代码里不存在, 字段散落在 handler 里"

chosen_ir_changes:
  - "ContextCandidate 加 kind (objective|constraint|fact|decision|risk|evidence|instruction) + epistemic.status (confirmed|inferred|uncertain|stale) + priority (critical|normal) — 3 字段非 10"
  - "ContextBundle/v1 改为 per-model-call receipt: schema/turnId/modelCallId/promptHash/selectedUnitIds/droppedUnits/charsBySource/totalChars/compiledAt/killSwitchEngaged"
  - "Admission 做成 reducer filter 函数 admit(unit, turnState)->pass_fast|pass_mem|defer|drop+reason, 不是独立组件"
  - "移除 attempt.ts post-orchestrator systemPrompt 突变, 全部走候选收集"

simpler_alternative: >-
  Reducer+Receipt 架构: 放弃 compiler+bundle 隐喻, 把上下文管线建模为确定性 reducer
  (INGEST/ADMIT/COMPILE) + receipt; v1 只用 5 字段 entry (id/source/text/kind/confidence);
  admission 是 filter 不是组件; receipt 就是 bundle; provider adapter 只接收 (prompt, receipt)
  禁止追加; 现有 ContextCandidate+TurnInjectionLedger 已做 70%, 迁移成本低。

first_milestone: >-
  Phase 1 (单一 authority + 最小字段): 给 ContextCandidate 加 kind/epistemic.status/priority
  3 字段; 让 finalizeContextOrchestratorTurn 成为唯一 prompt authority, 移除 attempt.ts 的
  post-orchestrator 突变点; emit per-model-call ContextBundle/v1 receipt。验收: grep
  attempt.ts 在 orchestrator 后的直接 systemPrompt 赋值=0; 每条突变有 lineage; receipt
  replay 能 bit-for-bit 重建 prompt; 现有单测全绿; char budget 不变。

rejected_ideas:
  - "在关闭 attempt.ts 多突变点之前实现 ContextUnit/v1 全 schema (会变装饰字段)"
  - "在 admission 之前实现 Mem path (会变 context tax)"
  - "在真实 corpus 之前实现 unit-aware 摘要 (无法证明保真度)"
  - "通过增加更多 provider/flag/memory layer/UI 状态解决 authority 问题"
  - "把 Working Context 做成独立顶层对象 (应是 ContextUnit 的 scope=task 投影)"
  - "把 Admission Planner 做成独立组件 (应是 reducer filter 函数)"
  - "把 ContextBundle 做成永久不可变 artifact (先 turn-scoped + 可重放, 持久化是 P2)"
  - "任何默认开启 Mem/VToken/SEKB 的提议 (TF-0006 blocked, liveObservations=0)"

evidence_required_before_default_on:
  - "真实 provider (非 ScriptedLlmDriver) 的 20+ transcript"
  - "至少 2 个真实渠道的入站消息 canary"
  - "真实脱敏 corpus manifest"
  - "14-28 天 soak + 真人 A/B (≥2 用户)"
  - "fidelity 指标: constraint/evidence 单元截断数=0; critical constraint 丢失数=0"
  - "requestId/runId/sessionKey/traceId/cost/latency/tool outcome/approval/side effect digest 相关性日志"
  - "失败/恢复统计 + 隐私边界审查 + 产品签署"

owner_questions:
  - "per-turn vs per-model-call bundle: tool loop 一个 turn 多次 model call, bundle 粒度? 我建议 per-model-call+稳定前缀+delta, 但改变 '一个 turn 一个 bundle' 表述"
  - "Assembler 是否合并进 Orchestrator: 当前两个编译器 (Assembler 管 knowledge/working_memory/tool_registry, Orchestrator 管 memory/vtoken), 是否合并为单一 reducer"
  - "attempt.ts hooks systemPrompt 是否保留: hooks 当前可改 systemPrompt (line 3923), 禁止则破坏扩展点, 保留则破坏单一 authority"
  - "Phase 1 是否允许改变现有 hook/intensity 行为: 移除 post-orchestrator 突变点可能改变 prompt 内容, 需接受可能输出差异"
```

## 证据矩阵附录

| 场景 | 入口 | Context authority | Mem path | 最终 bundle | 副作用 | 恢复边界 | 证据等级 |
|---|---|---|---|---|---|---|---|
| 桌面 coding | ChatInput→Host API→Gateway→dispatchInboundMessage→attempt.ts | Orchestrator(memory+vtoken)+Assembler(knowledge/working_memory/tool_registry)+CVK+attempt.ts hooks/intensity/identity/media — 多 authority | memory stage=memory-inject-pilot default-off; 无 fast/mem 分流 | 不存在唯一 bundle; attempt.ts 多次突变 systemPrompt | write journal(fail-open)+approvals+trajectory | transcript 可恢复; bundle 不可恢复(进程内 Map); 外部副作用不可恢复 | E1/E2 |
| cron agentTurn | Cron→SQLite queue→agentTurn job→embedded turn→同 attempt.ts | 同桌面(共享 attempt.ts) | 同桌面 | 同桌面(多突变点) | 同桌面+cron lease/allowlist | 同桌面; cron 队列持久化但 bundle 不持久化 | E1/E2 |
| compact/fork/handoff | sessions.compact / fork / handoff | compact:Gateway 重编译; fork:transcript clone 但 ledger 不可克隆; handoff:新会话从头编译 | N/A | 无 bundle 可恢复; in-process Map<turnId,ledger> turn 后删除 | compact 不撤销文件/进程/网络/delivery; fork 不复制外部副作用; handoff 不恢复外部副作用 | checkpoint rollback HEAD 上 RPC 不可达(WIP 未注册); 即使注册只恢复 write journal pre-image | E1/E2; checkpoint restore=E0(WIP) |
