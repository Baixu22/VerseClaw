# 父代码 → vendored runtime 的深路径引用：守卫与现状（issue #93 收口）

Date: 2026-10-11 (agent-driven)
Baseline: private `main` = `d717b90f2`（P2 batch 7-16 落地后的 tip）
Owner issue: Baixu22/VerseClaw#93（P1）
driven_by: agent — 无真人操作或数据；所有数字由本 checkout 实跑 `scripts/check-runtime-deep-refs.mjs` 得到。

## 1. issue 的现状：字符串那半已有人做，代码那半一直没人做

- #92（已 CLOSED）覆盖的是 `shared/` 里的**字符串证据断言**；#93 的评论（2026-10-10）记录了
  batch 6 落了一个 `scripts/check-evidence-refs.mjs`，校验 5 个 evidence 文件里的字符串路径与
  root `package.json` 里的 runtime 脚本路径。
- **但那份门禁不在 main 上**：它只存在于未合并分支 `codex/p1-issues-20261010`
  （`git show origin/codex/p1-issues-20261010:scripts/check-evidence-refs.mjs` 可读，`origin/main` 无此文件）。
  同时该分支还**独立做了一遍 #95 的 uftk 删除**（见 §6 风险提示）。
- 因此 main 上**没有任何门禁覆盖深路径引用**，#93 的第一条验收标准（"全部经过存在性校验或有明确豁免"）
  在集成分支上一直未满足。

## 2. 新增守卫：`scripts/check-runtime-deep-refs.mjs`

判定规则：`electron/`、`src/`、`shared/`、`scripts/` 与 root `package.json` 脚本中，任何指向
`openclaw_runtime/**` 的引用都必须

1. **能解析**（文件、扩展名探测、`index.*`、以及 ESM `.js` → `.ts` 别名），或
2. **在 `scripts/runtime-deep-refs-baseline.json` 中带非空 `reason` 被明确豁免**。

否则 fail-closed（退出码 1），并逐条点名 `文件:行 → 路径`。理由：这是重 vendor 上游后**唯一会静默失效**的一类
引用 —— 既不会编译失败，也不会测试失败。

扫描同时覆盖引用形态：**code**（`import` / `await import()` / `require()`）、**string**
（证据断言、workspace 标签、脚本参数、夹具文本）、**package-script**（root `package.json`）。
这不是启发式猜测：正则只匹配"带 `openclaw_runtime/` 的引号字符串/import 说明符"，并对
`${...}` 插值、`*` glob、`{a,b}` 花括号展开、`!` 开头的 gitignore 取反、以及含反斜杠转义的多行串直接跳过。

### 实测盘点（main `d717b90f2`）

```
runtime-deep-refs: 216 reference(s) {"import":38,"string":172,"package-script":6}
  exempted (accepted debt): 3
  OK: every reference resolves or is exempted with a reason
```

- 覆盖范围：`electron/`（21 个 import + 2 个 string）、`src/`、`shared/`（172 个 string 的绝大多数、
  即证据断言）、`scripts/` 工具链，以及 root `package.json` 里的 6 条 runtime 脚本路径。
- **明确不在范围内**（并写进脚本头与规则）：`tests/`（其 import 由 TS 编译器报错，重命名会响亮失败）
  与 `harness/`（规格散文里是 `openclaw_runtime/**` 之类的**模式**，不是文件引用）。

## 3. 三条豁免（逐条给出证据，不是"跑不过就豁免"）

| 引用 | 判定 | 依据 |
|---|---|---|
| `scripts/agent-map-validation.mjs` 里生成脚本的 `./openclaw_runtime/src/runtime-core/agent-map.ts` | **上下文正确，非缺陷** | 该文本是 `BENCHMARK_SCRIPT`，通过 `spawnPnpm([... 'tsx', '-'], { cwd: ROOT, input: BENCHMARK_SCRIPT })` 从 stdin 执行，`./` 相对 **repo root** 解析，故实际指向 `openclaw_runtime/src/runtime-core/agent-map.ts`（该文件存在）。文本扫描以"所在文件目录"为基准才会误判 |
| `scripts/check-live-model-evidence.mjs` 的 `openclaw_runtime/dist/entry.js` | **构建产物** | 由 `pnpm run build:runtime` 产出；源码 checkout 本就无 `dist/`。该脚本运行时对文件做 sha256，缺失会自己失败 |
| `scripts/rc01r-prerequisite-provenance.mjs` 的 `openclaw_runtime/src/context-engine/cvk/codebase-index.ts` | **历史清单，按 commit 判定** | `PREREQUISITE_PATHS` 是 `PREREQUISITE_DIFF_BASE..PREREQUISITE_COMMIT`（`c860c12f4`）这段**历史 diff** 的期望文件集，用 `git diff --name-only` 比对（脚本 111-121 行），不是比对工作树；该路径在那一刻存在、后来被改名。清单长度还被断言必须为 38，**不得为了让守卫变绿而改动** |

守卫首次运行还命中 4 类**扫描器自身**的噪声，已作为扫描规则修掉而不是豁免：花括号展开
（`test-api.{ts,js}`）、`!` 开头的忽略模式、含 `\n` 转义的多行串、以及本守卫自己文档注释里的示例路径。
另外 `scripts/runtime-deep-refs-baseline.json` 被显式排除出扫描面（它的 `reason` 会引用被豁免的路径）。

**诚实结论：今天 main 上没有"真的断了"的深路径引用**；三条豁免全部是上下文正确或设计如此。
守卫的价值是让**下一次**重 vendor/改名立刻变红，而不是证明当前存在故障。

## 4. 验收标准对照

| #93 验收标准 | 状态 | 证据 |
|---|---|---|
| 77 处深路径引用全部经过存在性校验或有明确豁免 | **满足** | 216 条引用全部经解析校验，3 条带理由豁免；`node scripts/check-runtime-deep-refs.mjs` exit 0 |
| 根脚本对 runtime 内部文件的引用在升级后可验证 | **满足** | 同一守卫的 `package-script` 面覆盖 root `package.json` 的 6 条 runtime 脚本路径；`scripts/` 工具链的 38 个 import/字符串引用同时纳入 |
| 版本双轨问题已解决（见 #67） | **已由 #67 关闭** | #67 = CLOSED/COMPLETED（vendoring 同步策略），`openclaw_runtime/UPSTREAM.md` 记录上游 URL、vendored 版本与本地 fork 策略；本变更不再重复该议题 |

## 5. 未做与边界（不要夸大）

1. **耦合没有消除，只是被约束**：38 个深 import 仍然存在，未迁移到任何"受支持入口"。issue 的
   "建议方向"2/5（改成符号 import 以便编译期报错、固定上游文件→断言路径映射表）**未执行**——
   那需要先造一个 runtime 公开入口并逐个改写，属于独立任务；本变更把它记为**有界债务**并让它无法悄悄增长/腐烂。
2. **文本扫描不是模块图**：`path.join(root, 'openclaw_runtime', 'src', …)` 这类拼接引用看不见；
   注释里的匹配会计入。
3. **存在 ≠ 语义**：文件还在但导出改名，本守卫不会发现（那是编译器/符号 import 的职责）。
4. `tests/` 与 `harness/` 不在 fail-closed 面内（理由见 §2）；若将来要覆盖 `tests/`，需要先把
   "刻意深路径"的夹具与"应该走公开入口"的测试区分开。
5. 未跑：全量单测、`harness:ci` 整体、Electron E2E、打包、跨平台。

## 6. 顺带发现：一个需要所有者知晓的集成风险（不是本变更引入的）

调查本 issue 时发现，**多个已 CLOSED 的 issue 其实现只存在于未合并分支**。例如：

- `#116/#117/#118/#119` 引用的 `tests/unit/provider-error-http-boundaries.test.ts`、
  `tests/unit/host-api-client-error-metadata.test.ts`、`tests/unit/provider-error-retry-boundaries.test.ts`
  只存在于 `codex/p1-issues-20261010` 与 `codex/p1-provider-error-retry-20261010`；
- `#99` 的 `openclaw_runtime/src/process/os-containment.test.ts` 只在 `codex/p1-issues-20261010`；
- 同一分支**独立删除了 uftk 配置面**（`types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts`
  / `runtime-coding-uftk.test.ts`），但**没有** main 上那层 `stripDeprecatedValidationKeys` 兼容剥离
  （`openclaw_runtime/src/config/validation.ts` 在该分支无 uftk 相关改动）。

后果与建议（写给合并者）：

1. 这些 issue 在 GitHub 上是 CLOSED，但 main 上**没有**对应代码 —— 收口状态与集成分支不一致，
   建议在合并该分支前把这条差异当作合并前置检查；
2. 合并该分支时**必须保留 main 上 `validation.ts` 的 `runtime.coding.uftk` 剥离逻辑**，
   否则安装态 `~/.openclaw/openclaw.json`（其中仍带整块 `runtime.coding.uftk`）会让 gateway
   在严格 schema 下校验失败、子进程 exit 1（FP-P0-02 类故障）；
3. 该分支的 `scripts/check-evidence-refs.mjs` 与本守卫**范围重叠**（它覆盖 evidence 字符串 +
   package.json 脚本，本守卫是这三类的超集）。合并时保留一份即可，建议保留本守卫并把它的
   证据文件清单并入豁免或直接删除重复实现。
