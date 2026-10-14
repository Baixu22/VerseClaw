# Context 生态系统审计报告与决策问答

审计日期：2026-10-12
审计范围：CVK / DCS / 工具披露 / 提示词注入 / 记忆系统
工作区：本地 Windows 工作副本（C: 盘 junction -> D: 盘 ClawX 检出）
分支：`codex/stepfun-basic-evidence-20261008`　HEAD：`2f2b0b849`
审计性质：只读审计。未修改任何生产代码，未翻转任何默认值，未变更产品锁。
组件背景与代码锚点见附录引用；详细组件介绍见 `docs/dev/handoffs/CONTEXT-ECOSYSTEM-POSITIONING-AND-MEMORY-EXTRACTION-HANDOFF-2026-10-12.md`。

> **归档说明（2026-10-14 补记）**：本审计是在分叉血统
> `codex/stepfun-basic-evidence-20261008`（HEAD `2f2b0b849`）上完成的只读审计。该血统与
> `main` 无共同祖先、已被取代，现保存为 `archive/codex-stepfun-basic-evidence-20261008`
> （tag `archive-stepfun-basic-evidence-20261008`）。因此本文记录的是**当时那份血统**的观察，
> 其结论**未在 main 上应用**；若要据此做决定，请按当前 `main` 重新核对下面引用的代码锚点。
> 文中引用的 `docs/dev/handoffs/CONTEXT-ECOSYSTEM-POSITIONING-AND-MEMORY-EXTRACTION-HANDOFF-2026-10-12.md`
> 按仓库策略属本地连续性数据（`docs/dev/handoffs/` 不入库），落地时不同步。

---

## 第一部分：审计结论摘要

### 1.1 一句话结论

这套 context 生态是**工程成熟度显著高于生效面**的系统：它最硬的三块保证（注入预算、checksum 协议、记忆治理策略）默认都不产生用户可感知的行为；默认真正生效的只有一条 CVK 导航提示。因此当前的核心决策不是「继续建设」，而是**从「已建成的强机制」中挑选哪些值得开启**，并为每一项承担明确的开关、度量与回滚。

### 1.2 审计证据（本轮实跑，可复现）

| 门禁 | 结果 |
|------|------|
| runtime context-engine + memory 单测 | 58 files / **599 passed**, exit 0 |
| embedded-agent-runner + receipt-store + context-engine | 56 files / **537 passed**, exit 0 |
| agents/tools + memory + knowledge | 21 files / **175 passed**, exit 0 |
| 根仓 CVK/context 契约测试 | 8 files / **45 passed**, exit 0 |
| runtime 类型门 `tsgo -p tsconfig.core.json` | **exit 0 / 0 error** |

合计 **1311 passed / 0 failed**，4 组门禁 exit 全 0。

### 1.3 两处治理层缺陷（与选型无关，但应先修）

**缺陷 A：typecheck 门禁标准被无声降级。**
`docs/SEAM_MAP.md:11` 声称 runtime typecheck 存在「201 条基线错误（shared/types、cvk 等）」，并把验收标准写成「错误集对基线逐字节 diff 无增量」。本轮删除 tsbuildinfo 后完整重跑，实际为 **exit 0 / 0 error**，`tsconfig.core.json` include `src/**/*` 确认覆盖 cvk 与 runtime-core。
这条不只是文档过期：它把门禁从「exit 0」降级为「diff 无增量」，等于为一个不存在的问题长期降低门禁强度。**风险等级：中（治理层，非功能层）。建议优先修正。**

**缺陷 B：`pnpm harness validate` 当前不可用。**
报错 `fatal: origin/main...HEAD: no merge base`（命令为 `git diff --name-only -z origin/main...HEAD`）。这是 git ref 环境问题，不是 spec 内容失败，但会导致依赖该门禁的流程无法执行。需先 `git fetch origin main` 或按既有规则使用 `--no-diff` 并注明原因。

---

## 第二部分：选型决策方法论

### 2.1 先确立一条判断标准

对每个 context 能力，决策不应问「它实现了什么」，而应问：

> **在当前默认状态下，它是否已经在影响真实模型行为？如果没有，开启它的收益证据从哪来？回滚成本是多少？**

这条标准能直接区分本系统的三类能力：
- 已生效且安全 → 保留并作为对外叙事
- 已建成但未生效 → 决策焦点（开还是继续关，需要论据）
- 已建成但无强制点 → 需要先决定它到底存不存在

### 2.2 四类能力的决策矩阵

审计把 11 项 context/记忆能力归入四类，每类的决策方向与所需论据不同：

| 类别 | 含义 | 决策方向 | 开启前必须具备 |
|------|------|----------|----------------|
| **A. 已生效且低风险** | 默认开启、失败可降级、不改变模型行为语义 | 保留，作为项目特色 | 无（已满足） |
| **B. 已建成、待决策** | 机制完整但默认关闭 | 需要业主决策开或继续关 | 生产规模度量 + 灰度方案 + 回滚计划 |
| **C. 无强制点的规则** | 规则写进了文档，但没有任何执行点 | 先决定规则是否真实存在 | 产品决策（不能靠工程默认） |
| **D. 受产品锁约束** | 明确标记为不可开启 | 保持关闭 | 所有者授权（不可由 agent 推进） |

### 2.3 决策优先级排序方法

对 B 类能力排序时，本审计使用三个可比较的因子（1-5 分）：

| 因子 | 含义 | 提问方式 |
|------|------|----------|
| **用户可感知收益** | 开启后用户能否直接察觉改善 | 「不开的话，用户会重复劳动吗？」 |
| **证据成熟度** | 是否已有真实流量下的度量 | 「拿什么证明它有效，而不只是测试绿？」 |
| **回滚成本** | 关闭后是否需要迁移数据或改状态 | 「关掉会不会留下脏数据？」 |

按此排序，B 类能力的开启优先级为：**working-memory > tool-registry > RC-03 receipt 链**（详见第三部分）。

---

## 第三部分：逐项选型决策

### 3.1 A 类：建议作为项目特色开启（已生效，保持）

| 能力 | 生效状态 | 为什么适合作为特色 |
|------|----------|----------------|
| **CVK 引擎 default-on** | 已生效。`context-engine/registry.ts:889` 解析顺序为：显式 slot -> `context-runtime-kit`（slot 缺失且未禁用）-> legacy；真实输入在 `embedded-agent-runner/run/attempt.ts:4222` 传入 | 确定性编译（`llmDependency: false`）、有界注入（<=8000 字符）、失败自动 quarantine 降级 legacy。这是「可验证上下文」的唯一入口面 |
| **提示词注入预算** | 已生效。per-turn 单一字符账本，总额 6000，固定 precedence，丢弃率 >10% 告警 | 这是「上下文不失控」的唯一硬保证。历史怀疑 FP-P1-11（charge 与实际注入不一致）已带真 agent turn 证据关闭（applied+dropped+truncated == requested） |
| **工具披露 on_demand 摘要** | 已生效。默认 `summary` 模式，完整 schema 由 `context_read('tool_registry')` 按需展开 | token 效率亮点，且明确回落原生 grep/read，无行为风险 |

**决策结论**：三项保持不变，作为对外叙事核心。它们共同满足「默认生效 + 失败可降级 + 不改变模型语义 + 确定性可解释」，风险最低而说服力最强。

### 3.2 B 类：建议开启但必须门控灰度

#### B-1 DCS working-memory 注入（首选开启项）

- **现状**：机制完整。含工具结果后重注入、`regather` 去重、`significance` 分级（保留 5 条，超出时优先淘汰 medium）。默认关闭。
- **用户可感知收益：高。** 直接消除「重复劳动」——模型忘记刚做过什么。
- **回滚成本：低。** 纯注入侧开关，无数据迁移。
- **已具备的安全网**：受注入预算账本覆盖，降级行为可解释（precedence 中优先级 90，高于 cvk/vtoken/memory_pilot）。
- **开启前需补**：一次生产规模的灰度，度量 `lastTurnInjection.byChannel.working_memory` 的 applied/dropped 分布，确认它不会挤占更高优先级的 knowledge 通道。

**决策建议：开。** 这是 B 类中收益最高、回滚最便宜的一项。

#### B-2 DCS tool-registry 注入（建议与 B-1 同批）

- **现状**：机制完整，默认关闭。与 A-3 的 on_demand 披露配套。
- **收益与风险**：与 working-memory 同源；因已有 summary 模式兜底，全量 schema 不会被无条件注入。
- **决策建议：开，与 B-1 同批灰度**，便于用同一份预算账本观察两个通道的竞争关系。

#### B-3 RC-03 seal + receipt 权威链（作为可观测性开启，非功能开关）

- **现状**：机制成熟。三级索引 `attempt/modelCall/wireAttempt`、digest-only、注册 13 个 pre-seal producer 并断言「零绕过」。默认关闭（`OPENCLAW_RC03_SEAL`）。
- **真实价值在可审计，不在模型行为。** 它不改变注入内容，只记录「注了什么」。
- **决策建议：开，但定位为可观测性特色**，接入 Settings > Developer 或 runtime ack 面板，而非作为功能开关对外宣传。理由：它是唯一能证明「上下文到底怎么进 prompt」的机制，在上下文生态中属于信任基础设施。

### 3.3 C 类：规则存在但无强制点（需要产品决策，不可由工程默认）

#### C-1 「硬断言必须带 selector + checksum」当前无任何执行点

- **规则本身**：`harness/specs/rules/context-runtime-kit-boundary.md` 要求任何硬断言必须携带可解析的 `resource_id + selector + checksum`。`cvk/resolver.ts` 实现了完整校验语义（`invalid_ref / missing_selector / stale_selector / ambiguous_selector / wrong_resource / checksum_mismatch / hard_claim_missing_checksum`）。
- **执行现状**：`resolveCvkSelector` 在生产代码中**只被两处消费**——`cvk/recovery.ts` 与 `agents/agent-hooks/compaction-addressability.ts`。正常的 prompt 注入与工具调用路径**完全不过它**。同时 `cvk/tool-call-gate.ts` 停在 `report_only` 模式（`denied` 恒为 false）。
- **结论**：这条规则目前是**纯文档约定，无强制点**。

**两个选项（必须由所有者选择）**：

| 选项 | 含义 | 代价 |
|------|------|------|
| **接受「只服务 recovery」** | 承认该规则的作用域就是恢复/可寻址性，不覆盖日常注入 | 需修改 `context-runtime-kit-boundary.md` 措辞，消除「文档承诺 vs 实际执行力」的落差，否则易被误读为已有强制 |
| **推进 enforce** | 让 tool-call gate 在 enforce 模式下真正阻断缺 selector 的工具调用 | 这会**改变模型可调用的工具集**，属重大行为语义变更；需独立 task spec + shadow 期生产数据 + 灰度 + 回滚；且该模式从未在生产规模运行过 |

**审计倾向**：若短期无生产数据支撑，选项一（写清边界）成本远低于选项二。但这是产品决策，agent 不应自行推进。

### 3.4 D 类：受产品锁约束，保持关闭

| 能力 | 约束来源 |
|------|----------|
| **Runtime Memory 默认注入** | `runtimeMemory.injectPilot` 默认 off，注释明确「关闭时 prompt bytes 与今天字节一致」；且 provider 注册注释写明其质量门（maturity >= 0.7 / extraction density >= 1.0 / Recall@5 >= 40%）**未达标** |
| **Runtime Memory 作为 active writer** | memory 插件槽约束「同时只能一个 active writer，首个是 Role Memory」；`plugins/memory-runtime.ts` 对 `runtime-memory` 显式 `return []` |
| **普通 Chat 自动记忆捕获 / SEKB unattended writeback** | `docs/dev/first-product-controlled-preview/STATUS.md` hard lock 第 2 条；`knowledge-system-unification` 规划明确「继续关闭」 |
| **SEKB 自动写回 / Browser 无监督 / 真实远端副作用** | hard lock 第 2、8 条 |

**D 类不是「暂缓」，是「需所有者授权方可变更」。** agent 不得为验证效果而翻转这些默认值。

---

## 第四部分：记忆系统的审计发现

### 4.1 存在两套记忆系统（影响后续所有记忆决策）

| | Role Memory | Runtime Memory |
|---|---|---|
| 代码位置 | `src/memory/` | `src/runtime-core/memory-*.ts` |
| 规模 | 11 文件 / 4.6k LOC | 37 文件 / **16.3k LOC** |
| 存储 | `role-memory.sqlite`，MemoryCard + 治理 | SQLite，fact / episode / 混合检索 |
| 抽取能力 | `memory-extractor.ts` 仅 1.7KB，8 条正则 | `memory-extraction-prompt.ts` **已有完整 LLM 抽取 prompt** |
| 当前角色 | 唯一 active writer | shadow / benchmark |

**两套关系已被明文治理**：`knowledge-system-unification-development-plan.zh-CN.md` 规定单 active writer（首个 Role Memory）、Runtime Memory 不与 Role Memory 并行写入或注入；代码侧 `plugins/memory-runtime.ts` 已强制。

### 4.2 关键判断：记忆抽取的短板不是「能力缺失」

`memory-extraction-prompt.ts` 已含原子 subject/predicate/objectSummary schema、时间归一化、正反抽取示例、禁抽清单，质量相当完整。但其文件头注释写明：

> 「Used by the LoCoMo eval harness and available for future production LLM-based extraction paths.」

即：**抽取能力已存在，未接生产，且被质量门主动挡住。** 因此后续优化的正确方向不是重写抽取器，而是**把已有抽取接入 shadow 通道，用既有 eval 资产度量质量门是否达标**。`agents/runtime-memory-eval/` 下已有 12 个 eval 驱动（chain / cross-axis-rejection / conflict-resolution / utility-scorer / latency / budget-pressure / hazard-sentinel / topic-drift / temporal-evolution 等），质量门所需指标大概率已具备，只是未跑在生产流量上。

按所有者指示，本轮不展开该规划。

---

## 第五部分：问答（Q&A）

### Q1：为什么不把所有默认关闭的能力都打开？它们不是都测试通过了吗？

测试通过只证明**机制正确**，不证明**收益为正**。working-memory、tool-registry、RC-03 receipt 都是默认关闭状态下建成的，它们的单测与契约测试是绿的，但从未在生产流量下运行过。打开它们需要的是生产规模的度量（是否挤占更高优先级通道、是否增加延迟、是否引入重复注入），而不是更多单测。

### Q2：CVK 引擎已经是 default-on 了，为什么还说「默认生效的只有一条导航提示」？

因为 CVK 注入的是**导航信息**：registry 条目、compact selector 列表、工具 selector 提示、诊断。它让模型知道「有哪些上下文资源可按需取」，但不注入具体内容。所以它是入口面，不是内容面——这是设计意图（摘要仅作导航、硬断言需 checksum），不是缺陷。

### Q3：开启 working-memory 会不会把 prompt 撑爆？

不会无界增长，有三重约束：
1. `working-memory-handler.ts` 只保留最近 5 条 action，超出时优先淘汰 `significance: medium`；
2. 受 per-turn 6000 字符总账本约束，precedence 中优先级 90（仅次于 knowledge），预算不足时会先降级低优先级源；
3. 每次注入都会记入 `lastTurnInjection.byChannel`，可观测。

### Q4：RC-03 receipt 链默认关，那现在怎么知道上下文进了 prompt？

目前靠 DCS observability 计数器（`dcs-observability.ts`），但该文件自述「in-memory only，无进程外读路径」，且 `writeSoakSnapshot` 从不被自动调用。也就是说**当前没有可靠的进程外手段回答「上一轮到底注入了什么」**。这正是建议把 RC-03 作为可观测性特色开启的原因——它是补上这个观测缺口的基础设施。

### Q5：C-1 的 enforce 模式既然能力都写好了，为什么不直接开？

因为它会**改变模型可调用的工具集**：enforce 模式下缺 selector 的工具调用会被真正阻断（`denied: true`）。这从「加一条提示」变成「减一批能力」，是重大行为语义变更。且 `report_only` 是默认模式，enforce 分支从未在生产规模运行。属于必须由所有者拍板的产品决策。

### Q6：两套记忆系统会不会互相污染？

按当前治理不会——memory 插件槽限制单 active writer，`plugins/memory-runtime.ts` 对 `runtime-memory` 显式 `return []`，且 `runtimeMemory.injectPilot` 默认关闭保证「prompt bytes 与今天字节一致」。但需要注意的是：这个隔离依赖三道开关同时关闭（单 writer + pilot off + 插件槽空），任何一道被翻转都需要重新评估是否会形成并行注入。`knowledge-system-unification` 规划已把「Role Memory 与 Runtime Memory 语义重叠」列为待统一项。

### Q7：记忆抽取优化的第一阶段应该做什么？

按本审计 §4.2 的判断，第一阶段不是替换生产抽取，而是：**把已有的 LLM 抽取接入 shadow 通道**，用 `agents/runtime-memory-eval/` 的既有 eval 资产在真实流量上度量质量门（maturity / extraction density / multi-hop Recall@5），看是否达标。这样做的收益是：不触碰任何产品锁、不改变 prompt bytes、能在真实数据上判断 Runtime Memory 是否值得进一步开启。

### Q8：那 SEAM_MAP 的 typecheck 基线错误要不要现在修？

建议修，且属 agent 职责范围（不涉及产品锁、不改变任何运行时行为）。它当前正在为一个不存在的问题持续降低门禁强度——把「exit 0」降级成「diff 无增量」。修改内容：把该行的基线描述与验收标准改回实际（exit 0 / 0 error），并说明覆盖范围为 `tsconfig.core.json` include `src/**/*`。

### Q9：如果只能做一件事，做什么？

修正 SEAM_MAP 的 typecheck 基线（成本最低、修复治理缺陷）；如果允许做两件事，第二件是为 working-memory + tool-registry 出灰度方案——这是 B 类中用户可感知收益最高、回滚成本最低的一组。

### Q10：这些结论里哪些是实跑验证的，哪些是读码推断？

- **实跑验证**：所有测试计数与 exit code（§1.2）、typecheck exit 0 与「201 条基线错误」不符、harness validate 的 git 报错、CVK/DCS 默认值（通过读取实际解析函数与常量确认）。
- **读码推断**：各能力的风险评估、优先级评分、C-1 的影响面判断、Q3/Q4 的行为推演。这些基于代码逻辑，但未在生产流量下运行验证，开启前需按第三部分补齐灰度证据。

---

## 第六部分：下一步决策清单

需要业主决策的事项（agent 不应自行推进）：

1. **C-1 走向**：接受「CVK 硬断言只服务 recovery」并修正文档措辞，还是推进 tool-call gate enforce（需完整灰度）。
2. **B 类开启授权**：是否批准 working-memory + tool-registry 进入灰度，以及灰度成功标准。
3. **D 类是否维持**：产品锁（Runtime Memory 默认注入、SEKB 自动写回、普通 Chat 自动捕获）是否维持现状。

agent 可直接推进的事项（无需额外授权）：

4. 修正 `docs/SEAM_MAP.md:11` 的过期 typecheck 基线（§1.3 缺陷 A）。
5. 修复 harness validate 的 git ref 问题（`git fetch origin main`）以恢复门禁可用性（§1.3 缺陷 B）。
6. 为 B-1/B-2 起草灰度方案与度量口径（不含开启动作）。
7. 为 C-1 准备两种走向的对比文档（blast radius、回滚方案、所需证据），供业主决策。

## 附录：关键代码锚点

- CVK：`openclaw_runtime/src/context-engine/cvk/{compiler,engine,resolver,views,shadow-provider,tool-call-gate,recovery}.ts`
- CVK 引擎默认解析：`context-engine/registry.ts:889`；真实输入：`agents/embedded-agent-runner/run/attempt.ts:4222`
- CVK 边界规则：`harness/specs/rules/context-runtime-kit-boundary.md`
- DCS 默认全关：`context-engine/assembler.ts:90`；`agents/embedded-agent-runner/extensions.ts:154-165`
- 注入预算与 precedence：`context-engine/turn-injection-budget.ts`
- 工具披露：`context-engine/{dcs-context-tools-flags,coding-tool-navigation}.ts`；注册 `agents/agent-tools.ts:1117`
- RC-03 receipt 与 producer：`context-engine/{dcs-receipts,rc03-producers,rc03-seal-hook}.ts`
- 可观测性现状：`context-engine/dcs-observability.ts`
- Role Memory：`src/memory/{memory-policy,memory-store,gatekeeper,memory-extractor}.ts`
- Runtime Memory：`src/runtime-core/memory-*.ts`；抽取 prompt `memory-extraction-prompt.ts`；eval `agents/runtime-memory-eval/`
- 单 writer 约束：`src/plugins/memory-runtime.ts`；pilot 开关 `config/types.openclaw.ts:380`
- 产品锁与证据水位：`docs/dev/first-product-controlled-preview/STATUS.md`
- 过期 typecheck 基线：`docs/SEAM_MAP.md:11`