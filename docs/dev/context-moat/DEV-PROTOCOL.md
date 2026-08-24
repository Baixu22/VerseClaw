# DEV-PROTOCOL —— 长任务上下文护城河本轮开发协议

本文件是 TF-0102（长任务上下文护城河）本轮 M0 文档相的唯一合一产出，由 TF-0103 的七个子节点分节写入。

**读法**：每个 task 收口时，其审核记录（`reviews/<task-id>.md`）必须至少引用本文件的一节。本文件未落地的条款不具约束力；本文件已落地的条款对两条车道同等生效。

**写法**：每节只允许其 owner 车道写入。跨节编辑属越界，按 §R4 的偏差流程处理。下方每节的 HTML 注释是占位标记，被真实内容替换即代表该节收口；七节占位全部消除是同步点 B1 的机械判据。

| 节 | 内容 | 归属 | 来源节点 |
|---|---|---|---|
| §D1 | 完成定义 | lane-1 | TF-0104 |
| §R1 | 代码审核协议 | lane-1 | TF-0105 |
| §R2 | 分层测试验收门 | lane-2 | TF-0106 |
| §R3 | 每任务改动半径收口门 | lane-2 | TF-0107 |
| §R4 | 交付物目录 / 偏差 / 回滚 / pick-next / 并发编排 | lane-1 | TF-0145 |
| §R5 | 本轮硬边界 | lane-1 | TF-0146 |
| §D4 | 既有红门归属与 L1/L2 收紧定义 | lane-2 | TF-0142 |

---

## §D1 完成定义

来源节点：TF-0104。本节是本轮所有 task 的收口判据，优先于任何个别 node 的措辞。

### D1.0 为什么要改完成定义

旧定义是「代码写了 + 测试绿了 = done」。它有一个致命的结构性问题：**它不惩罚不接线**。

对执行者而言，把新模块接进生产路径要承担回归风险、要过更多门、要处理旗标与配置面；而不接线只需写完 + 补测试就能标 done，收益相同、风险为零。于是不接线成了**理性选择**。本轮起点实测 8 处生产零调用模块 —— `applyContextLadder` / `selectBlocksUnderTokenPressure` / `compressToolOutputText` / `compaction-damage-rules` / `l4-semantic-eval` / `runtime-embedding-adapter` / `register-rebuild-providers` / `buildToolPlan` —— 不是 8 次疏忽，是同一个激励结构被执行了 8 次。

所以新定义要做的不是「加一道检查」，而是**让诚实降级的收益高于虚假标注 done**。这就是 D1.3 三种出口存在的理由：接不上线有合法的、不算失败的名字可用，隐瞒才算失败。

### D1.1 标 done 的两个必要条件

`done` 需要 (a) 与 (b) **同时**成立，缺一不可：

**(a) 生产可达。** `grep` 出至少一个**非测试、非 `experiments/`、非 `scripts/`** 的生产调用点，且该调用点本身能**递归上溯**到以下四者之一：

- `src/agents/embedded-agent-runner/run/attempt.ts`（agent attempt 主循环）
- gateway 启动（`src/gateway/boot.ts`）
- `init.ts` 注册（`src/context-engine/init.ts`）
- RPC 暴露（`src/gateway/cli-runtime/gateway-rpc.ts`）

「有测试调用它」**不是**生产可达。「旗标打开就能走到」**不是**生产可达 —— 旗标默认关 = 未通电。

**(b) 反向证伪通过。** 执行者必须**主动去找推翻自己结论的证据**，四类逐条查并记录「查了什么 / 结果是什么」：

1. 默认旗标值（是否默认关）
2. kill switch 覆盖（是否存在使该路径不可达的开关）
3. 上游守卫（是否有更早的 return 先行拦截）
4. `deferProjection` 一类分支（是否把该路径旁路）

四类**全部记录且结果为空**才算通过。**未记录 = 不通过**，不是通过。记录格式固定为「查了什么 / 结果是什么」，写进 `node.evidence`。

**(b) 不得是实现者自述。** 审核者必须**复跑**实现者声明的证伪命令，并把命令与输出原样贴进审核记录（§R1.2 的 A2 专节）。只有自述而无审核者复跑 = 该 task 只能 `review_needed`。

### D1.2 判据脚本

`openclaw_runtime/scripts/check-production-reachable.mjs`（TF-0104 AC-2；TF-0102 AC-3 亦引用）。

> 路径说明：节点 AC 写作 `scripts/check-production-reachable.mjs`；仓库内 40 余个 `check-*.mjs` 全部位于 `openclaw_runtime/scripts/`，且本脚本扫描 `openclaw_runtime/src`，故落在该目录以匹配既有约定。

```bash
node scripts/check-production-reachable.mjs <symbol> [<symbol>...]
```

退出码：`0` 生产可达 ｜ `1` 不可达 ｜ `2` 仅 API 面（被引用未被调用）｜ `3` 用法错误 / 符号不存在 / 配置的 root 已失效。

其余模式：`--all-modules`（全量粗扫）、`--blind-spots`（列出无法解析的动态 import）、`--roots`（打印 root 与可达模块数）。

**它为什么不能用 `grep` 代替** —— 本轮实测两例，两例都会让 `grep` 给出错误答案：

| 符号 | `grep -rn` 的非测试命中 | 真实情况 |
|---|---|---|
| `applyContextLadder` | 2 处 | 两处都是**注释字符串里的符号名**（`coding-c6h-flip-decision.ts:114,189`）+ 自身定义。真实调用点 **0** |
| `compressToolOutputText` | `coding-long-chat-curve.ts:121` 处有真实调用 | 但该模块自身**不被任何生产入口可达**，调用链终止于另一个死模块。真实可达性 **无** |

脚本因此做两件 `grep` 做不到的事：① 剥离注释与字符串字面量后再匹配；② 沿 import 图递归判定**引用方模块**是否被生产入口可达。

**方法与已知边界**（写在这里以免被当成比它更强的工具使用）：

- 可达性同时跟随静态 `import` / `export ... from` 与**字面量** `import("...")`。动态边不是可选项：`src/index.ts` 正是通过 `await import("./library.js")` 触达整个库，src 下约 1300 处动态 import 为字面量。
- 约 17 处动态 import 使用**计算式** specifier（插件 / 扩展加载器），无法静态解析，是明确的盲区，由 `--blind-spots` 列出而非静默忽略。
- 多行 import 块中单独占一行的符号会被正确识别为 `import` 而非调用点 —— 否则「导入了但从未调用」会被误报为可达。
- `package.json` 的 `exports` 面（plugin-sdk 等）**不在** root 集合内，故纯 SDK 对外 API 会显示为不可达。`buildToolPlan` 属此类，按 TF-0102 的 SDK 边界结论单独处置，不按本节判为死代码。
- 配置的 root 若不存在，脚本**以 exit 3 显式失败**而不是静默缩小可达集 —— 失效的 root 会产出假的「不可达」判定，那正是本节要防的失败模式。
- `--all-modules` 的计数偏大：§D1 的 root 只覆盖本轮的上下文/agent 入口，不覆盖 channels / ACP / media / release 等轮外入口。该模式是粗扫，**逐符号模式才是权威判据**。

### D1.3 三种降级出口（合法，不算失败）

| 不满足 | 只能标 | 附加义务 |
|---|---|---|
| (a) 生产可达 | **`landed-unwired`** | 记 `record_deviation`；诚实说明为什么接不上线 |
| (b) 反向证伪（含审核者未复跑） | **`review_needed`** | 补齐四类记录或等审核者复跑 |
| (a)(b) 皆不满足 | **`landed-unwired`** | 同上，且不得声称测试绿即等于完成 |

`landed-unwired` 在 task-forest 的 `status` 枚举中**不存在**，且**不得擅自扩展枚举**（TF-0104 `non_goals`）。表达方式：`status` 用 `review_needed`，同时以 `context_tags` 追加 `landed-unwired` 标签、并在 `summary` 前缀标注，两处并用以便检索。

**这三个出口是本节的核心。** 接不上线是合法结果 —— 有时上游还没就绪，有时旗标属于另一条车道，有时该能力本轮本就不该通电。**隐瞒才是失败，降级不是。** 一个诚实标 `landed-unwired` 的 task 优于一个标 `done` 而实际零生产调用的 task，因为后者会让 §D1 的全部下游判据失去意义。


## §R1 代码审核协议

来源节点：TF-0105。适用范围：M1 起每一个改动 `openclaw_runtime/src` 的 task。M0 文档相的 task 只需 A2 与 A3 两项（无代码改动，A1/A4/A5/A6 判为 `N/A` 并写明理由）。

### R1.0 谁来审核

1. **审核者必须不是实现者。** 同一 session 内自审不成立 —— 实现者已经知道自己「想让它成立」，再由同一上下文判定，等于用假设验证假设。审核者可以是另一个 agent 会话、另一条车道，或人。
2. **审核者只被给出该 task 的 `requirements` 与 `acceptance_criteria`，不被给出实现者的自述结论。** 给出自述会产生锚定：审核者会去核对那份自述，而不是去核对实现。
3. 审核记录落 `docs/dev/context-moat/reviews/<task-id>.md`，首行须写审核者身份（agent 会话标识或人名）与审核时的 `git rev-parse --short HEAD`。
4. **任一项 FAIL，该 task 不得进入验收**，状态只能到 `review_needed`。六项之外的问题按 §R5 范围-2 强制三分类，不得以「顺手修了」的方式进入本次改动。

### R1.1 A1-A6 六项检查

六项不是抽象的代码质量项，而是本轮审计中**真实命中过**的六类缺陷模式。每项都附判例；判例的作用是防止检查项被理解成形式主义 —— 每一项都曾经让一个「测试全绿」的模块实际上不工作。

| 项 | 检查什么 | 机械判据 | 判例（本轮真实命中） |
|---|---|---|---|
| **A1** | **生产调用点存在性（递归上溯）** | 对新增/改动的每个导出符号跑 `grep -rn '<symbol>' src/ --include=*.ts`，排除 `*.test.ts` 后须有 ≥1 个调用方；再对该调用方递归上溯，直到抵达一个生产入口。链条上任一环只被测试消费，则整条链视为未通电 | 本轮起点即 8 个生产零调用模块。「有测试调用它」不是生产可达 —— 见 §D1 |
| **A2** | **反向证伪** | 主动查四类反证并逐条记录「查了什么 / 结果如何」：① 旗标默认值是否为关；② 是否存在 kill switch 使该路径不可达；③ 上游守卫是否先行 return；④ `deferProjection` 一类分支是否把该路径旁路。**四类全部记录为空才算 PASS**；未记录 = FAIL（不是 PASS） | 见 §D1 反向证伪条款。本项须同时引用 §R5 的边界编号，使越界成为可指认的具体条款违反 |
| **A3** | **注释与契约一致性** | 本次改动涉及的每条 doc-comment 断言，须在实现中找到对应代码；找不到则改注释或改实现，二者择一，不允许留着 | 三处实测说谎：`turn-injection-budget.ts:420`、`coding-runtime-flags.ts:9-10`、`assembler.ts:66-74`（详见 R1.3） |
| **A4** | **配置四面一致** | 新增/改动配置叶子须五处齐全：`config/zod-schema.ts` / `config/types.openclaw.ts` / `config/runtime-feature-leaves.ts` / 运维目录（`shared/dcs/prod-flags-catalog.ts`）/ **执行器**。缺执行器 = 写了没人执行 | `coding-runtime-flags.ts:152-164` 的 `worktree.backend` 有叶子无执行器。**声明「旗标关闭」为回滚方式时必须跑本项**（§R5 过程-9） |
| **A5** | **CJK 回归** | 触碰文本处理（分词 / 抽取 / 截断 / 相似度）必须有**纯中文输入**断言。测试语料全英文 = 本项 FAIL | `tokenizeWords`（`memory-hybrid-retrieval.ts:1046`）与 `extractEntities`（`:1063`）对纯中文串产出 0 token / 0 entity；缺陷能长期存活正是因为语料全英文 |
| **A6** | **边界值** | 触碰数值预算 / 阈值必须有 `0` / 负数 / `NaN` / 空数组断言。**只测 0 不够** —— `NaN` 会穿过所有 `<= 0` 与 `< 2` 守卫，因为 `NaN` 参与的比较恒为 false | `createInjectionBudget(NaN)`（`injection-budget.ts:41`）使全体注入退化为单字符省略号且报告 `applied: true`，击穿该文件第 8 行声明的 fail-closed 契约（详见 R1.3） |

### R1.2 审核记录模板

复制到 `docs/dev/context-moat/reviews/<task-id>.md` 后逐格填写。**空格 = FAIL，不是 PASS。**

```markdown
# 审核记录：<task-id> <task 标题>

- 审核者：<agent 会话标识 / 人名>（须 ≠ 实现者）
- 审核时 HEAD：<git rev-parse --short HEAD>
- 实现者：<标识>
- 审核者是否被给出实现者自述结论：否

## 开工前冲突自检（§R4）

- 本 task 声明触碰的文件集：<逐个列出>
- 另一车道当时 in_progress 的 task 及其触碰面：<列出，或「无」>
- **交集是否为空**：是 / 否 —— 非空则本 task 不得开工
- 开工前 `git status --porcelain -- <本车道文件域>`：<原样贴出，须为空>

## 边界判定（§R5）

- **本 task 触碰的文件是否全部落在范围-1 内**：是 / 否（否则须有 record_deviation）
- 本 task 是否改动任何旗标默认值：是 / 否（是则须有 `approvals/<task-id>.md`，§R5 技术-4）
- 新发现问题的三分类：阻塞本任务 <n> / backlog-P1 <n> / 升级-P0-需人工批准 <n>
- 「升级-P0」是否均有人工批准记录：是 / 否 / N/A（否 = 本审核记录 FAIL，§R5 范围-2）

## A1-A6

| 项 | PASS/FAIL/N-A | 证据（文件:行号） | 说明 |
|---|---|---|---|
| A1 生产调用点（递归上溯） | | | 上溯链：<符号> → <调用方> → … → <生产入口> |
| A2 反向证伪 | | | 见下方专节 |
| A3 注释与契约一致 | | | 本次改动涉及的 doc-comment 断言逐条 |
| A4 配置四面一致（含执行器） | | | 五处齐全 / N/A（本 task 无配置叶子改动） |
| A5 CJK 回归 | | | 纯中文断言所在测试:行号 / N/A |
| A6 边界值（0 / 负 / NaN / 空） | | | 四个断言所在测试:行号 / N/A |

### A2 反向证伪记录（四类逐条，不得留空）

| 反证类型 | 查了什么（命令 / 文件:行号） | 结果 |
|---|---|---|
| ① 旗标默认值是否为关 | | |
| ② 是否存在 kill switch | | |
| ③ 上游守卫是否先行 return | | |
| ④ deferProjection 一类分支是否旁路 | | |

- 关联 §R5 边界编号：<如 技术-4 / 过程-9>
- 结论：本 task 的新代码在**默认配置**下是否真的被生产路径执行：是 / 否
  （否 = 不得标 done，按 §D1 走 `landed-unwired`）

## 回滚（§R5 过程-9）

- 声明的回滚方式：<旗标关闭 / revert / 其他>
- 若为「旗标关闭」：该旗标是否存在执行器（A4 第五处）：是 / 否
- **实际验证过的回滚路径**：<贴出执行的命令与观察到的结果>

## 阴性对照（防橡皮图章，§R1.4）

- 对照对象：<已收口 task 的 id，或首份记录按 R1.4 用 R1.3 判例>
- 复跑的命令：<原样>
- 复跑输出：<原样贴出>
- 与基线是否一致：是 / 否
- 若不一致，差异是否可归因于某个已收口 task：<task-id> / 不可归因（不可归因 = 本次审核整体无效，换审核者重做）

## 引用的 DEV-PROTOCOL 节

- <至少一节，如 §D1 / §R2 / §R5>

## 结论

- 六项是否全部非 FAIL：是 / 否
- 建议状态：done / landed-unwired / review_needed
```

### R1.3 判例基线（阴性对照的校准锚）

以下输出观测于 `f005991b7`（S0 提交）。**用途**：首份审核记录的阴性对照没有「已收口的历史 task」可复跑，改用本节判例校准 —— 审核者复跑命令，输出与本节不符时，差异必须能归因到某个已收口 task；不可归因即说明审核者的工作树或判读有问题，本次审核无效。

| # | 命令 | 观测于 `f005991b7` | 预期由谁改变 |
|---|---|---|---|
| P1 | `grep -rn 'factViews' openclaw_runtime/src --include=*.ts \| wc -l` | `11`，其中 `config/runtime-feature-leaves.ts:70`、`config/types.openclaw.ts:193`、`config/zod-schema.ts:342` 三处**仍存在** —— 而 `coding-runtime-flags.ts:9-10` 的注释声称该叶子「has been removed」。这是 A3 与 A4 同时命中的判例 | 车道 2 的 TF-0109 / TF-0117（§R1 A3） |
| P2 | `sed -n '66,74p' openclaw_runtime/src/context-engine/assembler.ts` | 注释声称 `working_memory after a tool_result` 的通道「are still queried」 —— 而 `extensions.ts` 的 `injectedChannels` 是 add-only，同一 attempt 内首次注入后永久跳过 | 车道 1 的 TF-0126（T-B6） |
| P3 | `grep -n 'createInjectionBudget(' openclaw_runtime/src/context-engine/injection-budget.test.ts` | 覆盖 默认 / `100` / `10` / `5` / `0`，**无 `NaN`、无负数** —— A6 判例的测试缺口本体 | 车道 1 的 TF-0128 或后续边界值补测 |
| P4 | `injection-budget.ts:41` 的 `NaN` 逻辑追踪（无需运行）：`Math.max(0, Math.floor(NaN)) === NaN` → `remainingBudget` 返回 `NaN` → `rem <= 0` 为 false → `text.length <= rem` 为 false → `rem < 2` 为 false → 第 120 行 `text.slice(0, NaN - 1)` 得 `""`，拼接后为 `"…"`，返回 `applied: true` | 单字符省略号 + `applied: true`，第 8 行的 fail-closed 契约被击穿 | 修复者须同时补 A6 四个断言 |
| P5 | `sed -n '1046,1076p' openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts` | `tokenizeWords` 用 `/\W+/` 切分（CJK 属 `\W`，切完全为空串，被 `length > 1` 滤净）；`extractEntities` 五条正则全部锚定 `[A-Z]` / `[a-z]` / `\d` ASCII 类。纯中文输入 → 0 token / 0 entity | 车道 2 的 TF-0114（T-P0-6） |

### R1.4 阴性对照规则（防橡皮图章）

1. 每份审核记录必须含阴性对照项：对**任一已收口 task** 复跑其 A1 grep，并原样贴出输出。
2. **首份记录的 bootstrap**：本轮尚无已收口 task 时，改用 R1.3 的 P1-P5 任一条作为对照对象。
3. 复跑输出与基线不符时，差异**必须可归因到一个已收口 task**（贴出 `git log --oneline` 佐证）。不可归因 = 本次审核整体无效，需换审核者重做。
4. 阴性对照的目的是检出「审核者没有真的跑命令」：一个从未执行 grep 的审核者无法复现基线输出，也无法解释差异。


## §R2 分层测试验收门

<!-- owner=lane-2 node=TF-0106 -->

## §R3 每任务改动半径收口门

<!-- owner=lane-2 node=TF-0107 -->

## §R4 交付物目录 / 偏差 / 回滚 / pick-next / 并发编排

来源节点：TF-0145。本节补齐流程闭环中四处此前不被任何节点承载的空白：交付物无统一落盘位置、偏差记录只有既成事实而无「何时必须记」、有多个 ready 节点而无取任务规则（容易挑软的做）、图有 2.5x 并行余量而无并发编排（直接并行会在同文件冲突域上撞出脏工作树）。

### R4.1 统一交付物目录

**本轮全部产出物只允许落在此树下。路径以外的产出物视为未交付。**

```
docs/dev/context-moat/
  DEV-PROTOCOL.md          M0 七节合一的开发文档（本文件）
  GATE-BASELINE.md         TF-0142 产出：既有红门归属与 L1/L2 收紧定义基线
  reviews/<task-id>.md     §R1 审核记录，每 task 一份
  approvals/<task-id>.md   §R5 技术-4 默认值改动的人工 approve
  designs/<task-id>.md     §R3 拆分件的共享设计
  corpus/<corpus-id>.md    TF-0143 语料元数据
  loss-trace-spike.md      TF-0138 产出：上下文损失追踪 spike
```

**唯一的工具类例外**：`openclaw_runtime/scripts/check-production-reachable.mjs`（§D1.2 判据脚本）。它由 TF-0104 AC-2 与 TF-0102 AC-3 双重指定，是**审核工具**而非某个 task 的交付物，故落在仓库既有的 `check-*.mjs` 目录而非本树下。除此之外不得增加例外；若某 task 认为自己需要新的例外，按 R4.2 记偏差。

### R4.2 偏差记录（`record_deviation`）的强制触发条件

**四类之一即必须记，不是「可以记」：**

| | 触发条件 |
|---|---|
| (a) | **范围增减** —— 砍掉 / 加入 / 移轮任何 task |
| (b) | **task 收口为 `landed-unwired`** —— 接不上线的诚实降级（§D1.3） |
| (c) | **审核或验收发现的问题被判为「本轮不修」** —— 即三分类中落入 `backlog-P1` 的项 |
| (d) | **已声明的回滚被真实执行** —— 注意：声明回滚方式与真实执行回滚是两件事，只有后者触发 |

字段固定：`id` / `node_id` / `kind` / `summary` / `impact` / `decided_by`。

写入通道：`record_deviation` 是**结构性变更**，必须走 `proposal-save` + `proposal-apply`，且必须**即生成即应用**（见 R4.6）。

### R4.3 回滚流程

**声明回滚方式**（§R5 过程-9 的通用条款，每个改变模型可见内容的 task 都要做）与**真实执行回滚**是两件不同的事。真实回滚时必须走完五步：

1. 关闭旗标或 `revert`
2. 跑一次该 task 的 **L0 门**，确认回到基线
3. 记 `record_deviation`，`kind=rollback_executed`
4. 把 task 状态改回 **`proposed`**，而不是标 `done`
5. 在 `reviews/<task-id>.md` 中记录实际执行的命令与观察到的结果

**回滚本身不算 task 失败；隐瞒回滚才算。**

声明「旗标关闭」为回滚方式时，必须同时验证该旗标**存在执行器**（§R1 的 A4 第五处）。`coding-runtime-flags.ts:152-164` 的 `worktree.backend` 是「写了叶子没有执行器」的现成判例 —— 对这类旗标，「关闭旗标」不构成有效回滚，因为它本来就没有在执行。

### R4.4 pick-next 规则

存在多个 ready 节点时，**消除挑软柿子的空间**。在所有 blocking 前置已满足、且与另一车道在跑任务无文件冲突的 task 中，按以下四级排序取第一个：

1. **关键路径上的优先**
2. **`priority` 数值小的优先**
3. **`max_brb` 大的优先** —— 先做难的，避免把 `brb-M` / `brb-L` 堆到末期
4. **TF 编号小的优先**

开工前必须把该 task 状态改为 `in_progress` 并记入 task-forest（`update-node`）。选择依据在 node 或 `reviews/<task-id>.md` 中留一行。

> 本轮两条车道的排班已固定（R4.7），pick-next 主要用于排班被偏差打断后的重新取任务。**不得用 pick-next 把排班里靠后的 task 提前** —— 尤其是 TF-0122（须待 TF-0114 完成）与 TF-0140（须待 TF-0128 完成）。

### R4.5 并发上限与冲突域

**本轮固定 2 车道，禁止扩到 3 条以上。**

依据：调度模拟下 1/2/3/4/6 车道的墙钟为 13.1 / 7.2 / 5.3 / 4.7 / 4.1 个工作日。2 车道已拿到 83% 收益，第 4 条起边际近零。**瓶颈是冲突域而非人手** —— 多开车道只会在高冲突文件上排队，并线性放大脏树风险（`assembler.ts` / `extensions.ts` / `coding-runtime-flags.ts` / `prod-flags-catalog.ts` 各有 3-4 个 task 触碰）。

**冲突域表：每个域同时只允许 1 个 `in_progress`。** 新发现的域必须追加（按 R4.2(a) 记偏差）。

| 域 | 文件 | 触碰 task | 车道 |
|---|---|---|---|
| D01 | `tests/unit/config-schema-parity.test.ts` | TF-0106 / 0109 / 0112 / 0142 | 2 |
| D02 | `shared/dcs/prod-flags-catalog.ts` | TF-0107 / 0112 / 0137 / 0140 | 2 |
| D03 | `src/context-engine/coding-runtime-flags.ts` | TF-0112 / 0117 / 0137 / 0146 | 2 |
| D04 | `src/context-engine/assembler.ts` | TF-0117 / 0126 / 0140 | 1 |
| D05 | `src/agents/embedded-agent-runner/extensions.ts` | TF-0117 / 0126 / 0140 | 1 |
| D06 | `src/context-engine/context-candidate.ts` | TF-0126 / 0128 / 0138 | 1 |
| D07 | `src/config/types.openclaw.ts` | TF-0107 / 0109 | 2 |
| D08 | `src/memory/context-pack.ts` | TF-0110 / 0114 | 2 |
| D09 | `src/agents/agent-hooks/compaction-safeguard.ts` | TF-0111 / 0124 | 1 |
| D10 | `src/agents/worktree-service.ts` | TF-0112 / 0137 | 2 |
| D11 | `src/context-engine/turn-injection-budget.ts` | TF-0117 / 0128 | 1 |
| D12 | `docs/dev/context-moat/DEV-PROTOCOL.md` | TF-0103 全部子节点 | 双（按节分工） |
| **D13** | `src/runtime-core/memory-hybrid-retrieval.ts` | TF-0114（车道 2）/ TF-0122（车道 1） | **跨车道** |

**D13 是本轮唯一一组跨车道的真写冲突域。** TF-0114 修 `tokenizeWords` / `extractEntities` 的 CJK 空返回；TF-0122 裁决整条 hybrid 检索链去留，而「迁出」选项会移动整个文件。故 `TF-0122 depends_on TF-0114` 已由 non-blocking **升为 blocking**：必须先修完再裁决去留，反序会让 TF-0114 的修复被 TF-0122 的迁出连带作废。排班上两者相距 1050min，正常不会真撞上，但边必须是 blocking 以防 pick-next 抢跑。

**三处已排除的 mention-only 假阳性，勿再重复认定**：`attempt.ts` 与 `init.ts` 仅被 TF-0104 作为「生产入口 / 注册入口」判例引用（零写入）；`context-compression-eval-runner.mjs` 仅被 TF-0106 作为 §R2 门命令清单引用（只读）。若车道 1 的 TF-0143 / TF-0138 需要真改这个 runner，属触碰面扩大，按 R4.2 记偏差。

### R4.6 task-forest 多 session 写入纪律

两条车道各持一个会话、同写一张图，故通道选择不是风格问题：

| 场景 | 用什么 | 为什么 |
|---|---|---|
| 自己节点的 `status` / `progress` / `evidence` | **`update-node`** | 走文件锁自动串行化，**无** `base_graph_hash` 检查，不会被对方顶掉。禁止为一次状态变更去走 proposal |
| 结构性变更（加节点 / 加边 / `record_deviation`） | **`proposal-save` + `proposal-apply`** | 必须**即生成即应用**。存着过一会儿再 apply，对方任何一次 `update-node` 都会让它 stale |
| 提示 stale | 重新读图、重新生成提案 | **禁止 `--allow-stale`** —— 它会静默丢掉对方的任务信息 |

- 每条命令带 `--actor lane-1` / `--actor lane-2`，使 `events.jsonl` 可按车道回溯。
- Windows 控制台须设 `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`，否则 CLI 中文输出乱码会让判读失真。
- 锁默认等 30 秒。撞上另一车道正在写属于正常，等一下重试即可；**不要删 `.agent-workbench/task-forest/lock`**。
- 不手改 `graph/nodes.json` / `graph/edges.json` / `config.json`。图状态可疑时跑 `validate`。

### R4.7 双车道排班

#### M0 文档相（0-430min，两车道等长，全程零 `src` 改动）

M0 只产出 DEV-PROTOCOL.md 与目录树，不受 M1+ 的文件域分工约束，改按「协议节 vs 门节」分工，并刻意让 D01 / D07 两个冲突域完整落在同一条车道内。

**S0 骨架**（车道 1，≤10min，M0 第一个提交）：建七个子路径（`.gitkeep`）+ 建 DEV-PROTOCOL.md 骨架（七个 `## §X` 标题 + 每节一行 `<!-- owner=lane-N -->` 占位），**先提交再开工**。此后两车道只填自己 owner 的节，**禁止跨节编辑**。

| 车道 1（协议与流程节，430min） | 车道 2（门与半径节，420min） |
|---|---|
| S0 骨架（10） | TF-0109 T-P0-3（60） |
| TF-0105 R1（120） | TF-0142 D4（90） |
| TF-0104 D1（90） | TF-0106 R2（120） |
| TF-0145 R4（150） | TF-0107 R3（150） |
| owner 的节：§D1 §R1 §R4 §R5 | owner 的节：§R2 §R3 §D4 |
| TF-0146 R5（60） | |

本相内**零跨车道 blocking 边、零跨车道冲突域**：`TF-0106 → TF-0142 → TF-0109` 这条唯一的 M0 blocking 链整条在车道 2 内串行；D01 与 D07 均只在车道 2 内。

#### M1+ 实现相（430min 起，按文件域分工）

**车道 1（上下文·压缩·注入线，1920min）固定顺序**，独占 D04 / D05 / D06 / D09 / D11：

`TF-0136 D3(0)` → `TF-0128 T-C1(360)` → `TF-0117 T-D2(90)` → `TF-0126 T-B6(300)` → `TF-0116 T-D1(240)` → `TF-0111 T-P0-2(180)` → `TF-0124 T-B4(300)` → `TF-0143 T-CORPUS(180)` → `TF-0138 T-C0(180)` → `TF-0122 T-B2(90)`

**车道 2（治理·旗标·记忆线，2010min）固定顺序**，独占 D02 / D03 / D07 / D08 / D10：

`TF-0118 T-D3(300)` → `TF-0110 T-P0-1(240)` → `TF-0114 T-P0-6(240)` → `TF-0121 T-B1(240)` → `TF-0113 T-P0-5(180)` → `TF-0119 T-D4(180)` → `TF-0112 T-P0-4(120)` → `TF-0137 D2(90)` → `TF-0139 T-E1(120)` → `TF-0140 T-E2(300)`

**两条顺序都不许改序、不许挑软的做。** 两处位置是机械验证过的，不要挪：

- **TF-0117 必须紧跟 TF-0128**，不能留在车道 1 尾部：它触碰 D04 / D05，留在尾部会与车道 2 的 TF-0140 及其 soak 期重叠，直接违反 B3。
- **TF-0128 必须先于 TF-0124**（图上已是 blocking 边）。`GOAL_ANCHOR_PATTERN`（`compaction-damage-rules.ts:73`）含 `DECISIONS?`，而 TF-0124 要统一的章节契约里有 `## Decisions` —— 实测一份被掏空的摘要（五段齐全、内容全 `None.`）能同时通过 `structure_damage` 与 `goal_token_decay`。所以 TF-0128 必须先把检测器与章节契约解耦，顺序反了会**静默废掉本轮最核心的差异化能力**。

跨车道 blocking 边只有一条：`TF-0140`（车道 2，起于 2140min）`depends_on` `TF-0128`（车道 1，完成于 790min），余量 1350min —— 即同步点 B2，正常排班下不会成为等待点。

车道 1 收于 2350min、车道 2 收于 2440min，总墙钟 **2440min ≈ 6.8 个 6 小时工作日**。

### R4.8 三个同步点（barrier，未达成不得跨越）

> B1 的判据被**锚定在行首**（`^<!-- owner=`）而不是裸 `grep 'owner='`：本节自身的正文就包含 `owner=` 字样（S0 描述与 B1 命令本身），裸 grep 会把协议正文误当成未收口的占位，使 B1 永远无法达成。真实占位是唯一出现在**行首**的形式。定义 barrier 的文档必须对它自己也成立。

| | 内容 | 机械判据 |
|---|---|---|
| **B1** | M0（TF-0103）七节全部收口后才允许进入实现类 task —— 协议不齐则完成标准与验收判据不存在 | `grep -cE '^<!-- owner=lane-[12] node=TF-' docs/dev/context-moat/DEV-PROTOCOL.md` 输出 `0`（七个 `## §` 标题下的占位全部被真实内容替换），且 `git log` 显示每节只被其 owner 车道的提交改过 |
| **B2** | TF-0128（T-C1）完成后车道 2 才可开 TF-0140（T-E2）—— 翻正需要健康分四维基线 | 健康分四维 scorecard 已有非空输出，落在 `reviews/TF-0128.md` |
| **B3** | TF-0140 的 **14 天真人 soak 期间**，两条车道均不得改动 `assembler.ts` / `extensions.ts` / `prod-flags-catalog.ts` —— 否则回滚归因不清，soak 证据作废 | `git log --oneline <soak-start>..HEAD -- <三个路径>` 为空 |

**任一车道都不得自行放行 barrier。** 需要跨越而判据未达成时，报告给用户。

### R4.9 每车道独立提交（防脏树）

**每车道独立提交，不共享未提交改动。切换 task 之前，工作树对本车道文件域必须干净（提交或 stash）。**

这是防脏树的关键一条 —— 仓库当前本就有大量与本轮无关的未提交改动，两车道若共享脏树则无法干净剥离任一 task 的回滚。

- 每个 task 收口时提交或 stash，再开下一个。**不允许两个 task 的改动混在一次提交里** —— 混了就无法干净剥离任一 task 的回滚。
- 提交只包含本 task 真实触碰的路径。仓库里既有的未提交改动（`.agent-workbench/`、`artifacts/`、`docs/`、`electron/`、`openclaw_runtime/src` 下 79 项…）**不属于任何车道**：不要碰、不要提交、不要 stash 掉。
- **提交必须用 pathspec 限定**：`git commit -- <显式路径>`，不要裸 `git commit`。

> **为什么这条是硬性的**：`git add <路径>` 只控制本次新增暂存，而裸 `git commit` 提交的是**整个 index**。当另一车道在你 `add` 与 `commit` 之间 stage 了自己的文件时，它们会被静默裹入你的提交。本轮已真实发生一次（`TFD-lane1-index-bleed-2026-08-24`：车道 1 的 TF-0105 首次提交裹入了车道 2 的两个 D07 配置文件，已 `reset --soft` + `restore --staged` 剥离，车道 2 内容经 `git hash-object` 校验字节不变）。注意新增文件仍需先 `git add`，`git commit -- <path>` 对 untracked 文件会报 `did not match any file(s) known to git`。

### R4.10 每个 task 的开工—收口循环

1. **开工前冲突自检**（留痕到 `reviews/<task-id>.md`）：声明本 task 要触碰的文件集 → 与另一车道当前 `in_progress` 的 task 触碰面取交集 → **交集必须为空**。查另一车道在跑什么：`list --status in_progress`。同时跑 `git status --porcelain -- <本车道文件域>` 确认干净。
2. **置为 `in_progress`**：`update-node <id> --status in_progress --actor lane-N`
3. **做**。把节点的 `requirements` 当规格、`acceptance_criteria` 当验收清单，逐条对。
4. **L0 门**（每次编辑后，秒级）：`pnpm lint:bom` + 针对本次改动文件的定向测试。
5. **L1 门**（task 收口，分钟级）：见 §R2。
6. **改动半径收口**：见 §R3 三条命令，输出贴进审核记录。超出该节点 `max_brb` 档位 → 不许标 done，先拆或先记偏差。
7. **写审核记录** `reviews/<task-id>.md`：按 §R1.2 模板。
8. **收口**：`--status done`，或按 §D1.3 诚实降级。

> 关于第 6 步在本轮的执行细节：因仓库存在大量轮外未提交改动，§R3 三条命令若不加路径限定，输出会被既有污染主导而无法反映本 task 的真实半径。故按本 task 触碰路径限定执行，并附 `git diff --cached --name-only` 作为「无越界」的独立佐证。这是既有脏树下的执行方式，不是对 §R3 的豁免。


## §R5 本轮硬边界

<!-- owner=lane-1 node=TF-0146 -->

## §D4 既有红门归属与 L1/L2 收紧定义

<!-- owner=lane-2 node=TF-0142 -->
