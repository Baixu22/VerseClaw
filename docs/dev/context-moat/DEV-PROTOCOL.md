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

**(a) 生产可达。** `grep` 出至少一个**非测试、非 `experiments/`、非 `scripts/`** 的生产调用点，且该调用点本身能**递归上溯**到以下**五者**之一（前四者由 TF-0104 点名，第五者为包主入口，缺它会漏掉整条 library 面）：

- `src/agents/embedded-agent-runner/run/attempt.ts`（agent attempt 主循环）
- gateway 启动（`src/gateway/boot.ts`）
- `init.ts` 注册（`src/context-engine/init.ts`）
- RPC 暴露（`src/gateway/cli-runtime/gateway-rpc.ts`）
- **包主入口 `src/index.ts`**（`package.json` 的 `main` → `dist/index.js`；它经 `await import("./library.js")` 触达整个 library）

> 本清单与 §D1.2 脚本的 `PRODUCTION_ROOTS` 常量**必须逐条一致**（当前均为 5 项）。二者不一致时，「某符号是否生产可达」会因判定者用文本还是用脚本而不同 —— 那正是 §R1 A3 判例（`coding-runtime-flags.ts:9-10` 声称叶子已移除而它仍存在）的同类缺陷。**改任一处必须同步另一处。**
> 修订来源：TF-0104 的审核（lane-2）指出正文写「四者」而脚本实为 5 项。已实测该差异不改变本轮结论（含/不含 barrel root，D1.0 点名的死模块均仍判 `NOT PRODUCTION REACHABLE`），故属判据一致性问题而非判定错误 —— 但 A3 的标准是「不允许留着」。

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

**从仓库根运行**（`D:\ClawX`，两条车道的默认 cwd）：

```bash
node openclaw_runtime/scripts/check-production-reachable.mjs <symbol> [<symbol>...]
```

从 `openclaw_runtime/` 内运行时才可省略前缀（`node scripts/check-production-reachable.mjs …`）。**逐字照抄不带前缀的形式在仓库根会抛 `Cannot find module`** —— 本节初稿即为该形式，由 TF-0104 的审核（lane-2）指出并修正。审核者复跑本节命令时请按自己的 cwd 选择对应形式。

退出码：`0` 生产可达 ｜ `1` 不可达 ｜ `2` 仅 API 面（在可达模块中被引用但从未被调用）｜ `3` 用法错误 / 符号不存在 / 配置的 root 已失效。

**四档均已有实证样本**（审核者可逐条复跑；每档至少一个已知答案，避免任一分支「定义了但从未被走过」）：

| 退出码 | 实证符号 | 观测 |
|---:|---|---|
| `0` | `createInjectionBudget` | PRODUCTION REACHABLE，2 个真实调用点（`assembler.ts:307` / `turn-injection-budget.ts:280`），6 处测试命中正确排除 |
| `1` | `applyContextLadder` | NOT PRODUCTION REACHABLE，零调用点（其 grep 命中全在注释字符串内） |
| `2` | **`CODEX_CLI_PROFILE_ID`** | API-SURFACE-ONLY —— 经 `agents/auth-profiles.ts:6` 与 `plugin-sdk/provider-auth.ts:38` 两个**可达** barrel 再导出，但**从未被调用** |
| `3` | 任一不存在的标识符 | `symbol not found in src/` |

> `2` 档的样本由 TF-0104 的审核（lane-2）指出缺失后补入：其审核发现该档在 6 个抽样符号上均未触发，属「定义了但未被实证」的分支。后续对 1065 个具名再导出符号批量扫描找到 `CODEX_CLI_PROFILE_ID`。该档在本仓库稀有是有原因的 —— 「在可达模块中被具名导入却从未调用」通常会先被 lint 的未使用导入规则拦掉，**只有再导出（re-export）形态能合法长期存在**，因为再导出本身就是「不调用」的正当用途。

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

### D1.4 (a) 不适用的三类改动（编译期 / 守卫 / 契约面）

D1.1(a) 问的是「新代码是否被生产路径执行」。有三类改动**没有运行时调用点可言**，对它们套用 (a) 会把合规的工作误判为 `landed-unwired`：

| 类别 | 例子 | 为什么 (a) 不适用 | 判法 |
|---|---|---|---|
| **编译期契约** | TS 类型声明、`DeepRequired` 穷举夹具 | 类型在运行时被擦除，天然无调用点。其效力由 `pnpm typecheck:node` 与 `pnpm lint:dcs` 的 type-aware 运行强制 | (a) 判 **N/A**；改判「该约束是否真的在门内生效」 |
| **守卫 / 判据** | parity 测试夹具、lint 规则数据 | (a) 明确把测试排除在生产调用点之外，故守卫**永远**无法满足 (a) | (a) 判 **N/A**；改判「守卫是否由红转绿且不可绕过」 |
| **默认关旗标的配置面补齐** | 声明一个 default-off 叶子的类型/目录/夹具 | 旗标默认关是 §R5 技术-4 **强制要求**；为通过 (a) 而打开它才是越界 | (a) 判 **N/A**；改判「执行器是否存在 + 旗标是否如实默认关」 |

**判别标准**：问「本 task 是否引入了一个新的、意图在生产运行的能力？」

- **是** → (a) 全额适用。不满足即 `landed-unwired`。
- **否**（只补类型、夹具、目录、守卫） → (a) 判 N/A，并**必须**替代性证明两件事：① 该约束/守卫在 L0 或 L1 门内真实生效（贴出门命令与输出）；② 若涉及旗标，其**执行器已存在**且可递归上溯到生产入口（用 §D1.2 脚本取证）。

**这不是 (a) 的豁免口。** 替代证明的举证责任不低于 (a)：一个「补了类型但守卫仍不生效」的 task 依然 FAIL。真正的区别在于，把「默认关的旗标」打开去满足 (a) 会同时违反 §R5 技术-4 并破坏 TF-0146 的成功指标（本轮默认值改动次数恰为 1），所以对这三类改动，(a) 的字面判据与本轮边界**互相矛盾** —— D1.4 消除该矛盾。

> 来源：TF-0109（车道 2 的配置一致性守卫修复）的审核。该 task 只改 6 行 TS 类型声明 + 1 行夹具值，按 D1.1(a) 字面判定会因「新代码在默认配置下不被执行」而被迫标 `landed-unwired`，但它实际上没有引入任何未通电的模块 —— 它修复的守卫每次 L1 都在跑。缺口由实现者在自检时主动提出、由审核者裁定并回写本节。

### D1.5 已知的 (a) 假阳性：编译期夹具

`src/config/runtime-feature-leaves.ts` 的 `RUNTIME_FEATURE_EXHAUSTIVE` 会被 §D1.2 脚本与「生产零调用模块」清单判为不可达 —— 它在 `src/` 下、唯一消费者是 `tests/unit/config-schema-parity.test.ts`。但它**不是死代码**：它是 `DeepRequired<RuntimeFeatureConfig>` 的编译期锚，给 `RuntimeFeatureConfig` 加叶子而不同步此处会**停止编译**（实测 `TS2741`）。

**处置：判为 `guard-only`，保留，不迁出。** 清点「生产零调用模块数」时，此类编译期锚须单列，不计入需清偿的死代码 —— 否则会把守卫本体当成技术债清掉，正好拆掉防线。

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
| **A4** | **配置四面一致** | 新增/改动配置叶子须五处齐全：`config/zod-schema.ts` / `config/types.openclaw.ts` / `config/runtime-feature-leaves.ts` / 运维目录（`shared/dcs/prod-flags-catalog.ts`）/ **执行器**。缺执行器 = 写了没人执行。**第五处不能用 §D1.2 脚本判定，见 A4 注**。声明「旗标关闭」为回滚方式时必须跑本项（§R5 过程-9） | `coding-runtime-flags.ts:152-164` 的 `worktree.backend` 有叶子无执行器 |

> **A4 注 —— 「有执行器」与「生产可达」是两个不同谓词，不可用同一工具判定。**
>
> §D1.2 脚本回答的是「该符号是否能被生产入口触达」。A4 第五处要回答的是**更强的问题**：「把这个叶子改掉，运行时行为会不会变」。二者可以背离，本轮就有现成判例：
>
> `resolveWorktreeBackend` 经脚本判 **exit 0（生产可达）**，但其唯一生产调用点是 `runtime-flag-ack.ts:272` —— 一条**只上报、不消费**的路径；真正建 worktree 的 `worktree-service.ts:267` 读的是传入的 `options?.backend`，从不读该叶子。**故它可达却无执行器：设置该叶子不改变任何运行时行为。**
>
> 对照组：`runKeCandidateGenerationForTerminal` 同样 exit 0，但其调用点 `task-loop-controller.ts:2237` 确实**按值分支**（`if (!flags.candidateGeneration) return {enabled:false}`）。两者退出码相同、性质相反。
>
> **A4 第五处的正确判据（两步，脚本只完成第一步）**：
> 1. 用 §D1.2 脚本确认解析器可达（必要不充分）；
> 2. **人工追到至少一个「按该值分支或据该值改变输出」的站点**，并在审核记录中给出 `文件:行号` 与该分支语句本身。只找到上报 / 日志 / ack / 快照类消费 ⟹ **判无执行器，A4 FAIL**。
>
> 修订来源：TF-0146 的审核（lane-2）指出协议把两个谓词混为一谈、要求用脚本做 A4 执行器检查是无效的。该缺口路由至本节（§R1 A4 定义）与 TF-0137（D2：无执行器旗标的处置）。
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
| P1 | `grep -rn 'factViews' openclaw_runtime/src --include=*.ts \| wc -l` | `11`，其中 `config/runtime-feature-leaves.ts:70`、`config/types.openclaw.ts:193`、`config/zod-schema.ts:342` 三处**仍存在** —— 而 `coding-runtime-flags.ts:9-10` 的注释声称该叶子「has been removed」。这是 A3 与 A4 同时命中的判例 | 车道 2 的 **TF-0112**（T-P0-4，其标题即「factViews 从 schema/type 下架」）。**归属已更正**：初稿写作 TF-0109，但 TF-0109 的 `non_goals` 明确「不顺手改其他旗标（其余旗标问题在 T-P0-4）」，`factViews` 正属「其他旗标」；由 TF-0109 的审核（lane-1，2026-08-24）提出并采纳 |
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

来源节点：**TF-0106**。本节把「验收」定义为**一组固定的 exit-code 判定**，而非执行者自述。四层门 L0/L1/L2/L3，逐层加重、触发时机递增。

**命令真实性**：本节所有命令均已核实存在于 `package.json` / `scripts/`（TF-0106 requirement-1）。逐条对照见 §R2.6。**禁止向本节写入未验证命令。**

**与 §D4 的关系（单一真相源）**：门的**命令清单以本节为准**；§D4 定义这些门在当前红树上的**可达判据**（哪些失败入白名单）。命令清单出现于两节时，§D4 引用本节，不得各写一份。TF-0142（§D4）依赖本 task（§R2），方向即为此。

---

### §R2.0 判据总则

1. **门 = exit code，不 = 自述。** 每道门是一组命令；命令全部 exit 0（L2/L3 为「失败集 ⊆ §D4 白名单」）才算过。
2. **失败输出原样保留。** 验收记录必须贴命令与 exit code，失败输出逐字保留，不得转述、不得截断为「大致通过」。
3. **绿的定义不是「所有测试全绿」，是「本轮必修项全绿 + §D4 白名单外无新增失败」**（TF-0106 requirement-5）。当前树上除 `config-schema-parity`（已由 TF-0109 修绿）外，`pnpm test` 与 `maturity:validate` 亦为红，且其失败**零本轮引起**（§D4 已机械证明）。把它们当「全绿门」会造出永不可达的理想门。
4. **留存义务**（success_metric）：每个 `done` task 留存 L0+L1 输出；每个 `done` milestone 留存 L2 输出；M5 留存 L3 输出。落 `reviews/<task-id>.md`。

---

### §R2.1 L0 快门 —— 每次编辑后，秒级，必须 exit 0

编辑代码后立即自查，最廉价的一层。**只跑与本次改动直接相关的部分**，不跑全量。

```bash
pnpm lint:bom
pnpm lint:dcs
npx vitest run <本次改动直接相关的 .test.ts>
```

- 触发时机：**每次编辑后 / 每次提交前**。
- 判据：三者 exit 0。第三条的文件由改动面决定（例：改 `config/` → `config-schema-parity.test.ts`）。
- 目的：把「一眼可见的破坏」挡在提交前，成本 < 10s。

> `lint:dcs` 是 type-aware oxlint，文件清单固定（见 `package.json`），已含全部 DCS/config 相关 src。若本次改动落在清单外的 src，L0 第二条仍跑，但真正的类型验证在 L1 的 `typecheck:node`。

---

### §R2.2 L1 子系统门 —— 每 task 收口，分钟级，必须 exit 0

**这是每个 task 能否标 `done` 的硬门。** 六条全部 exit 0 才算过：

```bash
pnpm lint:bom
pnpm contract:check
pnpm typecheck:node
pnpm lint:dcs
pnpm test:dcs
npx vitest run tests/unit/config-schema-parity.test.ts tests/unit/default-config-matrix.test.ts
```

- 触发时机：**每个 task 收口时**（改 `--status done` 前）。
- 实测墙钟：约 **75s**（`ef66a1c28`），确为分钟级。
- **不含 `pnpm test`、不含 `maturity:validate`** —— 依据 §D4.4：二者失败零本轮引起、且与 `test:dcs` 文件集零重叠，放进 L1 等于让每个 task 收口卡在别的 global_task 的未完成交付物上。二者移入 L2。
- `config-schema-parity` 与 `default-config-matrix` **单独列出**：实测均不在 `test:dcs` 的文件清单内（否则会漏跑）。前者是 FP-P0-06 配置面防线（TF-0109 的使能前置），后者是 18 项默认配置矩阵。

**L1 基线**（AC-2，观测于 TF-0109 修绿后的 `ef66a1c28`）：

```
L1 BASELINE @ ef66a1c28  2026-08-24T16:51:53Z
  pnpm lint:bom          → check-no-bom: ok                    exit=0
  pnpm contract:check    → Contract check passed.              exit=0
  pnpm typecheck:node    → tsc --noEmit (no diagnostics)       exit=0
  pnpm lint:dcs          → oxlint --deny-warnings (clean)      exit=0
  pnpm test:dcs          → 20/253 + 5/10 + 10/88 passed        exit=0
  parity + default-config-matrix → 2 files / 134 passed        exit=0
```

---

### §R2.3 L2 里程碑门 —— 每 milestone 收口，重，失败集 ⊆ §D4 白名单

里程碑收口才跑的全量门。**不要求 exit 0**（当前树上 `pnpm test`/`maturity` 为红），要求**失败集 ⊆ §D4 §6 白名单**：

```bash
pnpm lint:check
pnpm typecheck
pnpm contract:check
pnpm test
pnpm maturity:validate
```

- 触发时机：**每个 milestone（M1..M5）收口时**。
- 判据（逐条，据 §D4.5）：
  - `typecheck` / `contract:check`：**exit 0**（无豁免）。**两者已实测为 exit 0**，非未验证的断言。
  - `lint:check`：**不要求 exit 0** —— 实测 exit 1（4 errors / 131 warnings）。判据为 **error 集 ⊆ §D4 白名单 `gates.lint_check.exemptions`**（`(file, rule)` 对），且 `baselineErrorCount ≤ 4`。四项均已给出**逐字节因果证明**为本轮起点即存在，详见 `GATE-BASELINE.md §9`。`eslint .` 未加 `--max-warnings`，warning 不入门。**该门为 §D4 初版漏判的第四道红门**（`TFD-lane2-lintcheck-fourth-gate-2026-08-25`）。
  - `pnpm test`：失败集 ⊆ §D4 白名单 `gates.pnpm_test.exemptions`，且 `config-schema-parity` 不在失败集内。**白名单外任一失败 = 回归，阻塞。**
  - `maturity:validate`：A2 失配集 ⊆ §D4 §4.3 的 25 项基线；**并须单独补跑** `pnpm maturity:residual` 与 `pnpm maturity:traceability` 以消除 §D4 记录的 `&&` 链短路盲区（`TFD-maturity-chain-blindspot-2026-08-24`）。
- **`&&` 链门须逐段跑**（本轮两道门栽在此形状）：`lint:check` 与 `maturity:validate` 均为 `&&` 链，退出码只报告链上**第一个**失败，其后各段状态是**未知量而非已知绿**。`lint:check` 的盲区已实测消解（`lint:dcs` 单独跑 exit 0）；`maturity` 的两段见 §D4.3。
- **`maturity` 两条补跑命令有副作用，跑完必须复原**（本节初版未声明，是我的缺陷）：实测 `maturity:traceability` 会改写 `artifacts/system-maturity/P7-001/traceability-report.json`（+246/-108），而该文件**本身就是 §D4.3 那 25 项基线中的一项** —— 即这道门会改写它所校验的对象。后果有两层：①留着不复原就是 §R5 技术-7「不追溯修改历史 artifacts」的违反；②两车道共用工作树，该改动不属任何车道（§R4.9）。故 L2 判据补一条**强制收尾**：

  ```bash
  pnpm maturity:residual; pnpm maturity:traceability     # 逐段跑，不用 &&
  git status --porcelain -- artifacts/system-maturity     # 应为空
  git checkout -- artifacts/system-maturity/P7-001/traceability-report.json   # 若非空则复原
  ```

  **自修改的门不得以「跑过了」为凭据**：若不复原，下一次同门比对的是被上一次运行改写过的基线，25 项的「只保证不增长」就失去意义。
- 回归定义（承重条款，同 §D4.6）：**白名单之外的任何失败 = 回归，一律阻塞。** 白名单条目**只减不增**；新增须走 §R4 偏差触发 (c)。

---

### §R2.4 L3 证据门 —— 仅 M5，真人 soak

差异化能力的**真人**证据门，只在 M5 收口时触发。**这是打破 `humanRuns=0` 证据自循环的唯一出口**（TF-0102 success_metric）。

```bash
node scripts/context-compression-eval-runner.mjs --paired-summary <真实会话 JSONL 路径>
```

外加**非命令**判据：**1 名真人 × 1 个增强表面 × 14 天 × 可回滚记录**（落 `approvals/<task-id>.md`，见 TF-0140）。

- 触发时机：**仅 M5**。
- 命令判据：runner exit 0，且其 `--paired-summary` 叠加输出显示样本被真实 overlay（`[paired-summary] overlaid N/M samples`，N>0）。
- soak 判据：14 天真人记录 + 期内 B3 冻结未被破坏（`git log <soak-start>..HEAD -- assembler.ts extensions.ts prod-flags-catalog.ts` 为空）。
- 本轮 L3 只对 **TF-0140** 一个表面成立；其余表面本轮不进 L3。

---

### §R2.5 通用回滚条款（TF-0106 requirement-4，接 §R4.3）

**每个改变模型可见内容的 task**，必须在 node 中声明回滚方式，三选一：

1. **旗标关闭**（`runtime.*=false`）；
2. **配置回退**；
3. **revert commit**。

**无声明者不得进入 L1 门。** 声明「旗标关闭」为回滚方式时，验收记录的 **A4 必须同时验证该旗标存在执行器**（§R5 过程-9；防 `worktree.backend` 那类「写了没执行器」的旗标 —— 关了也没用）。

验收记录必须写明**实际验证过**的回滚路径（贴执行命令与观察结果），不是「理论上可回滚」。

#### §R2.5.1 回滚验证必须 worktree-only（本轮实测硬教训）

回滚验证**禁止使用 `git revert` / `git reset` / `git stash` / 裸 `git add`** —— 两条车道共用**一个工作树与一个 index**，这些命令都是**跨车道写**。本轮已实证其危害：`TFD-lane2-rollback-drill-index-mutation-2026-08-24` —— 一次 `git revert --no-commit` 把删除暂存进共用 index，被另一车道的 pathspec-less 提交裹走。

**唯一允许的回滚验证手法**（零 index 写入）：

```bash
git show <commit> -- <本 task 文件> | git apply -R   # 反向打补丁到工作树
<跑本 task 的 L0 门>                                   # 确认回到基线
git show <commit> -- <本 task 文件> | git apply       # 恢复
git diff HEAD -- <本 task 文件>                        # 空 = 已复原
```

**判定回滚是否复原，以 `git diff HEAD`（内容）为准，不以 `git status --porcelain`（含行尾态）为准** —— 本仓库 CRLF/LF 归一化会让 `git apply` 往返后 `status` 显示 `M` 而内容实际一致（TF-0142 实测）。

#### §R2.5.2 提交隔离（同一硬教训的另一面）

每次提交一律用 **`git commit -- <显式路径>`**，不得用裸 `git commit`（后者提交整个 index，会裹走另一车道在途 stage 的文件 —— `TFD-lane1-index-bleed-2026-08-24`）。收口三条半径命令按 §R3 执行，且 pathspec 限定到本车道文件域（仓库有 200+ 既有未提交改动，裸 `git diff --stat HEAD` 无法度量单 task 半径）。

---

### §R2.6 命令真实性对照（TF-0106 requirement-1）

下表每条命令均在本 task 收口时实跑验证存在（`fe469cbff`/`ef66a1c28`）：

| 门 | 命令 | 位置 | 实测 |
|---|---|---|---|
| L0/L1 | `pnpm lint:bom` | `package.json` `scripts.lint:bom` = `node scripts/check-no-bom.mjs` | exit 0 |
| L0/L1 | `pnpm lint:dcs` | `scripts.lint:dcs`（type-aware oxlint 固定清单） | exit 0 |
| L1 | `pnpm contract:check` | `scripts.contract:check` = `node scripts/contract-check.mjs` | exit 0 |
| L1 | `pnpm typecheck:node` | `scripts.typecheck:node` = `tsc --noEmit -p tsconfig.node.json` | exit 0 |
| L1 | `pnpm test:dcs` | `scripts.test:dcs`（DCS vitest 三组） | exit 0 |
| L1 | `tests/unit/config-schema-parity.test.ts` | 文件存在 | 116 passed |
| L1 | `tests/unit/default-config-matrix.test.ts` | 文件存在 | 18 passed |
| L2 | `pnpm lint:check` / `typecheck` / `test` / `maturity:validate` | `package.json` 均存在 | 见 §D4（红，按白名单） |
| L3 | `scripts/context-compression-eval-runner.mjs` | 文件存在，接受 `--paired-summary`（实测 4 处引用） | — |

**未落入本表的命令不得写进 §R2。** 新增门命令须先验证存在并补入本表。

## §R3 每任务改动半径收口门

来源节点：**TF-0107**。本节给出**无累积状态**的每任务收口门：每个 task 收口时由审核者（非实现者，§R1.0.1 保证）执行固定命令组，全部 `git` / `grep` / `wc` 可判，**与执行者身份和历史无关**。

### §R3.0 为什么废除原 BRB 档位

原「执行者累积档位」设计有四个洞，全部无机械判据：档位记录位置是析取式（`execution_hints` 或 ledger 文件 —— 即无唯一位置）；无任何任务负责档位裁决，降档条款是空文；「零返工」无操作定义；且存在**退化均衡** —— 风险规避型执行者的占优策略是永不升档，导致所有 M/L 任务卡在拆分上。

替代设计的三条硬约束（TF-0107 `non_goals`）：**不引入任何累积状态 / 档位账本 / 执行者评分**；**不引入无法机械判定的条款**（如「加强 code review」）；`brb-S/M/L` 语义改为 **`max_brb`（该 task 允许的最大改动半径上限）**，不再表示执行者档位 —— 不存在档位、不存在升降、不存在 ledger。

保留原设计中真正有效的一条：**§D1(a) 不通过 → 只能 `landed-unwired`**。这是状态判定而非身份惩罚，不需要任何账本。

### §R3.1 三条收口命令（审核者执行并原样贴输出）

先确定本 task 的提交集合 —— 这是三条命令共同的输入：

```bash
TASK=TF-XXXX
COMMITS=$(git log -E --format=%H \
  --grep="^(Task:|Refs|Node:) $TASK([^0-9]|\$)" 590588791..HEAD)
```

> 该匹配式的三个要件（行首锚定 / 键名必需 / id 边界且不得用 `$` 收尾）**每一个都由实测事故驱动**，见 §R3.8.2。照抄不带锚定的形式会把 S0 骨架的 8 个文件灌进 TF-0145，使其半径读作 **8/5 = 硬 FAIL**（真实值 2/5）。审核者写入 §R1 判定的提交带 `Reviews:` 而非 `Task:`，**因此天然不进本式**，不消耗被审 task 的半径（§R3.8.1）。

**空集必须先判 FAIL，不得进入命令 1-3：**

```bash
[ -n "$COMMITS" ] || echo "FAIL: no commit attributable to $TASK (§R3.8.1 规则 4)"
```

这不是形式主义。`$COMMITS` 为空时 `git show --pretty="" --name-only $COMMITS` **退化为 `git show HEAD`** —— 实测返回 **1**（当时 HEAD 的文件数），而非 0。于是：

- 三条命令**全部假性通过**（1 ≤ 任何 max_brb，命令 2/3 输出空）；
- 报出的半径值是**另一个提交（很可能是另一车道的）**的文件数，与本 task 无关。

即 trailer 打错一个字符 ⟹ 半径门静默失效，且给出一个借来的数字冒充测量结果。**空集的唯一合法解释是「本 task 没有可归属提交」，那本身就是 §R3.8.1 规则 4 的违反，故判 FAIL 而非 PASS。**

**命令 1 —— 改动半径 ≤ `max_brb`**

```bash
git show --pretty="" --name-only $COMMITS | sort -u | wc -l
```

**命令 2 —— schema 路径守卫（须为空，除非在 §R3.3 白名单内）**

```bash
git show --pretty="" --name-only $COMMITS -- \
  '*zod-schema*' 'shared/dcs/prod-flags-catalog.ts' \
  'openclaw_runtime/src/config/types.openclaw.ts' | sort -u
```

**命令 3 —— 默认值守卫（命中且不在 §R3.4 白名单 = 硬 FAIL）**

```bash
git show $COMMITS -- ':!docs' ':!*.md' \
  | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -E "\.default\(|defaultValue|DEFAULT_[A-Z_]+\s*[:=]"
```

> **本节对 TF-0107 requirements 的字面命令做了两处修正，均有实测依据，见 §R3.7。** 直接照抄字面命令会产生假阳性与错误归因。

### §R3.2 `max_brb` 阈值表

| `context_tags` | max_brb（文件数上限） |
|---|---:|
| `brb-S` | **5** |
| `brb-M` | **15** |
| `brb-L` | **40** |
| `brb-none` | **0**（无代码半径） |
| **无 brb-* 标签** | 按 **S=5** 处理（最严），并须补标签 |

`brb-none` 的语义已实测确认：本轮 5 个 `brb-none` 节点全部是**已 deprecated 的被砍 task**（TF-0123/0125/0131/0132）或**纯决策节点**（TF-0136）—— 即「本无代码改动面」，不是「无上限」。**`brb-none` 的 task 若产生任何代码改动即硬 FAIL。**

### §R3.3 schema 白名单（命令 2 的唯一豁免）

只有下列 task 允许命令 2 非空。白名单由 §R4.5 的冲突域登记**派生**，不独立维护：

| task | 允许触碰 | 依据域 |
|---|---|---|
| **TF-0109**（已 `done`） | `types.openclaw.ts`、`runtime-feature-leaves.ts` | D07 / D14 |
| **TF-0112**（T-P0-4） | `zod-schema.ts`、`types.openclaw.ts`、`prod-flags-catalog.ts`、`runtime-feature-leaves.ts` | D02 / D07 / D14 |
| **TF-0137**（D2） | `prod-flags-catalog.ts` | D02 |
| **TF-0140**（T-E2） | `prod-flags-catalog.ts` | D02 |

**白名单外任一 task 的命令 2 非空 = 硬 FAIL。** TF-0107（本节点）虽在 D02/D07/D14 登记内，但实际为纯文档 task，命令 2 实测为空 —— **登记允许不等于必须触碰**。

> **待补登记（`zod-schema.ts` 未登记为冲突域）**：命令 2 守卫 `*zod-schema*`，但 §R4.5 的 D01-D14 表**无任何域覆盖 `openclaw_runtime/src/config/zod-schema.ts`**，而 TF-0112 的标题（「factViews 从 schema/type 下架」）明确要求改它。该文件仅由车道 2 的 task 触碰（车道 1 七个独占域不含它），故**无跨车道风险**，但按 §R4.5「新发现的域必须追加」应登记。已记 `TFD-lane2-r3-command-corrections-2026-08-24`；因 §R4 属车道 1 owner 节，**本车道不得跨节编辑**，故由车道 1 在 §R4.5 补 D15 行。

### §R3.4 默认值白名单（**恰好一项**）

本轮默认值白名单**恰好一项**，不是「≤ 一项」—— TF-0146 的成功指标是「本轮默认值改动次数 **= 1**」：

| # | task | 旗标 | 人工 approve 记录（必须存在） |
|---:|---|---|---|
| 1 | **TF-0140**（T-E2） | `runtime.contextBlock.tool-registry.enabled` | `docs/dev/context-moat/approvals/TF-0140.md` |

**这是全表。白名单以外任何默认值改动一律硬 FAIL**（§R5 技术-4）。

旗标真实性已核实：`shared/dcs/prod-flags-catalog.ts:76` 的 `key: 'runtime.contextBlock.tool-registry.enabled'`，`runtime-feature-leaves.ts:52` 的 `"tool-registry": { enabled: ... }`。

#### §R3.4.1 `approvals/<task-id>.md` 约定（AC-3）

- **固定路径**：`docs/dev/context-moat/approvals/<task-id>.md`，`grep` 可查。目录已由 S0 建立（当前仅 `.gitkeep`）。
- **必须先有 approve 记录，才允许改默认值**。顺序不可倒置：先改后补批准 = 硬 FAIL。
- 审核者的机械判据：

  ```bash
  test -f docs/dev/context-moat/approvals/TF-0140.md && echo APPROVED || echo BLOCKED
  ```

- 记录须含：批准人（真人标识）、批准 UTC 时间戳、被批准的**具体旗标全名**、声明的回滚方式（§R2.5）、soak 起点 commit。
- **TF-0140 另需**：翻正提交落地后立即在同一文件写下 soak 起点 commit 与 UTC 时间戳，并通知另一车道进入 **B3 冻结**（§R4 同步点）。

### §R3.5 超半径处置：拆分或降级，不得放行

超出 `max_brb` 的 task **不得收口**。两条合法出口，无第三条：

1. **拆分**为两个各自在半径内的 task。拆分件**必须共享一份设计说明**，固定路径 `docs/dev/context-moat/designs/<task-id>.md`（`<task-id>` 取拆分后**第一个** task 的 id，其余拆分件在自己的 `reviews/` 记录中引用同一路径）。设计说明须写明：为何原 task 超半径、拆分边界、拆分件之间的接口契约、以及**拆分后两件的 max_brb 之和不得超过原 task 的 max_brb**（否则拆分即成为绕过半径的手段）。
2. **降级 `landed-unwired`**（§D1 / §R5 过程-10）。

### §R3.6 里程碑级累积半径（补住「拆分不减少总改动量」）

单任务门拦不住累积大改动：把一个大 task 拆成三个小 task，每个都过 S 门，总量却是 3×S。故里程碑收口时另跑：

```bash
git diff --name-only <milestone-start>..HEAD | sort -u | wc -l
```

> **累积门刻意不用 §R3.8.2 的 trailer 匹配式，用区间 diff。** 两者职能不同：per-task 半径必须精确归属（故必须锚定），而累积量要的是**总改动面**，任何提交的文件都真实存在、都该计入。实测于 `cce818682`，三种测法在 M0 上分别给出 **18（区间 diff，基准真值）/ 13（锚定 trailer 匹配）/ 18（不锚定匹配）**：锚定式漏掉 S0 骨架提交的 5 个文件（它无行首 trailer），而不锚定式凑对纯属巧合 —— 它靠一处**行中散文**误配把骨架捞了回来。**用区间 diff 则对 trailer 质量完全免疫。**
>
> M0 仍在累积提交，故上列绝对值随 HEAD 变化（例如 `5268f0e06` 处为 19 / 14 / 19）。**不变量才是判据：区间 diff 与锚定匹配之差恒为 5，即 S0 骨架那 5 个无 trailer 文件**（`approvals/` `corpus/` `designs/` `reviews/` 四个 `.gitkeep` + `loss-trace-spike.md`）。复核时请验这个差值，不要照抄绝对值。

配套断言（§R3.8.1 规则 4，无归属提交本身即违反）：

```bash
for c in $(git log --format=%H <milestone-start>..HEAD); do
  git log -1 --format=%B "$c" | grep -qE '^(Task:|Reviews:|Refs|Node:) TF-[0-9]' \
    || echo "UNATTRIBUTED: $(git log -1 --format='%h %s' "$c")"
done
```

M0 实测输出**恰好两行**（`f005991b7` / `fe469cbff`），均为 §R3.8.4 已登记的既有实例。`Refs` / `Node:` 只为回溯 M0 而接受；M1 起这两键不再合法（§R3.8.2），届时该断言须为空。

与下表预算比较。预算 = 该里程碑**活跃子节点 `max_brb` 之和**，**冻结于 B1**（M0 收口时刻）—— 冻结是关键：否则后续拆分会同步抬高预算，累积门自我失效。

| 里程碑 | 活跃子节点 | max_brb 构成 | **累积预算（文件数）** |
|---|---:|---|---:|
| M0 `TF-0103` | 8 | S×8 | **40** |
| M1 `TF-0108` | 6 | S×6 | **30** |
| M2 `TF-0115` | 4 | M×2 + S×2 | **40** |
| M3 `TF-0120` | 4 | M×3 + S×1 | **50** |
| M4 `TF-0127` | 3 | M×1 + S×2 | **25** |
| M5 `TF-0133` | 2 | L×1 + S×1 | **45** |
| **M0..M5 合计** | **27** | — | **230** |

（已排除 4 个 deprecated 被砍 task；M6/TF-0144 不占本轮预算。）

### §R3.7 对 requirements 字面命令的两处修正（实测依据）

TF-0107 的 `requirements` 给出的字面命令有两处在本仓库会**产生错误判定**。照抄会让门失效或误伤，故修正并留证：

#### 修正 1 —— 半径不能用 `<task-start-ref>..HEAD` 区间，必须用「本 task 自己的提交集」

字面命令 `git diff --name-only <task-start-ref>..HEAD | wc -l` 在**双车道交错提交**下会把另一车道的文件算进本 task 半径。实测（TF-0109）：

```
本 task 自己的提交 (eb532b5c7 f0a82ce04) 并集 = 3 个文件
  docs/dev/context-moat/reviews/TF-0109.md
  openclaw_runtime/src/config/runtime-feature-leaves.ts
  openclaw_runtime/src/config/types.openclaw.ts

字面区间 eb532b5c7^..f0a82ce04 = 5 个文件（多算 2）
  + docs/dev/context-moat/DEV-PROTOCOL.md      ← 车道 1 的 4a4c91634
  + docs/dev/context-moat/reviews/TF-0105.md   ← 车道 1 的 4a4c91634
```

TF-0109 的 `max_brb` = S = 5。**字面命令给出 5/5，恰好卡在上限** —— 车道 1 再提交一次，一个完全合规的 task 就会因**别人的改动**硬 FAIL。故改用 `git show --name-only <本 task 提交> | sort -u | wc -l`。

#### 修正 2 —— 默认值 grep 必须排除文档，否则每个合规 task 都会被误杀

字面命令对整个 diff 做 grep。实测在 TF-0109 上**命中**：

```
HIT: +| ① 旗标默认值是否为关 | ... `defaultValue:false` ... | **命中反证**：默认关 |
```

该命中来自 `reviews/TF-0109.md` 的**散文**，TF-0109 未改任何默认值。更严重的是这是**系统性**假阳性：§R1 的 A2 表**要求**每份审核记录记录「① 旗标默认值是否为关」，故**每个合规填表的 task 都会踩中硬 FAIL**。加 `-- ':!docs' ':!*.md'` 后：

- 真阴性：TF-0109 / TF-0142 / TF-0106 三个 task 均**无命中**（实测）。
- 真阳性：对合成 diff 实测**仍能捕获**两种真实形态 —— `z.boolean().default(false→true)` 与 `DEFAULT_FLAGS = { toolRegistry: false→true }`。

> 真阳性验证不可省：一个只验证「当前不报警」的守卫，与一个永不报警的空守卫无法区分。

### §R3.8 提交归属约定（三条命令的前置）

三条命令都要求「本 task 的提交集」可被机械识别。实测本轮两条车道**约定不一致**，且有提交完全无归属：

| 提交 | 现有归属写法 |
|---|---|
| 车道 1（`f005991b7` / `4a4c91634` / `6de7499e5` / `40ffb3814` / `3450a87bc`） | `Node: TF-XXXX` |
| 车道 2（`eb532b5c7` / `f0a82ce04` / `0f3f95430` / `ef66a1c28` / `f04a5352a` / `be6cdbdd8`） | `Refs TF-XXXX` |
| `fe469cbff`（车道 1 对 TF-0109 的审核） | **无任何归属** |

且两条车道的 `git` author **完全相同** —— 实测 19/19 个 round 提交的 `%an` / `%ae` / `%cn` 均为同一值（`OpenClaw UFTK Pilot <uftk-pilot@openclaw.invalid>`），**author 无法区分车道**。故本节确立三个正交 trailer 键。

#### §R3.8.1 三个正交 trailer 键

| 键 | 取值 | 用途 | 是否计入半径 |
|---|---|---|---|
| `Task:` | **恰好一个** `TF-XXXX` | 半径归属（命令 1/2/3 的输入） | **计入** |
| `Reviews:` | 一个或多个 `TF-XXXX` | 非实现者写入 §R1 审核判定 | **不计入被审 task 的半径** |
| `Lane:` | `lane-1` \| `lane-2` | 节 owner 审计（TF-0145 AC-6） | 不适用 |

四条硬规则：

1. **`Lane:` 在每个提交上必填。** 它是唯一能把提交归到车道的机械手段（author 不能，见上）。**无 `Lane:` 的提交 = §R3 违反。**
2. **`Task:` 与 `Reviews:` 互斥。** 一个提交要么是某个 task 的交付物，要么是对若干 task 的审核记录。
3. **`Reviews:` 提交的触碰面只允许 `docs/dev/context-moat/reviews/*.md`。** 这是防绕过条款：否则「标成 `Reviews:`」就成了让代码改动逃出半径门的通道。其他路径必须另起 `Task:` 提交。
4. **无归属提交 = §R3 违反**，其改动无法归入任何 task 的半径，因而既不可验收也不可回滚归因。

> **`Reviews:` 只能按角色判定，不能按文件路径判定。** 实测本轮 8 个「只碰 `reviews/`」的提交里，**4 个是实现者自检证据包**（`f0a82ce04` / `ef66a1c28` / `be6cdbdd8` / `cd3e6134d`）、3 个是审核者判定、1 个是修复提交。实现者把自检材料写进 `reviews/<own-task>.md` 属其交付物，**计入自己的半径**；审核者追加判定属 `Reviews:`，**不计入被审 task 的半径** —— 审核者的笔不该消耗实现者的改动预算。

#### §R3.8.2 归属匹配式（§R3.1 与 §R3.6 共用）

```bash
TASK=TF-XXXX   # 必须先赋值：$TASK 为空时本式退化为匹配任意 trailer 行，静默返回全部 18 个提交
git log -E --format=%H --grep="^(Task:|Refs|Node:) $TASK([^0-9]|\$)" 590588791..HEAD
```

三个要件都由实测事故驱动，缺一即错：

| 要件 | 缺了会怎样（实测） |
|---|---|
| **`^` 行首锚定** | `f005991b7` 正文含「Zero src changes. Node: TF-0145 (S0 sub-step).」为**行中散文**。不锚定则 S0 骨架的 8 个文件全灌入 TF-0145，半径读作 **8/5 = 硬 FAIL**，真实值 **2/5** |
| **键名必需** | `0f3f95430` 的 trailer 为 `Refs TF-0142 (D4). Depended on by TF-0106 (R2).` —— 只匹配 id 会把 TF-0142 的提交算进 TF-0106 的半径；`f04a5352a` 反向同理 |
| **`([^0-9]\|$)` id 边界，且不得用 `$` 收尾** | 边界防 `TF-0107` 误配 `TF-01070`；而**全锚定 `$` 会漏掉** M0 的带后缀形式（`Refs TF-0142 (D4)`），实测使 TF-0142 半径从 5 假降到 4 |

即：**不锚定 → 假阳性（合规 task 被判硬 FAIL）；全锚定 → 假阴性（合规提交漏计）。两者都已实测发生。** M1 起 `Refs` / `Node:` 不再合法，但匹配式保留三键以便回溯 M0（`fe469cbff` 的缺归属为已知既有实例，不追溯改写，§R5 技术-7）。

#### §R3.8.3 AC-6 的两级判据

TF-0145 AC-6 要求「每节只被其 owner 车道的提交改过」。节 owner：**车道 1 = §D1 / §R1 / §R4 / §R5；车道 2 = §R2 / §R3 / §D4**。

**判据 A（必要条件；无需 trailer，可回溯 M0）** —— 单个提交改到的节必须同属一个 owner：

```bash
F=docs/dev/context-moat/DEV-PROTOCOL.md
sect() { awk -v s="$1" 'index($0,"## "s)==1 {f=1;next} /^## §/{f=0} f'; }
owner() { case "$1" in §D1|§R1|§R4|§R5) echo lane-1;; §R2|§R3|§D4) echo lane-2;; esac; }
for c in $(git log --format=%H 590588791..HEAD -- "$F"); do
  own=""
  for s in §D1 §R1 §R2 §R3 §R4 §R5 §D4; do
    [ "$(git show "$c^:$F" 2>/dev/null | sect "$s" | md5sum)" \
   != "$(git show "$c:$F" | sect "$s" | md5sum)" ] && own="$own$(owner "$s")\n"
  done
  [ "$(printf "$own" | sort -u | grep -c .)" -gt 1 ] \
    && echo "CROSS-LANE: $(git log -1 --format=%h "$c")"
done
```

实测输出**恰好一行** `f005991b7` —— S0 骨架提交，按 §R4.7 被**明确指派**给车道 1 创建全部七节占位，是协议内的唯一例外。**其余每一个改动本文件的提交都 owner-同质**（提交数随 M0 累积而增长，故此处不写固定基数；判据是「输出集恰为 `{f005991b7}`」）。该判据的真阳性（会对跨 owner 提交开火）与零假阳性均已实测。

**判据 B（充分条件；需 `Lane:`，M1 起生效）** —— 提交声明的车道必须等于其所改节的 owner。在判据 A 的循环内，把 `own` 的唯一值与提交的 `Lane:` 比对：

```bash
F=docs/dev/context-moat/DEV-PROTOCOL.md
sect() { awk -v s="$1" 'index($0,"## "s)==1 {f=1;next} /^## §/{f=0} f'; }
owner() { case "$1" in §D1|§R1|§R4|§R5) echo lane-1;; §R2|§R3|§D4) echo lane-2;; esac; }
for c in $(git log --format=%H <milestone-start>..HEAD -- "$F"); do
  own=""
  for s in §D1 §R1 §R2 §R3 §R4 §R5 §D4; do
    [ "$(git show "$c^:$F" 2>/dev/null | sect "$s" | md5sum)" \
   != "$(git show "$c:$F" | sect "$s" | md5sum)" ] && own="$own$(owner "$s")\n"
  done
  sects=$(printf "$own" | sort -u | tr '\n' ',')
  lane=$(git log -1 --format=%B "$c" | sed -n 's/^Lane: \(lane-[12]\)$/\1/p' | head -1)
  [ -z "$lane" ] && { echo "NO-LANE: $(git log -1 --format=%h "$c") sections=$sects"; continue; }
  [ "$lane," = "$sects" ] || echo "OWNER-VIOLATION: $(git log -1 --format=%h "$c") Lane=$lane sections=$sects"
done
```

M0 已落地的提交**全部输出 `NO-LANE:`** —— 即判据 B 对 M0 完全失效，这正是缺陷 1 的形态。唯一例外是本节的修正提交 `cce818682` 本身（首个带 `Lane: lane-2` 的提交，实测通过判据 B）。M1 起该断言须无 `NO-LANE` 且无 `OWNER-VIOLATION`。

**为什么两级都要**：判据 A 挡不住「车道 1 单独改 §R2」（同质但越权），故需 B；判据 B 对 M0 全部失效（无 `Lane:`），故需 A 回溯。**M0 区间的 AC-6 只能达到判据 A 的强度 —— 如实记录，不声称已完全机械验证。**

#### §R3.8.4 M0 既有实例（不追溯改写，§R5 技术-7）

| 提交 | 与本节规则的偏离 | 处置 |
|---|---|---|
| `f005991b7` | 无 trailer；跨 owner 改全部七节 | S0 骨架，§R4.7 明确指派，**协议内例外** |
| `fe469cbff` | 无 trailer | 已知既有实例 |
| `1d4644fcc` | 三个 `Task:`，且混入一处 §R4 编辑 | 按本节应拆为 `Reviews: TF-0142 TF-0106 TF-0107` ＋ `Task: TF-0145` 两个提交 |
| `6d82ff372` | 两个 `Task:`（TF-0104 / TF-0146） | 同一文件的两节服务两个 task，pathspec 不可拆 —— 见下 |

**同一文件的两节确实服务两个 task 时**（如 `6d82ff372` 同修 §D1 与 §R1），允许多个 `Task:`，但该文件**计入每个被列 task 的半径**（保守方向，只高估不漏计）。除此之外多 `Task:` 一律违反规则 1。

#### §R3.8.5 §R3 自身的五处缺陷修正（来自 TF-0145 审核与 TF-0107 审核）

§R3 由我（车道 2）在 TF-0107 落地。下列五处缺陷由我在审核 TF-0145 时发现、在修正过程中连带发现，或由车道 1 在审核 TF-0107 时记为 backlog-P1，**均为我自己的缺陷**，此处修正并留证：

| # | 位置 | 缺陷 | 后果（实测） |
|---:|---|---|---|
| 1 | §R3.8 | 只有 `Task:` 一个键，无车道键 | 初版把两车道从 `Node:` / `Refs` **统一到 `Task:`**，而这两种写法原本恰好是车道的事实判别器。统一后 author 又相同 ⟹ **TF-0145 AC-6 后半变为不可机械验证**。我为让半径可归属，摧毁了车道可归属 |
| 2 | §R3.8 | 「一提交只能带一个 trailer」对审核提交过严 | 审核提交天然覆盖多 task。实测 `1d4644fcc` 带三个 `Task:`，使 TF-0106 / TF-0107 / TF-0142 各被灌入 2 个他人文件；TF-0106 与 TF-0142 半径因此读作 **5/5**，再有一次审核提交即误判硬 FAIL |
| 3 | §R3.1 / §R3.8 | 匹配式未锚定 | **TF-0145 半径读作 8/5 = 硬 FAIL，真实值 2/5** —— 我的门把一个完全合规的 task 判死。这是四处中最重的：它静默错测每个 task 的半径，而半径正是本节的唯一职能 |
| 4 | §R3.6 | 累积门误用 trailer 匹配式 | 原式 `--grep="Task: TF-"` 只匹配 19 个提交中的 8 个，累积量读作 7（真值 18）；而改用锚定式仍漏 5 个文件。**里程碑门本可漏掉过半改动量。** 修法是改用区间 diff（对 trailer 质量免疫），见 §R3.6 |
| 5 | §R3.1 | 空提交集假性通过（审核 TF-0107 时由车道 1 记为 backlog-P1，要求 M1 首个 task 前补） | 实测比原判更重：`$COMMITS` 为空时 `git show` **退化为 `git show HEAD`**，命令 1 返回 **1** 而非 0 —— 三条命令全部假性通过，且报出的半径是**另一个提交**的文件数。trailer 打错一字符即静默失效。修法见 §R3.1 的空集断言 |

第 3、4 处形态互为镜像，一并说明：**per-task 半径要精确归属，故必须锚定；累积量要总改动面，故必须不依赖归属。** 用同一把尺量两件事正是缺陷来源。第 5 处与第 3 处同源 —— 锚定收紧了匹配，也就抬高了「打错 trailer ⟹ 空集」的可达性，故两者必须同时修。

五处的共同形态与 §R3.7 修正 1 相同 —— **归属边界不精确时，门伤害的是合规者，或者干脆什么都不测**。故与 §R3.7 采用同一处置：给出实测反例、修正命令、并保留真阳性验证。

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
| D11 | `src/context-engine/turn-injection-budget.ts` | TF-0117 / 0128（车道 1）/ **TF-0118（车道 2，仅删除 test-only 导出 `reserveTurnInjectionCapacity`）** | **跨车道** |
| D12 | `docs/dev/context-moat/DEV-PROTOCOL.md` | TF-0103 全部子节点 | 双（按节分工） |
| **D13** | `src/runtime-core/memory-hybrid-retrieval.ts` | TF-0114（车道 2）/ TF-0122（车道 1） | **跨车道** |
| D14 | `src/config/runtime-feature-leaves.ts` | TF-0109 / TF-0107 / TF-0112 | 2 |
| D15 | `src/config/zod-schema.ts` | TF-0112（唯一写者）；TF-0105 / TF-0107 / TF-0109 仅只读引用 | 2 |
| D16 | `src/agents/agent-hooks/compaction-damage-rules.ts` | TF-0128 / TF-0124 | 1 |
| D17 | `src/context-engine/context-health-monitor.ts` | TF-0128 / TF-0129 | 1 |
| D18 | `src/agents/agent-hooks/compaction-sections.ts`（TF-0128 新建，章节常量单一真相源） | TF-0128 / TF-0124 | 1 |
| D19 | `src/agents/agent-hooks/compaction-safeguard-quality.ts` | TF-0128 / TF-0124 | 1 |

**D13 是本轮唯一一组跨车道的真写冲突域。** TF-0114 修 `tokenizeWords` / `extractEntities` 的 CJK 空返回；TF-0122 裁决整条 hybrid 检索链去留，而「迁出」选项会移动整个文件。故 `TF-0122 depends_on TF-0114` 已由 non-blocking **升为 blocking**：必须先修完再裁决去留，反序会让 TF-0114 的修复被 TF-0122 的迁出连带作废。排班上两者相距 1050min，正常不会真撞上，但边必须是 blocking 以防 pick-next 抢跑。

**D09 的触碰面扩大（TF-0128）**：D09 原列 TF-0111 / TF-0124。TF-0128 的 requirement-5「先以 shadow 模式上线」要求把损伤审计接进生产路径，而唯一**无条件**经过的落点是 `compaction-safeguard.ts` 的 `capCompactionSummaryPreservingSuffix` 收尾处 —— 紧邻的 `auditSummaryQuality` 调用点被 `qualityGuardEnabled` 门控，接在那里会让审计在质量守卫关闭时静默失效（§D1(b) 反向证伪的 ③ 上游守卫情形）。故 TF-0128 追加为 D09 触碰者，并新登记 D16-D19 四个此前未登记的车道 1 文件。四者触碰者全部在车道 1，属车道内串行，无跨车道风险。偏差记录：`TFD-d16-d19-damage-detection-domains-2026-08-25`。

**D11 升为第二组跨车道域（2026-08-25 发现）**：D11 原登记为车道 1 独占（TF-0117 / TF-0128）。车道 2 的 **TF-0118**（T-D3 死导出清理）其 `summary` 点名要删 `reserveTurnInjectionCapacity`（`turn-injection-budget.ts:312`，实测 test-only），落在 D11 内，而 TF-0118 **不是**该域的登记触碰者。发现时机：车道 1 执行 §R4.10 第 1 步的开工前交集自检，检出 `TF-0117 ∩ TF-0118 = {turn-injection-budget.ts} ≠ ∅`，故**未开工 TF-0117**，改按 §R4.4 pick-next 取 TF-0116。**该文件当时尚未被修改，冲突在发生前被拦住** —— 这正是 R4.10 第 1 步存在的理由。

**serialization 要求**：两者都要改同一文件，须串行。建议 **TF-0117 先**（只改一处注释措辞，brb-S，且 `turn-injection-budget.ts:420` 的契约措辞正是 TF-0117 的三处判例之一），**TF-0118 后**（删除该导出）。反序会让 TF-0117 的行号依据失效。此顺序未写进图，故裁决权交回用户（§13）。偏差记录：`TFD-d11-cross-lane-tf0118-2026-08-25`。

**三处已排除的 mention-only 假阳性，勿再重复认定**：`attempt.ts` 与 `init.ts` 仅被 TF-0104 作为「生产入口 / 注册入口」判例引用（零写入）；`context-compression-eval-runner.mjs` 仅被 TF-0106 作为 §R2 门命令清单引用（只读）。若车道 1 的 TF-0143 / TF-0138 需要真改这个 runner，属触碰面扩大，按 R4.2 记偏差。

**D14 的登记缘由**：`runtime-feature-leaves.ts` 由 TF-0109 的 `requirements` 第 1 条直接指定改动，但初版 D01-D13 表未收录它。实现者（车道 2）在自检时主动指出该缺口并建议延后登记；审核者（车道 1）按本节「新发现的域必须追加」即时补登为 D14，理由是本表的作用是**登记完整性**而非仅风险控制 —— 延后会留下一个「pick-next 看不见该域」的窗口。三个触碰者同在车道 2，属车道内串行，无跨车道风险。偏差记录：`TFD-d14-runtime-feature-leaves-2026-08-24`。

**D15 的登记缘由**：`zod-schema.ts` 被 §R3.1 的命令 2 列为受守卫路径，但 D01-D14 无任何域覆盖它，而 TF-0112 的标题（「factViews 从 schema/type 下架」）明确要求改它。缺口由车道 2 在 §R3.3 指出，并因 §R4 属车道 1 owner 节而**正确地未跨节编辑**、改为提请车道 1 补登；审核者（车道 1）已核实该文件在 D01-D14 表中命中数为 0，且图上唯一写者为 TF-0112（TF-0105 / TF-0107 / TF-0109 均为只读引用），故补登为 D15，车道 2 独占。偏差记录：`TFD-d15-zod-schema-2026-08-24`。

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

> **回滚验证禁用写 index 的手段**：验证回滚路径（§R5 过程-9 要求每个 task 都做）必须只动工作树 —— `git apply -R` 反向打补丁 → 跑该 task 的 L0 门 → `git apply` 恢复。**禁用 `git revert --no-commit` / `git reset` / `git stash`**：它们把改动写进两条车道共用的 index，另一车道下一次提交就会把它裹走。本轮两条车道各自独立撞到过这个坑的一侧（`TFD-lane2-rollback-drill-index-mutation-2026-08-24` 与 `TFD-lane1-index-bleed-2026-08-24` 是同一事件的两侧记录）。

**提交归属 trailer（§R3.8 的机械形式，自 M1 起强制）**：每个提交必须且只能带一个 `Task: TF-XXXX` trailer。这正是本节「不允许两个 task 的改动混在一次提交里」的可机械判定形式 —— 无归属的提交无法归入任何 task 的半径，因而既不可验收也不可回滚归因。M0 已落地的提交沿用 `Node:` / `Refs`，审核者对 M0 task 用 §R3.8 的三选一 grep 匹配；`fe469cbff`（车道 1 对 TF-0109 的审核）缺归属为已知既有实例，按 §R5 技术-7 不追溯改写。

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

来源节点：TF-0146。此前这十条边界只写在审核派发文档里，不是任务图的一部分 —— 意味着执行者不受它约束、审核者无处引用。本节把它们落进 DEV-PROTOCOL.md，使「不做什么」和「做什么」一样可引用、可审核。

**引用约定**：§R1 的 A2（反向证伪）项必须引用本节的边界编号，使越界成为**可指认的具体条款违反**而非笼统的「超范围」。M1 起每个 task 的审核记录都要有一行「本 task 触碰的文件是否全部落在范围-1 内」的判定（§R1.2 模板已含此格）。

本节据双 agent 独立审核修订了三条原本漏水的边界（边界 1 的 UI 附属面、边界 2 的 P0 判定权、边界 4 的默认值例外自相矛盾），修订处标【已修订】。

### 范围（三条）

**范围-1** —— 只碰 `openclaw_runtime/src` 下 context-engine / memory / agents（上下文·压缩·工具声明相关部分）与配置面。**不碰** channels / browser / media / ACP / VerseShell / release·signing / UI 重构 / gateway 协议。

> 【已修订】原提案含 T-C4（会触碰 host-api + i18n 四语 + renderer），已砍，本轮不存在 UI 附属面。T-C1（TF-0128）的输出面限定为 artifact JSON，**不做 renderer**。

**范围-2** —— 不追求零缺陷。本轮只修已列的 6 项 P0 + 已列技术债。

> 【已修订，补判定权】新发现问题由**审核者**在审核记录中强制三分类 `{阻塞本任务 / backlog-P1 / 升级-P0-需人工批准}`。出现「升级-P0」而无对应人工批准记录 = 审核记录 lint **FAIL**。
>
> **判定权是分离的**：实施者**无权**自行判定某问题「不是 P0」，审核者**无权**自行判定「是 P0」。前者防止实施者把该升级的问题降级藏进 backlog；后者防止审核者把普通问题夸大为 P0 阻塞流程。真正的 P0 升级须走 `approvals/<task-id>.md` 人工批准。

**范围-3** —— 不做 UI 产品化。本轮**无任何 renderer 组件新增**（T-C4 已砍后此条自动成立，保留为回归约束）。

### 技术（四条）

**技术-4** —— **不改任何旗标默认值。**

> 【已修订，例外收敛为真唯一】唯一例外是 T-E2（TF-0140）的 `runtime.contextBlock.tool-registry.enabled`，且必须有 `docs/dev/context-moat/approvals/<task-id>.md` 人工 approve。原提案的 T-C4「receipt 转默认」构成第二个例外，已砍，本条恢复为**真唯一例外**。
>
> **对车道 1：一次默认值都不能改。** 唯一例外属车道 2 的 TF-0140。声明「旗标关闭」为回滚方式时，A1 审核必须同时验证该旗标**存在执行器** —— `coding-runtime-flags.ts:152-164` 的 `worktree.backend` 就是「写了叶子没执行器」的现成判例（§R4.3 已精确化：其解析器仅被 `runtime-flag-ack.ts:272` 上报路径调用，真正建 worktree 的 `worktree-service.ts` 不读该叶子）。

**技术-5** —— 不新建存储系统（复用现有 SQLite）、不引入向量库、不引入分词库依赖（CJK 用 bigram/trigram 兜底）、不引入新测试框架、不新建 CI 流水线。

> 【补充】本轮**无 schema 迁移**（T-C2 已移入 M6）。若第二轮触碰 `src/state/*`，迁移限定 additive-only 并过 `sqlite-schema-shape` 守卫。

**技术-6** —— 不刷 benchmark、不做 RL 训练、不把 LLM 反思循环作为主机制、不自研检索算法、不实现 `nativeMemory` 原生记忆能力协商。

**技术-7** —— 不追溯修改历史 artifacts。

> 【已修订】禁止改写历史 `completionClass` 与内容；**允许追加式标注**（T-D4(3) 的「标为 synthetic」按追加处理）。

### 过程（三条）

**过程-8** —— 每个 task 的改动半径受 `max_brb` 约束，收口时按 §R3 三条命令验证。

> 【已修订】增加里程碑级累积半径，补住「拆分不减少总改动量」—— 把一个大 task 拆成三个小 task 不应绕过半径约束，里程碑级累积半径对拆分件求和后仍受约束。

**过程-9** —— 每个改变模型可见内容的 task 必须声明回滚方式，并在验收记录中写明**验证过**的回滚路径。

> 【补充】声明「旗标关闭」为回滚方式时，A1 审核必须同时验证该旗标存在执行器（避免复现 `worktree.backend` 那类「写了没执行器」的旗标）。见 §R4.3 回滚流程。

**过程-10** —— `landed-unwired` 是合法出口。接不上线就诚实降级，**不允许标 done**。§D1(a) 的递归上溯规则 + 审核者复跑脚本是其防伪线。

### 边界与本轮成功判据的对应

| 成功判据（TF-0146 success_metrics） | 对应边界 |
|---|---|
| 越界事件数 = 0（触碰范围-1 以外的文件而未记 deviation） | 范围-1 |
| 「升级-P0 无人工批准」事件数 = 0 | 范围-2 |
| 本轮默认值改动次数 = 1（恰好 T-E2） | 技术-4 |

**本节不重新论证边界的合理性**（那是规划阶段的事），也不为第二轮预设边界。


## §D4 既有红门归属与 L1/L2 收紧定义

来源节点：**TF-0142**。完整失败清单、25 项哈希基线、机器可读白名单落 **`docs/dev/context-moat/GATE-BASELINE.md`**；本节只固化**规则**，数据以 GATE-BASELINE.md 为准。基线观测于 `fe469cbff`（2026-08-24T15:53:26Z）。

### §D4.1 问题

§R2 若把 L1/L2 定义为「固定 exit-code 组全绿」，在当前工作树上**永不可达**：**四个**门为红 —— `config-schema-parity`（1 failed，根因 = `runtime.memory.candidateGeneration`）、`pnpm test`（22 failed / 6991 passed + 4 套件加载失败）、`maturity:validate`（25 项 A2 证据哈希失配）、`lint:check`（4 eslint errors，**本节初版漏判，补裁于 GATE-BASELINE.md §9**）。不先裁定归属，G-MOAT 验收判据「L1 门整体 exit 0」被既有红门污染。

### §D4.2 三分类与唯一硬判据

沿用 §R5 范围-2 三分法：**must-fix**（根因在范围-1 内且本轮认领 → 必须 exit 0）/ **exempt-noise**（环境或既有未提交改动 → 入白名单、不阻塞）/ **backlog-debt**（其他 global_task 的未完成交付物 → 入白名单、不阻塞、记 owner）。

「是否本轮引起」的**唯一机械判据**（不靠判断力）：

```bash
git diff --name-only 590588791..HEAD   # 本轮全部改动
# 与「失败项主体文件集」取交集，为空 ⟹ 非本轮引起
```

实测（`fe469cbff`）：本轮 15 个改动文件 ∩ `pnpm test` 的 17 个失败文件 = ∅；∩ `maturity` 的 25 个失配文件 = ∅。**本轮至今零门失败引入。**

### §D4.3 三门裁定

| 门 | 分类 | 归属 | L1/L2 效力 |
|---|---|---|---|
| `config-schema-parity` | **must-fix** | TF-0109（`done`，已过 §R1 审核） | 必须 exit 0；**豁免 0 条** |
| `pnpm test` | must-fix 0 / exempt-noise 12 文件 / backlog-debt 5 文件 | TF-0028 / 0029 / 0010 / 0021 / 0007 / 0018 / 平台 | **移出 L1**，入 L2 按白名单差分 |
| `maturity:validate` | backlog-debt（全 25 项 committed 漂移） | system-maturity backlog | **不入 L1**；L2 要求失配集 ⊆ 25 项基线 |
| `lint:check`（**补裁，第四门**） | backlog-debt 3 / exempt-noise 1（4 errors） | 无归属节点（3 项 committed 既有债，早于本轮）/ 未跟踪既有产物 1 项 | **不入 L1**；L2 要求 error 集 ⊆ 白名单且 ≤ 4 |

`maturity:validate` 有**已知盲区**：6 脚本 `&&` 链在第 4 个（`validate-system-maturity-evidence`）中断，第 5/6 脚本从未执行、状态未知（非已知绿）。L2 判定须单独补跑 `maturity:residual` 与 `maturity:traceability` 消除盲区。

### §D4.4 收紧后的 L1（每 task 收口）—— 必修全绿，不含 `pnpm test` / `maturity`

> **命令清单以 §R2.2 为准**（单一真相源）。本节只给出「为什么这样收紧」的裁定依据，不复制命令清单 —— 两处各写一份必然漂移。

L1 的判据是**必修项全绿**，而非「所有测试全绿」。

`pnpm test` **不入 L1** 的裁定依据：其 22 项失败**零本轮引起**（§D4.2 交集为空），且与 `test:dcs` 的文件集**零重叠**（实测）。放进 L1 等于让每个 task 收口卡在别的 global_task 的未完成交付物上，正是「永不可能变绿的理想门」。`maturity:validate` 同理（25 项全为 committed 漂移）。二者移入 L2 按白名单差分。

L1 基线（AC-3）观测于 TF-0109 修绿后，全部 exit 0；完整输出见 §R2.2 与 `GATE-BASELINE.md §5.1`。

### §D4.5 收紧后的 L2（里程碑收口）—— 白名单差分

> **命令清单以 §R2.3 为准。** 本节只定分类语义。

`typecheck` / `contract:check` 要求 **exit 0**（无豁免，两者已实测为 0）；`lint:check` / `pnpm test` / `maturity:validate` 要求**失败集 ⊆ GATE-BASELINE.md §6 白名单**，且 `config-schema-parity` 不在失败集内。`maturity` 另须按 §R2.3 单独补跑 `maturity:residual` / `maturity:traceability` 以消除 §D4.3 的 `&&` 链盲区。

> **`lint:check` 是 §D4 初版漏判的第四道门。** 初版此处曾把它与 `typecheck` / `contract:check` 并列断言「exit 0（无豁免）」，而**三条断言从未被实测**：实测 `typecheck` 与 `contract:check` 为 0，`lint:check` 为 **1**（4 errors）。四个 error 已逐字节证明为本轮起点即存在，按 §D4.2 三分类入白名单（backlog-debt 3 + exempt-noise 1），裁定与因果证明见 `GATE-BASELINE.md §9`，偏差记 `TFD-lane2-lintcheck-fourth-gate-2026-08-25`。这是**白名单的一次增加**，其合法性依据是「该门自始为红且从未被分析」而非「为容纳回归而放宽」—— 区别见 §D4.6。

### §D4.6 回归定义（承重条款）

> **白名单之外的任何失败 = 回归，一律阻塞。** 白名单是显式清单（文件名 + 测试名），非「已知失败」这类模糊表述。条目数**只减不增**；新增须走 §R4 偏差触发 (c)（「问题被判为本轮不修」）的 `record_deviation`。

即：本节把「22 项失败 / 25 项失配」从模糊坏状态钉成**确定数字**。任何人让它变大，必须留偏差记录。

### §D4.7 本决策的 `non_goals`（守住）

不修 `pnpm test` 任何失败、不重算任何 maturity 哈希、不放宽 `config-schema-parity`、不改任何测试 / 旗标默认值 / src 代码。半径 = GATE-BASELINE.md + 本节，零 src 改动。
