# SEAM MAP — 接缝地图（Task A 产出）

> 后续 Task B-I 的挂载坐标。证据格式 `文件:行号`。worktree 根 = `ClawX-context-engine-rebuild/`，ragcode 源 = `verseshell/ragcode-main/`。
> 本轮零生产代码，纯摸底。

## 0. 真实构建命令（PROGRESS 硬验收要用）

| 用途 | 命令（在 worktree 根） | 出处 |
|---|---|---|
| typecheck（仓库根 node+web） | `node scripts/typecheck-agent-dev.mjs` | 根 package.json:typecheck；⚠️ 不覆盖 openclaw_runtime/src |
| typecheck（runtime 源码，rebuild 代码归它管） | `cd openclaw_runtime && pnpm tsgo`（=tsgo:core，tsconfig.core.json） | openclaw_runtime/package.json:tsgo；**已知 201 条基线错误（shared/types、cvk 等，先在）**，验收标准=错误集对基线逐字节 diff 无增量（同 DCS 轨道锚点），非 exit 0 |
| 单元测试 | `cd openclaw_runtime && pnpm exec vitest run <文件>`（包真名=`openclaw`，`--filter openclaw_runtime` 无效，实测 No projects matched） | openclaw_runtime/package.json:name + vitest 4.1.7 实测 |
| 全量测试 | `vitest run && pnpm run test:dcs` | 根 package.json:test |
| runtime 构建 | `node openclaw_runtime/scripts/build-all.mjs` | openclaw_runtime/package.json:build |
| lint | `node openclaw_runtime/scripts/run-oxlint-shards.mjs` | openclaw_runtime/package.json:lint |
| 原生模块构建放行 | `openclaw_runtime/pnpm-workspace.yaml:allowBuilds`（pnpm 11 拦 install 脚本；tree-sitter 五件套已置 true，Node v24 走 node-gyp-build 预编译无本地编译） | 迭代4 实测 |

> ⚠️ 根 `package.json` 的 `"test":"test"` 是占位坏值；真实测试入口是 vitest（openclaw_runtime 有 vitest.config.ts）。Task B 起用 `cd openclaw_runtime && pnpm exec vitest run <文件>` 定向跑新测试。

## A. FactStore 挂载点（新建 context-engine/factstore/）

- **SQLite 文件位置**：`<workspace>/.openclaw/factstore.sqlite`（每 workspace 一份；沿用 codegraph extension 的 per-workspace `.codegraph/` 惯例，见 extensions/codegraph/index.ts 的 WorkspaceParam 语义）。projectId = `sha256(canonicalRoot.toLowerCase()).slice(0,24)`（SPEC §4.2）。
- **实例化/生命周期**：FactStore 是纯数据层，**不挂 runtime 生命周期**（避免与 BlockStore 耦合）。由需要它的 View provider 惰性 `openFactStore(workspaceRoot)` 单例（按 workspace path 缓存句柄）。这样 Producer（Task B）和 View（Task E/F/G）共享同一句柄，满足"一份 .sqlite 一个时钟"。
- **与 BlockStore 关系**：分立两层（ALIGNMENT 校正3）。FactStore 存 code facts（symbols/edges/chunks+provenance/heat）；BlockStore（block.ts）存 prompt 注入块。连接点只在 View：View 读 FactStore → 产 `ContextItem[]`，必要时 upsert `knowledge` Block。FactStore 不 import block.ts，反之亦然。
- **schema 起点**：`[语义 ragcode:src/graph/sqlite-statements.ts]` 七表 + SPEC §4.1 给 files 加四列 `producer/produced_hash/touch_count/last_touch_ms`。

## B. 两影子 provider 接 FactStore 的精确切口

两个 provider 都用 **options 回调注入数据**，这就是 FactStore 的喂入口，**无需改 provider 骨架**：

### agent-map-context-provider.ts
- 注入口：`AgentMapContextProviderOptions.getResult(query, extras) => AgentMapResult`（agent-map-context-provider.ts:26-29）。
- 数据契约：`AgentMapResult`（agent-map.ts:264-278）含 `content/includedFiles/includedSymbols/evidence/evidenceRefs`。
- **agent-map 真实数据源**：调用方喂 `AgentMapSourceFile[] = {file, content, language?}`（agent-map.ts:280-285），经 `buildBudgetedAgentMap` 用 TS SourceFile 提 tag。**它不自己扫盘**——所以 FactStore 接管的方式是：Task F 写一个 `factStoreToAgentMapResult(store, query)`，从 FactStore 的 symbols/chunks 组装 `AgentMapResult`，作为 `getResult` 回调传入。
- **多语言升级点**：`AGENT_MAP_SUPPORTED_EXTENSIONS`（agent-map.ts:66-75）仅 JS/TS；`AGENT_MAP_LANGUAGES`（:90-96）同。FactStore 走 ragcode 五语言 analyzer，天然多语言——Task F 的 `factStoreToAgentMapResult` 直接产出 Py/Go/Rust/Java symbol，绕过这个前端限制（不改 agent-map 本体，接口兼容）。
- **ignore 名单可抄**：`AGENT_MAP_DEFAULT_INPUT_LIMITS.ignoredDirectories`（:49-63）+ `AGENT_MAP_GENERATED_FILE_SUFFIXES`（:77-88）→ FactStore ignore 层（SPEC Task C）。

### symbol-context-provider.ts
- 注入口：`SymbolContextProviderOptions.getOverviews(query, extras) => RuntimeSymbolOverview[]`（symbol-context-provider.ts:31-34）。
- Task F 写 `factStoreToSymbolOverviews(store, query)`，从 FactStore symbols 组装 `RuntimeSymbolOverview[]`，作为 `getOverviews` 回调。
- 两 provider 均 `shadowOnly:true`（:65/:69），转权威在 Task I。

## C. codegraph 五能力 → 新 impact provider 字段级对照

> 真实路径：`openclaw_runtime/extensions/codegraph/index.ts`（ALIGNMENT 校正2 写的 `extensions/codegraph/` 少了 `openclaw_runtime/` 前缀，以本行为准）。

⚠️ **SPEC-GAP-1（见下）**：codegraph extension 实为 **15 个工具**（grep `name: "codegraph_` 实测：explore/search/callers/callees/impact/status/sync/init/entrypoints/find_flow/minimal_context/git_stats/freshness/decide/context_plan），非 ALIGNMENT 假设的 5 个。以下先给 spec 点名的核心 5 基线；其余 10 的 parity 取舍需人拍板。

| codegraph 工具 | 输入 | 输出结构 | 新 impact provider 对应 |
|---|---|---|---|
| `codegraph_search`（index.ts:981） | query, kind?, limit? | `cg.searchNodes()` → `[{node:{id,name,filePath,kind,...}, score}]` | FactStore `selectSymbolByNameLike` → find_symbol |
| `codegraph_callers`（:1000） | symbol, depth? | `cg.getCallers(nodeId, depth)` → 调用链 | FactStore edges kind=`calls` 反向 1-hop（SPEC Task G） |
| `codegraph_callees`（:1018） | symbol, depth? | `cg.getCallees()` | edges kind=`calls` 正向 |
| `codegraph_impact`（:1036，ImpactSchema:49） | symbol/file | 受影响集合 | `[语义 ragcode:src/graph/impact-report.ts]` |
| `codegraph_explore`（:955） | query, maxFiles? | `cg.findRelevantContext()` → `{files:[{filePath,symbols[]}], nodeCount}` | ContextPack provider（Task E） |
| **其余10**：status/sync/init/entrypoints/find_flow/minimal_context/git_stats/freshness/decide/context_plan | 见 index.ts:1054-1285 | — | **SPEC-GAP-1 待决**（status/sync/init/freshness 属索引运维，FactStore 按需物化后天然消解；真正待决的是 entrypoints/find_flow/minimal_context/git_stats/decide/context_plan 六个分析能力） |

- codegraph 底层是 `cg`（vendored CodeGraph 实例，`prepareCG`），非外部进程 → 退役=解绑 plugin 注册（openclaw.plugin.json），非卸 npm。
- **Task G golden 复现参数**（与基线对齐必须用同参）：callers/callees 先 `searchNodes(sym,{limit:1})` 取 top-1 再走链，depth 默认 **2**；impact = `getImpactRadius(nodeId, depth=3)`；explore = `findRelevantContext(query,{searchLimit:5, traversalDepth:2, maxNodes:50})` + maxFiles 默认 5；search = `searchNodes(query,{kinds?, limit:10})`。symbol 未命中时返回 `Symbol not found: <sym>` 文本。codegraph 自有 e2e 门 = `pnpm test:codegraph-runtime`（Task I 退役时须一并处理）。
- `freshnessMode: fast|balanced|strict`（index.ts:12-17 `FreshnessModeParam`，:217 类型）：fast 跳同步 / balanced 节流增量同步 / strict 等同步完再读。**FactStore 新鲜度门直接对齐这三档**（比 ragcode env 变量更贴本仓库），Task C 采纳。

## D. Task B/C 地基情报（迭代1续摸底）

- **tree-sitter 形态**：仓库**没有**原生 `tree-sitter` 依赖；已有 `web-tree-sitter@0.26.9`（WASM）+ `tree-sitter-bash@0.25.1`（package.json:1912,1918），且有生产级加载模式可直接复用：`src/infra/command-explainer/tree-sitter-runtime.ts`（`Parser.init({locateFile})` + `Language.load(<pkg>.wasm)` + 懒加载单例 + 解析超时护栏）。ragcode analyzers 用的是原生 tree-sitter API → Task B 适配方向：**优先尝试 SPEC 原案（装原生 tree-sitter）过 B① 门禁；装不上（Electron env 已知屏蔽原生模块）则按 SPEC-GAP-3 走 WASM 适配**。
- **SQLite 驱动**：仓库统一用 `node:sqlite` 的 `DatabaseSync`（经 `src/infra/node-sqlite.ts` 的 `requireNodeSqlite`），配套 `infra/sqlite-transaction.ts`、`infra/sqlite-wal.ts`。FactStore（Task C）照此办理，**不引入 better-sqlite3**。
- **ignore 名单实位**：`AGENT_MAP_DEFAULT_INPUT_LIMITS.ignoredDirectories` = agent-map.ts:46-64（13 目录）；`AGENT_MAP_GENERATED_FILE_SUFFIXES` = :77-88（10 后缀）；`AGENT_MAP_SUPPORTED_EXTENSIONS` = :66-75。（比本图 B 节早先写的 :49-63/:77-88 更精确，以本行为准。）
- **⚠️ ragcode 源缺失**：协议路径 `C:/Users/27933/Desktop/verseshell/ragcode-main/` 不存在（Glob 实测 No files found；Desktop/Downloads/Developer/用户根遍历均无）。恢复方案：全盘搜 → 不在则 clone `https://github.com/MarshallEriksen-Neura/ragcode`（SPEC 附录B）到协议路径。clone 不可达则升 SPEC-GAP 停机。

## SPEC-GAP 清单（需人拍板）

- **SPEC-GAP-1｜codegraph parity 范围**：extension 实有 15 工具（不止 5）。Task G 的 parity 该覆盖哪些？建议：**核心 5（search/callers/callees/impact/explore）达 parity 后即可退役绑定**；status/sync/init/freshness 四个索引运维工具被 FactStore 按需物化天然替代（无需 parity）；其余 6 个分析能力（entrypoints/find_flow/minimal_context/git_stats/decide/context_plan）作为**独立后续 View**，不阻塞本 rebuild 闭环。→ **需你确认这个缩范围决定**；确认前 Task G 只对核心 5 做 parity，Task I 退役前在 PROGRESS 明确列出"未迁移的 6 个分析能力"清单，不静默丢弃（SPEC §5 无声上限纪律）。
- **SPEC-GAP-2｜根 package.json test 脚本损坏**（`"test":"test"`）：不阻塞（改用 vitest 定向命令），但若 Task H/I 要跑"全量测试"需确认 `vitest run && pnpm run test:dcs` 是权威入口。倾向自己扛，此处仅登记。
- **SPEC-GAP-3｜tree-sitter 原生 vs WASM**（迭代1续登记）：SPEC §5.3/B① 门禁假设原生 `tree-sitter@^0.21.1`（Windows 需 prebuilt/本地编译，且本仓库 Electron env 有屏蔽原生模块前科）；仓库现实约定是 `web-tree-sitter` WASM（已在生产用于 bash 解析，见 D 节）。若原生装不上，建议改走 WASM：五语言 grammar 用各 `tree-sitter-<lang>` npm 包自带的 prebuilt .wasm，analyzer cp 后把原生 API 调用适配为 web-tree-sitter API（接口近同构）。**该改动同时改写 B① 门禁语义（require('tree-sitter') → WASM parser 冒烟），需人认可**；拍板前执行顺序=先试原生，失败即停机呈报本 GAP。

## 结论：Task A 验收自检

- [x] FactStore 挂载点明确（A 节：per-workspace `.openclaw/factstore.sqlite`，惰性单例，与 BlockStore 分立）
- [x] 两影子 provider 数据切口明确（B 节：getResult / getOverviews 回调，附 agent-map 真实数据源与多语言升级路径）
- [x] codegraph→impact 字段级对照（C 节，附 freshnessMode 三档采纳）
- [x] SPEC-GAP 全部登记（GAP-1 需拍板、GAP-2 自扛）
