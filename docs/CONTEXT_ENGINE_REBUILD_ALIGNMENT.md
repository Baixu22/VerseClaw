# 对齐修正记录 (ALIGNMENT) — 施工前必读

> 本文件是 [CONTEXT_ENGINE_REBUILD_SPEC.md](./CONTEXT_ENGINE_REBUILD_SPEC.md) 的**现实校正层**。spec 写于摸清现有代码之前,有几个假设与 worktree 现状冲突。**冲突处以本文件为准。** 所有路径相对于 worktree 根 `ClawX-context-engine-rebuild/`,ragcode 出处仍相对于 `verseshell/ragcode-main/`。

## 校正 0:context-engine 不是空目录,是成熟 Provider 运行时

`openclaw_runtime/src/context-engine/` 已是一套 **Block / Provider / Assembler** 上下文注入系统。施工不是起骨架,是**在既有 registry 上挂新 Provider + 立 FactStore 做数据底座**。

**冻结的既有契约(不可改,必须适配)**:
- `runtime-core/registries.ts:124-198` —— `RuntimeContextProviderManifest`(含 `capabilities: string[]`、`dependsOnIndexing: boolean`、`shadowOnly: boolean`、`enabledByDefault: boolean`、`priority`/`order`)、`RuntimeContextProvider`(`getContext(query, extras)`)、`RuntimeContextProviderQuery`(`activeFiles`/`goal`/`tokenBudget`/`workspace`)、`RuntimeContextProviderResult`(`contextItems`/`diagnostics`/`evidenceRefs`)。
- `context-engine/block.ts` —— `SourceSystem` 已含 `"codegraph"` 与 `"agent-map"`;`ContextBlock`/`BlockStoreApi`(`upsert`/`query`/`queryByEntity`/`invalidate`/`stats`)。
- `context-engine/provider-registry.ts` —— provider 用 `create*Provider(): RuntimeContextProvider` 工厂 + manifest 模式注册。

## 校正 1:已有两个"影子 View 半成品",spec Task 5 是改造不是新建

- `context-engine/agent-map-context-provider.ts`(`AGENT_MAP_CONTEXT_PROVIDER_ID`,`shadowOnly:true`,`capabilities:["context.agent-map","context.symbol"]`)
- `context-engine/symbol-context-provider.ts`(`SYMBOL_CONTEXT_PROVIDER_ID`,`shadowOnly:true`,`capabilities:["context.symbol","symbol.overview","symbol.find","symbol.references"]`)

二者现为 `shadowOnly`(只发诊断证据,不进权威 prompt,`legacyAuthoritative` 仍是权威)。**spec 说的"agent-map 变 View"在这里的准确含义**:给这两个 provider 接上 FactStore 真实数据源,并规划从 `shadowOnly:true` → 权威的灰度路径(见校正 4)。数据源来自 `runtime-core/agent-map.ts`,spec Task 5 的"换血"对象就是它。

## 校正 2:codegraph 已 vendored 在仓库内,parity/退役都在本地

`extensions/codegraph/index.ts` 开头自述 "Vendored from @colbymchenry/codegraph v1.0.1 + AgentGraph extensions"。它是**仓库内 plugin**,暴露 `explore/search/callers/callees/impact`,已带 `freshnessMode: fast|balanced|strict`。

- spec Task 6 的 **parity 基线 = 这个 extension 的 explore/search/callers/callees/impact 输出**,不是外部 npm。
- spec Task 8 的"退役"= 解绑这个 extension 的 plugin 注册(`openclaw.plugin.json`),不是卸 npm 包。
- **它的 `freshnessMode` 三档语义可直接抄进 FactStore 新鲜度门**,比 ragcode 的 env 变量更贴合本仓库既有约定。

## 校正 3:FactStore 与既有 BlockStore 是两层,不可混淆

`block.ts` 的 `BlockStoreApi` 存的是**上下文块**(persona/knowledge/working_memory……面向 prompt 注入),**不是**代码事实。spec 的 FactStore 存的是 **code facts**(symbols/edges/chunks + provenance/heat)。二者**分立**:
- FactStore = 新建,`context-engine/factstore/`,SQLite,§4 schema。代码事实的唯一真相源。
- BlockStore = 既有,不动。上下文块的存储。
- **连接点**:View(Provider)从 FactStore 读事实 → 产出 `ContextItem[]` / 必要时 upsert 成 `knowledge` Block。FactStore 不感知 Block,BlockStore 不感知 code fact。

## 校正 4:"六个意图动词"= capability 字符串,不是新门面

spec §9 的门面与现实冲突。现实路由机制是 `manifest.capabilities: string[]` + provider registry。**六动词落地为 capability 命名**,由 registry 按 capability 解析,不新建门面类:

| spec 动词 | 落地为 capability | 承载 provider |
|---|---|---|
| understand | `context.understand` | 新建 context-pack provider |
| locate | `context.locate` / 复用 `context.symbol` | symbol-context-provider(接 FactStore) |
| impact | `context.impact` | 新建 impact provider(达 codegraph parity) |
| reuse | `context.reuse` | 新建 reuse provider |
| verify | `context.verify` | 新建 review-diff provider |
| remember | 既有 memory/Block 系统,**不新建** | 现有 |

## 校正 5:Task 顺序按现实重排

spec §7 的 Task 0"建三个空目录"作废。新起点:

- **Task A(补 spec 之前的地基摸底)**:精读 `runtime-core/agent-map.ts`(现有 AgentMap 实现 + ignore 名单)、`extensions/codegraph/index.ts` 全文(parity 基线 + freshnessMode)、`provider-registry.ts` 注册流程。产出:一页《接缝地图》,标明 FactStore 挂载点、两个影子 provider 的数据注入点、codegraph 能力清单。**先做,不写代码。**
- **Task B = spec Task 1**:Producer 层落地(cp ragcode `analyzers/` 整目录 + ripgrep producer)。独立可测,与运行时解耦。
- **Task C = spec Task 2**:FactStore 落地(`context-engine/factstore/`,§4 schema + provenance/heat)。**先证明 verseshell `db.sqlite_query` 能直读(中立膜)。**
- **Task D = spec Task 3**:按需物化闭环 + parse-on-touch。
- **Task E = spec Task 4**:ContextPack provider(cp 打包三件套 + 检索归一化),注册为 `context.understand`,先 `shadowOnly:true`。
- **Task F = spec Task 5(改造)**:agent-map/symbol 两个影子 provider 接 FactStore 真实数据。保持接口与现有单测兼容。
- **Task G = spec Task 6**:impact provider 达 codegraph parity(基线 = vendored extension 输出)。
- **Task H = spec Task 7**:capability 路由打通 + grep 降级 + Day-1 零税验证。
- **Task I = spec Task 8**:codegraph extension 灰度解绑 + 影子 provider 转权威 + 清理。

## 校正 6:灰度纪律(防止"自信的错误答案")

现有系统用 `shadowOnly` + `legacyAuthoritative` 做安全灰度——**这是本仓库已验证的模式,必须沿用,不可绕过**:
- 每个新 View provider **首次注册一律 `shadowOnly:true`**,只发诊断/证据,不进权威 prompt。
- 用 `diagnostics` 对比新 provider 输出 vs 现有 codegraph/legacy 输出(shadow 比对),数据达标后才翻 `shadowOnly:false` + `enabledByDefault:true`。
- FactStore 的 provenance(§4.1)是翻权威开关的前置证据:**不能证明"这条事实的 produced_hash == 当前 content_hash"的 View,不许转权威**。

---

**一句话**:spec 的架构理念(索引即缓存、Producer/FactStore/View 三层、证据+缺口契约)全部成立且照做;但**落地形态是"在既有 Provider registry 上挂 shadow→权威灰度的新 provider + 新建 FactStore 数据底座",不是另起门面**。现有的 shadow provider 机制恰好是 spec 灵魂("诚实声明、先证据后动手")的现成载体。
