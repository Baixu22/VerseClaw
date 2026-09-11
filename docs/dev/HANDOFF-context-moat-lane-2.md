# 车道 2 交接提示词（context-moat 长任务上下文护城河）

> 交接给接手 agent。你接的是**车道 2**。仓库 `D:\ClawX`，分支 `codex/model-error-gap-fill`（原 `feat/runtime-lifecycle-governance` 线），全局 task **TF-0102**。
> 车道 1 在**同一个仓库、同一个工作树、同一份 git index、同一个 git author** 上并行工作。这不是比喻，本轮已因此发生两次真实事故。
> 交接时 HEAD = `2d8e775d1`；本轮起点参照 ref = **`590588791`**（所有半径命令都用它）。HEAD 会随车道 1 提交前移，取任务前先 `git log --oneline -5` 看清。

---

## 0. 你要立刻做的三件事（按顺序）

1. **读完第 1 节的强制阅读清单**。不读就动手会重复本轮已经犯过的错。
2. **修 TF-0118 的 A3 FAIL**（第 5 节）。这是唯一在途的阻塞项，车道 1 已审并给出 FAIL，交付物本体没问题，要修的是记录里两处**与实测不符的断言**和一处**落不到地的路由**。
3. **审 TF-0128**（第 6 节）。车道 1 的 T-C1 停在 `review_needed` 等你，它是同步点 **B2** 的前置，也是 TF-0140 的 blocking 依赖。

---

## 0.5 交接前你必须知道的一件事：这条分支不干净

**本轮起点 `590588791` 之后，分支陆续并入了与本轮无关的 workstream 提交** —— provenance UI 接线、gateway env 默认值、E2E 快照刷新、跨分支 merge 等。交接时实测：

```
round range 590588791..HEAD  = 43 个提交 / 294 个文件
其中带本轮 trailer 的        = 30 个提交
归属完整集（trailer + §R3.8.4 两个既有实例）= 36 个文件   ← 本轮真实触碰面
```

三个后果，都已实测：

1. **§R3.6 累积门原本会误判整轮硬 FAIL** —— 区间 diff 读作 294，而 M0..M5 总预算是 230。**已修**（`a424325aa`）：改用「trailer 匹配 + §R3.8.4 既有实例清单」，读作 36，且集合内零个文件落在预期触碰面外。**共用分支上区间 diff 不可用。**
2. **`git status` 里约 80 个 dirty 文件不是你的**，也不全是车道 1 的 —— 有第三方进程留下的孤儿改动（车道 1 已在其 handoff 里记录此事）。**一律不碰、不提交、不 stash。**
3. **rule-4 断言必须用 pathspec 限定到本轮触碰面**，否则外来 workstream 的提交会全部报成 UNATTRIBUTED。

当前 §R3.8.4 只登记了两个既有无 trailer 实例（`f005991b7` S0 骨架、`fe469cbff`）。实测另有**三个未登记**：`5973da7c8`（车道 1 的 handoff 提交，零 trailer）、`2b03f5435`、`c89b1c4e5`（两个 in-flight checkpoint）。**要么补登，要么让对应方补 trailer** —— 现状下 M1 起「该断言须为空」这条做不到。

> **一处需要人来裁的不一致**：车道 1 把 `HANDOFF-lane-1.md` 提交进了 `docs/dev/context-moat/`，而 §R4.1 明写该树下**只允许七个路径**、「路径以外的产出物视为未交付」，且无任何偏差登记这第八个路径（`grep HANDOFF DEV-PROTOCOL.md` = 0）。我因此把本文件放在 **`docs/dev/HANDOFF-context-moat-lane-2.md`（树外）**，没有跟着扩树。两份 handoff 位置不一致，请用户决定是补登第八路径、还是把车道 1 那份也移出去。

---

## 1. 强制先读（不可跳过）

| 顺序 | 对象 | 为什么 |
|---|---|---|
| 1 | `docs/dev/context-moat/DEV-PROTOCOL.md` **全部七节** | 本轮唯一的协议真相源。929+ 行。**未落地本文件的条款不具约束力；已落地的对两条车道同等生效** |
| 2 | `docs/dev/context-moat/GATE-BASELINE.md` | 四道既有红门的裁定与机器可读白名单（§6 的 JSON） |
| 3 | 节点 TF-0102 / TF-0145 / TF-0146 | 全局意图、流程编排、本轮硬边界 |
| 4 | `docs/dev/context-moat/reviews/TF-0118.md` | 你要修的东西在这里，含车道 1 的完整审核判定 |

七节归属（**禁止跨节编辑**）：

| 节 | 内容 | owner | 来源节点 |
|---|---|---|---|
| §D1 | 完成定义 | **车道 1** | TF-0104 |
| §R1 | 代码审核协议 A1-A6 | **车道 1** | TF-0105 |
| **§R2** | **分层测试验收门 L0/L1/L2/L3** | **你** | TF-0106 |
| **§R3** | **每任务改动半径收口门** | **你** | TF-0107 |
| §R4 | 交付物目录/偏差/回滚/pick-next/并发编排 | **车道 1** | TF-0145 |
| §R5 | 本轮硬边界 | **车道 1** | TF-0146 |
| **§D4** | **既有红门归属与 L1/L2 收紧定义** | **你** | TF-0142 |

---

## 2. 你的固定任务链与当前位置

**§R4.7 已固定车道 2 的顺序。不许改序、不许挑软的做、不许用 pick-next 把靠后的提前。**

```
TF-0118 T-D3(300)  ← review_needed 95%，车道 1 已审 A3 FAIL，你要修（第 5 节）
TF-0110 T-P0-1(240) ← 修完 0118 后的下一个
TF-0114 T-P0-6(240)
TF-0121 T-B1(240)
TF-0113 T-P0-5(180)
TF-0119 T-D4(180)
TF-0112 T-P0-4(120)
TF-0137 D2(90)
TF-0139 T-E1(120)
TF-0140 T-E2(300)   ← 需人工批准，见第 8 节
```

车道 1 的顺序（**别碰，但要知道他们在哪**，用于冲突自检）：

```
TF-0136 D3(0) done → TF-0128 T-C1(360) review_needed → TF-0117 T-D2(90) → TF-0126 T-B6(300)
→ TF-0116 T-D1(240) → TF-0111 T-P0-2(180) → TF-0124 T-B4(300) → TF-0143 T-CORPUS(180)
→ TF-0138 T-C0(180) → TF-0122 T-B2(90)
```

**两处顺序是机械验证过的，不要挪**：TF-0117 必须紧跟 TF-0128（否则与你的 TF-0140 soak 期重叠，违反 B3）；TF-0128 必须先于 TF-0124。

里程碑：M0 `TF-0103` **done**（B1 已由人放行）。M1 `TF-0108` / M2 `TF-0115` / M3 `TF-0120` / M4 `TF-0127` / M5 `TF-0133` 均 `proposed`。注意**你的链跨里程碑**：TF-0118/0119 属 M2，TF-0121 属 M3，TF-0139/0140 属 M5。

---

## 3. 文件域（§R4.5 的 D01-D20）

**规则：每个域同时只允许 1 个 `in_progress`。新发现的域必须追加并记偏差。**

### 你独占（车道 2）

| 域 | 文件 | 你的哪些 task 会碰 |
|---|---|---|
| D01 | `tests/unit/config-schema-parity.test.ts` | TF-0112 |
| D02 | `shared/dcs/prod-flags-catalog.ts`（**仓库根**，不在 openclaw_runtime 下） | TF-0112 / 0137 / 0140 |
| D03 | `openclaw_runtime/src/context-engine/coding-runtime-flags.ts` | TF-0112 / 0137 |
| D07 | `openclaw_runtime/src/config/types.openclaw.ts` | — |
| D08 | `openclaw_runtime/src/memory/context-pack.ts` | **TF-0110 / TF-0114** |
| D10 | `openclaw_runtime/src/agents/worktree-service.ts` | TF-0112 / 0137 |
| D14 | `openclaw_runtime/src/config/runtime-feature-leaves.ts` | TF-0112 |
| D15 | `openclaw_runtime/src/config/zod-schema.ts` | TF-0112（唯一写者） |

### 车道 1 独占 —— **你一行都不能改**

`assembler.ts`(D04) / `extensions.ts`(D05) / `context-candidate.ts`(D06) / `compaction-safeguard.ts`(D09) / `turn-injection-budget.ts`(D11) / `compaction-damage-rules.ts`(D16) / `context-health-monitor.ts`(D17) / `compaction-sections.ts`(D18) / `compaction-safeguard-quality.ts`(D19)

### 跨车道 —— 高危，动前必须确认对方不在途

| 域 | 文件 | 注意 |
|---|---|---|
| **D11** | `turn-injection-budget.ts` | 名义车道 1。TF-0118 曾需删其中一个 test-only 导出，**已路由车道 1 接单**，你不要动 |
| **D13** | `src/runtime-core/memory-hybrid-retrieval.ts` | **本轮唯一跨车道真写域**。你的 TF-0114 修 `tokenizeWords`/`extractEntities` 的 CJK 空返回；车道 1 的 TF-0122 裁决整条链去留。`TF-0122 depends_on TF-0114` 已升为 **blocking** —— 必须你先修完 |
| **D20** | **仓库根 `package.json`** | 两条车道 L1 门的共同载体。**禁止裸 `git commit -- package.json`**，详见第 9 节陷阱 3 |
| D12 | `DEV-PROTOCOL.md` | 按节分工，见第 1 节 |

---

## 4. 你要认领的审核点

**§R1.0.1：禁止自审。** 实现者与审核者必须是不同会话。所以：

- **你的每个 task 收口只能到 `review_needed`**，必须由车道 1 审过才能 `done`。
- **车道 1 的每个实现类 task 由你审。** 这是你的持续义务，不是可选项。

审核协议 §R1 的 A1-A6 六项：

| 项 | 内容 |
|---|---|
| A1 | 生产调用点（递归上溯到 §D1.1 的**五个** root） |
| A2 | 反向证伪四类（默认旗标值 / kill switch / 上游守卫先行 return / `deferProjection` 类旁路），**四类全记录且为空**才算过；**审核者必须复跑实现者声明的证伪命令并原样贴输出** |
| A3 | 注释/文档断言与实现一致 —— 「找不到对应代码则改注释或改实现，**二者择一，不允许留着**」 |
| A4 | 配置四/五面一致（zod-schema / types.openclaw / runtime-feature-leaves / prod-flags-catalog / **执行器**） |
| A5 | CJK 回归 |
| A6 | 边界值 |

另有 **§R1.4 阴性对照**：每份**审核记录**必须复跑一个已收口 task 的判据并贴原样输出，防橡皮图章。

### 现在挂在你名下的审核

| 节点 | 状态 | 说明 |
|---|---|---|
| **TF-0128 T-C1** | `review_needed` 90% | 车道 1 的损伤检测去耦合 + 上线 + ContextHealthMonitor 四维通电。**它是 B2 同步点的前置，也是你 TF-0140 的 blocking 依赖** —— 拖着它等于拖自己 |

审核时的两条实测教训：
1. **A4 的「执行器」不能用 §D1.2 脚本交差。** `worktree.backend` 是活体反例：执行器**存在**（`worktree-service.ts:160-162` 按 backend 分支），但与旗标**未接线**（`:267` 读 `options?.backend`；`resolveWorktreeBackend` 唯一生产消费者是 `runtime-flag-ack.ts:272` 的**上报映射**），而脚本给它 **exit 0**。可达 ≠ 有执行器。执行器检查须追至**行为分支点**并确认旗标值真的流到那里。
2. **§R1.0.2 防锚定在同仓双车道下无法机械保证** —— 实现者结论写在图节点 `evidence` 里，而节点是取任务的必经通道。缓解手法：**先自己跑完命令再读对方结论**，并在记录里如实声明锚定风险。

---

## 5. 【最紧急】TF-0118 的 A3 FAIL —— 你要修的东西

车道 1 的审核（`6fde351e7`）判：**A1/A2/A4/A5/A6 非 FAIL，AC-2/AC-3 PASS，A3 FAIL，维持 `review_needed`**。交付物本体正确、无需重做取证。

### 他们的判据成立，别辩

**F1（A3 FAIL）**：`reviews/TF-0118.md` 两处断言 `trace-context-provider.ts`「零 importer，连测试都没有」。**实测为假**，仓库根有三个 importer：

```
tests/unit/runtime-trace-context-provider.test.ts:10
tests/unit/runtime-grounding-shadow-consumers.test.ts:24
tests/unit/runtime-grounding-authority-effectiveness.test.ts:20
→ 3 files / 15 tests passed
```

**根因是前任自己发现并写下的那条规则没被自己执行完**：记录里明写「§D1.2 脚本扫描域仅 `openclaw_runtime/src`，判死前须另跑全仓 grep」，却只把它应用到 `commitMemoryProposal`，漏掉其余三个候选。盲区命中率实测 **3/4**。规则写对了，覆盖面漏了。

**F2**：把它路由给 TF-0137 落不到地 —— TF-0137 的 `title`/`summary`/`requirements` 只点名 `worktree.backend` 与 `sekb.experienceShadow`，且形态不同（那边是「旗标有执行器无」，这边是「执行器有但模块不可达」）。**一个目标不接收的路由与丢弃不可区分。**

### 你要做的（建议走 (a)）

- **(a) 直接判 `guard-only` 保留、结案**（车道 1 认为这是正解，我同意）：它有专属套件 + 两个 grounding 套件共 15 个通过用例，`RUNTIME_TRACE_CONTEXT_FLAG_PATHS` 实测 `exit=0` PRODUCTION REACHABLE，`createRuntimeTraceContextProvider` `exit=1` —— **这正是另外四个 provider 已判 `guard-only` 的同一形态**（活旗标执行器 + 唯一消费者是测试 + 删掉即拆守卫），本就该与它们同列。
- (b) 若坚持走决策节点，必须先走 proposal 改 TF-0137 的 `summary`/`requirements` 纳入第三条旗标。
- **不得停留在现状。**

同时要改的记录文字：把两处「零 importer / 连测试都没有」改为实测事实，并把分类从「最干净的删除候选、待 TF-0137 裁决」改为 `guard-only` 保留。

### 车道 1 另外三条发现（不阻塞，但要吸收）

- **F3**：`reserveTurnInjectionCapacity` 在 `tests/unit/context-orchestrator-entry-scan.test.ts:68` 另有一处**反向守卫**（断言 `attempt.ts` 不引用它）。**不阻塞删除**（删后「不引用」仍成立）。车道 1 已接单，你不用动。
- **F4**：AC-1 不只是「未达成」，而是**从未被测量** —— AC-1 要「全量扫描的零调用**导出**数」，而 §D1.2 脚本只有「单符号判定」与「模块级粗扫」，**没有枚举某目录零调用导出的模式**。车道 1 替跑 `--all-modules`：`src/context-engine` 27 + `src/agents` 90 = **117**，但这是**模块级粗扫上界，不是死代码数**（脚本自己告警：roots 只覆盖本轮 context/agent 入口，域外入口后面的模块也计入；其中 9 项本身是 test-harness/test-utils）。结论：「不硬凑到 0」正确，但「排除 guard-only 后 = 0」这条补救**未经测量、不能凭断言采纳**，度量重定义属 TF-0102 的 `success_metrics` 面。
- **F5**：已补登 **D20 = 仓库根 `package.json`**，见第 3 节。

---

## 6. 已路由 / 挂账的债（别重复发现，也别假装不存在）

| # | 内容 | 归属 |
|---|---|---|
| 1 | `reserveTurnInjectionCapacity` 删除（D11 内） | **车道 1**（TF-0117 顺带），已接单 |
| 2 | §D1.2「判死前须跑全仓 grep」写进已知边界 | **车道 1**（§D1 owner），已落地 |
| 3 | AC-1 度量重定义（导出级枚举能力 or 改写指标） | **TF-0102 owner** |
| 4 | `maturity:validate` 的 `&&` 链盲区：第 5/6 个脚本从未执行 | backlog，归 TF-0028/0029；§R2.3 已要求 L2 单独补跑 |
| 5 | `maturity:traceability` **有副作用**，会改写 `artifacts/system-maturity/P7-001/traceability-report.json`（而该文件正是 25 项基线之一）。§R2.3 已加强制收尾：逐段跑、跑完验 `git status --porcelain -- artifacts/system-maturity` 为空、非空则 checkout 复原 | 你的 §R2.3，已落地 |
| 6 | `pnpm test` 基线 17/22 建议改上限表述（wmic 项会环境翻转） | 你的 §D4，未做 |
| 7 | §R4 metric-5 只计 merge 冲突，不计共用 index/工作树污染（而本轮两次真实事故正是后者） | **车道 1**（§R4） |

**四道既有红门**（`GATE-BASELINE.md`）：`config-schema-parity`（must-fix，TF-0109 已修绿，豁免 0 条）/ `pnpm test`（白名单差分）/ `maturity:validate`（25 项基线）/ `lint:check`（4 个 eslint error，backlog-debt 3 + exempt-noise 1，判据为 `(file,rule)` 对 ⊆ 白名单 **且** 总数 ≤ 4）。

---

## 7. 门（每次收口都要跑）

### L1 六条（§R2.2，每个 task 收口，单一真相源在 §R2.2）

```bash
pnpm lint:bom
pnpm contract:check
pnpm typecheck:node
pnpm lint:dcs
pnpm test:dcs
npx vitest run tests/unit/config-schema-parity.test.ts tests/unit/default-config-matrix.test.ts
```

**六条全 exit 0 才算过。** `test:dcs` 当前 37 个测试文件全绿。

### §R3 三条半径命令（每个 task 收口，原样贴输出）

```bash
TASK=TF-XXXX
COMMITS=$(git log -E --format=%H --grep="^(Task:|Refs|Node:) $TASK([^0-9]|\$)" 590588791..HEAD)

# 空集断言：必须先判，空集 = FAIL 而非 PASS
[ -n "$COMMITS" ] || echo "FAIL: no commit attributable to $TASK"

# 命令 1 —— 半径 ≤ max_brb（brb-S=5 / M=15 / L=40 / none=0）
git show --pretty="" --name-only $COMMITS | sort -u | wc -l

# 命令 2 —— schema 路径守卫（须为空，除非在 §R3.3 白名单内）
git show --pretty="" --name-only $COMMITS -- \
  '*zod-schema*' 'shared/dcs/prod-flags-catalog.ts' \
  'openclaw_runtime/src/config/types.openclaw.ts' | sort -u

# 命令 3 —— 默认值守卫（命中且不在 §R3.4 白名单 = 硬 FAIL）
git show $COMMITS -- ':!docs' ':!*.md' \
  | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -E "\.default\(|defaultValue|DEFAULT_[A-Z_]+\s*[:=]"
```

匹配式的三个要件**每一个都由实测事故驱动**，别简化：不锚定 → TF-0145 半径读作 8/5 假 FAIL（真值 2/5）；用 `$` 收尾 → 漏掉 M0 的 `Refs TF-0142 (D4)` 带后缀形式；不要键名 → `Refs TF-0142 (D4). Depended on by TF-0106 (R2).` 会把 0142 的提交算进 0106。

**空集断言不是形式主义**：`$COMMITS` 为空时 `git show --name-only $COMMITS` **退化为 `git show HEAD`**，命令 1 返回 1 而非 0，三条命令全部假性通过，且报出的半径是**别人提交**的文件数。

### §R3.6 里程碑累积门（里程碑收口时）

**不要用区间 diff**（见第 0.5 节）。用归属完整集：

```bash
ATTRIBUTED=$(git log -E --format=%H \
  --grep="^(Task:|Reviews:|Refs|Node:) TF-[0-9]" <milestone-start>..HEAD)
KNOWN_UNATTRIBUTED="f005991b7 fe469cbff"     # §R3.8.4 已登记，仅此两个
git show --pretty="" --name-only $ATTRIBUTED $KNOWN_UNATTRIBUTED | sort -u | wc -l
```

预算（冻结于 B1）：M0 40 / M1 30 / M2 40 / M3 50 / M4 25 / M5 45，合计 **230**。交接时实测归属完整集 = **36**。

---

## 8. 硬约束（不可协商）

### 提交纪律

- **每车道独立提交，不共享未提交改动。切换 task 前，工作树对你的文件域必须干净。**
- **不允许两个 task 的改动混在一次提交里**（混了就无法分开回滚）。
- **只 `git add` 本 task 真实触碰的路径。** 仓库里那一大堆既有未提交改动（`.agent-workbench/`、`artifacts/`、`docs/`、`electron/`、`openclaw_runtime/src/**` 约 80 个文件）**不是你的** —— 不要碰、不要提交、不要 stash 掉。新建文件要先 `git add` 才能被 pathspec 提交。
- **trailer 两个键，缺一则对应审计失效**：
  - `Task: TF-XXXX` —— 恰好一个，半径归属。**实现者自己的自检证据包也用 `Task:`**（它是交付物、计入半径）
  - `Reviews: TF-XXXX [...]` —— **非实现者**写 §R1 判定时用，不计入被审 task 半径，触碰面只允许 `docs/dev/context-moat/reviews/*.md`
  - `Lane: lane-2` —— **每个提交必填**。两条车道 author 完全相同（19/19 实测），这是唯一能把提交归到车道的机械手段

### 边界

- **不改任何旗标默认值 —— 唯一例外是 TF-0140**（`runtime.contextBlock.tool-registry.enabled`），且必须先有 `docs/dev/context-moat/approvals/TF-0140.md` 的人工 approve 记录（顺序不可倒置，先改后补 = 硬 FAIL）。本轮默认值改动次数的成功指标是 **= 1**，不是 ≤1。
- 不新建存储系统、不引入向量库、**不引入分词库依赖（CJK 用 bigram/trigram 兜底）**、不引入新测试框架、不新建 CI 流水线。
- 不追溯修改历史 artifacts；禁止改写历史 `completionClass` 与内容；**只允许追加式标注**。
- **需要跨越 B1/B2/B3 → 不要自行放行，报告给用户。** B1 已放行；**B2** = TF-0128 的健康分四维 scorecard；**B3** = 14 天 soak 冻结（冻结 `assembler.ts` / `extensions.ts` / `prod-flags-catalog.ts`）。
- TF-0140 需人工 sign-off 才能改默认值 —— **停下等用户**。
- 不要删 `.agent-workbench/task-forest/lock`。
- **不要手改** `nodes.json` / `edges.json` / `config.json`。
- **禁止 `--allow-stale`**（会静默丢掉另一车道的 task 信息）。
- 提案必须**即生成即应用**。

### 失败纪律

- **同一方法连续失败两次 → 停止微调，说清根因，换一条路。**
- **`landed-unwired` 是合法出口**（§D1.3）：接不上线时 `status` 用 `review_needed` + `context_tags` 加 `landed-unwired` + `summary` 前缀标注，并记 `record_deviation`。**隐瞒才是唯一真正的失败。**
- 超 `max_brb` 不得放行：只有「拆分」（须共享 `designs/<task-id>.md`，且拆分件 max_brb 之和不得超原值）或「降级 `landed-unwired`」两条出口。

---

## 9. 工具用法与实测陷阱（都是踩过的）

### task-forest CLI

```bash
# 路径固定
TF=~/.claude/skills/task-forest/scripts/task_forest.py
# Windows 每次调用都要设，否则中文输出乱码、你会误判状态
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8

# 只读
python "$TF" show TF-XXXX --json
python "$TF" list --status in_progress
python "$TF" validate

# 写（会改图状态；把 TF-XXXX 换成真实 id 再跑）
python "$TF" update-node TF-XXXX --actor lane-2 --status in_progress --progress 5

# 结构性变更（record_deviation / add-node / add-edge）必须走 proposal，且即存即应用
python "$TF" proposal-save --proposal-file <f>.json --session-id session-lane-2
python "$TF" proposal-apply <TFP-id> --yes --actor lane-2
```

> **本块刻意全部用 `TF-XXXX` 占位。** 交接时我为验证 handoff 里的命令可跑，把这段整体执行了一遍，其中的 `update-node ... --status in_progress` **真的把 TF-0110 置成了 `in_progress`/5%** —— 那等于凭空宣告占用 D08 域，会误导另一车道和 pick-next。已即时改回 `proposed`/0 并在此登记。**别整块复制运行含写操作的示例。**

- **`--progress` 是 0–100 不是 0–1**。传 `0.9` 会显示成 0.9%。
- **长文本一律走 `--fields-file`，不要用 `--append-evidence` 传含反引号/特殊字符的字符串** —— 反引号会被 shell 当命令替换执行，文本静默丢失。本轮实测踩过。
- `proposal-apply` 的 proposal id 是**位置参数**，且必须 `--yes`。

### 陷阱 1 —— shell 转义连挫就换 Python

`awk '/^D:\\ClawX/'` 会触发 `\C` 非法转义警告，变量恒空，于是「交集为空 ⟹ 零本轮引起」是**空洞成立**的。`sed`/`tr` 处理 Windows 路径反斜杠同样反复失败。**改用 Python 脚本文件**（用 `chr(92)` 避免源码里出现字面反斜杠），别在 shell 里硬撑。

### 陷阱 2 —— 正则要兼容 Markdown 强调

统计冲突域时用 `^\| D[0-9]{2} \|` 得 14 组并一度判定「D13 缺失」（而 D13 恰是唯一跨车道真写域，真缺失是重大缺陷）。实际是表里写作 `| **D13** |`。用 `^\| \*{0,2}D[0-9]{2}\*{0,2} \|`。**且提示语要做条件门控** —— 那次「(无输出 = 完全没有 D13)」是无条件打印的，进一步误导了自己。

### 陷阱 3 —— D20（仓库根 `package.json`）

1. **动前先 `git diff -- <绝对路径>/package.json`** 确认第三方 hunk 的存在与位置。
2. **禁止裸 `git commit -- package.json`**（会把对方未提交改动一起卷入）。
3. 「先撤对方 hunk → 提交 → 再 `git apply` 还原」这套手法，**在两人改同一行时第 4 步会失败**（实测 `patch does not apply`）。若就此停手，**对方的未提交工作会从工作树上消失**。共行时必须**按语义重放**对方的意图值，不能按 patch 还原。
4. **所有 `git status` / `git diff` 路径断言一律用绝对路径** —— 本仓有 `openclaw_runtime/package.json` 与仓库根 `package.json` 同名，相对路径在 cwd 漂移时会命中错误那个并返回空 diff，**伪造出「文件干净」的结论**。

### 陷阱 4 —— 回滚演练不要碰 index

`git revert --no-commit` 会写暂存区，在共用 index 下会被对方的 pathspec-less 提交卷走（本轮真实事故 `TFD-lane2-rollback-drill-index-mutation`）。用 **worktree-only 往返**：

```bash
git show <commit> -- <path> | git apply -R    # 撤
<跑一次 L0/L1 门，确认回到基线>
git show <commit> -- <path> | git apply       # 还原
git diff HEAD -- <path>                        # 判据：内容为空
```

**判定是否复原以 `git diff HEAD`（内容）为准，不要看 `git status --porcelain`** —— 本仓 CRLF 会让 porcelain 显示 `M` 而内容其实一致。

### 陷阱 5 —— §D1.2 脚本的四类已知盲区

`node openclaw_runtime/scripts/check-production-reachable.mjs <symbol>`（**从仓库根跑要带前缀**）。退出码 `0` 可达 / `1` 不可达 / `2` 仅 API 面 / `3` 用法错或 root 失效。

**exit 1 不等于死代码。** 四类盲区：

1. **扫描域仅 `openclaw_runtime/src`** —— 仓库根 `tests/`、`electron/`、`src/`（渲染层）的调用方看不见。**判死前必须另跑全仓 grep**：`grep -rn <symbol> tests apps electron shared scripts packages`。本轮此盲区命中 **3/4**。
2. **`package.json` 的 `exports` 面不在 root 集合内** —— 纯 SDK 对外 API 会显示不可达。`buildToolPlan` 属此类（`exports "./plugin-sdk/agent-runtime"` → `agent-runtime.ts:28 export * from "../tools/index.js"` → `tools/index.ts:11`），是**已发布 API**，删它是 breaking change。
3. **约 17 处计算式动态 import** 无法静态解析（`--blind-spots` 会列出）。
4. **字符串 ID 注册**看不见 —— provider 常以字符串挂在活注册表上（例：`GROUNDING_SHADOW_CONSUMER_IDS` 是 PRODUCTION REACHABLE 的活清单，里面三个 ID 的 adapter 全是死的）。要 grep **字符串字面量**而非符号名。

**另外没有「枚举某目录下所有零调用导出」的模式** —— 任何写成「零调用导出数 = N」的 AC/指标都不可由本脚本测量。

### 陷阱 6 —— 测试要能失败才算测试

- 新写的守卫/套件必须做**变异测试**：注入它声称要防的缺陷，确认套件转红。「只验证当前通过」的守卫与永不开火的空守卫不可区分。本轮标准做法：9 个注入缺陷，9 个全部被捕获。
- **`try/catch` + 提前 `return` 的用例会显示为 passed 而实际零断言。** 本机 `symlinkSync` 抛 `EPERM`（无特权 Windows），初版就踩了。改用 `it.skipIf(!probe)`，让它如实报 skipped。

---

## 10. 判断力要点（本轮最贵的几条经验）

1. **「唯一调用者是测试」不等于死代码。** TF-0118 差点删掉 `register-rebuild-providers.ts`，而它的唯一 importer 是一份 **245 行、11 用例、全通过**的门套件（gate H-1 六个 intent verb / H-2 grep 降级链 / H-3 冷库首查 ≤ 裸 rg+200ms），其真实被测对象 `buildContextPack`/`createMaterializer`/`ripgrepSearch`/`FactStore` **全部生产可达**。这属 **§D1.5 `guard-only`**，§D1.5 明写此类「不计入需清偿的死代码 —— 否则会把守卫本体当成技术债清掉，正好拆掉防线」。
2. **指标与协议冲突时，先说冲突，不要凑数。** TF-0118 的 AC-1「零调用导出数 → 0」与 §D1.5 直接冲突，凑到 0 只能靠删守卫或跨域越界。判「未达成 + 指标需修正」比做出一个 0 更有价值。但**补救本身也要测量** —— 车道 1 正确指出「排除 guard-only 后 = 0」这条也没被测过。
3. **门的归属边界不精确时，伤害的是合规者。** §R3 有五处自身缺陷都是这个形态（未锚定 → 合规 task 读作 8/5 硬 FAIL；累积门误用 trailer 匹配 → 漏过半改动量；空集 → 三条命令全假性通过）。
4. **`&&` 链门的退出码只报告链上第一个失败，其后各段是未知量而非已知绿。** 本轮两道门栽在这个形状（`maturity:validate`、`lint:check`）。判据必须逐段跑。
5. **审自己和审别人用同一把尺。** 前任对车道 1 的 §D1 判 A3 FAIL（文档断言与实现不一致），车道 1 就用同一判据对 TF-0118 判了 A3 FAIL —— 而且是对的。别辩，修掉。
6. **报告要如实**：门红了就说红并贴输出；跳过了就说跳过；假阳性是自己工具造成的就写明是工具缺陷不是交付物缺陷。本轮多次靠这条避免了误判。

---

## 11. 交接时的确认清单

```bash
cd /d/ClawX
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
TF=~/.claude/skills/task-forest/scripts/task_forest.py

git log --oneline -5                                    # 看车道 1 有没有新提交
python "$TF" validate                                   # 应「校验通过」
python "$TF" list --status in_progress                  # 确认无本轮实现类 task 在途
git status --porcelain -- docs/dev/context-moat openclaw_runtime/src/memory \
  openclaw_runtime/src/config shared/dcs                # 你的域应为空
grep -cE '^<!-- owner=lane-[12] node=TF-' docs/dev/context-moat/DEV-PROTOCOL.md   # 应为 0
grep -c '^## §' docs/dev/context-moat/DEV-PROTOCOL.md   # 应为 7
```

**别问「要不要开始」，直接从第 0 节的三件事开始做。**
