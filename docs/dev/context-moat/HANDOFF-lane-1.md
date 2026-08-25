# 车道 1 交接文档（context-moat 长任务上下文护城河轮）

> **给接手 agent**：本文件是车道 1 的完整交接。读完本文件 + `docs/dev/context-moat/DEV-PROTOCOL.md` 即可接手，**不要凭猜测开工**。
> 生成于 `HEAD = <本提交>`，2026-08-25。车道 2 有一份对应的交接文档，两份互不覆盖。

---

## 0. 你是谁，边界在哪

你是**车道 1**，与**车道 2 在同一个 repo、同一个工作树、同一个 git index 上并发工作**。协作靠三件事：文件域互斥（§R4.5）、共享 task-forest 图、交叉审核（§R1.0.1 禁止自审）。

**车道 1 的线**：上下文 · 压缩 · 注入。独占域 D04 / D05 / D06 / D09 / D11 / D16-D19。
**车道 1 拥有的协议节**：§D1、§R1、§R4、§R5（车道 2 拥有 §R2、§R3、§D4）。**禁止跨节编辑**——需要改对方的节时，路由给对方，不要自己动手。

---

## 1. 绝对不许违反的硬约束

这些不是建议。本轮已因违反其中两条产生过真实事故。

1. **每次 task-forest CLI 调用都必须带 `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`**（Windows）。否则中文输出是乱码，你会基于乱码做判断。
2. **绝不手改** `.agent-workbench/task-forest/graph/nodes.json`、`graph/edges.json`、`config.json`。结构性改动一律走 `proposal-save` + `proposal-apply <id> --yes --actor lane-1`，且**生成后立即 apply**（放着会 stale）。
3. **绝不删** `.agent-workbench/task-forest/lock`。
4. **`--allow-stale` 禁用**。它会静默丢掉另一车道的 task 信息。
5. **提交必须 pathspec 限定**：`git commit -- <本 task 真正改的路径>`。**裸 `git commit` 会把另一车道已 staged 的文件一起吞掉** —— 本轮的 `TFD-lane1-index-bleed-2026-08-24` 就是这么来的。两个 task 的改动**绝不混进一个 commit**。
6. **提交必须带 trailer**：实现者用 `Task: TF-XXXX`，非实现者写审核判定用 `Reviews: TF-XXXX`；两者都加 `Lane: lane-1`。trailer 决定 §R3 半径归属，打错一个字符会让 `git show` 退化为 `git show HEAD` 并报出别人的文件数。
7. **禁用 `git revert --no-commit` / `git reset` / `git stash`** —— 两条车道共用一个 index。回滚验证只用 `git apply -R`（仅工作树）。
8. **车道 1 不得改任何旗标默认值。** 本轮唯一例外是车道 2 的 TF-0140，且需要 `docs/dev/context-moat/approvals/<task-id>.md` 的人工批准文件。
9. **同步点 B1 / B2 / B3 不得自行放行**，报给用户。
10. **仓库里那一大批 round 前的未提交改动（345 项：195 改 / 7 删 / 143 未跟踪，横跨 `src/components` `src/pages` `src/styles` `shared/i18n`）不属任何车道**：不碰、不提交、不 stash。§R5 范围-3 规定本轮零 renderer 改动。
11. **跨包仓库里所有 `git status` / `git diff` 路径断言必须用绝对路径。** 本仓有 `openclaw_runtime/package.json` 与仓库根 `package.json` 同名；相对路径在 shell cwd 漂移时会命中错误的那个、返回空 diff，**伪造出「文件干净」或「第三方改动已丢失」的结论**。我在审核 TF-0118 时踩过这个坑。
12. **同一方法连续失败两次就停下**，说清根因、换路子。

---

## 2. task-forest：目录与命令

**CLI**：`~/.claude/skills/task-forest/scripts/task_forest.py`
**数据根**：`D:\ClawX\.agent-workbench\task-forest\`

```
.agent-workbench/task-forest/
├── graph/{nodes,edges,forest}.json     ← 只读，绝不手改
├── config.json                          ← 只读，绝不手改
├── deviations/deviations.jsonl           ← 只经 proposal 写入
├── events/events.jsonl
├── todos/todos.json
├── alignments/alignments.jsonl
├── proposals/TFP-*.json                  ← proposal-save 落盘处
└── exports/task-forest.{graph,timeline,todos}.json + .html
```

**常用调用**（每条都要带 UTF-8 env）：

```bash
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python ~/.claude/skills/task-forest/scripts/task_forest.py show TF-0117 --json
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python ~/.claude/skills/task-forest/scripts/task_forest.py list --status in_progress
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python ~/.claude/skills/task-forest/scripts/task_forest.py update-node TF-0117 --status in_progress --progress 20
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python ~/.claude/skills/task-forest/scripts/task_forest.py validate
```

**踩过的坑，别重踩**：

| 坑 | 正确做法 |
|---|---|
| `--progress 0.9` 渲染成 `0.9%` | **progress 是 0-100，不是 0-1** |
| `--add-evidence` 不存在 | 是 `--append-evidence` |
| `proposal-apply --proposal-id X` 报 unrecognized | proposal id 是**位置参数**：`proposal-apply <id> --yes --actor lane-1` |
| evidence 里的反引号被 shell 当命令替换执行，落盘文本丢字 | 长文本一律走 `--fields-file <json>`，不要走命令行 |
| `show` 不带 `--json` 看不到完整字段 | 判断前一律 `--json` |

---

## 3. 本轮进度总览

**全局 task**：`TF-0102` 长任务上下文护城河（可归因的上下文治理）。

| 里程碑 | 节点 | 状态 |
|---|---|---|
| M0 文档相 | `TF-0103` | **done** —— 七节全部收口，L2 二次尝试通过 |
| M1 P0 止血 | `TF-0108` | proposed |
| M2 技术债清偿 | `TF-0115` | proposed |
| M3 有背书的半成品补齐 | `TF-0120` | proposed |
| M4 差异化通电 | `TF-0127` | proposed |

**同步点**：

- **B1（七节全收口）已放行**。判据 `grep -cE '^<!-- owner=lane-[12] node=TF-' docs/dev/context-moat/DEV-PROTOCOL.md` 实测 **0**。
- **B2**：车道 2 的 TF-0140 `depends_on` 车道 1 的 TF-0128。TF-0128 目前 `review_needed`，**尚未 done** —— 这是 B2 唯一的实质前置，见 §6。
- **B3**：TF-0140 翻正落地后 14 天 soak 冻结 `assembler.ts` / `extensions.ts` / `prod-flags-catalog.ts`。未开始。
- **三个 barrier 都不由任何单一车道放行**，报用户。

---

## 4. 车道 1 的固定排班（§R4.7，不许改序、不许挑软的做）

`TF-0136 D3(0)` → `TF-0128 T-C1(360)` → **`TF-0117 T-D2(90)` ← 你从这里开始** → `TF-0126 T-B6(300)` → `TF-0116 T-D1(240)` → `TF-0111 T-P0-2(180)` → `TF-0124 T-B4(300)` → `TF-0143 T-CORPUS(180)` → `TF-0138 T-C0(180)` → `TF-0122 T-B2(90)`

| Task | 状态 | brb | 标题 | 备注 |
|---|---|---|---|---|
| TF-0136 | **done** | – | D3 决策：T-C5/TF-0013 与 T-C4/TF-0031 的关系裁定 | |
| TF-0128 | **review_needed** (90%) | M | T-C1 损伤检测去契约耦合 + 上线 + 健康分四维通电 | **等车道 2 审核**，见 §6 |
| **TF-0117** | **proposed** ← **下一个** | S | T-D2 契约措辞与实现对齐（三处注释说谎） | 已完成开工前自检，见 §5 |
| TF-0126 | proposed | M | T-B6 修 `working_memory` 通道在同一 attempt 内被永久跳过 | **被 §1.10 的孤儿改动挡住**，见 §7 |
| TF-0116 | proposed | M | T-D1 实验件迁出 `src/` | **纯搬迁，不许顺手重构** |
| TF-0111 | proposed | S | T-P0-2 剪枝摘要与上一轮摘要合并 | |
| TF-0124 | proposed | M | T-B4 统一两套摘要章节契约 | 图上 `depends_on` TF-0128（blocking） |
| TF-0143 | proposed | S | T-CORPUS 真实长会话语料（≥40 轮 + ≥2 次压缩 JSONL） | |
| TF-0138 | proposed | S | T-C0 spike：真实长会话的一次上下文损失追踪 | **产物必须去标识化**，见 §8 |
| TF-0122 | proposed | S | T-B2 裁决 hybrid 检索链去留 | 须待车道 2 的 TF-0114 完成（blocking，D13 跨车道） |

**两处机械验证过的顺序，不要挪**：

- **TF-0117 必须紧跟 TF-0128**。它触碰 D04/D05，留到尾部会与车道 2 的 TF-0140 及其 soak 期重叠，**直接违反 B3**。
- **TF-0128 必须先于 TF-0124**（图上已是 blocking 边）。顺序反了会静默废掉本轮最核心的差异化能力。

---

## 5. 你的第一个动作：TF-0117

**开工前自检（§R4.10 第 1 步）我已跑完，结论：可以开工。** 但你落地前**重跑一次**，因为车道 2 随时可能开新 task：

```bash
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python ~/.claude/skills/task-forest/scripts/task_forest.py list --status in_progress
git status --porcelain -- /d/ClawX/openclaw_runtime/src/context-engine/turn-injection-budget.ts \
  /d/ClawX/openclaw_runtime/src/context-engine/coding-runtime-flags.ts \
  /d/ClawX/openclaw_runtime/src/context-engine/assembler.ts
```

我实测时：车道 2 无 `in_progress` 的实现类 task（TF-0118 已交回 `review_needed`），三个目标文件**全 CLEAN**。

**TF-0117 = 纯注释/文档 task，`non_goals` 明写「不改任何行为」。** 三处说谎（符号锚定，行号请自行复核，我核对时仍成立）：

| # | 位置 | 注释声称 | 实现 | 要求 |
|---|---|---|---|---|
| 1 | `turn-injection-budget.ts` ≈:420（`skipTurnInjection` 上方） | `charsApplied` must equal the turn's real prompt growth | 只计 `text.slice(beforeLen)`；基线 `extraSystemPrompt` 与 1409 行基础 system prompt 不在分母 | 改为「等于 DCS 通道追加的字符数，不含基线」。**真实两档边界归 M4 的 T-C5，本 task 不做** |
| 2 | `coding-runtime-flags.ts` :8-11（文件头注释块） | `factViews` 叶子 `has been removed` | schema/type 仍接受 | 只改措辞。**配置面由车道 2 的 T-P0-4（TF-0112）处理** |
| 3 | `assembler.ts` :66-75（`skipChannels` 的 doc） | channels that produced new Blocks since the last call are still queried | `extensions.ts:338-342` 把所有 `charsApplied>0` 的通道加进 `injectedChannels` 并在后续 model call 全部 skip —— **与注释相反** | 须与 TF-0126（T-B6）的行为修复同步：T-B6 先修行为则注释保持原意，否则注释改为描述当前实现 + TODO 指向 T-B6 |

**AC**：三处措辞与实现一致且各附 `file:line` 依据；A3 PASS。
**注意**：`extensions.ts:338-342` 只是**证据**，不是编辑目标。TF-0117 不需要碰 `extensions.ts` —— 我上一轮一度误判它阻塞 TF-0117，已更正。

### ⚠️ TF-0117 的一个未决登记问题，开工时必须先处理

`coding-runtime-flags.ts` 是 **D03**，域表的「车道」列写 **2**，但**登记触碰者里有 TF-0117 和 TF-0146（都是车道 1）**。同时最初的交接词把 D03 列为「车道 2 独占，不得触碰」。两处说法冲突。

§R4.5 的**操作性规则**是「每个域同时只允许 1 个 `in_progress`」——按这条读，「车道」列是粗标签而非独占锁，登记触碰者才是授权凭证，TF-0117 有授权。

**但不要自己拍板。** 开工前确认车道 2 的 TF-0112 / TF-0137 均非 `in_progress`；若要按上面这条读法落地，**记一条偏差**说明你采用了哪种读法，并把结论报用户。这正是本轮两次真实事故的形态（登记与实际不符），不要靠推测跨过去。

---

## 6. 你认领的审核点（§R1 交叉审核，禁止自审）

**审核是硬义务，不是可选项**：§D1 的「完成」定义要求 (b) **反向证伪由非实现者复跑**。实现者永远不能自己放行。

### 已完成的审核（我做的，无需重做）

| 被审 task | 车道 | 我的判定 | 记录 |
|---|---|---|---|
| TF-0109 / TF-0142 / TF-0106 / TF-0107 | 2 | 全部 done | `reviews/` 对应文件 |
| **TF-0118**（T-D3 死导出清理） | 2 | **A3 FAIL；其余非 FAIL；AC-2/AC-3 PASS；维持 `review_needed`** | `reviews/TF-0118.md` 的「非实现者审核（lane-1）」节 |

**TF-0118 交回车道 2 的最小收口清单（三条，改完即可 done，不需再取证）**：

1. 记录第 176 / 342 行称 `trace-context-provider.ts`「零 importer、连测试都没有」**为假** —— 仓库根有三个 importer、15 个通过用例。改为实测事实，并把裁定由「路由 TF-0137」改为 **`guard-only` 保留**（与另三个 provider 同列）。
2. AC-1 段：把「度量需修正为『排除 guard-only 后 = 0』」降为**建议**，注明全量扫描从未跑过、上界 117 由审核者补测、重定义权在 TF-0102。
3. 若仍坚持走决策节点，须先走 proposal 把 `runtime.traceContext.provider` 纳入 TF-0137 的 `summary`/`requirements`（TF-0137 目前只点名 `worktree.backend` / `sekb.experienceShadow`，且仍 `proposed`）。

### 你待认领的审核（车道 2 排班，逐个交来时你审）

`TF-0110 T-P0-1(S)` → `TF-0114 T-P0-6(S)` → `TF-0121 T-B1(M)` → `TF-0113 T-P0-5(S)` → `TF-0119 T-D4(S)` → `TF-0112 T-P0-4(S)` → `TF-0137 D2(S)` → `TF-0139 T-E1(S)` → `TF-0140 T-E2(L)`

全部 `proposed`。其中两个要特别当心：

- **TF-0114** 触碰 **D13（跨车道）** `memory-hybrid-retrieval.ts`，且你的 TF-0122 依赖它（blocking）。
- **TF-0140** 是**本轮唯一允许改旗标默认值的 task**（`runtime.contextBlock.tool-registry.enabled`）。审它时必须验证 `docs/dev/context-moat/approvals/<task-id>.md` 人工批准文件存在，且 §R3.1 命令 3（默认值守卫）的命中项在 §R3.4 白名单内。它同时是 B2 与 B3 的触发点。

### 你欠车道 2 的一个审核请求

**TF-0128（我实现的）目前 `review_needed`，等车道 2 审。** 移交时按 §R1.0.2 只给它 `requirements` 与 `acceptance_criteria`。我在 `reviews/TF-0128.md` 末尾留了**四个要复核的点**：

1. **A2 判读**：接受 §D1.4 第三类（shadow 上线 + 默认关旗标）的替代举证，还是一律按「新代码默认不执行」判 `landed-unwired`？
2. **AC-4 的部分达成**：四维都有生产输入源，但压缩钩子没有 `turnId`，四维无法落在同一张 scorecard。是否接受该诚实降级？
3. **AC-5 的触发器选型结论**是否成立（特别是「不得单用 `goal_token_decay`」的四条理由）？
4. **D09 触碰面扩大**的必要性论证（无条件落点 vs `qualityGuardEnabled` 门控落点）？

**TF-0128 不 done，B2 就悬着。** 这是当前唯一卡在跨车道边上的东西。

### 审核怎么做（§R1，别简化）

A1 生产调用点（递归上溯到五个 root 之一）· A2 反向证伪（**四类逐条，不得留空**）· A3 注释与契约一致 · A4 配置四面一致（注意「有执行器 ≠ 生产可达」是两步判据）· A5 CJK 回归 · A6 边界值（0 / 负数 / NaN / 空）。

外加两条**防橡皮图章**的硬要求：

- **§R1.4 阴性对照**：每份审核记录必须对任一已收口 task 复跑其 A1 grep 并原样贴出。我上次用 TF-0104 的 exit-code 见证表：`createInjectionBudget=0 / applyContextLadder=1 / CODEX_CLI_PROFILE_ID=2 / <不存在的符号>=3`，复跑相符即无漂移。**不符且不能归因到某个已收口 task = 本次审核整体无效，换审核者重做。**
- **不要采信实现者的数字。** 我审 TF-0118 时把他们声称的每个门都自己重跑了一遍，还独立复现了他们「9/9 变异测试全捕获」中的一条（注入 `memory-policy.ts:116` 风险阈值 `7→99` → 恰 1/47 失败，证明套件有区分力），然后 `cp` 复原并用 `git status` 空确认逐字节还原。**正是「先自己跑、后读结论」才让我逮到 A3 那条假断言。**

---

## 7. 仍然开着的问题

### (a) 345 项 round 前孤儿改动 —— 会挡住 TF-0126

`extensions.ts` 带一处**真实功能改动**（task-state handler 从全局改为按 run 作用域，`runId`/`sessionId` 键控，并串入 `RuntimeLineage`）。已机械证明**不是车道 2 干的**：车道 2 本轮只碰过 11 个文件，且本轮**零提交**触碰 `extensions.ts`。它属 round 前的 provenance/lineage 在途工作。

**我按 §1.10 / §R4.9 没有处置它。** 整体提交会把一批 UI/i18n 改动记在本轮账上（违反 §R5 范围-3）；只提交 4 文件子集也不行——`extensions.ts` import 的 `runtime-core/lineage.ts` 仍是未跟踪文件，单独提交会产出一个 clean checkout 下编译不过的提交。

**TF-0126（T-B6）需要改 `extensions.ts`，所以它被挡住。** 三条出路，**决定权在用户**：① 由改动所有者自己提交/丢弃；② 授权算出 `extensions.ts` 的最小 import 闭包并验证其能独立编译后单独提交；③ 把 TF-0126 降级挂账。排班上 TF-0126 在 TF-0117 之后，所以你**做 TF-0117 时不会立刻撞上**，但收 TF-0117 之前就该把这件事推给用户。

### (b) 结转义务

| 义务 | 状态 |
|---|---|
| TF-0107 AC-2：M1 首个 task 收口时留存一次完整 §R3.1 三命令基线 | **已由车道 2 在 TF-0118 兑现**（`reviews/TF-0118.md` §R3 节） |
| §R3.1 `$COMMITS` 空集断言 | **已生效**（车道 2 在 TF-0118 收口时首次真实触发） |
| **§D4 `pnpm_test` 基线数字过期** | `GATE-BASELINE.md` 记 `baselineFailedFiles: 17 / baselineFailedTests: 22`；我在 TF-0128 收口时实测 **16 个失败文件**。方向安全（白名单只减不增），但**数字须在下一次 L2 里程碑门重测并带归因更新** |
| §D1.2 第五个盲区 + 「无导出级枚举模式」 | **已由我落地**（审 TF-0118 时） |
| §R4.5 D20（仓库根 `package.json`，跨车道） | **已由我落地** |

### (c) 已知的红门（不是你造成的，别去修）

L2 里程碑门**不要求 exit 0**，要求「失败集 ⊆ §D4 白名单」：

- `lint:check`：exit 1（4 errors / 131 warnings），判据是 error 集 ⊆ `gates.lint_check.exemptions` 且 `baselineErrorCount ≤ 4`。
- `pnpm test` / `maturity:validate`：红，失败零本轮引起（§D4 已机械证明）。
- **`maturity:traceability` 会重写 `P7-001/traceability-report.json`，而那个文件本身就是 25 项固定基线之一** —— 门重写它自己要校验的东西。§R2.3 已强制要求跑完恢复。

**白名单之外任何失败 = 回归，一律阻塞。白名单条目只减不增。**

---

## 8. TF-0138 的去标识化要求（提前看，别到时候返工）

TF-0138 的产物**只允许**：digest / ref / 枚举标签 / 数值元数据。
**禁止**：贴原始上下文片段；把 `lineage.reason` 的自由文本原样写入（必须归一化成枚举标签）。
收口时 grep 确认：无凭据模式、无绝对路径、无原文段落。

## 9. 本轮的其他边界（§R5）

不新建存储系统 · 不引向量库 · 不引分词库（CJK 走 bigram/trigram 兜底）· 不引新测试框架 · 不建新 CI 流水线 · 不做 schema 迁移 · **零 renderer 组件**。
不追改历史 artifact（允许 append-only 标注）。

---

## 10. 开工顺序

1. 读 `docs/dev/context-moat/DEV-PROTOCOL.md` 的 §D1 §R1 §R4 §R5（你 owner 的四节），再扫 §R2 §R3 §D4（车道 2 的门与半径判据，你要用）。
2. 读 `reviews/TF-0128.md`（你继承的在审 task）与 `reviews/TF-0118.md`（你刚发出的审核判定）。
3. 跑 §5 的开工前自检两条命令。
4. 把 §5 末尾的 **D03 登记冲突**和 §7(a) 的**孤儿改动处置**报用户——这两件不由你拍板。
5. 开 TF-0117：`update-node TF-0117 --status in_progress`，然后按 §R4.10 的开工-收口循环走。
6. 收口时按 §R2 L0/L1 跑门、按 §R3.1 跑三条半径命令、按 §R1 写 `reviews/TF-0117.md`（实现者自检包，**A2 判定格与阴性对照留给非实现者**），pathspec 限定提交并带 `Task: TF-0117` + `Lane: lane-1`。
