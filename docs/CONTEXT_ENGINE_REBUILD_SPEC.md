# Context-Engine 内部整改：开发规格书 v1

> **一句话目标**：把 `openclaw_runtime` 的 context-engine 从"预建索引再服务"改成"agent 摸过的文件顺手解析、结果记忆化进一个带内容哈希的 FactStore、查询时缺什么补什么并诚实声明缺口"。**索引降级为缓存，契约（证据+缺口+可动手判定）升级为产品的脸。**
>
> **本文档定位**：这是一份可直接施工的规格。设计决策（最强大脑）已冻结在本文；实现细节（脏活累活）交给执行模型逐 Task 完成。每个 Task 标注了**要从 ragcode 抄什么、抄哪个文件、抄的时候改什么**，以及**验收标准**。执行模型不需要做架构决策，只需照抄+适配+过验收。

---

## 0. 阅读对象与协作模型

- **审阅者（你）**：只读第 1、2、9 节 + 每个 Task 的"验收标准"。发现规格有洞时改本文，不要让执行模型自己发明。
- **执行模型（便宜模型）**：按 Task 编号顺序施工。每个 Task 是自包含的：给了出处、给了接口、给了验收。**禁止跨 Task 发明新抽象**；遇到规格没覆盖的情况，停下来标记 `SPEC-GAP: <描述>`，不要自作主张。
- **出处标记约定**：`[CP ragcode:<相对路径>]` = 直接 cp 这个文件（叶子器官）；`[语义 ragcode:<路径>]` = 复刻设计语义、按本地类型重写；`[禁止 ragcode:<路径>]` = 明确不要碰的框架胶水。所有 ragcode 路径相对于 `C:/Users/27933/Desktop/verseshell/ragcode-main/`。

---

## 1. 为什么改（背景，只读一次）

现状三个孤岛——CodeGraph（`@colbymchenry/codegraph`，外部进程 + `.codegraph/codegraph.db`）、agent-map（`openclaw_runtime/src/runtime-core/agent-map.ts`，运行时内部模块）、tree-sitter/ast（散落零件）——各有独立索引、独立协议、独立新鲜度时钟。它们之间通过进程边界/序列化通信，带来两类不可接受的损耗：

1. **迭代扩展需要廉价往返**：上下文打包本质是"拿一点→看预算→再扩一跳"的循环，跨进程往返是毫秒~秒级，逼迫设计退化成"一次多给"（冗余）或"一次给摘要"（精度损耗）。
2. **稳定 ID 过边界退化成散文**：进程内 symbol 是带偏移的对象引用，序列化后变成 `"handleLogin (auth.ts:120)"` 字符串，下游必须重新解析、重新定位，精度死在"再解析"里。

**本次整改的硬约束**：热路径（查询→事实→打包）必须全部进程内、传引用不传散文；一份 SQLite = 一个事实底座 = 一个新鲜度时钟。

**不做的事**：不引入 MCP 子进程做热路径；不保留两份图索引；不在 T1 引入 embedding/LanceDB（见 §8 分期）。

---

## 2. 目标架构（冻结，不可改）

```
                 openclaw_runtime（单进程）
  ┌─────────────────────────────────────────────────────────┐
  │                    context-engine                        │
  │                                                          │
  │  Producers ───────→  FactStore  ───────→  Views          │
  │  ┌──────────┐       ┌──────────┐         ┌────────────┐  │
  │  │ grep(rg) │       │ 内存层(session)│      │ agent-map  │  │
  │  │ treesit  │──写──→│ + SQLite(项目) │─读──→│ find_owner │  │
  │  │ tsCompiler│      │ 稳定ID/内容哈希 │      │ impact     │  │
  │  └──────────┘       │ provenance/heat│      │ ContextPack│  │
  │                     └──────┬─────────┘      └────────────┘  │
  └────────────────────────────┼──────────────────────────────┘
                               │ 同一个 .sqlite 文件（唯一中立膜）
                  verseshell db.sqlite_query 直读（脚本/人入口）
```

**三层职责边界（这是唯一要焊死的分层，其余代码保持流动）**：

| 层 | 职责 | 绝不做 |
|---|---|---|
| **Producer** | file+content → facts（symbols/edges/chunks）。纯函数，无状态，无 IO 副作用（读文件除外） | 不写库、不决定新鲜度、不打包 |
| **FactStore** | 事实的唯一真相源。写入去重、内容哈希失效、provenance/heat 记账、新鲜度门 | 不解析代码、不排序打包 |
| **View** | facts → agent-facing 输出（repo map / owner / impact / ContextPack）。只读 store | 不解析、不写库 |

**数据流的铁律**：Producer 只写 FactStore；View 只读 FactStore；Producer 和 View 之间**没有直接调用**。任何"View 需要一个还没解析的文件"的情况，都通过 FactStore 的"缺失→触发 Producer→记忆化"闭环解决，不允许 View 直接 call Producer。

---

## 3. 核心机制：索引即缓存（Salsa 式按需物化）

**决策已冻结**：不分项目大小、不分任务长短，所有查询走同一条管线。没有"要不要建 codegraph"这个决策——它被降级为"要不要花 3ms 解析这个文件"的事实级决策。

```
query
  │
  ├─→ 查 FactStore（带内容哈希新鲜度检查）
  │     命中且 fresh → 直接用
  │     命中但 stale（哈希不符）→ 标记失效，走补齐
  │     未命中 → 走补齐
  │
  ├─→ 补齐（最便宜的 producer 现场补，有预算上限）
  │     T0 文本命中   → ripgrep（永远可用，冷启动即 grep 速度）
  │     T1 结构事实   → tree-sitter 解析"刚被摸过的文件"（单文件毫秒级）
  │     T2 跨文件边   → 只沿已知节点 1-hop 扩展，绝不全仓扫描
  │
  ├─→ 新产出的事实写回 FactStore（记忆化）
  │
  └─→ 按预算打包输出（ContextPack：证据 + 缺口声明 + 可动手判定）
```

**parse-on-touch 规则**（这是"短任务也增效"的来源）：agent 每次通过 Read/Grep 工具真实读到一个文件，context-engine 顺手把它送进 T1 producer 解析入库。这些文件本来就要读，解析只加毫秒。同 session 第二个查询就开始命中缓存。

**护栏（防止缓存反噬成税）**：
- 每次查询有解析预算上限 `maxParsePerQuery`（默认 12 文件），超了就**声明缺口**（写进 `missingEvidence`），不硬扛。
- 后台补齐只在 idle + 仓库"热"（≥2 个 session 触碰过）时做。
- FactStore 有大小硬上限，按 `heat` LRU 驱逐。
- ignore 名单（node_modules/dist/.gen.*/vendor/...）永不解析——直接抄 agent-map 的名单（见 Task 2）。

---

## 4. FactStore 数据契约（冻结 schema）

**起点直接抄 ragcode 的 SQLite schema** `[语义 ragcode:src/graph/sqlite-statements.ts]`（该文件是 schema 访问的单一真相源，`projects/files/symbols/edges/chunks/chunks_fts/skipped_files` 七张表的完整列定义都在里面的 prepared statement 中）。**在此基础上加两列，这两列是本架构的安全带，不可省**：

### 4.1 `files` 表——加 `provenance` 与 `heat`

抄 ragcode `files` 表原列（见 sqlite-statements.ts:133-135 的 `insertFile`）：
`project_id, path, absolute_path, language, size_bytes, content_hash, modified_at_ms, indexed_at_ms, status, generation`

**新增列**：
```sql
-- provenance: 这条事实由哪个 producer、在什么 content_hash 下产出。精确失效与可信度的根。
producer      TEXT NOT NULL DEFAULT 'unknown',  -- 'ripgrep' | 'treesitter' | 'ts-compiler' | 'fallback'
produced_hash TEXT NOT NULL DEFAULT '',          -- 产出时源文件的 content_hash；与当前 content_hash 不符 = stale
-- heat: LRU 驱逐依据
touch_count   INTEGER NOT NULL DEFAULT 0,
last_touch_ms INTEGER NOT NULL DEFAULT 0
```

`symbols`/`edges`/`chunks` 表**沿用 ragcode 原样**（含 `generation` 列做批次失效），但每行通过 `file_path` 关联到 `files` 的 provenance——即"这个文件的事实是谁在什么哈希下产的"记在文件级，不必每行冗余。

### 4.2 稳定 ID 纪律（冻结）

- `projectId = sha256(canonicalRoot.toLowerCase()).slice(0, 24)` —— **直接抄** ragcode 方案（`[语义 ragcode:docs/INDEX_SCHEMA.md]` 有说明，Windows 路径大小写/斜杠坑他们踩完了）。
- `symbol.id` 沿用 ragcode 生成规则（见各 analyzer 内的 id 构造，通常 `filePath#name#startLine`）。
- **铁律**：进程内传 `SymbolNode` 对象引用，不传 `"name (file:line)"` 字符串。只有跨 SQLite 膜（verseshell/dashboard 读）时才允许序列化。

### 4.3 新鲜度语义（冻结）

**直接抄** freshness gate 的判定逻辑 `[语义 ragcode:src/core/freshness-gate.ts]`：读时惰性检查 → stale 文件按需有界刷新 → 返回前刷新完。适配点：ragcode 的 gate 检查的是 `indexStatus` 的 stale/pending 列表；本地改成**内容哈希比对**——`files.content_hash`（当前）vs `files.produced_hash`（产出时），不符即 stale。环境变量语义沿用（`off/stale-ok/force`，见 freshness-gate.ts:81-86）。

---

## 5. Producer 层规格

### 5.1 Producer 统一接口（冻结）

**直接抄** `[CP ragcode:src/indexing/analyzers/types.ts]` 的 `LanguageAnalyzer` / `FileAnalysis` / `AnalyzeFileInput` 接口，一字不改。它已经是完美的纯函数契约：

```ts
// 抄自 ragcode src/indexing/analyzers/types.ts:3-29
export interface FileAnalysis { chunks: CodeChunk[]; symbols: SymbolNode[]; edges: GraphEdge[]; warnings?: IndexAnalysisWarning[]; }
export interface AnalyzeFileInput { repoRoot: string; file: CodeFile; content: string; }
export interface LanguageAnalyzer {
  language: LanguageId;
  capabilities: AnalyzerCapability[];   // "symbols"|"imports"|"exports"|"calls"|"definitions"|"framework_routes"|"tests"
  analyzeFile(input: AnalyzeFileInput): FileAnalysis;
}
```

### 5.2 具体 Producer 清单

| Producer | 出处 | 层 | 备注 |
|---|---|---|---|
| ripgrep 文本 | 本地新写（薄封装 `rg --json`） | T0 | 永远可用，无需解析；命中即写 `chunks` |
| TypeScript/JS | `[CP ragcode:src/indexing/analyzers/typescript-analyzer.ts]` | T1 | 用 TS Compiler API，最精确 |
| Python | `[CP ragcode:src/indexing/analyzers/python-treesitter-analyzer.ts]` | T1 | tree-sitter |
| Go | `[CP ragcode:src/indexing/analyzers/go-treesitter-analyzer.ts]` | T1 | tree-sitter |
| Rust | `[CP ragcode:src/indexing/analyzers/rust-treesitter-analyzer.ts]` | T1 | tree-sitter |
| Java | `[CP ragcode:src/indexing/analyzers/java-treesitter-analyzer.ts]` | T1 | tree-sitter |
| tree-sitter base | `[CP ragcode:src/indexing/analyzers/tree-sitter-base.ts]` | — | 上述四个的公共基类 |
| fallback | `[CP ragcode:src/indexing/analyzers/fallback-analyzer.ts]` | T1 | 未知语言兜底 |
| registry | `[CP ragcode:src/indexing/analyzers/registry.ts]` | — | 语言→analyzer 路由，一字不改 |

**这一整个 `analyzers/` 目录就是你要找的"ast 能力的统一形态"。整目录 cp，是本次整改性价比最高的一步。**

### 5.3 依赖（package.json）

抄 ragcode 的这几个依赖（版本见 ragcode `package.json:87-92`）：
`tree-sitter@^0.21.1, tree-sitter-go, tree-sitter-java, tree-sitter-python, tree-sitter-rust, typescript@^5.9.3`。
⚠️ **Windows 原生模块风险**：`tree-sitter` 需 prebuilt 或本地编译，Task 1 必须先验证装得上（见 Task 1 验收）。

---

## 6. View 层规格

### 6.1 ContextPack 契约（冻结，所有 View 的统一返回格式）

**直接抄** `[CP ragcode:src/core/types.ts:382-436]` 的 `ContextSnippet` + `ContextPack` + `MissingEvidenceHint`，以及 `EditReadiness` 三态（types.ts:701）：

```ts
// 抄自 ragcode，字段顺序即输出顺序，不可打乱
export type EditReadiness = "safe_to_edit_after_reading" | "investigate_only" | "not_enough_context";
export interface ContextPack {
  query; repoRoot; projectId; mode;
  answerable: boolean; confidence: "low"|"medium"|"high";
  brief;                    // 一句话结论
  freshness;                // 新鲜度报告
  ownerChain;               // 真相在哪
  topology;                 // 结构边
  snippets: ContextSnippet[];   // 证据（带 elidedLineCount，诚实报告省了多少行）
  relationships;
  nextQueries: string[];    // 建议下一步查什么
  missingEvidence: string[];    // 诚实声明缺什么 ← 本架构的灵魂
  budgetChars; usedChars;
}
```

**输出顺序铁律**（写进 markdown formatter）：`brief → freshness → ownerChain → topology → 证据 snippets → missingEvidence → nextQueries`。这个顺序抄自 ragcode README 的 ContextPack 契约说明，不可改——它把"结论/可信度/缺口"放在证据前面，是让 agent 先判断"够不够动手"再看细节。

### 6.2 打包三件套（直接 cp）

| 组件 | 出处 | 职责 |
|---|---|---|
| 骨架化 | `[CP ragcode:src/context/skeletonizer.ts]` | 大文件返回骨架而非全文，TS 用 Compiler API 精确抽签名 |
| 预算控制 | `[CP ragcode:src/context/context-budget.ts]` | `truncatePackToBudget` / `estimatePackCost` / `compactFallbackPack`，字符预算内挑片段 |
| 扩展策略 | `[CP ragcode:src/context/expansion-policy.ts]` | `chooseExpansion`：按 query+mode 决定 file_card/skeleton/focused_body/full_body |

**这三个就是 agent-map 重复造的那部分轮子，且 ragcode 造得更细。cp 它们，删 agent-map 的对应实现。**

### 6.3 检索归一化（直接 cp，这是对中文用户的差异化）

| 组件 | 出处 | 职责 |
|---|---|---|
| 查询上下文 | `[CP ragcode:src/retrieval/query-context.ts]` | `buildQueryContext`：中/英/混合检测 + raw/path/symbol/lexicon 加权词项 |
| 混合检索 | `[CP ragcode:src/retrieval/hybrid-retriever.ts]` | `HybridRetriever` + `fuseHits`：关键词+语义融合（**去掉 semantic 分支即纯 FTS，T1 先这样**） |
| 领域词典 | `[CP ragcode:src/retrieval/domain-lexicon.ts]` | 协议/配置/测试/入口等中文词落到实现证据 |
| 图重排 | `[CP ragcode:src/retrieval/graph-reranker.ts]` | 无 embedding 也能跑，按图距离重排 |

### 6.4 具体 View 清单

| View | 出处 | 收编的孤岛 |
|---|---|---|
| repo map | `[语义 ragcode:src/mcp/tools.ts topology_map]` + agent-map 的预算逻辑 | **agent-map 变成这个 View** |
| find_owner | `[语义 ragcode:src/mcp/tools.ts find_owner]` + `src/graph/owner-ranking.ts` | codegraph 的定位职责 |
| find_symbol | `[语义 ragcode:src/graph/sqlite-statements.ts selectSymbolByNameLike]` | codegraph |
| impact/callers/callees | `[语义 ragcode:src/graph/impact-report.ts]` + `src/subgraph/` | **codegraph 的核心职责** |
| reuse | `[CP ragcode:src/reuse/reuse-detector.ts]` `buildReuseCandidateReport` | 新能力 |
| review_diff | `[语义 ragcode:src/graph/diff-files.ts]` | 新能力 |

### 6.5 明确不抄（框架胶水，抄进来就是新孤岛）

`[禁止]` 以下整层：`src/mcp/server.ts`（MCP 传输层）、`src/cli/`、`src/web/`、`src/agents/`（它自己的 agent harness）、`src/memory/`（ClawX 有自己的记忆系统）、`src/config/`、以及**整个 LanceDB/embedding 层**（`src/semantic/`，T1 不碰，见 §8）。

---

## 7. 施工 Task 清单（按序执行）

> 每个 Task：**输入前置** → **要抄什么** → **适配点** → **验收标准**。执行模型逐个完成，过不了验收不进下一个。

### Task 0 — 环境与骨架验证 `[前置：无]`
- **做什么**：在 `openclaw_runtime/src/context-engine/` 下建 `factstore/`、`producers/`、`views/` 三个空目录 + `index.ts` 门面占位。确认 Node ≥24（本机 v24.15.0 ✓）。
- **验收**：
  1. `pnpm --filter openclaw_runtime typecheck` 通过（空骨架）。
  2. 三层目录存在，`index.ts` 导出空的 `ContextEngine` 门面接口。

### Task 1 — Producer 层落地 `[前置：Task 0]`
- **要抄什么**：整个 `[CP ragcode:src/indexing/analyzers/]` 目录 → `producers/analyzers/`。外加本地新写 ripgrep producer。
- **适配点**：
  - analyzer 依赖 ragcode 的 `core/types.ts` 类型（`CodeChunk/SymbolNode/GraphEdge/LanguageId`）——把 `[CP ragcode:src/core/types.ts:1-127]` 的这段类型也抄进 `context-engine/types.ts`。
  - ripgrep producer：薄封装 `rg --json <query> <root>`，输出映射成 `chunks`（`kind:"block"`）。verseshell 已有 `file.grep`，但 producer 要结构化输出，直接 spawn `rg` 更干净。
- **验收**：
  1. **Windows 原生模块必须真装上**：`node -e "require('tree-sitter')"` 不报错。装不上则标 `SPEC-GAP` 并停——这是全案的地基。
  2. 单测：喂一个 20 行的 TS 文件给 `analyzeFileWithRegistry`，返回的 `symbols` 含预期函数名、`edges` 含 import 边。（可直接改造 ragcode 自带的 analyzer 测试）
  3. 五语言（TS/Py/Go/Rust/Java）各跑通一个 fixture，capabilities 与 registry 声明一致。

### Task 2 — FactStore 落地 `[前置：Task 1]`
- **要抄什么**：`[语义 ragcode:src/graph/sqlite-statements.ts]` 的建表 + prepared statements 全套 → `factstore/statements.ts`。`[语义 ragcode:src/graph/sqlite-graph-store.ts]` 的 upsert/select 封装 → `factstore/store.ts`。
- **适配点**：
  - `files` 表加 §4.1 的四列（`producer/produced_hash/touch_count/last_touch_ms`）。
  - 写路径加 provenance 记账：每次 producer 写入，记 `producer` 名 + 当时 `content_hash` 到 `produced_hash`。
  - 新鲜度：抄 `[语义 ragcode:src/core/freshness-gate.ts]`，把 stale 判据从 status 列表改成 `content_hash != produced_hash`。
  - ignore 名单：抄 `[语义 ClawX:openclaw_runtime/src/runtime-core/agent-map.ts]` 里的 `AGENT_MAP_DEFAULT_INPUT_LIMITS.ignoredDirectories` 和 `.gen.*` 后缀名单（agent-map.ts:44-80），FactStore 拒绝入库这些路径。
  - heat：每次 touch（读或命中）`touch_count++`、更新 `last_touch_ms`；LRU 驱逐用这两列。
- **验收**：
  1. 写入一个文件的 facts → 读回一致；改文件内容（哈希变）→ 新鲜度门报 stale。
  2. provenance 正确：查得出"symbol X 由 treesitter 在 hash H 下产出"。
  3. ignore 名单生效：`node_modules/foo.js` 拒绝入库。
  4. **verseshell 直读验证**：`db.sqlite_query` 打开该 .sqlite，`SELECT COUNT(*) FROM symbols` 返回正确计数——证明"中立膜"通了。

### Task 3 — 按需物化管线（核心闭环）`[前置：Task 2]`
- **要抄什么**：无直接对应，这是本架构的原创闭环。参照 §3 的管线图实现 `factstore/materialize.ts`。
- **适配点**：
  - `ensureFacts(files, budget)`：对每个 file，命中且 fresh→跳过；否则 → 选 producer → 解析 → 写库 → 计入预算。超 `maxParsePerQuery`(12) 停，剩余文件名塞进返回的 `deferred[]`。
  - `parse-on-touch` 钩子：暴露 `onFileTouched(path)`，供 agent 的 Read/Grep 工具调用，把文件排进物化队列。
- **验收**：
  1. 冷 store 查询一个新文件：首次触发解析（慢），第二次命中缓存（快，无解析）——打点计时证明。
  2. 预算护栏：一次 query 触碰 20 个未解析文件，只解析 12 个，其余 8 个出现在 `missingEvidence`。
  3. 编辑一个已缓存文件后再查：自动重解析（provenance 失效触发）。

### Task 4 — ContextPack 与打包 View `[前置：Task 3]`
- **要抄什么**：`[CP]` ContextPack 契约（§6.1）+ 打包三件套（§6.2）+ 检索归一化（§6.3，去 semantic 分支）。
- **适配点**：markdown formatter 严格按 §6.1 输出顺序。`missingEvidence` 接 Task 3 的 `deferred[]` + 检索 miss。
- **验收**：
  1. 一个真实查询返回合法 ContextPack，字段顺序正确，`snippets` 的 `elidedLineCount` 如实报告省略行数。
  2. edit-readiness 三态可复现：证据充分→`safe_to_edit_after_reading`；只命中部分→`investigate_only`；全 miss→`not_enough_context`。
  3. 预算截断：设一个小 `budgetChars`，`truncatePackToBudget` 生效且 `missingEvidenceHints` 含 `context_budget_truncated`。
  4. 中文查询落地：中文问"鉴权在哪配置"能命中英文实现文件（验证 domain-lexicon + query-context）。

### Task 5 — agent-map 改造为 View `[前置：Task 4]`
- **做什么**：把 `openclaw_runtime/src/runtime-core/agent-map.ts` 的数据来源从"自己扫文件系统"改为"读 FactStore"。保留其对外 `AgentMapRequest`/`AgentMapResult` 接口不变（下游不动），内部换血。
- **适配点**：`agent-map` 的 cache（`agent-map-cache.ts`）职责被 FactStore 收编——删缓存层，refreshPolicy(`auto/force/cache_only`) 映射到 FactStore 新鲜度门的三种 mode。
- **验收**：
  1. agent-map 现有单测（`tests/unit/runtime-agent-map-*.test.ts`）全绿——**接口兼容是硬指标**。
  2. agent-map 现在能处理 Py/Go/Rust/Java 文件（原来只 JS/TS）——加一个多语言 fixture 测试证明升级。
  3. 同一文件，agent-map 和 find_symbol View 返回的 symbol 集合一致（证明单一事实源）。

### Task 6 — 结构 View（impact/callers/owner）达 codegraph parity `[前置：Task 4]`
- **要抄什么**：`[语义 ragcode:src/graph/impact-report.ts + src/subgraph/ + src/graph/owner-ranking.ts]`。
- **parity 基线**：现有魔改 codegraph 暴露 `callers/callees/impact/trace` 四个能力（已核实 `super-agent-dev/codegraph/src/mcp`）。新 View 必须在同一批查询上给出**不劣于** codegraph 的结果。
- **验收**：
  1. 建一组 golden 查询（10~15 个，取自真实仓库如 ClawX），对每个查询记录 codegraph 的 callers/impact 输出作为基线。
  2. 新 View 在这组查询上：召回的直接调用者/被影响文件 **⊇ codegraph 的结果**（允许更多，不允许更少）。
  3. 差异清单人工过一遍（你审），确认多出的是真命中不是噪声。**过了这关才能拔 codegraph。**

### Task 7 — 门面收敛与 grep 降级 `[前置：Task 4,5,6]`
- **做什么**：`context-engine/index.ts` 暴露 §9 的六个意图动词，内部路由到 View。实现 §3 的降级链（索引 miss/missingEvidence 非空 → 自动 ripgrep 回填）。
- **验收**：
  1. 六个动词各有一个端到端测试。
  2. 降级验证：查一个索引里没有、但文本里有的字符串，管线自动 grep 命中并回填进 ContextPack，`snippets` 标注来源 producer=ripgrep。
  3. **Day-1 零税验证**（关键差异化指标）：全新仓库（空 store）第一个查询的墙钟时间与纯 `rg` 基线之差 < 200ms。

### Task 8 — codegraph 退役 + 清理 `[前置：Task 6 parity 通过]`
- **做什么**：解除 `@colbymchenry/codegraph` 的 MCP 绑定与安装脚本；删 agent-map 的旧扫描/缓存代码；删被打包三件套取代的 agent-map 重复实现。
- **验收**：
  1. 全量 typecheck + 现有测试套件全绿。
  2. `grep -rn "codegraph" openclaw_runtime/src` 无残留引用（除退役说明注释）。
  3. `.codegraph/` 不再被创建；无孤儿进程。

---

## 8. 分期与 opt-in 边界（防止过度设计）

| 期 | 内容 | 触发条件 |
|---|---|---|
| **T1（本文档全部）** | Producer + FactStore + 按需物化 + ContextPack + 图 View + grep 降级。**无 embedding。** | 立即做 |
| **T2** | 后台空闲补齐、热仓库预热、heat 驱逐调优 | T1 稳定后 |
| **T3（opt-in）** | LanceDB/embedding 语义层 `[语义 ragcode:src/semantic/]` | **仅长期重仓用户，明码标价（磁盘/算力/首次构建时长），用户点头才开** |

**T3 为什么默认关**：coding agent 已有图+FTS+grep 三重召回，embedding 是最贵最重、边际收益最低的一层。默认开它就回到了"强绑定、用户承担成本、自我感动"的老路。留成明确的付费升级项，不塞进默认体验。

---

## 9. 对外契约：六个意图动词（冻结）

门面只暴露意图级动词，不暴露 27 个工具级接口（那是对 LLM 的认知税）：

```ts
understand(query)   → ContextPack           // 理解 X    [get_context/get_project_brief]
locate(query)       → OwnerChain + symbols  // 真相在哪   [find_owner/find_symbol]
impact(target)      → BlastRadius + tests    // 改它炸到谁 [explain_impact/related_tests]
reuse(query)        → ReuseCandidates        // 有没有现成 [find_reuse_candidates]
verify(diff)        → ReviewReport           // 改得对不对 [review_diff+related_tests]
remember(fact)      → void                   // 记住决定   [ClawX 自有记忆，不用 ragcode memory]
```

所有动词返回都遵守 ContextPack 契约（证据+新鲜度+缺口+可动手判定）。**调用方永远不需要知道底下是图、FTS 还是 grep。**

---

## 10. 全局验收（Definition of Done）

整改完成的标志——**这五条同时成立**：

1. **能力不丢**：五语言符号/边解析、骨架打包、中文查询归一化、impact 分析全部可用且 ≥ 原 codegraph（Task 6 golden 对照为证）。
2. **无损耗融合**：热路径零跨进程往返（代码审查确认无 MCP/子进程调用在 query→pack 路径上）；一份 .sqlite 一个新鲜度时钟（无第二份图索引存在）。
3. **无选择风险**：不存在任何"要不要建索引/用 grep 还是 codegraph"的分支判断（`grep -rn` 确认无项目级路由代码）；所有仓库走同一管线。
4. **Day-1 零税**：空 store 首查 vs 纯 rg 墙钟差 < 200ms（Task 7 为证）；同 session 第 2+ 查询 token/延迟显著下降（打点曲线为证）。
5. **不留技术债**：三层边界清晰（Producer 不写库/View 不解析，代码审查为证）；codegraph 与 agent-map 旧代码已删净（Task 8 为证）；无 `SPEC-GAP` 悬而未决。

**最危险的失败模式不是慢，是"自信的错误答案"**（基于过期事实的回答）。所以 §4.1 的 provenance 列 + 内容哈希失效是第一优先级安全带，Task 2 必须先立住，任何 View 上线前都要能证明它不会返回 stale 事实。

---

## 附录 A：ragcode cp 清单速查（给执行模型）

**直接 cp（叶子器官，无框架纠缠）**：
```
src/indexing/analyzers/*          → producers/analyzers/   (整目录)
src/core/types.ts:1-127,382-436   → context-engine/types.ts (类型段)
src/context/skeletonizer.ts       → views/pack/
src/context/context-budget.ts     → views/pack/
src/context/expansion-policy.ts   → views/pack/
src/retrieval/query-context.ts    → views/retrieval/
src/retrieval/hybrid-retriever.ts → views/retrieval/  (删 semantic 分支)
src/retrieval/domain-lexicon.ts   → views/retrieval/
src/retrieval/graph-reranker.ts   → views/retrieval/
src/reuse/reuse-detector.ts       → views/
```

**复刻语义（按本地类型重写）**：
```
src/graph/sqlite-statements.ts    → factstore/statements.ts (+ provenance/heat 列)
src/graph/sqlite-graph-store.ts   → factstore/store.ts
src/core/freshness-gate.ts        → factstore/freshness.ts (哈希比对版)
src/graph/impact-report.ts        → views/impact/
src/graph/owner-ranking.ts        → views/owner/
src/subgraph/*                    → views/impact/
src/mcp/tools.ts (动词映射逻辑)    → context-engine/index.ts (只抄 handler 逻辑，不抄 MCP 传输)
```

**明确不碰**：
```
src/mcp/server.ts  src/cli/  src/web/  src/agents/  src/memory/  src/config/  src/semantic/(整个 embedding 层，T3 再议)
```

**从 ClawX 现有代码抄**：
```
runtime-core/agent-map.ts:44-80 的 ignore 名单/gen 后缀 → factstore/ignore.ts
```

## 附录 B：License

ragcode = MIT（`ragcode-main/LICENSE`）。cp 合法，在 `producers/analyzers/` 和 `views/pack/` 顶部保留 attribution 注释：`// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode`。
