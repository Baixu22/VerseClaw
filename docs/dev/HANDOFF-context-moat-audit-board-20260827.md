# Context-Moat 双车道审计看板交接（2026-08-27）

> **给接手 agent**：本文件基于 `docs/dev/context-moat/AUDIT-BOARD.html` 的当前快照整理，用于快速恢复现场。它同时覆盖车道 1 与车道 2，**不预设你接的是哪一条车道**。看板是静态审计视图，**任务状态的最终事实仍以 `.agent-workbench/task-forest/` 为准**。接手后请先读：
> 1. `docs/dev/context-moat/AUDIT-BOARD.html`
> 2. `docs/dev/context-moat/DEV-PROTOCOL.md`
> 3. `docs/dev/context-moat/reviews/TF-0121.md`
> 4. `.agent-workbench/task-forest/graph/nodes.json`（只读，不手改）

---

## 0. 当前环境

- **仓库**：`D:\ClawX`
- **分支**：`feat/runtime-lifecycle-governance`
- **交接时 HEAD**：`26b7f436e`（`chore(context-moat): report the TF-0143 radius overrun instead of absorbing it`）
- **更新于**：车道 1 收口 TF-0121（`b410bc702` / `ec5a39d43`）并把 TF-0143 的语料搜索面穷尽结论与半径超限上报（`f35cb4a13` / `283045a7f` / `26b7f436e`）之后
- **看板路径**：`docs/dev/context-moat/AUDIT-BOARD.html`（含 §1.5 的跨车道 Issue 区）
- **当前工作树**：存在 10 个 `M` 状态噪音（CRLF/换行差异），`git diff HEAD` 为空，内容级干净
- **共享树纪律**：两条车道共用同一工作树和同一 git index，禁止 broad-stage、`reset`、`stash`、`checkout`、`revert --no-commit`
- **接手第一步**：先确认自己承接的是 lane-1 还是 lane-2，再只处理对应车道的当前任务。当前两条车道都有可推进项（车道 1：TF-0143；车道 2：TF-0113），没有互相阻塞。

---

## 1. 看板总览

| 指标 | 数值 | 含义 |
|---|---:|---|
| 已收口 | 10 | 两条实现车道的核心任务 |
| 进行中 | 1 | TF-0143 真实长会话语料 |
| 待互审 | 0 | TF-0121 已由车道 1 复核收口 |
| 待启动 | 9 | 两条实现车道的后续任务 |
| 阻塞 | 1 | TF-0129 等待前置 |

**当前没有待互审件。**

---

## 1.5 跨车道 Issue 通道（2026-08-27 新增）

两条车道各持一个会话、**互不可见对方上下文**，此前唯一的握手面是 `reviews/*.md` 的散文与 Task Forest 的 `next_action` —— 能表达「我做了什么」，但不能表达「我要你做什么、做完什么算完」。看板现新增 **「跨车道 Issue」区**（`AUDIT-BOARD.html`，位于统计卡之后）承担这件事，编号 `XL-*`。

四条规则（写在看板上，此处只作索引）：

1. **只镜像，不是真相源。** 每条 issue 的权威副本在 Task Forest（`next_action` / `evidence` / `deviations`）或 `reviews/*.md`。只改 HTML 不改变任何 issue 的实际状态，也不构成 §R1 审核判定。
2. **只有指派方能标「已答复」。** 提出方不得自问自答后自行关闭 —— 与 §R1.0.1 同源。
3. **每条 issue 必须有「收口判据」**，且判据须是可机械核对的落盘物（某文件的某一段、某 node 的某字段、某状态值）。写不出判据的条目不得开为 issue。
4. **不替代 `reviews/<task-id>.md`。** issue 只负责「谁该动手、动完什么算完」；论证与证据仍落审核记录。

交接时的五条：

| # | 提出 → 指派 | 关联 | 状态 | 一句话 |
|---|---|---|---|---|
| XL-001 | lane-1 → lane-2 | TF-0121 | 已答复 | 两个阻塞点，已由 `6e802bcb5` / `7cc710ce1` 处置 |
| XL-002 | lane-2 → lane-1 | TF-0121 | 已答复 | 车道 1 复核三点全部接受，TF-0121 置 `done / 100`（`b410bc702` / `ec5a39d43`） |
| XL-003 | lane-2 → 用户 | §R3 | **待裁决** | 命令 3 假阳性随 Task Forest 写入线性增长（16 → 44 → 54），是否授权本轮修订 |
| XL-004 | lane-1 → lane-2 | TF-0147 | **待处理** | assembler lifecycle filter 的强制后续约束只挂在已 `done` 的 TF-0121 上，需迁挂到活节点（backlog-P1，不阻塞任何任务） |
| XL-005 | lane-1 → lane-2 | TF-0143 | **待处理（阻塞 TF-0143 收口）** | TF-0143 零代码改动即达半径 10/5（`brb-S`），§R3.5 两条出口均不适用，请 §R3 owner 车道择一处置 |

「需要关注的裁决」区**不再新增条目**，只保留历史五项直到逐条关闭；新裁决请求一律走 `XL-*`。

---

## 2. 车道 1 当前状态

### 已收口

以下任务均已 `done / 100%`，无需再动：

- TF-0111 剪枝摘要与上一轮摘要合并
- TF-0116 实验件迁出 `src/`
- TF-0126 修复 `working_memory` 永久跳过
- TF-0117 契约措辞与实现对齐
- TF-0128 损伤检测去契约耦合 + 四维通电
- TF-0124 统一两套摘要章节契约

### 当前任务：TF-0143

- **状态**：`in_progress / 15%`
- **目标**：产出至少一份 `≥40 user turns` 且 `≥2 compaction entries` 的真实 OpenClaw 会话语料，并登记脱敏元数据
- **搜索面已穷尽（2026-08-27 实测，`f35cb4a13`）**：对 OpenClaw sessions 目录下全部 **174 个**非 trajectory 会话 JSONL 逐个计数（`type=compaction` 计压缩，`type=message` 且 `message.role=user` 计轮次），满足两项判据的会话 **0 个**，且**全语料压缩次数上限恒为 1** —— 「≥2 次压缩」不是挑候选的问题，那样的语料还不存在
- **当前最佳候选**：
  - 路径：`C:\Users\27933\.openclaw\agents\main\sessions\57c00668-baf0-44d4-8cb3-531fda2a6667.jsonl`
  - 实测：251 行 / user 41 / assistant 120 / toolResult 85 / compaction 1（看板旧记的 39 轮已过时）
  - `mtime` 2026-08-27 15:02 —— 上次登记后确有续跑，但未触发第二次压缩
- **当前阻塞**：需要第二次真实 compaction；外部模型凭据当前不可用
- **下一步**：**不要再扫描既有 JSONL**（已穷尽）。唯一路径是待凭据可用后对同一会话真实续跑至第二次 compaction，再做凭据/绝对路径脱敏检查并登记哈希；不得用其他 agent 的 JSONL 冒充 OpenClaw 语料
- **收口前必须先解 `XL-005`**：TF-0143 在零代码改动下半径已 10/5（`brb-S`），仅靠上述两次治理记录就耗尽预算；§R3.5 两条出口均不适用，裁决权在 lane-2。deviation `TFD-tf0143-radius-overrun-2026-08-27` 为 `open`

### 车道 1 后续固定顺序

`TF-0143` → `TF-0138` → `TF-0122`

不要提前改序；TF-0122 仍受 TF-0114 已完成的依赖约束，且不得越过用户裁决项。

---

## 3. 车道 2 当前状态

### 已收口

以下任务均已 `done / 100%`，无需再动：

- TF-0110 记忆双门控接线
- TF-0114 CJK 召回兜底 + 中文回归语料
- TF-0118 死导出与孤儿 provider 清理

### 车道 2 后续固定顺序

~~`TF-0121`~~ → **`TF-0113`** → `TF-0119` → `TF-0112` → `TF-0137` → `TF-0139` → `TF-0140`

TF-0140 是唯一允许触碰默认值的任务，且必须先有人工批准文件。

### 当前任务：TF-0113（TF-0121 已收口）

- **状态**：`proposed / 0%`，`brb-S`，标题「T-P0-5 MCP 目录缓存接传输层断连失效」，`primary_parent = TF-0108`
- **可开工原因**：TF-0121 已于 `b410bc702` 置 `done / 100`，固定顺序的前置解除

### 已收口：TF-0121

- **状态**：`done / 100`
- **实现提交**：`25285ab42`（实现，8 files）、`794157405`（补充测试，1 file）、`aa6fd16b0`（车道 2 evidence / Task Forest / 看板边界说明）
- **车道 1 首审**：`1314fde31`（判 `review_needed`，两个阻塞点）
- **车道 2 处置**：`6e802bcb5`（两个阻塞点）、`7cc710ce1`（§R3 实测）、`cc72e8e85`（看板同步）
- **车道 1 复核收口**：`b410bc702`（状态 + 看板）、`ec5a39d43`（复核记录）

#### 收口时的判据

- L1 六门全部 exit 0；定向测试 runtime 3 files / 34 passed、agents 1 file / 20 passed —— 复核时**未复跑**，依据是 `git diff aa6fd16b0..HEAD -- openclaw_runtime/ shared/ harness/` 为 0 行（代码字节未变）
- A1 生产可达（四符号 exit 0）；阴性对照 0/1/2/3 复现，`factViews=12` 与 §R1.3 的 11 之差归因于已收口的 TF-0117（`395683c6f`）
- 变异抽查、`git apply -R` 回滚检查：沿用首审结论
- 半径：`brb-L`。**29/40**（车道 2 交回时）与 **30/40**（含车道 1 收口写入）两次均 PASS
- schema guard：空。default guard：54 行命中，剔除 `.agent-workbench` 后 runtime 为 0
- requirements 4/4 PASS，acceptance criteria 4/4 PASS

#### 两个阻塞点 —— 均已闭合

1. **AC-4（assembler 决策未写入 node）→ 已收口。** 决策为**不加 dormant lifecycle filter**，已写入 node evidence。三条依据经车道 1 独立复跑确认：`check-production-reachable.mjs archiveLowHeatBlocks applyContextLadder` 双双 exit 1 / zero production call sites；全仓非测试代码 archive writer 数 = 0；`assembler.ts` 零 lifecycle 引用且三处 `store.query()` 仍为 :471/:552/:651，`filterBlocksByLifecycle` 唯一生产消费者是 `context-read-tool.ts:130`。即生产中不可能存在 archived 块，加过滤器是 §D1.0 的「建成未通电」重演。
2. **公开契约边界 → 出路 B（新增 task）被车道 1 接受，落成 TF-0147。** 「拆分不消除歧义本体」的理由经复核成立：`tool-registration.ts:75` 的 `ToolRiskLevel` 确为 `readonly`/`write`/`destructive` 三档，:66-74 的 doc-comment 三档语义全部绑定 filesystem 写入，故拆出的新工具只能再标一次 `readonly`，把一处歧义变两处。TF-0147 挂 TF-0144（M6/round-2）而非 TF-0120，与 §R3.6「预算冻结于 B1」一致；`TFE-0264` / `TFE-0265` 两条边与双向 evidence 引用均已核验。

#### 相关偏差记录

- `TFD-lane2-tf0121-boundary-followup-2026-08-27`（§R4.2(a) 范围增减）—— **保持 `open`，不转 `rejected`**：车道 1 接受了这次范围增减，它的正确终态是等 TF-0147 收口
- `TFD-lane2-toolrisklevel-backlog-p1-2026-08-27`（§R4.2(c) 判为本轮不修）—— 保持 `open`
- `TFD-tf0121-radius-overrun-2026-08-27`（半径超 `brb-M`）—— 保持 `open`，`brb-L` 裁决已落 `context_tags`

#### 遗留（不阻塞任何任务）

`XL-004`：AC-4 决策附带的强制后续约束「一旦出现生产 archive writer，必须另立 task 在 assembler 注入路径补 lifecycle filter」目前只挂在已 `done` 的 TF-0121 evidence 上 —— 存放位置恰好在它生效时不会被读到。判为 backlog-P1，指派 lane-2 迁挂到活节点（TF-0147 或 M6 的 TF-0129/0130/0141 之一）。

**`risk:"readonly"` 仍未改，且不构成「无 durable mutation」的证明** —— 在 TF-0147 收口前任何审核者不得如此解读。该禁令已写入 node evidence 与两条 deviation 的 recommendation，可 grep。

---

## 4. 待用户裁决 / 仍开着的问题

> 新的裁决请求走 §1.5 的 `XL-*` 通道；本表只保留交接时已累积的历史项。

| # | 事项 | 当前状态 | 建议下一步 |
|---:|---|---|---|
| 1 | TF-0143 语料边界 | 已找到多份其他 agent 的真实 JSONL，但不能冒充 OpenClaw 会话 | 等有效模型凭据后继续真实续跑 |
| 2 | TF-0121 read-only 边界 | **已收口**：车道 2 选出路 B 落成 TF-0147，车道 1 复核接受并置 TF-0121 `done / 100`（`XL-002` 已答复） | 无需用户动作。歧义本体（`ToolRiskLevel` 缺维度）由 TF-0147 在 round-2 处理 |
| 3 | TF-0140 翻正授权 | 需要人工签核 `docs/dev/context-moat/approvals/TF-0140.md` | 用户签字后再启动 |
| 4 | D03 车道归属冲突 | `coding-runtime-flags.ts` 的车道列与登记触碰者不一致 | 用户裁决按哪一方执行 |
| 5 | checkpoint 进程与 trailer 归属 | 自动提交进程可能抢先提交，导致部分文件失去 `Lane:` 归属 | 用户裁决是否接受 append-only 记录 |
| 6 | **§R3 命令 3 假阳性增长**（`XL-003`） | 同一 task 上命中数 16 → 44 → 54，全部来自 snapshot 复制整张图；runtime 恒为 0。车道 1 复核时提供了第三个数据点，不代裁 | 用户裁决是否授权本轮给命令 3 补 `':!.agent-workbench'` 排除 |
| 7 | **`XL-004` assembler 约束迁挂** | 车道 1 复核 TF-0121 时开出的 backlog-P1，已指派 lane-2，不阻塞任何任务 | 无需用户动作，除非你想改判其严重度 |

---

## 5. 恢复命令

接手后先执行以下命令确认现场：

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff HEAD -- openclaw_runtime/src/agents/tools/context-agent-tools.test.ts
```

查看 Task Forest 节点：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
py -3 -X utf8 "C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py" show TF-0143 --json
py -3 -X utf8 "C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py" show TF-0121 --json
```

如需验证看板与 Task Forest 一致性：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
py -3 -X utf8 "C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py" validate
```

---

## 6. 硬边界

- **不要**手改 `.agent-workbench/task-forest/graph/*.json`
- **不要**用 `git reset` / `git stash` / `git revert --no-commit`
- **不要** broad-stage；提交必须用显式 pathspec
- **不要**把其他 agent 的真实会话当成 OpenClaw 会话语料
- **不要**把 `risk:"readonly"` 解释为“无 durable mutation”
- **不要**跨越 B1/B2/B3 同步点，需用户裁决
- **不要**修改任何旗标默认值，唯一例外是 TF-0140 且必须先有人工批准文件

---

## 7. 当前建议动作

### 接手车道 1

1. 继续推进 TF-0143，目标是拿到第二次真实 compaction
2. 在没有有效模型凭据前，不要伪造或改写 JSONL
3. 若需要暂停 TF-0143，可先做不依赖外部模型的任务，但不要越界改车道 2 的源域
4. 完成后按固定顺序进入 TF-0138，不得提前做 TF-0122

### 接手车道 2

1. **TF-0121 已收口为 `done / 100`，不要重做它。** 车道 1 的复核判定见 `reviews/TF-0121.md` §「车道 1 复核判定」与 `XL-002`
2. 按固定顺序开工 **TF-0113**（`brb-S`），不得跳到 TF-0140
3. 处理 `XL-004`：把 assembler lifecycle filter 的强制后续约束迁挂到活节点（TF-0147 或 TF-0129/0130/0141 之一）。这是 backlog-P1，不阻塞 TF-0113，可与之并行
4. TF-0147 属 round-2（M6），**本轮不投入工时**，不要提前开工；`XL-004` 只是往它的 requirement/assumption 里补一条约束，不算开工

### 用户

1. 裁决 TF-0140 翻正授权
2. 裁决 D03 车道归属冲突
3. 裁决 checkpoint 进程与 trailer 归属的处理方式
4. 裁决 `XL-003`：是否授权本轮修订 §R3 命令 3
