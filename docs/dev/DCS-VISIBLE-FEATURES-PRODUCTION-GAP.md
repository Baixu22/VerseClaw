# DCS 可见功能 → 真正生产可用：完整缺口清单

| 字段 | 值 |
|------|-----|
| **文档性质** | 缺口与投产清单（产品目标驱动） |
| **目标口径** | **所有用户/开发者看得见的功能，都能在生产路径上真实生效**——不是“目录能看、面板能开、代码有了但默认不干活” |
| **非目标** | 仅为演示翻默认；联合系统 GA 话术；SEKB 无人自动写回 |
| **代码基线** | `ClawX-maturity-p0` @ `main` / `60931957b`（2026-07-20～22 证据） |
| **权威锚点** | `docs/dev/component-readiness-audit-2026-07-20.md`、`shared/dcs/prod-flags-catalog.ts`、`docs/dev/default-config-matrix.md`、`docs/dev/tf0006-evidence-upgrade-unblock.md`、`CODING-FLAG-GRADUATION.md` |
| **当前官方水位** | **P0 受控投用资格闭合 · P1 canary ready · 未执行真人投放**；`defaultOn=false` · `liveReady=false` · `productApproved=false` · `jointSystemGa=NO-GO` |
| **总判决** | **READY_WITH_CONDITIONS**：基线 coding 可生产用；**可见的增强面大量处于“能看见 / 能 opt-in / 不能当默认生产能力”** |

---

## 0. 你要的“生产可用”定义（本文采用）

### 0.1 成功标准（用户语言）

对每一个**用户或开发者能在 UI / 工具表 / 文档 / Settings 里看见的功能**：

1. **能打开**：有稳定入口（UI 开关、配置项或明确 env），不是只能读 runbook。
2. **打开后真干活**：改变 agent 工具表、prompt 注入、写路径行为或可观测指标——**不是**只改 badge / 只写 shadow 日志。
3. **默认或一键可达**：普通生产安装后，要么默认生效，要么在 Settings 一键开启且 config-sync 到 runtime（**禁止**“必须手改 env + 重启才能用、UI 只展示说明”作为终点）。
4. **可回滚**：一键 / 一配置 kill，失败不污染主路径。
5. **有 live 证据**：至少一轮真人生产路径任务记录 + 无红线事故；合成 canary **不算**本目标下的“生产可用”。

### 0.2 四级

| 术语 | 含义 |
|------|------|
| **可见（Visible）** | Settings 面板、页面、工具名、文档 runbook、Developer 目录中出现 |
| **可开（Opt-in capable）** | 改 env/config/API 后代码路径存在 |
| **默认真干活（Default productive）** | 零特殊配置即改变用户可感知结果 |
| **生产可用（Production-usable）** | 满足 §0.1；本文目标态 |
| **只能看（Display-only / Shelfware）** | UI/文档展示能力，但默认关、或只读、或 shadow-only、或无 live 证据 |

### 0.3 与旧两档的关系

| 档 | 旧标签 | 与本目标关系 |
|----|--------|----------------|
| A 受控 opt-in | controlled internal use | **必要但不充分**：仍可能“能开但只能专家开” |
| B default-on GA | liveReady + productApproved | **本目标的子集出口**：多数可见增强面最终要毕业到默认或 Settings 一键生产路径 |
| **本文目标** | **Visible → Productive** | 每个可见面达到 §0.1，允许少数面标为“实验/废弃并隐藏” |

---

## 1. 现状总览

```text
┌──────────────────────────────────────────────────────────────┐
│ 用户可见层                                                    │
│  Settings: DCS 生产 Flag 面板(只读) | VToken Bridge(可开关)   │
│  Knowledge/SEKB 路径 | Browser | Agent Dev | Chat 工具表      │
├──────────────────────────────────────────────────────────────┤
│ 多数增强 = 可见目录 / 只读说明 / 默认 OFF / shadow-only        │
│ 基线 coding 写路径 = 默认真干活（write/edit/parseOnTouch…）   │
└──────────────────────────────────────────────────────────────┘
```

| 维度 | 完成度（粗） | 说明 |
|------|-------------|------|
| 能力实现 + 接线 | ~95% | R1–R6 / C0–C7 代码在 |
| 工程门禁 / 安全默认 | ~95% | P0 绿、fail-closed |
| **可见面 → 可操作生产入口** | **~25%** | 大量只读目录 / env 专家路径 |
| **打开后默认真干活 / 一键真干活** | **~35%** | 基线写路径强；记忆/知识/视图弱 |
| Live 运营证据 | ~5% | L3 真人任务 ≈ 0 |
| TF-0006 解封 | 0% | 四件套全缺 |

**一句话**：系统处在 **“基础设施已生产级、产品增强面大量上架但未开售”**——对你要的“看见就能用”而言，缺口主要在 **产品入口、默认策略、live 证据与一致性**，不是从零写 DCS。

---

## 2. 可见功能全表（核心）

图例：

- **生效态**：`默认生产` / `opt-in 真干活` / `shadow 只双写` / `只读展示` / `dep 门控` / `废弃`
- **与目标差距**：`已达标` / `差入口` / `差默认` / `差 live` / `差产品决策` / `应隐藏或改名`

### 2.1 Settings / UI 可见面

| ID | 可见位置 | 用户以为能干什么 | 实际行为 | 生效态 | 缺口类型 | 要到 §0.1 还需 |
|----|----------|------------------|----------|--------|----------|----------------|
| UI-01 | 设置 → 开发者 → **DCS 生产 Flag** | 管理/打开 DCS 能力 | **只读目录**：展示 key/默认/风险/如何手改；**无开关** | 只读展示 | 差入口 | **可写控制面**（toggle → 写 config/env → config-sync → 重启或热加载）+ 状态回读 |
| UI-02 | 设置 → 开发者 → **VToken Bridge** | 打开 Working Context | 有 Switch；可 `setEnabled` / `ensureStarted`；**assembly 默认仍 OFF**，与 bridge 两层门 | opt-in 真干活（桥）/ assembly 另门 | 差默认 + 差 live | assembly 与 bridge 语义合并或 UI 一次开齐；live 打包质量证据 |
| UI-03 | Knowledge / SEKB 相关 UI + E2E 黄金路径 | 经验沉淀与召回 | **人工 confirm 后**才 persist；默认 SEKB master off；禁止 auto writeback | opt-in + 人审 | 差默认 + 差 live | 默认发现性入口；生产会话一键走 capture→confirm→recall；禁止无确认写 |
| UI-04 | Browser workbench | 浏览/自动化 | 审批升级；**私网默认 deny** | opt-in 监督 | 差 live | 公网 allowlist 真任务 soak；审批不可绕过回归 |
| UI-05 | Agent Dev / 场景工作台 | “开发能力已绿” | **≠ DCS 生产可用**；易误导 | 只读/实验 | 差产品决策 | UI 标明 experimental；禁止等同 GA |
| UI-06 | Chat 工具列表（agent tools） | 所有列出工具可用 | 部分工具 **根本不在默认 catalog**（view 四工具） | 部分默认 / 部分隐身 | 差默认 | view 工具毕业或 UI 明确“需开启 DCS 视图” |
| UI-07 | Observability / 指标展示（若有） | 看 DCS 是否在工作 | 多数计数器 **进程内**，非产品仪表盘 | 只读/开发 | 差入口 | 导出/面板对接 `codingObservability`/`dcsObservability` |

### 2.2 Agent 工具面（聊天里“看得见/应看得见”）

| ID | 工具 / 能力 | 默认是否进 catalog | 真干活条件 | 生效态 | 缺口 |
|----|-------------|-------------------|------------|--------|------|
| T-01 | `context_read` | 有 sessionId + BlockStore 时注册 | state DB 打开成功 | dep 门控 · 默认可注册 | DB 失败则整组消失；需健康检查与用户提示 |
| T-02 | `context_search` | 同上 | 同上 | 同上 | 同上；检索质量 live 未证 |
| T-03 | `context_write` | 同上 + sink | 角色白名单（默认 implementer） | 同上 | 权限/滥用边界 live |
| T-04 | `context_understand` | **默认不在** | `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1` + FactService | opt-in 隐身 | **看不见就不存在**；要生产默认或 Settings 一键 + 进 catalog |
| T-05 | `context_impact` | 默认不在 | 同上 | opt-in 隐身 | 同上 |
| T-06 | `context_reuse` | 默认不在 | 同上 | opt-in 隐身 | 同上 |
| T-07 | `context_verify` | 默认不在 | 同上 | opt-in 隐身 | 同上 |
| T-08 | `write` / `edit` / `apply_patch` | 默认在 | 基线 | **默认生产** | 已达标（envelope 3/3） |
| T-09 | parse-on-touch / writeJournal / soft gates | 写路径默认增强 | FactService 有 workspace | **默认生产**（部分） | 已基本达标 |
| T-10 | `staleWriteGuard` | 逻辑在，**默认 false** | config true | opt-in | 假阳性语料 + override UX + 再谈默认 |
| T-11 | symbol lease | 默认 false | config | opt-in | multi-process WAL live 若要默认 |
| T-12 | patch-flow | **API-only**，default false | 调用方显式 API | api-only | 编排 UI/默认路径产品决策 |
| T-13 | task_loop / mission_loop / team_orchestrate | 默认可用 | 用户调用 | **默认生产** | writeSet fill partial 等编排完整性 |
| T-14 | codegraph 插件工具 | Electron 路径常不可见 / RETIRED | 非 DCS 主路径 | 废弃/屏蔽 | **应隐藏或标明废弃**，避免“看见却没有” |
| T-15 | undo_write（若暴露） | 依赖 writeJournal | journal on | 默认生产 | 确认 UI 可达 |

### 2.3 Prompt / 记忆注入面（用户“感觉 AI 记住了”）

| ID | 能力 | 用户可见线索 | 默认 | 真干活 | 缺口 |
|----|------|--------------|------|--------|------|
| M-01 | **working-memory Assembler 注入** | 文档/Flag 目录 | **false** | config `runtime.contextBlock.working-memory.enabled` | **核心 shelfware**：producer 在写 envelope，**默认不进 prompt** |
| M-02 | **tool_registry 注入**（## Tools） | 文档 | **false** | `tool-registry` / assembler flag | 与 C1 视图工具毕业绑定 |
| M-03 | compass knowledge Block（main） | 间接（COMPASS 另有预回复） | contextBlock.compass **false** | flag | 与现有 COMPASS 预回复双路径需统一 |
| M-04 | role-memory knowledge Block（subagent） | 间接 | **false** | flag | 普通 chat 不走；spawn 路径才相关 |
| M-05 | CVK systemPromptAddition | 系统提示里可能有导航壳 | CVK **默认引擎** | 元数据导航，**非记忆内容** | 用户以为“上下文引擎在记东西”——实际壳活芯睡 |
| M-06 | chat-turn memory inject pilot | 几乎不可见 | **false** | config | 与 DCS 并行；应废弃或并入，避免第三套 |
| M-07 | VToken `## Working Context` | Settings 桥 | assembly **false** | bridge + assembly | 与 M-01 产品主路径二选一或分层 |
| M-08 | SEKB experience 注入 / 召回 | Knowledge UI | master **false**；cutover 永 false | 人审 + 显式 enable | 无 auto；生产=人审闭环必须顺滑 |
| M-09 | Runtime Memory | 审计/诊断 | diagnostics-only | 禁止当默认 inject | **不得**当生产记忆卖点直至 live 证据 |
| M-10 | C6 context ladder | 文档/API | assembler **不自动** | 显式 API | 要么产品 API 入口，要么不要在对外叙述里当功能 |
| M-11 | C7 routing/experience shadow | Flag 目录 | shadow **false** | 双写 only | 标明 shadow；禁止当“已启用知识” |

### 2.4 配置 / 目录可见但易误导项

| ID | 项 | 问题 | 影响 |
|----|-----|------|------|
| C-01 | `runtime.coding.factViews.enabled` **默认 true** | **零调用方**；真门控是 env view-tools | 开发者以为 Fact 视图已默认开 → **假安全感** |
| C-02 | DCS Flag 面板 risk 文案 vs 真实状态 | 只读 + “如何手改” | 看起来像控制台，实际是说明书 |
| C-03 | `productionMode: opt-in` badge | 正确但用户不懂 | 需中文产品文案：未全量生产 |
| C-04 | kebab vs snake contextBlock keys | schema 与 assembler 映射复杂 | 配置写错=静默不生效 |
| C-05 | config-sync 整 key `runtime` | 已修，但用户侧仍易漏 isolation 文件 | “设置了却没进 Gateway” |

### 2.5 运营 / 证据可见面

| ID | 项 | 状态 | 缺口 |
|----|-----|------|------|
| O-01 | `dcs:canary:c1` | 合成 5.125×，`keep-off` | **不能**支撑“生产可用” |
| O-02 | P1 profiles / runbook | 齐，角色占位 | 真人名 + L3 runs=0 |
| O-03 | TF-0006 四证据 | **全 false** | 挡 default-on / liveReady |
| O-04 | kill dry-run | 有 | 缺真 kill 演练 |
| O-05 | artifacts gitignore | 本地证据易丢 | 归档策略 |

---

## 3. 按“只能看”模式分类的缺口

### 模式 A — 展示型（Display-only）

**现象**：UI/文档告诉你有这能力，**没有**等价的一键生产开关。

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-A1 | DCS 生产 Flag **只读面板** | 每个 flag 可 toggle 并回读 runtime 生效状态 |
| G-A2 | runbook 式启用（改 env 重启）作为唯一路径 | Settings 一等公民路径 |
| G-A3 | Agent Dev 绿灯当生产就绪 | 文案隔离 + 门禁分离 |

### 模式 B — 默认关隐身（Default-off invisible）

**现象**：能力在代码里，**默认工具表/ prompt 都看不到效果**。

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-B1 | 四个 Fact view 工具不进默认 catalog | live A/B 达标 → 默认 on **或** 设置开后立即进表且 Chat 可发现 |
| G-B2 | working-memory 有 envelope 无注入 | 默认 on 或 设置开后 **当轮** prompt 可见 `## Recent Actions` 类注入 |
| G-B3 | tool_registry / knowledge Blocks 默认不注入 | 同上 |
| G-B4 | SEKB master 默认 off | 生产安装可发现入口；confirm 路径 ≤3 步 |

### 模式 C — Shadow / API-only（开了也不像产品功能）

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-C1 | routingMemo / experienceShadow 仅双写 | 明确产品阶段：要么 cutover 计划，要么 UI 标“采样中不改回答” |
| G-C2 | patch-flow / applyContextLadder 无产品入口 | 接 Orchestrator UI 或从对外功能列表移除 |
| G-C3 | 观测计数器无面板 | 开发者页最小仪表盘或导出按钮 |

### 模式 D — 壳活芯睡 / 假生效

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-D1 | CVK 导航壳 vs 记忆内容 | 产品话术改准；或 DCS/VToken 真内容默认进 prompt |
| G-D2 | factViews config true 但 env 关 | **删死配置或接真门控**（P0 一致性） |
| G-D3 | TaskLoop 才有 phase；单轮 chat 无 task_state | 文档+UI 说明；或单轮也产最小 task_state |

### 模式 E — 证据与政策锁（开了也不允许宣称生产）

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-E1 | TF-0006 四件套 | corpus + live-ab + soak + product-approval |
| G-E2 | L3 真人 canary 未执行 | ≥10 任务/ profile × 记录 |
| G-E3 | C1 live A/B | 真人 cohort，非 synthetic-agent |
| G-E4 | working-memory 长会话有用性 | multi-day soak 报告 |
| G-E5 | 分 flag 毕业 PR + matrix 更新 | 对照 `default-config-matrix.md` 受审变更 |

### 模式 F — 应下架或改名（减少“看见却没有”）

| 缺口 | 代表 | 关闭条件 |
|------|------|----------|
| G-F1 | codegraph RETIRED 仍可能被文档提及 | 隐藏入口 / 明确 Retired |
| G-F2 | provider-registry pilot 已删 API | 文档扫尾，禁止当主路径 |
| G-F3 | Runtime Memory 当“记忆功能”露出 | 标 diagnostics-only 直到 liveReady |

---

## 4. 详细缺口卡片（执行用）

### 4.1 P0 — 一致性与“别再骗用户”（1～2 周可闭）

> 不翻激进默认，先消灭“假默认 / 只读装成控制台”。

#### GAP-P0-01 · Flag 面板从只读说明书 → 可写控制面

| 项 | 内容 |
|----|------|
| **用户痛点** | 设置里看见一排 DCS Flag，点进去只能抄 enable 字符串 |
| **现状** | `DcsProdFlagsPanel` 绑定 `DCS_PROD_FLAGS` 只读 |
| **目标** | 每个 opt-in 项：Switch/Select → 写用户 config 或受控 env → `config-sync` → 显示 **runtime 已生效/未生效** |
| **验收** | E2E：UI 打开 view-tools 或 working-memory 后，新 session 工具表/注入可观测变化；关闭后恢复 |
| **依赖** | host-api 配置写接口；Gateway 重启或热加载策略 |
| **优先级** | **P0**（你要的“看见就能用”的总闸） |

#### GAP-P0-02 · 消灭 `factViews.enabled` 死配置

| 项 | 内容 |
|----|------|
| **现状** | `DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.factViews.enabled"]=true` 无调用方；真门控 `isDcsContextViewToolsEnabled()` |
| **目标** | 二选一：**删除/废弃 config** 并只保留 env+UI；或 **config 真接入** `resolveViewToolsEnabled` |
| **验收** | 单测锁定单一真相源；文档/catalog 一致 |
| **优先级** | **P0** |

#### GAP-P0-03 · 可见工具“隐身”可发现

| 项 | 内容 |
|----|------|
| **现状** | view 四工具默认不在 catalog → 用户永远点不到 |
| **目标（过渡）** | Chat/设置提示：“DCS 视图工具未启用 → [一键启用]”；启用后立即出现 |
| **目标（终态）** | 见 GAP-P1-01 默认毕业 |
| **优先级** | **P0** |

#### GAP-P0-04 · BlockStore/state DB 失败可感知

| 项 | 内容 |
|----|------|
| **现状** | deps 打开失败 → context_* 整组不注册，用户无提示 |
| **目标** | Settings/日志/Chat 系统提示：“上下文存储不可用” |
| **验收** | 故意坏 DB 路径 → 明确错误，而非静默少工具 |
| **优先级** | **P0** |

#### GAP-P0-05 · 产品文案：壳 vs 芯

| 项 | 内容 |
|----|------|
| **现状** | CVK 默认注入导航元数据，易被当成“记忆已开” |
| **目标** | UI/文档区分：Context Engine 导航壳 / DCS 工作记忆 / VToken 打包 |
| **优先级** | **P0**（信任） |

#### GAP-P0-06 · 废弃面下架

| 项 | 内容 |
|----|------|
| **对象** | codegraph RETIRED、provider-registry pilot 叙述、过时“未注册/零 producer”文档 |
| **目标** | 用户路径不可见或标 Retired |
| **优先级** | **P0** |

---

### 4.2 P1 — 每个主可见面“打开后真干活”（2～4 周）

#### GAP-P1-01 · Fact 视图四工具生产化

| 项 | 内容 |
|----|------|
| **现状** | env 默认 off；合成 canary keep-off |
| **目标** | Settings 一键 → 工具进表 → 真人任务可稳定调用 understand/impact/reuse/verify |
| **证据** | 替换 synthetic：`live-ab-report`；路由准确率与任务通过率 |
| **毕业** | 过线后可讨论 **默认 on**（仍需 productApproved） |
| **优先级** | **P1** |

#### GAP-P1-02 · working-memory：从“只生产 envelope”到“会话真记住”

| 项 | 内容 |
|----|------|
| **现状** | edit/write/apply_patch 产 envelope；Assembler 默认不注入 |
| **目标** | 开启后长会话可引用近期改动摘要；exactly-once 不炸 token |
| **证据** | 长会话 soak（跨小时/天）；有用性人工分 |
| **优先级** | **P1（核心体验）** |

#### GAP-P1-03 · tool_registry 注入与工具导航一致

| 项 | 内容 |
|----|------|
| **目标** | 开启后 system 侧工具摘要与真实 catalog 一致；与 view 工具 on_demand 协作 |
| **优先级** | **P1** |

#### GAP-P1-04 · VToken 与 DCS 主路径产品决策

| 项 | 内容 |
|----|------|
| **现状** | 双轨默认关；Bridge 可开、assembly 另门 |
| **目标** | 明确：**主 Working Context = ？**（DCS Block 注入 / VToken / 二者分层） |
| **禁止** | 三套同时默认开无预算协调 |
| **优先级** | **P1 决策门** |

#### GAP-P1-05 · SEKB 人审生产闭环顺滑

| 项 | 内容 |
|----|------|
| **目标** | 从任务结束 → 候选原则 → 一键确认 → 下轮可召回；**仍禁止 auto writeback** |
| **验收** | 非 E2E 脚本：真人 10 次 confirm 路径；0 未确认写入 |
| **优先级** | **P1** |

#### GAP-P1-06 · Browser 监督生产

| 项 | 内容 |
|----|------|
| **目标** | 公网任务可重复；审批/恢复可解释；私网保持 deny |
| **优先级** | **P1**（若 Browser 在你的“可见功能”集合内） |

#### GAP-P1-07 · staleWriteGuard 可生产默认候选

| 项 | 内容 |
|----|------|
| **缺** | 真编辑器 churn 假阳性率 + override UX |
| **优先级** | **P1**（写安全） |

#### GAP-P1-08 · TaskLoop 场景覆盖

| 项 | 内容 |
|----|------|
| **现状** | task_phase_change 主 producer 在 TaskLoop |
| **目标** | 凡宣传 task_state/SEKB trajectory 的功能，验收必须含 loop 任务 |
| **优先级** | **P1** |

---

### 4.3 P2 — 默认生产 / 全员无感（5～12 周+）

#### GAP-P2-01 · TF-0006 解封四件套

| 文件 | 状态 | 要求 |
|------|------|------|
| `corpus-manifest.json` | ❌ | 非 synthetic；64K 级或产品批替代规模 |
| `live-ab-report.json` | ❌ | 人审 A/B、事故、opt-out |
| `soak-report.json` | ❌ | 稳定窗口（建议 ≥2 周） |
| `product-approval.json` | ❌ | 具名审批 + **可毕业 flag 列表** |

#### GAP-P2-02 · 分表面 default-on 毕业（禁止联合一次翻）

建议顺序（可调）：

1. **view tools**（工具可见性最大）  
2. **working-memory 注入**（体验最大）  
3. **tool_registry**  
4. **staleWriteGuard**（安全）  
5. **VToken assembly** 或明确永不默认  
6. **symbolLease / git worktree / patchFlow** 按并发需求  
7. **C6 ladder** 仅在有 live 64K 后  
8. **C7 cutover** 仅在 shadow 窗口 + 审批后（可能永久人审）

每步：`consider-default-on` → 灰度 → `default-config-matrix` 变更 → 一键 rollback 文档。

#### GAP-P2-03 · 双注入预算动态协调

| 项 | 内容 |
|----|------|
| **现状** | `KNOWLEDGE_INJECTION_CHAR_BUDGET=2000` 常量；CVK + DCS + VToken 无动态裁剪 |
| **目标** | 统一预算器；超限可观测 |
| **优先级** | **P2** |

#### GAP-P2-04 · 观测产品化

| 项 | 内容 |
|----|------|
| **目标** | Settings/Observability 页展示 injection hits、view tool calls、falseBlockRate、kill 状态 |
| **优先级** | **P2** |

#### GAP-P2-05 · C4/C5 默认强化（按需）

| 项 | 内容 |
|----|------|
| git worktree 默认 | 需 Windows soak；现默认 inprocess **合理** |
| WAL lease 默认 | 需多进程证据；现 memory **合理** |
| **原则** | 无并发痛点可不默认 on，但 UI 不得暗示“已默认隔离” |

---

## 5. 目标态架构（Visible → Productive）

```text
用户 Settings
  ├─ [生产开关组] DCS
  │    ├─ 工作记忆注入 (working-memory)     ──► config-sync ──► Assembler
  │    ├─ 工具注册表摘要 (tool_registry)   ──► Assembler
  │    ├─ 上下文视图工具 (view tools)      ──► env/config ──► tool catalog
  │    ├─ 写保护 (staleWriteGuard)         ──► coding flags
  │    └─ 状态：已生效 | 未同步 | 存储故障
  ├─ [生产开关] VToken Working Context     ──► bridge+assembly 一次开
  ├─ [生产流程] SEKB 人审写回              ──► confirm only
  └─ [Kill] 一键切断全部增强               ──► kill switch

禁止终态：只读 Flag 墙、env-only 专家路径、shadow 冒充已启用、死配置 true。
```

---

## 6. 里程碑与工作量

### M0 — 诚实与可操作（约 1～2 周）

- [ ] GAP-P0-01～06  
- [ ] 关键 E2E 复绿 + 真 kill 一次  
- [ ] 文案：opt-in ≠ 已生产  

**出口**：用户不再“看见假开关”；专家路径降为高级。

### M1 — 主路径可生产使用（约 2～4 周，含真人）

- [ ] Settings 打开后：**view tools + working-memory** 真干活  
- [ ] 每面 ≥10 次真人任务记录  
- [ ] SEKB 人审闭环 10 次  
- [ ] VToken/DCS 主路径书面决策  

**出口**：**对你定义的“看得见的主功能”已生产可用（可仍非全员默认）**。

### M2 — 默认生产候选（约 5～8 周起）

- [ ] TF-0006 四件套  
- [ ] 至少一个表面 default-on 灰度  
- [ ] 预算协调 + 观测面板  

**出口**：`readyForDefaultFlagGraduation` 可讨论；**仍禁止**无审批联合 GA。

### M3 — 全可见面清零 shelfware（约 2～4 月）

- [ ] 矩阵中每一行：`已达标` 或 `已隐藏/Retired`  
- [ ] 无 Display-only 生产开关  
- [ ] Runtime Memory 要么 liveReady 要么永不进卖点  

---

## 7. 红线（达到目标时仍不能破）

1. 不靠“改默认证明可用”绕过 live 证据。  
2. SEKB **禁止**无人 auto writeback（除非单独改产品政策与安全评审）。  
3. Browser 私网默认 deny。  
4. kill switch 必须在一个操作周期内切断增强。  
5. 合成 canary / Agent Dev 绿 **≠** 生产可用。  
6. packaging 路径 **不得 auto-flip** 默认。  

---

## 8. 建议执行顺序（针对你的目标）

```text
第 1 周   P0 诚实：可写 Flag 面板 + 死配置修复 + 隐身工具可发现 + 废弃下架
第 2–3 周 P1 真干活：working-memory 注入 + view tools 经 UI 稳定启用 + 真人 10×2
第 3–4 周 SEKB/Browser/VToken 决策与闭环；主路径唯一化
第 5–8 周 TF-0006 证据 + 第一个 default-on 表面（建议 view tools 或 working-memory）
之后     其余表面毕业或下架，清零 shelfware 表
```

**人力粗估**（单小队）：  
- M0：1 名全栈 + 0.5 产品文案  
- M1：+1 运行时 + 真机操作员  
- M2：+数据/评测 + 产品审批人  

---

## 9. 附录：快速对照“已生产 vs 只能看”

| 已接近生产可用 | 仍是只能看 / 专家才能用 |
|----------------|-------------------------|
| write/edit/apply_patch + envelope | DCS Flag 只读面板 |
| parseOnTouch / writeJournal | view 四工具（默认隐身） |
| TaskLoop 工具本体 | working-memory **注入** |
| CVK 导航壳（有限价值） | tool_registry / knowledge 注入 |
| config-sync 整 runtime 键 | factViews 死配置 true |
| P0 门禁与 kill 设计 | C6/C7 API/shadow |
| SEKB **协议**存在 | SEKB **默认真空** + 无顺滑 UI |
| VToken Bridge 开关 | VToken assembly 默认关与双门 |
| Browser 安全默认 | Browser 真任务 soak 不足 |

---

## 9.1 可执行任务切片（已持久化）

开发进度**不要**继续堆在本缺口总览里。已拆为：

| 路径 | 角色 |
|------|------|
| [`dcs-visible-production/STATUS.md`](./dcs-visible-production/STATUS.md) | **仅元数据**：任务注册表、active/next、hardLocks |
| [`dcs-visible-production/tasks/TASK-*.md`](./dcs-visible-production/tasks/) | **一任务一文档**：目标、切片、验收、Progress log |
| 工作区镜像 | `ClawX-maturity-p0/docs/dev/dcs-visible-production/` |

丢上下文：先读 STATUS → 再打开 `nextTaskId`。

### 壳 vs 芯文案（TASK-P0-05）

Settings → Developer 顶部 **Context layers explainer** 明确三层：

1. **CVK** = 默认导航壳（元数据，不等于记忆已开）  
2. **DCS** = BlockStore 工作记忆/工具（opt-in）  
3. **VToken** = Working Context 源打包（不替代 DCS）

实现：`src/components/settings/ContextLayersExplainer.tsx` + i18n `developer.contextLayers.*`。

## 10. 文档维护

| 变更时 | 更新 |
|--------|------|
| 任务进度 | **只改** `dcs-visible-production/STATUS.md` 一行 + 对应 `TASK-*.md` log |
| Flag 面板可写落地 | 将 UI-01 / GAP-P0-01 标闭合 + TASK-P0-01 done |
| 壳/芯文案 | TASK-P0-05 + Settings developer 三层面板 |
| 任一表面 default-on | 更新 §2 表 + `default-config-matrix.md` + TF-0006 |
| 废弃面下架 | §2.5 / G-F* |
| 冲突裁决 | **以源码默认值 + 本仓库 artifacts 最新 report 为准**；旧 liveness（7/11）仅作史 |

**相关文档**

- 就绪审计：`ClawX-maturity-p0/docs/dev/component-readiness-audit-2026-07-20.md`  
- 默认矩阵：`docs/dev/default-config-matrix.md`  
- Flag 目录：`shared/dcs/prod-flags-catalog.ts`  
- 毕业矩阵：`team/claude/CODING-FLAG-GRADUATION.md`  
- TF-0006：`docs/dev/tf0006-evidence-upgrade-unblock.md`  
- 受控 canary：`docs/dev/dcs-ops-canary-runbook.md`  
- 生产 runbook：`docs/dcs-production-p0-runbook.zh-CN.md`  

---

## 11. 结论（给决策者）

| 问题 | 答案 |
|------|------|
| 现在是不是“有了但不能用”？ | **对大量可见增强面：是**（只读目录、默认关、隐身工具、只产不注）。对基线 coding 写路径：**不是**。 |
| 要满足“所有看见的功能都能生产用”还差什么？ | **(1) 可写生产控制面 (2) 隐身能力可发现并真生效 (3) 注入类默认或一键真进 prompt (4) 死配置/废弃面清理 (5) 真人 live 证据与分表面毕业 (6) TF-0006** |
| 最短有意义胜利 | **M0+M1**：Settings 真开 view tools + working-memory，并完成真人任务——此时主可见 DCS 能力从 shelfware 变成生产可用（仍可非全员默认）。 |
| 全表清零 shelfware | **M2+M3**，日历通常 **2～4 个月**量级，取决于 live 语料与审批。 |

---

*生成说明：综合 2026-07-20 组件就绪审计、prod-flags-catalog、源码默认 flag、C1 canary keep-off、TF-0006 blocked、以及多代理深研交叉验证（35 CONFIRMED / 5 STALE）。*
