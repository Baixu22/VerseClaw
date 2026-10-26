# 组件清单（当前源码投影）

> 本页把 `shared/dcs/component-disposition-catalog.ts` 的当前 disposition 记录按成熟度分组，便于查“还有哪些小组件、是否有用户入口、当前/目标模式是什么”。
>
> 这是**分类投影**，不是独立运行时验收。具体效果仍需 owner 的 production path、evidence、rollback 与 effective-state。

## 计数

| Disposition | Count |
|---|---:|
| default | 13 |
| advanced | 12 |
| internal | 24 |
| retired | 5 |

当前总数为 54。2026-10-25 的冻结验收候选曾记录 `components=53`；当前 catalog 为 54，说明新源码投影不等于旧候选验收。

## 阅读列

- **Current → target**：currentMode 是当前实现形态，targetDefaultMode 是组件处置目标。
- **User entry**：有用户入口才列入；“internal ONLY” 不是产品页面。
- **Owner**：声明 owner id，不等于当前会话/运行时已加载。
- **Node**：所属 implementation/retirement node。
- **Visibility**：user / internal / retired。

## Default：当前声明范围内的产品表面

| ID | Label | Current → target | Entry / visibility | Owner | Node |
|---|---|---|---|---|---|
| `component.working-memory-context` | Working-memory Workspace Context | `baseline` → `baseline` | model context in ordinary Chat / task workspaces / `user` | `working-memory-context-source` | `TF-0494` |
| `component.tool-registry-context` | Tool-registry Workspace Context | `baseline` → `baseline` | model tool context in ordinary Chat / task workspaces / `user` | `tool-registry-context-source` | `TF-0494` |
| `component.dcs-context-tools` | DCS fact views and context tools | `opt-in` → `baseline` | model context_read/search/understand tools in ordinary Chat / `user` | `dcs-fact-view-and-tools` | `TF-0495` |
| `component.role-memory` | Role-memory card governance | `opt-in` → `baseline` | /memory accepted and candidate review / `user` | `role-memory-card-governance` | `TF-0498` |
| `component.knowledge-review-authority` | Knowledge review authority | `mixed` → `baseline` | /knowledge review / `user` | `knowledge-review-authority` | `TF-0499` |
| `component.knowledge-retrieval-source` | Knowledge retrieval source | `mixed` → `baseline` | model knowledge context in ordinary Chat and Knowledge review / `user` | `knowledge-retrieval-source` | `TF-0499` |
| `component.skills-mcp-source-registry` | Skills and MCP source registry | `mixed` → `baseline` | Skills and Channels settings, model MCP tools / `user` | `skills-mcp-source-registry` | `TF-0502` |
| `component.tool-search-schema-expander` | Tool Search schema expander | `mixed` → `baseline` | model tool discovery and schema expansion / `user` | `tool-search-schema-expander` | `TF-0502` |
| `component.coding-execution-backend` | Coding execution backend | `mixed` → `baseline` | model tool, shell and file execution / `user` | `coding-execution-backend` | `TF-0510` |
| `component.permission-approval-authority` | Permission and approval authority | `mixed` → `baseline` | tool approvals and host action permission decisions / `user` | `permission-approval-authority` | `TF-0509` |
| `component.task-ledger` | Task Ledger | `mixed` → `baseline` | /task-ledger / `user` | `task-ledger` | `TF-0508` |
| `component.renderer-ui-surface` | Renderer UI surface | `mixed` → `baseline` | application shell and Settings / `user` | `renderer-ui-surface` | `TF-0505` |
| `feature.coding-recovery` | Coding write/recovery controls | `mixed` → `baseline` | model coding writes and auto verification / `user` | `coding-execution-backend` | `TF-0510` |

## Advanced：高级/受监督表面

| ID | Label | Current → target | Entry / visibility | Owner | Node |
|---|---|---|---|---|---|
| `component.browser-session-owner` | Browser session owner | `mixed` → `opt-in` | /browser / `user` | `browser-session-owner` | `TF-0503` |
| `feature.stale-write-guard` | Stale-write guard | `opt-in` → `opt-in` | advanced stale-file write protection / `user` | `coding-execution-backend` | `TF-0510` |
| `feature.worktree-isolation` | Worktree isolation | `opt-in` → `opt-in` | advanced multi-agent coding isolation / `user` | `coding-execution-backend` | `TF-0510` |
| `surface.inbox` | Inbox | `mixed` → `baseline` | /inbox / `user` | `renderer-ui-surface` | `TF-0505` |
| `surface.cron` | Cron and auto-approve | `mixed` → `opt-in` | /cron / `user` | `renderer-ui-surface` | `TF-0505` |
| `surface.remote-tasks` | Remote tasks | `mixed` → `baseline` | /remote-tasks / `user` | `renderer-ui-surface` | `TF-0505` |
| `surface.clawgraph` | ClawGraph | `mixed` → `baseline` | /clawgraph / `user` | `coding-execution-backend` | `TF-0505` |
| `surface.code-review` | Code review | `mixed` → `baseline` | /code-review / `user` | `renderer-ui-surface` | `TF-0505` |
| `surface.image-generation` | Image generation | `mixed` → `baseline` | /image-generation / `user` | `renderer-ui-surface` | `TF-0505` |
| `surface.observability` | Observability | `mixed` → `baseline` | /observability / `user` | `observability-recorder` | `TF-0511` |
| `settings.developer-advanced` | Developer Settings advanced controls | `mixed` → `opt-in` | Settings > Developer / `user` | `renderer-ui-surface` | `TF-0505` |
| `settings.billing` | Billing Settings | `mixed` → `baseline` | Settings > Billing / `user` | `renderer-ui-surface` | `TF-0505` |

## Internal：内部实现或诊断

| ID | Label | Current → target | Entry / visibility | Owner | Node |
|---|---|---|---|---|---|
| `component.context-runtime-kit` | Context Runtime Kit | `baseline` → `internal` | internal ONLY / `internal` | `context-runtime-kit` | `TF-0493` |
| `component.dcs-context-authority` | DCS context authority | `baseline` → `internal` | internal ONLY / `internal` | `dcs-context-authority` | `TF-0493` |
| `component.dcs-assembler-adapter` | DCS Assembler compatibility adapter | `baseline` → `internal` | internal ONLY / `internal` | `dcs-assembler-compat-adapter` | `TF-0493` |
| `component.provider-request-guard` | Provider request guard | `baseline` → `internal` | internal ONLY / `internal` | `provider-request-guard` | `TF-0493` |
| `component.context-enhancement-gate` | Context enhancement gate | `baseline` → `internal` | internal ONLY / `internal` | `context-enhancement-gate` | `TF-0493` |
| `component.vtoken-bridge` | VToken internal host bridge | `opt-in` → `internal` | internal ONLY / `internal` | `TF-0496` | `TF-0496` |
| `component.compass-context` | COMPASS context source | `opt-in` → `internal` | internal ONLY / `internal` | `TF-0511` | `TF-0511` |
| `component.c6-context-ladder` | C6 context ladder source (internal API) | `opt-in` → `internal` | internal ONLY / `internal` | `TF-0493` | `TF-0493` |
| `component.native-file-memory-retrieval` | Native file memory retrieval | `baseline` → `read-only` | internal ONLY / `internal` | `native-file-memory-retrieval` | `TF-0497` |
| `component.runtime-memory-store` | Runtime Memory store | `opt-in` → `internal` | internal ONLY / `internal` | `runtime-memory-store` | `TF-0497` |
| `component.memory-candidate-queue` | Memory candidate queue | `opt-in` → `internal` | internal ONLY / `internal` | `memory-candidate-queue` | `TF-0497` |
| `component.dreaming-derived-cache` | Dreaming derived cache | `baseline` → `internal` | internal ONLY / `internal` | `dreaming-derived-cache` | `TF-0497` |
| `component.memory-embedding-provider` | Memory embedding provider | `opt-in` → `internal` | internal ONLY / `internal` | `memory-embedding-provider` | `TF-0497` |
| `component.sekb-candidate-provider` | Knowledge engineering-principle adapter | `mixed` → `internal` | internal ONLY / `internal` | `TF-0499` | `TF-0499` |
| `component.v3-capability-catalog` | V3 capability catalog | `shadow` → `internal` | internal ONLY / `internal` | `v3-capability-catalog` | `TF-0501` |
| `component.verseshell-execution-adapter` | VerseShell execution adapter | `opt-in` → `internal` | internal ONLY / `internal` | `verseshell-execution-adapter` | `TF-0504` |
| `component.browser-task-projection` | Browser task projection owner | `mixed` → `internal` | internal ONLY / `internal` | `browser-task-projection-owner` | `TF-0503` |
| `component.observability-recorder` | Observability recorder | `mixed` → `internal` | internal ONLY / `internal` | `observability-recorder` | `TF-0504` |
| `component.routing-memo-observation` | Routing Memo observation | `mixed` → `internal` | internal ONLY / `internal` | `TF-0511` | `TF-0511` |
| `component.host-api-transport-owner` | Host API transport owner | `baseline` → `internal` | internal ONLY / `internal` | `host-api-transport-owner` | `TF-0508` |
| `component.retired-surface-registry` | Retired surface registry | `baseline` → `retired` | internal ONLY / `internal` | `retired-surface-registry` | `TF-0505` |
| `feature.agent-map` | AgentMap | `opt-in` → `internal` | internal ONLY / `internal` | `TF-0511` | `TF-0511` |
| `feature.runtime-shadow-governance` | Runtime shadow/governance leaves | `mixed` → `internal` | internal ONLY / `internal` | `TF-0511` | `TF-0511` |
| `feature.local-control-plane` | Local control-plane reports | `mixed` → `internal` | internal ONLY / `internal` | `observability-recorder` | `TF-0511` |

## Retired：退役与回滚来源

| ID | Label | Current → target | Entry / visibility | Owner | Node |
|---|---|---|---|---|---|
| `component.vtoken-context` | VToken context source | `retired` → `retired` | retired ONLY / `retired` | `TF-0496` | `TF-0496` |
| `feature.symbol-lease` | Symbol lease | `retired` → `retired` | retired ONLY / `retired` | `TF-0510` | `TF-0510` |
| `feature.patch-flow` | Patch flow | `retired` → `retired` | retired ONLY / `retired` | `TF-0510` | `TF-0510` |
| `surface.dreams` | Dreams page | `baseline` → `retired` | retired ONLY / `retired` | `renderer-ui-surface` | `TF-0500` |
| `surface.ui-v2-showcase` | UI v2 showcase | `baseline` → `retired` | retired ONLY / `retired` | `renderer-ui-surface` | `TF-0505` |

## 用这张表判断问题

- 想在 UI 找人脸/入口：先查 User entry，不要从 runtime source 反推页面。
- 想判断默认开关：回到 `docs/dev/default-config-matrix.md`；本表只表达 disposition。
- 想判断真实模型可见性：还要看 `ModelCapabilityProfile/v1` 的 current run facts。
- 想判断工具可执行性：还要看 driver capability、permission/approval、effective state 和真实 effect receipt。
- 想判断产品成熟度：还要看 owner node 的 production-call、e2e、effective-state、permission-negative、canary、rollback 和 benefit/necessity evidence。

## 当前容易误读的组

### Workspace Context

`working-memory-context` 和 `tool-registry-context` 是 default，但它们是同一个 Settings > General 用户概念的内部来源。不要把它们写成两个用户开关。

### Context tools

`dcs-context-tools` 是 default disposition；自动发现仍依赖 workspace、FactService、permission 与 runtime health，env 仅作为 rollback override。

### Memory

Role/Runtime/candidate/embedding/Dreaming 是多个内部数据域，用户面仍只有一个 `/memory`。本表的多行不是多个用户记忆。

### Verse tools

VerseGit、VerseShell、VerseBrowser 的 host contract 行与 driver action 行不是同一层。尤其 VB 的 81 contract methods、67 driver methods、28 model actions、14 desktop advertised actions 必须成组阅读。

### Retired surfaces

`feature.symbol-lease`、`feature.patch-flow`、`component.vtoken-context`、`surface.dreams` 和 `surface.ui-v2-showcase` 已退役。看到源码/兼容形状不代表可重新当产品能力使用。

## 相关权威

- [组件处置矩阵](../dev/component-disposition-matrix-20261021.md)
- [默认配置矩阵](../dev/default-config-matrix.md)
- [产品语义](../clawx-product-semantics.md)
- [Component Authority Manifest](../../shared/component-authority-manifest.ts)
- [Component Disposition source](../../shared/dcs/component-disposition-catalog.ts)
- [Module index](README.md)
