# 仓库引用图精确分析（2026-10-10 复算）

> 状态：已完成（agent 驱动，无真人证据参与）
> 日期：2026-10-10
> 基线：私有 `main` 后代 `ca093b5fb`（分支 `codex/nop-issues-batch1-20261010`）；`git ls-files` 跟踪文件 17,182 个
> 关联 issue：**#75**（修正第一轮审计中被文件名子串匹配放大的零引用数）
> 工具：`scripts/analyze-reference-graph.mjs`（新增，确定性、无第三方依赖）
> 单元测试：`tests/unit/reference-graph-analysis.test.ts`

---

## 1. 结论摘要

1. **零引用统计必须用完整相对路径精确匹配。** 第一轮的"文件名或目录名子串匹配"同时产生**双向**错误：同名文件（`STATUS.md`、`README.md`、`index.json`）让真实未被引用的文件看起来被引用；而全路径确实出现在树里的文件，若其 basename 没有逐字出现，又会被误判为零引用。#75 只描述了后一个方向。
2. **零引用的数值高度依赖"哪些文件算引用来源"。** 同一棵树、同一批候选文件，`docs/` 的零引用数在三种口径下分别是 **253 / 43 / 0**（见 §4 表 A、表 B）。任何清理决策都必须同时声明口径，否则数字没有意义。
3. **两个被 #75 点名为"最明确可归档候选"的目录，结论是"不归档，原地保留"**（见 §6）。它们的"零代码引用"只在排除 `openclaw_runtime/` 时成立；18 份 harness 任务规格、2 份同目录证据文档、以及 `openclaw_runtime/scripts/` 下 2 个 `.mts` 脚本都引用了它们；其中 6 个文件被 8 份规格声明为 `docs.files` 必读文档，移动会直接打破 `scripts/check-repository-artifacts.mjs` 的 fail-closed 门禁。
4. **没有任何在跟踪文件中残留旧的膨胀数字**（`421` / `105` / `27 个零引用` / `458` / `1823`）。唯一载体 `docs/dev/repository-cleanup-triage-2026-10-08.md` 既未被跟踪，在本工作树中也已不存在（见 §7）。

---

## 2. 方法

### 2.1 判定规则

对每个候选文件 `P`（请求目录下的跟踪文件）与每个来源文件 `S`（跟踪文件中排除 `openclaw_runtime/` 与 lock 文件的文本文件）：

> `S` 引用 `P` **当且仅当** `P` 的完整相对路径（以 git 拼写的正斜杠形式）作为子串出现在 `S` 的文本中。

不允许的匹配方式（第一轮的缺陷）：

- 只比较 basename：`STATUS.md`、`README.md`、`index.json` 在仓库里有大量同名文件，命中率极高，等价于"几乎全部被判为已引用"。
- 只比较目录名：`team/`、`docs/dev/` 这类通用目录名会命中无关文本。
- 用 basename 去反查"谁引用了它"：这正是把 `docs/` 458 个文件里 421 个判为零引用的成因之一——被删/未删的判据变成了名字碰撞，而不是真实引用。

### 2.2 来源分类

`--dir` 给出的候选文件按引用来源分成三档，互不混用：

| 档位 | 扩展名 | 说明 |
|---|---|---|
| `code` | `.ts .tsx .mjs .mts .js .cjs .jsx` | 可执行/可加载代码 |
| `contracts` | `.md .json .yml .yaml` | 文档与契约 |
| `any` | 全部跟踪文件 | 含 `.gitignore`、`SHA256SUMS`、日志等 |
| `issueMethod` | `code` ∪ `.json .yml .yaml`（不含 `.md`） | **复刻 #75 自己声明的口径**，用于 1:1 对照 |

### 2.3 为什么还要 `--ignore-source`

`scripts/repository-artifacts.json` 是保留清单，`.gitignore` 的 `# BEGIN reviewed repository inputs` 段由它生成，`artifacts/system-maturity/P6-005/release-source-manifest.json` 是发布源清单——这三个文件**按构造逐条列出每一个被保留的路径**。因此"任意跟踪文件"口径下 `docs/` 的零引用数恒为 **0**：这不是分析结果，而是登记表的自指。同理 `SHA256SUMS`、`harness-ci*.log`、`forbidden-claims-scan.json` 会反复回显路径清单。

所以本报告同时给出两个来源集：

- **表 A**：全部扫描到的来源文件（默认口径，排除 `openclaw_runtime/` 与 lock 文件）。
- **表 B**：在表 A 基础上叠加 `--ignore-source scripts/repository-artifacts.json --ignore-source .gitignore`，即剔除两个"自枚举登记表"。表 B 才是与 #75 表格可比的数字来源。

### 2.4 为什么这是精确的，而不是又一个启发式

- 匹配目标就是判定目标本身（完整相对路径），没有 basename、没有通配、没有后缀猜测。
- 候选按父目录分组，组前缀（`dir + "/"`）必然是组内任一候选路径的前缀，因此"来源不含组前缀"可安全跳过——这只加速，不改变结果集。
- 命中位置逐条记录 `文件:行号`，可用 `git grep` 逐条复核。
- 二进制文件按前 8 KiB 是否含 NUL 判定并跳过，避免把编译产物里的字节序列当成引用。

---

## 3. 复现命令

```bash
# 主口径（表 A）：七个区域
node scripts/analyze-reference-graph.mjs \
  --dir docs,.design-staging,reports,plans,team,harness/specs/tasks,artifacts \
  --out <evidence>/reference-graph-areas-20261010.json

# 剔除自枚举登记表（表 B，与 #75 表格可比）
node scripts/analyze-reference-graph.mjs \
  --dir docs,.design-staging,reports,plans,team,harness/specs/tasks,artifacts \
  --ignore-source scripts/repository-artifacts.json --ignore-source .gitignore \
  --out <evidence>/reference-graph-areas-no-registry-20261010.json

# 两个归档候选目录（含 provenance 与目录名软信号）
node scripts/analyze-reference-graph.mjs \
  --dir docs/dev/context-control-plane,docs/dev/knowledge-system-unification \
  --include-runtime --hash \
  --mentions context-control-plane --mentions knowledge-system-unification \
  --out <evidence>/reference-graph-archive-candidates-all-sources-20261010.json
```

`--help` 列出全部开关。`--include-runtime` 才会把 `openclaw_runtime/` 纳入来源集（#75 的口径默认排除它，见 §6.3）。`--hash` 为每个候选记录 `size` 与 `sha256`。

本次复算的扫描规模（表 A）：跟踪文件 17,182；扫描 4,764；跳过 `openclaw_runtime/` 12,156、lock 文件 4、二进制 258；候选 2,035。

---

## 4. 当前树精确数字

### 表 A：全部来源文件（默认）

| 区域 | 文件数 | 有代码引用 | 零代码引用 | 零代码占比 | 零 `issueMethod` | 零任意引用 |
|---|---|---|---|---|---|---|
| `docs/` | 297 | 44 | **253** | 85.2% | 0 | 0 |
| `.design-staging/` | 0 | 0 | 0 | — | 0 | 0 |
| `reports/` | 32 | 19 | **13** | 40.6% | 0 | 0 |
| `plans/` | 118 | 16 | **102** | 86.4% | 0 | 0 |
| `team/` | 3 | 0 | **3** | 100% | 0 | 0 |
| `harness/specs/tasks/` | 455 | 35 | **420** | 92.3% | 35 | 0 |
| `artifacts/` | 1,130 | 39 | **1,091** | 96.5% | 0 | 0 |

### 表 B：剔除 `.gitignore` 与 `scripts/repository-artifacts.json`（与 #75 可比）

| 区域 | 文件数 | 零代码引用 | 零代码占比 | **零 `issueMethod`** | **零 `issueMethod` 占比** | 零任意引用 | 零任意占比 |
|---|---|---|---|---|---|---|---|
| `docs/` | 297 | 253 | 85.2% | **43** | **14.5%** | 1 | 0.3% |
| `.design-staging/` | 0 | 0 | — | 0 | — | 0 | — |
| `reports/` | 32 | 13 | 40.6% | **0** | 0% | 0 | 0% |
| `plans/` | 118 | 102 | 86.4% | **0** | 0% | 0 | 0% |
| `team/` | 3 | 3 | 100% | **0** | 0% | 0 | 0% |
| `harness/specs/tasks/` | 455 | 420 | 92.3% | **35** | 7.7% | 0 | 0% |
| `artifacts/` | 1,130 | 1,091 | 96.5% | **184** | **16.3%** | 151 | 13.4% |

**表 B 的 `issueMethod` 列是与 #75 对照的正式口径**；表 A/B 的"零代码"列按本任务给定的更窄定义（只算 `.ts/.tsx/.mjs/.mts/.js/.cjs/.jsx`）计算，两者不可互换。这一差异本身就是结论：把 `.json/.yml/.yaml` 并入"代码"会让 `docs/` 的零引用从 253 掉到 0。

---

## 5. 与 #75 表格的对照与漂移解释

#75 的表格（2026-10-09 审计）与本次复算（`issueMethod` 口径，表 B）：

| 区域 | #75 文件数 | #75 零引用 | #75 占比 | 当前文件数 | 当前零引用 | 当前占比 | 差异来源（漂移） |
|---|---|---|---|---|---|---|---|
| `docs/` | 458 | 56 | 12.2% | 297 | 43 | 14.5% | `9d84273d3` 删 187、后续批次新增 29 |
| `.design-staging/` | 28 | 0 | 0% | 0 | 0 | — | 已整目录不在跟踪集（见下） |
| `reports/` | 117 | 0 | 0% | 32 | 0 | 0% | `9d84273d3` 删 85，**完全吻合** 117−85=32 |
| `plans/` | 118 | 0 | 0% | 118 | 0 | 0% | 无变化，**完全吻合** |
| `team/` | 55 | 8 | 14.5% | 3 | 0 | 0% | `9d84273d3` 删 52，**完全吻合** 55−52=3 |
| `harness/specs/tasks/` | 441 | 28 | 6.3% | 455 | 35 | 7.7% | 无删除；batch 1–7 新增 17 份任务规格 |
| `artifacts/` | 1,823 | 506 | 27.8% | 1,130 | 184 | 16.3% | `9d84273d3` 删 705、后续新增 21 |

漂移主因是**同一个提交**：`9d84273d3`（2026-10-09，`chore(repo): keep process artifacts local and enforce reviewed source inputs`）一次改动 1,114 个文件、删除 480,599 行，其中删除 `docs/` 187、`reports/` 85、`team/` 52、`artifacts/` 705 个跟踪文件——正是把过程产物（dev prompt、devlog、临时报告、证据批次）移出 Git 的那次保留策略落地。它与审计发生在同一天，因此 #75 的绝对计数在其后立刻失效；`reports/`、`team/`、`plans/` 三行用"审计数 − 删除数 = 当前数"能精确对上，说明差异是漂移而不是口径矛盾。

`docs/dev/context-control-plane` 同理：#75 记为 23 个文件，`9d84273d3` 删掉了该目录下 17 份 `STAGE*-DEV-PROMPT` / `DEVLOG` / `STAGE-ROADMAP` / 验收 prompt 草稿，**当前只剩 6 个跟踪文件**。`docs/dev/knowledge-system-unification` 未受该提交影响，仍是 19 个。

两点必须标注为**未能完全核实**：

- `.design-staging/` 的 28→0：当前分支的可达历史里**没有任何触及 `.design-staging/` 的提交**（历史上发生过 history compaction）；该目录现在同时是 `scripts/repository-artifacts.json` 的 `localOnlyDirectories` 成员与 `.gitignore:204` 的忽略项，因此它**按政策就不可能被跟踪**。删除动作本身在本 checkout 中不可证。
- `harness/specs/tasks/` 账目差 3：441 + 17(新增) = 458，实际 455。可能是 #75 的 441 本身为近似值，或 3 个新增路径在同批次里被重命名。未逐条核对。
- `artifacts/` 同样有 ±9 的残差（1,823 − 705 + 21 = 1,139 vs 实际 1,130）。

---

## 6. 归档结论：`docs/dev/context-control-plane` 与 `docs/dev/knowledge-system-unification`——**不归档，原地保留**

### 6.1 候选面与来源面

`docs/dev/context-control-plane`：**6** 个跟踪文件（不是 #75 写的 23）。
`docs/dev/knowledge-system-unification`：**19** 个跟踪文件，与 #75 一致。
合计 **25** 个文件、179,365 字节。每个文件的字节数与 sha256 已记录（`<evidence>/archive-candidates-manifest.md`、`archive-candidates-sha256sums.txt`、`archive-candidates-references.json`）。

在 #75 的口径下（排除 `openclaw_runtime/`）：25/25 零代码引用，"零引用"的说法在这一步看似成立。

### 6.2 但引用确实存在，而且分三类

**(a) harness 任务规格 18 份（全部 `lifecycleStatus: archived`）**

`context-control-plane-stage0/1/2/3/4/5/5-l7-soak/6`、`knowledge-system-ks01…ks09`、`knowledge-system-integrity-foundation`。其中 **8 份在 `docs.files` 里声明了 6 个候选路径**为必读文档：

- `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
- `docs/dev/context-control-plane/stage0/authority-matrix.md`
- `docs/dev/context-control-plane/stage0/artifacts-schema.md`
- `docs/dev/context-control-plane/stage0/authority-adapters.md`
- `docs/dev/context-control-plane/stage0/golden-path-contract.md`
- `docs/dev/context-control-plane/stage0/stage1-task-draft.md`

这 6 个路径正是被移入 `docs/archive/**` 后就会失效的路径。`scripts/check-repository-artifacts.mjs:101-105` 对每份规格的 `docs.files` 条目 fail-closed：

```js
if (isLocalArtifact(input) || !tracked.has(input) || !existsSync(join(root, input))) {
  issues.push('Spec requires local or missing documentation: ' + path + ': ' + input);
}
```

即"未跟踪/不存在/被判为本地产物"三者任一都会让仓库保留门禁退出码变 1。**移动 = 破坏 CI 硬门禁**，除非回头改 8 份已归档规格。

**(b) 同目录证据文档 2 份**

`docs/dev/knowledge-system-unification/evidence/KS-09-CANARY-GRADUATION-ACCEPTANCE.md`（引用 7 个候选）、`.../KS-07-SEMANTIC-RETRIEVAL-SOURCE-SET-ACCEPTANCE.md`（1 个）。这两条是目录内相对引用，若整体平移目录结构其实可以保持有效，但已不构成"零引用"。

**(c) 代码引用 2 处——只在包含 `openclaw_runtime/` 时可见**

用 `--include-runtime` 复算后，`docs/dev/knowledge-system-unification` 由"19/19 零代码引用"变为 **18/19**：

- `openclaw_runtime/scripts/source-set-ks07-quality.mts:23` 逐字包含
  `docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json`——**该文件的完整路径级代码引用**。
- `openclaw_runtime/scripts/knowledge-surface-reports.mts:33` 逐字包含
  `docs/dev/knowledge-system-unification/surface-reports`——**该目录级代码引用**，覆盖其中 8 个 `surface-reports/*.json`。

因此 #75 "两个目录合计 42 个文件、零代码引用"的说法在本树上不成立：`knowledge-system-unification` 至少有一个文件的完整路径被 `.mts` 脚本硬编码引用，另有一个子目录被 `.mts` 脚本按目录名引用。方向性结论：**排除 `openclaw_runtime/` 会让"零引用"看起来比实际更强**，这一点在 #75 的口径里没有被声明。

### 6.3 结论

> **不归档，原地保留。** 依据：(1) 18 份 harness 任务规格（`lifecycleStatus: archived`）引用这 25 个文件，其中 8 份把 6 条路径写入 `docs.files`，移动会触发 `scripts/check-repository-artifacts.mjs` 的 fail-closed 失败；(2) `openclaw_runtime/scripts/source-set-ks07-quality.mts:23` 与 `openclaw_runtime/scripts/knowledge-surface-reports.mts:33` 是可执行代码，硬编码了 `knowledge-system-unification` 的文件路径与目录路径；(3) 改写这 8 份规格的 `docs.files` 会篡改历史验收记录的输入清单，属于 `harness/specs/rules/repository-artifact-retention.md:47-51` 明确禁止的"回溯改写历史记录"。

因此：

- **没有执行任何 `git mv`，没有创建 `docs/archive/`**，25 个文件逐字节保持不变（sha256 清单见证据目录）。
- 未产生 `retainedFiles` 路径改名；`check-repository-artifacts.mjs` 的行为不受影响。
- provenance（字节数 + sha256 + 分析日期 + 引用清单）已入库到本文件与证据目录，未来若要做归档决策，可以直接引用这份清单而不必重算。
- 这也修正了 #75 自己的一个前提：这两个目录**不是**"最明确的可归档候选"；按当前证据它们是最不适合归档的一批文档。

---

## 7. 旧口径残留排查（#75 建议第 3 条）

在跟踪文件中检索旧结论的痕迹：

| 检索 | 结果 |
|---|---|
| `git grep -n -I -e 零引用 -e zero.reference -e zero-reference -- .` | 2 处，均与目录审计无关：`docs/dev/codex-parity/runtime-interaction-maturity.md:31`（讲一个 TS 符号 `interventionPolicyForInputMode` 在生产侧无调用）、`openclaw_runtime/extensions/codegraph/dist/extraction/tree-sitter.js:4697`（解析器注释） |
| `git grep -n -I -e '\b421\b' -- docs harness/specs scripts` | 2 处，均为源码行号区间/正则，与零引用统计无关 |
| `git grep -n -I -e '\b458\b' -e '\b1823\b' -e '27 个零引用' -- docs harness/specs scripts` | 0 处 |
| `scripts/` 中是否有实现子串启发式的清理脚本 | 无。逐个检查含 `basename(` 的脚本，均为打包/校验/证据用途，没有任何脚本在做"零引用清理"判定 |
| `docs/dev/repository-cleanup-triage-2026-10-08.md` | 未跟踪；且在本工作树中**不存在**（`Test-Path` = False，全树 `*triage*` 无命中） |

**结论：当前跟踪文件中没有依赖旧膨胀数字的文本或脚本，无需修改；第一轮的膨胀结论没有留下可跟踪的durable 载体。** 本文件即为其替代记录。

---

## 8. 局限（limits）

1. **精确路径包含 ≠ 语义依赖。** 它统计的是"某处逐字写出了这个路径"，既可能低估也可能高估：
   - 低估：相对链接 `[x](stage0/y.md)`、相对 import `'../widgets/Widget.ts'`、`path.join(root, 'docs', 'x.md')` 这类分段拼接、反斜杠写法、跨行断开的路径、构建期生成的路径——都不会被计为引用。单元测试 `does not follow relative markdown links that omit the repo-root path` 与 `does not treat a relative import or bare basename as a full path` 明确固定了这一行为。
   - 高估：登记表与清单类文件（`scripts/repository-artifacts.json`、`.gitignore` 生成段、`artifacts/system-maturity/P6-005/release-source-manifest.json`、`SHA256SUMS`、CI 日志、`*-scan.json`）按构造回显路径，会把未消费者伪装成"已引用"。
2. **口径敏感度大于漂移本身。** `docs/` 零引用在三种来源集下为 253 / 43 / 0。任何引用本报告的下游决策必须带上 `--dir` 与 `--ignore-source` 参数；只写"零引用 = N"是不完整的。
3. **`openclaw_runtime/` 默认被排除是 #75 的口径，不是本工具的判断。** §6.2(c) 证明该排除会隐藏真实代码消费者；对 `docs/` 以外的区域（尤其 `artifacts/`）未做同样的 `--include-runtime` 复算，可能同样存在被隐藏的引用。
4. **二进制文件被跳过**（表 A 258 个、全来源 292 个）。若某个二进制里恰好含候选路径字符串，本工具不会发现；未测量该风险。
5. **`any` 口径在剔除登记表后仍有残留噪声**：`docs/` 剩 1 个非零任意引用文件、`artifacts/` 剩 151 个"只被证据日志或临时报告提及"的文件（13.4%）。这些不是消费者，需要人工/语义判断。
6. **未能核实的两项**：`.design-staging/` 28→0 的删除动作（当前分支不可达，见 §5）；`harness/specs/tasks/` 与 `artifacts/` 的 ±3 / ±9 残差。
7. **第一轮审计的实际来源集不可考。** 仓库中没有审计脚本；唯一的记录是不被跟踪的分诊文档，且本工作树中已不存在。因此 #75 的 56 只能被"界定"（字面口径 0，剔除自枚举登记表 43），不能被逐位复现。
8. **无真人验证。** 全部数字由 agent 在本 checkout 上运行 `scripts/analyze-reference-graph.mjs` 得到，证据为原始 JSON 报告与终端输出；不含任何 real-human 步骤或数据。

---

## 9. 证据

原始产物位于 `D:/ClawX-work/nop-issues-batch1-20261010/issue-75/`（工作区外，不入 Git）：

| 文件 | 内容 |
|---|---|
| `reference-graph-areas-20261010.json` | 表 A 的机器可读报告（7 区域 2,035 候选） |
| `reference-graph-areas-no-registry-20261010.json` | 表 B 的机器可读报告 |
| `reference-graph-archive-candidates-20261010.json` | 两个候选目录、#75 口径（排除 runtime），含 `--mentions` |
| `reference-graph-archive-candidates-all-sources-20261010.json` | 两个候选目录、全来源（含 runtime），含 size/sha256 |
| `archive-candidates-manifest.md` / `archive-candidates-sha256sums.txt` | 25 个文件的 provenance 与引用来源 |
| `archive-candidates-references.json` | 每个文件逐条 `引用文件:行号` |
| `spec-docs-files.mjs` + `spec-docs-files.txt` | 用仓库自身 `parseFrontmatter` 复算的 `docs.files` 声明（18 份规格 / 8 份声明 / 6 条路径） |
| `drift-analysis.txt` | 各区域跟踪数、`9d84273d3` 逐区域删除量 |
| `stale-claims-search.txt` | §7 的检索原文 |
| `run-*.txt` / `explain-zero-code.txt` | 终端原始输出 |

## 10. 变更文件

- 新增 `scripts/analyze-reference-graph.mjs` 与 `scripts/analyze-reference-graph.d.mts`
- 新增 `tests/unit/reference-graph-analysis.test.ts`（11 个用例，全部通过）
- 新增本文件，并在 `scripts/repository-artifacts.json` 的 `retainedFiles` 中登记（同步 `.gitignore` 的 reviewed inputs 段）
- **未移动任何文件，未创建 `docs/archive/`**
