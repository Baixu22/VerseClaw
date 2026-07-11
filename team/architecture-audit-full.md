# ClawX 全量架构审计报告（完整版）

> 基于 codegraph 全量扫描（11,381 文件 / 254,192 节点 / 841,006 边）+ 目录结构 + 调用关系分析
> 生成时间：2026-07-09，索引已 sync 增量同步至最新
> 范围：整个 Runtime + 知识沉淀/知识库 + 多 Agent 协作 + Loop 功能 + Git 管理 + 三层架构

---

## 0. 项目身份与全局视图

### 0.1 项目身份
- **项目名**：Verse Claw（GUI）+ OpenClaw Runtime（AI 引擎）
- **类型**：单开发者桌面应用，用于学习 agent-runtime 架构设计。非商业产品，无第三方用户数据
- **Stack**：Electron + React 19 + Vite + TypeScript。pnpm@10.33.4
- **持久化**：electron-store（JSON）+ OS keychain + SQLite（runtime 内部，含 Kysely schema）

### 0.2 三层硬边界架构
```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (src/, React 19)                                  │
│  HashRouter pages + zustand stores + components             │
│  唯一后端入口: src/lib/host-api.ts + host-api-client.ts     │
└───────────────────────IPC───────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Main Process (electron/)                                   │
│  60+ service + gateway manager + 30+ utils                  │
│  IPC 注册: registerIpcHandlers → 17 个子注册器              │
└───────────────────────WS/HTTP───────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw Runtime (openclaw_runtime/, port 18789)           │
│  GatewayServer + agents + runtime-core + 100+ extensions    │
│  入口: entry.ts → startGatewayServer                        │
└─────────────────────────────────────────────────────────────┘
```

### 0.3 索引统计概览

| 维度 | 数量 |
|------|------|
| 文件总数 | 11,381 |
| 节点总数 | 254,192 |
| 边总数 | 841,006 |
| 函数 | 69,067 |
| 属性 | 68,912 |
| import | 47,543 |
| 常量 | 22,174 |
| type_alias | 20,505 |
| method | 10,342 |
| interface | 1,560 |
| class | 765 |
| route | 82 |
| component | 54 |
| enum | 7 |
| DB 大小 | 663.5 MB |

---

## 1. Renderer 层（src/）

### 1.1 入口与路由
- 应用入口：`src/main.tsx` → `src/App.tsx`
- 路由：HashRouter，82 个 route 节点
- i18n：`src/i18n/index.ts` 加载 shared/i18n/locales

### 1.2 Pages（22 个顶级页面）

| Page | 路径 | 功能 |
|------|------|------|
| Chat | `src/pages/Chat/index.tsx` | 主聊天页（含 19 个子模块：ChatInput/ChatMessage/ChatToolbar/CompactionArtifactViewer/ExecutionGraphCard/RollbackPlanPanel/TeamOrchestrationCard 等） |
| Agents | `src/pages/Agents/index.tsx` | Agent CRUD + 角色配置 |
| Knowledge | `src/pages/Knowledge/index.tsx` | 知识库管理 |
| Skills | `src/pages/Skills/index.tsx` | 技能管理 |
| Models | `src/pages/Models/index.tsx` | 模型管理 + usage-history |
| Channels | `src/pages/Channels/index.tsx` | 渠道配置 |
| Settings | `src/pages/Settings/index.tsx` | 设置（含 StorageCleanerSection） |
| Observability | `src/pages/Observability/index.tsx` | 可观测性（AgentTraceGraph/TraceNodeDrawer/TraceWaterfall） |
| TaskLedger | `src/pages/TaskLedger/index.tsx` | 任务账本 |
| Cron | `src/pages/Cron/index.tsx` | 定时任务 |
| ClawGraph | `src/pages/ClawGraph/index.tsx` | 代码图谱可视化 |
| CodeReview | `src/pages/CodeReview/index.tsx` | 代码审查 |
| ImageGeneration | `src/pages/ImageGeneration/index.tsx` | 图像生成 |
| Dreams | `src/pages/Dreams/index.tsx` | 梦境模式 |
| RemoteTasks | `src/pages/RemoteTasks/index.tsx` | 远程任务 |
| Billing | `src/pages/Billing/index.tsx` | 计费 |
| Setup | `src/pages/Setup/index.tsx` | 初始化向导 |

### 1.3 Stores（zustand，20+ 顶级 store）

**chat store**（最复杂，22 个子模块）：
- `chat/store-api.ts` — 统一 API 出口
- `chat/helpers.ts` / `internal.ts` / `types.ts` — 内部基础
- `chat/session-actions.ts` / `session-selection.ts` / `session-history-actions.ts` — 会话生命周期
- `chat/runtime-actions.ts` / `runtime-event-actions.ts` / `runtime-event-handlers.ts` / `runtime-send-actions.ts` / `runtime-ui-actions.ts` / `runtime-graph.ts` — Runtime 交互
- `chat/history-actions.ts` / `history-rpc-params.ts` / `history-startup-retry.ts` / `history-transcript-fallback.ts` / `history-transcript-hydrate.ts` / `history-transcript-merge.ts` — 历史记录
- `chat/turn-ledger-recorder.ts` — Turn 账本
- `chat/cron-session-utils.ts` — 定时会话
- `chat/session-label-hydration.ts` — 标签水合

**其他 stores**：agents / channels / cron / gateway / mcp / observability / providers / settings / skills / skill-packs / workspaces / artifact-panel / resource-tracker / storage-health / baseline-cache

### 1.4 Lib（后端交互单一入口，35+ 模块）

**核心契约层**：
- `src/lib/host-api.ts` — **唯一后端入口**（硬规则：禁止直接 ipcRenderer.invoke）
- `src/lib/host-api-client.ts` — 强类型客户端（`invokeHost<M,A>`）
- `src/lib/host-events.ts` — 事件订阅

**Agent Dev 控制面**：`agent-dev.ts` / `capability-audit.ts` / `capability-orchestrator.ts` / `capability-publication-view-model.ts` / `capability-registry.ts` / `chat-capability-actions.ts`

**功能模块**：gateway-status / provider-accounts / providers / model-options / channel-alias / channel-status / knowledge-librarian / skill-files / quick-access-skills / task-ledger-plan-projection / orchestration-plan-edit-draft / role-visuals / image-generation / git-ui / telemetry / cron-session-history / workspace-session / workspace-tree / file-preview-client / generated-files / error-model / error-message

### 1.5 Components（15+ 子目录）

| 目录 | 内容 |
|------|------|
| `agents/` | RoleCard / RoleProfileEditor / RolesOrchestrationPanel / SubagentRunnerPanel / OrchestrationPlanView |
| `assistant-render/` | AssistantRender + 8 个子组件（GitHubCard/TurnSummaryCard/TurnWorkPanel/WorkContextBar/WorkHeatGraph/TokenUsageBadge/KnowledgeDirectiveChip） |
| `assistant-ui/` | attachment / dot-matrix / number-roll |
| `ai-elements/` | card / chain-of-thought / commit / file-tree / reasoning / shimmer / stack-trace / task / test-results / web-preview |
| `file-preview/` | 20+ 组件（ArtifactPanel/MonacoViewer/MonacoDiffViewer/PdfViewer/SheetViewer/OfficePreview/WorkspaceBrowserBody/WorkspaceGitPanel/WorkspaceTerminalPanel/WorkspaceWebPreviewPanel 等） |
| `layout/` | MainLayout / Sidebar / TitleBar / SessionFolderTree / SessionSearchModal / ArchiveModal |
| `settings/` | AgentDevWorkbenchPanel / ImageGenerationSettings / ProjectRulesCenter / ProvidersSettings |
| `task-ledger/` | TaskLedgerSummaryPanel / TaskNodeSelector |
| `tool-ui/` | agent-interactions / plan-view |
| `topics/` | TopicManager / TopicSelector |
| `channels/` | ChannelConfigModal |
| `chat/` | ChatAgentEffortPopover / ResourceChip / WorkModeSummaryPanel |
| `common/` | ErrorBoundary / FeedbackState / LoadingSpinner / StatusBadge |
| `brand/` | BrandLogo |
| `ui/` | shadcn 基础组件（badge/button/card/dialog/input/select 等 17 个） |

### 1.6 Extensions / Hooks
- `src/extensions/`：index / loader / registry / types / `_ext-bridge.generated.ts`
- `src/hooks/`：use-min-loading / use-pretext-measure / use-stick-to-bottom-instant / use-webgl-fire

---

## 2. Main Process 层（electron/）

### 2.1 启动入口
- `electron/main/index.ts` → `registerIpcHandlers`
- `electron/main/ipc-handlers.ts:111` — **17 个子注册器**：
  - `registerTypedHostHandlers` / `registerUnifiedRequestHandlers`
  - `registerGatewayHandlers` / `registerOpenClawHandlers` / `registerProviderHandlers`
  - `registerShellHandlers` / `registerDialogHandlers` / `registerAppHandlers`
  - `registerSettingsHandlers` / `registerUsageHandlers` / `registerCronHandlers`
  - `registerWindowHandlers` / `registerWhatsAppHandlers` / `registerFilePreviewHandlers`

### 2.2 Host API 注册机制
- `electron/main/ipc/host-invoke.ts:21` — `HostApiRegistry` class
- `registerExtensionContributions` (L34) — 扩展贡献注册
- `createHostInvokeDispatcher` (L88) / `registerHostInvokeHandler` (L131) / `toHostApiRegistry` (L79)
- `electron/main/ipc/host-contract.ts` — 契约定义

### 2.3 Services（60+ 模块）

**Agent / Runtime 相关**：agents-api / agent-browser-api/service/cli-runner / agent-dev-api / chat-api / memory-api / roles-api / orchestration-presets-api / task-ledger-api/service

**渠道与通信**：channels-api / cron-api / remote-control-api / remote-tasks-api

**可观测性**（8 模块）：observability-api / observability-service / observability-adapter / observability-graph / observability-index / observability-issues / observability-redaction / observability-trajectory / observability-trajectory-index

**文件与工作区**：files-api / git-api / workspace-permissions / workspaces-api / workspace-runtime-sync

**Gateway 与 Runtime 控制**：gateway-api / openclaw-api / openclaw-doctor（在 utils）

**技能与扩展**：skills-api / skill-packs-api / local-skill-service / tool-provider-registry

**系统与权限**：permissions-api / permission-decision-audit / sandbox-api / workspace-permissions / system-api / settings-api / diagnostics-api / logs-api

**其他**：app-api / capabilities-api / clawgraph-api / code-review-api / dialog-api / media-api / mcp-api / office-tools-api / project-rules-api / providers-api / resource-leases / resource-tracker-api / resource-tracker / sessions-api / shell-api / terminal-api / terminal-session-manager / topics-api / usage-api / uv-api / web-preview-api / web-preview-inspector / web-preview-manager / window-api / work-providers-api

### 2.4 Gateway Manager（30+ 模块）

`electron/gateway/manager.ts:226` — `GatewayManager` class

**生命周期与状态**：lifecycle-controller / startup-orchestrator / startup-recovery / restart-controller / restart-governor / reload-policy / process-launcher / process-policy / supervisor / state / prelaunch-maintenance-cache / startup-stderr

**连接与协议**：client / ws-client / ws-trace / connection-monitor / protocol / rpc-backpressure / request-store / event-dispatch / chat-runtime-events

**配置与同步**：config-sync / config-sync-env / clawhub / skill-catalog / skill-installer / skills-symlink-cleanup / capability-monitor / agent-browser-bridge

### 2.5 Utils（55+ 模块）

**Agent 配置核心**：`agent-config.ts` — Agent CRUD + SOUL.md 编译/解析（核心业务）+ openclaw-cli/doctor/sdk/auth/proxy/workspace/image-generation/image-generation-runtime/control-ui

**配置与路径**：config / config-mutex / paths / env-path / context-window

**安全与沙箱**：secure-storage / sandbox-policy-resolver / sandbox-provider-detection / workspace-runtime-permissions

**会话与文件**：session-files / session-util / token-usage-core / token-usage

**Provider 与 OAuth**：provider-keys / provider-registry / browser-oauth / device-oauth / device-identity / minimax-oauth / openai-codex-oauth / wechat-login / whatsapp-login

**渠道与通信**：channel-alias / channel-config / channel-status / control-ui-device-pairing / remote-control

**其他**：clawx-harness-template / gateway-health / logger / officecli-path / plugin-install / prompt-cache-status / proxy / proxy-fetch / runtime-package-resolution / store / telemetry / uv-env / uv-setup / win-shell

### 2.6 Main 进程其他模块

- **main/**（17 模块）：app-state / index / ipc-handlers / launch-at-startup / main-window-focus / menu / process-instance-lock / provider-model-sync / proxy / quit-lifecycle / signal-quit / single-instance-lock / theme-icons / traffic-light-layout / tray / window / zoom-shortcuts
- **preload/**：`electron/preload/index.ts` — IPC bridge
- **extensions/**：loader / registry / types / `_ext-bridge.generated.ts` + `builtin/`（diagnostics / clawhub-marketplace / index）
- **shared/**：providers/registry + providers/types + pi-ai-model-cost

---

## 3. OpenClaw Runtime 层（openclaw_runtime/）

### 3.1 启动入口与 Packages

**入口**：`openclaw_runtime/src/entry.ts` → `startGatewayServer(port=18789)`

**Packages（17 个内部包，构成 Runtime 的内核）**：

| Package | 职责 |
|---------|------|
| `agent-core/` | Agent harness 核心：agent-loop / agent / llm / node / runtime-deps / validation + harness/compaction（branch-summarization/compaction/compression-artifact/compression-planner） + harness/env（kill-tree/nodejs） + harness/session（jsonl-repo/jsonl-storage/memory-repo/memory-storage） + harness/utils（shell-output/truncate） |
| `acp-core/` | ACP 协议：runtime（errors/session-identifiers/session-identity/types） + session/normalize-text/meta/record-shared/session-interaction-mode/session-lineage-meta |
| `gateway-client/` | Gateway 客户端：client / device-auth / event-loop-ready / readiness / timeouts |
| `gateway-protocol/` | Gateway 协议 schema（23 个 schema 文件）：agent / agents-models-skills / artifacts / channels / commands / config / cron / devices / environments / error-codes / exec-approvals / frames / logs-chat / nodes / plugin-approvals / plugins / primitives / protocol-schemas / push / secrets / sessions / snapshot / tasks / wizard |
| `llm-core/` | LLM 核心：utils/diagnostics + utils/event-stream + types + validation |
| `llm-runtime/` | LLM 运行时：api-registry / stream |
| `markdown-core/` | Markdown：chunk-text / code-spans / fences / frontmatter / ir / render-aware-chunking / render / tables |
| `media-core/` | 媒体：base64 / constants / content-length / file-name / inbound-path-policy / inline-image-data-url / lazy-import / media-source-url / mime / read-byte-stream-with-limit / read-response-with-limit |
| `media-generation-core/` | 媒体生成：capability-model-ref / catalog / model-ref / normalization / string |
| `media-understanding-common/` | 媒体理解：active-model / defaults / errors / format / openai-compatible-video / output-extract / provider-id / provider-supports / video |
| `memory-host-sdk/` | Memory host SDK（最大包）：host/（70+ 模块：embeddings 全套 + sqlite-vec + qmd + multimodal + openclaw-runtime 全套适配器） + engine-embeddings / engine-foundation / engine-qmd / engine-storage / engine / query / runtime-cli / runtime-core / runtime-files / runtime / secret / status |
| `model-catalog-core/` | 模型目录：configured-model-refs / model-catalog-normalize / model-catalog-refs / model-catalog-types / provider-id / provider-model-id-normalization |
| `net-policy/` | 网络策略：ip / ipv4 / redact-sensitive-url / url-userinfo |
| `normalization-core/` | 规范化：number-coercion / record-coerce / string-coerce / string-normalization |
| `plugin-package-contract/` | 插件包契约 |
| `plugin-sdk/` | 插件 SDK：browser-config / config-runtime / exec-approvals-runtime / gateway-method-runtime / outbound-media / plugin-entry / plugin-runtime / provider-auth-runtime / provider-auth / provider-entry / provider-http / provider-model-shared/types / provider-onboard / provider-stream-shared / provider-tools / provider-web-search-config-contract / provider-web-search / runtime-doctor / runtime-env / secret-input / security-runtime / testing / text-runtime / video-generation |
| `sdk/` | SDK：client / event-hub / normalize / transport / types |
| `speech-core/` | 语音：tts + api / runtime-api / speaker / voice-models |
| `terminal-core/` | 终端：ansi / decorative-emoji / display-string / health-style / links / note / osc-progress / palette / progress-line / prompt-select-styled / restore / safe-text / stream-writer / string / table / terminal-link / theme |
| `tool-call-repair/` | 工具调用修复：grammar / payload / promote / stream-normalizer |
| `web-content-core/` | Web 内容：index / provider-runtime-shared |

### 3.2 Gateway Server（90+ 模块）

**核心**：
- `server.impl.ts:472` — `GatewayServer` type
- `startGatewayServer` (L544) — 启动函数
- `server-live-state.ts` / `server-runtime-handles.ts` — 运行时状态

**HTTP/WS 层**：server-http / server-json / server-chat / server-cron / server-lanes / server-shared / server-utils / server-close / http-common / http-utils / ws-log / ws-logging / origin-check / net

**认证与安全**：auth / auth-resolve / startup-auth / credentials / device-auth / probe-auth / probe-target / probe / role-policy / method-scopes / security-path / origin-check

**Agent/Chat 处理**：agent-command / agent-list / agent-prompt / chat-abort / chat-sanitize / call.runtime / call / session-utils

**配置与重启**：config-diff / config-reload / restart-trace / boot / startup-tasks

**Hooks 与扩展**：hooks / hooks-mapping / hooks-policy / hooks.types / server/hooks

**OpenAI 兼容**：openai-http / models-http / mcp-http

**Node 集群**：node-catalog / node-registry

**Talk/Control UI**：talk-handoff / control-ui

**TLS**：server/tls

### 3.3 Gateway Server Methods（86 个 RPC 方法文件）

`openclaw_runtime/src/gateway/server-methods/` 是 Gateway 对外的 RPC 接口层，共 86 个方法文件：

**Agent / Orchestration（15 个）**：agent / agents / agents-config-mutations / agent-browser / agent-id-shared / agent-job / agent-timestamp / agent-wait-dedupe / role-orchestration-methods（含 `roles.list/get` / `teams.list` / `orchestrator.plan/run` / `task_loop.run/status` / `observability.reportTrace/traces` / `memory.*`）/ approval-shared / capabilities / nodes / nodes-pending / nodes-wake-state / nodes.helpers / nodes.handlers.invoke-result

**Chat / Session（15 个）**：chat / chat-reply-media / chat-transcript-inject / chat-webchat-media / sessions / sessions.runtime / session-active-runs / session-change-event / talk / talk-client / talk-session / talk-shared / send / record-shared

**Config / Models / Tools（15 个）**：config / config-write-flow / commands / commands-list-result / models / models-auth-status / models-list-result / optional-model-catalog / tools-catalog / tools-effective / tools-effective.runtime / tools-invoke / tools-invoke-mcp-fallback.test / plugin-approval / plugin-host-hooks

**Channel / Cron / Media（10 个）**：channels / cron / chat / native-hook-relay / push / voicewake / voicewake-routing / tts / web / artifacts

**System / Health / Doctor（10 个）**：system / health / diagnostics / doctor / doctor.memory-core-runtime / logs / update / restart / restart-request / security-verification-shadow

**Skill / Secret / Environment（8 个）**：skills / skills-upload / secrets / environments / devices / connect / local-control-plane / mission-control-methods

**Validation / Shared（5 个）**：validation / shared-types / base-hash / clawgraph-methods / tasks / wizard

### 3.4 Agents 子系统（90+ 模块）

#### 3.4.1 Role-First 核心
- `role-contract.ts` — RoleContract 类型 + 8 个内置角色（planner/architect/implementer/tester/reviewer/security-reviewer/docs-writer/skeptic）
- `role-registry.ts` — `buildRoleRegistry` / `resolveRoleContract`（解析顺序：BUILT_IN_ROLE_CONTRACTS → cfg.agents.roles[]）
- `role-router.ts:140` — `routeRole` / `resolveMode` / `scoreRole`（角色路由）
- `role-spawn.ts:224` — `spawnRoleSubagent` / `buildRoleSystemPrompt`（角色 → subagent 映射）
- `role-effort.ts` — effort → thinking 映射

#### 3.4.2 编排
- `orchestrator.ts` — multi-agent 编排核心
- `team-template.ts` / `team-template.types.ts` — 团队模板（`getTeamTemplate` / `resolveTeamTemplate` / `getTeamTemplateSnapshot` / `normalizeTeamTemplate`）

#### 3.4.3 Agent 生命周期
agent-command / agent-config / agent-scope / agent-settings / identity / identity-file / cli-runner / cli-session / cli-backends / cli-output / workspace-run / workspace / workspace-dir / session-dirs / session-slug / subagent-list / lanes / routing-memo / run-wait / timeout

#### 3.4.4 工具系统（80+ 工具）
- `agent-tools.ts` — 工具注册（含 `createMemoryQueryTool`）
- `tool-catalog.ts` / `tool-call-id.ts` / `tool-display.ts` / `tool-images.ts` / `tool-mutation.ts` / `tool-policy.ts` / `tool-search.ts` / `bash-tools.ts` / `channel-tools.ts` / `apply-patch.ts`

**工具子目录 `agents/tools/`（70+ 工具）**：
- **会话协作**：sessions-send-tool / sessions-send-tool.a2a / sessions-spawn-tool / sessions-yield-tool / sessions-list-tool / sessions-history-tool / sessions-access / sessions-helpers / sessions-resolution / sessions-announce-target / sessions-send-helpers / sessions-send-tokens / subagents-tool / agents-list-tool / message-tool / session-status-tool / session-status.runtime / transcripts-tool
- **任务/编排**：task-loop-tool / team-orchestrate-tool / mission-loop-tool / goal-tools / update-plan-tool / heartbeat-response-tool / agent-step / skill-workshop-tool
- **媒体生成**：image-generate-tool / image-generate-background / image-generate-tool.actions / image-tool / image-tool.helpers / music-generate-tool / music-generate-background / music-generate-tool.actions / video-generate-tool / video-generate-background / video-generate-tool.actions / media-generate-background-shared / media-generate-background.test-support / media-generate-tool-actions-shared / media-tool-shared / pdf-tool / pdf-tool.helpers / pdf-tool.model-config / pdf-tool.test-support / pdf-native-providers / tts-tool
- **Web**：web-fetch / web-fetch-utils / web-fetch-visibility / web-fetch.test-harness / web-guarded-fetch / web-search / web-search-citation-redirect / web-search-provider-common / web-search-provider-config / web-search-provider-credentials / web-shared / web-tool-runtime-context / web-tools
- **Agent Browser**：agent-browser-tool / agent-browser-automation-event
- **Cron**：cron-tool / cron-tool-canonicalize
- **Gateway**：gateway-tool / gateway / gateway-schema / embedded-gateway-stub / embedded-gateway-stub.runtime
- **Nodes**：nodes-tool / nodes-tool-commands / nodes-tool-media / nodes-utils
- **通用**：common / gateway / tool-runtime.helpers / manifest-capability-availability

#### 3.4.5 Prompt 与上下文
system-prompt / context / context-cache / defaults / fast-mode / code-mode / btw / owner-display

#### 3.4.6 MCP
mcp-transport / mcp-http / mcp-stdio / mcp-oauth

#### 3.4.7 模型与认证
model-auth / model-catalog / model-scan / models-config / auth-profiles / auth-health

#### 3.4.8 沙箱
- `sandbox/`（8 模块）：config / docker / hash / manage / prune / shared / ssh / types
- 顶级：sandbox / sandbox-paths / path-policy

#### 3.4.9 其他子目录
- `cli-runner/`：log
- `command/`：types
- `harness/`：errors / policy / types
- `runtime/`：index / proxy
- `schema/`：typebox
- `sessions/`（见 3.5）
- `tools/`：common / gateway / pdf-tool / tts-tool + AGENTS.md
- `utils/`：ansi / fs-watch / git / html / mime / paths / sleep

### 3.5 Agent Sessions 子系统（45 模块）

`openclaw_runtime/src/agents/sessions/` 是 Agent 会话的核心实现：

**会话运行时**：agent-session-runtime / agent-session-services / agent-session / index / sdk

**执行与配置**：exec / bash-executor / http-dispatcher / event-bus / defaults / diagnostics / settings-manager / session-manager / session-cwd / package-manager / resource-loader

**模型与提供商**：model-registry / model-resolver / provider-display-names / resolve-config-value

**Prompt 与消息**：system-prompt / prompt-templates / messages / slash-commands / keybindings

**认证**：auth-guidance / auth-storage

**其他**：extension-sdk / footer-data-provider / source-info / telemetry

#### 3.5.1 Compaction（压缩，3 模块）
`agents/sessions/compaction/`：
- `branch-summarization.ts` — 分支摘要
- `compaction.ts` — 压缩核心
- `index.ts` — 导出

#### 3.5.2 Sessions Extensions（7 模块）
`agents/sessions/extensions/`：
- `index.ts` / `loader.ts` / `runner.ts` / `wrapper.ts` / `types.ts`
- `policy-light-snapshotter.ts` — 轻量快照（含 git 操作，rollback 支持）
- `shadow-write-event-recorder.ts` — shadow 写入事件记录

#### 3.5.3 Sessions Tools（18 模块）
`agents/sessions/tools/`：
- bash-operations / bash / edit-diff / edit / find / grep / ls / read / write
- file-mutation-queue / output-accumulator / path-utils / private-temp-file / render-utils / tool-contracts / tool-definition-wrapper / truncate / limits / index

### 3.6 Agent Harness 子系统（21 模块）

`openclaw_runtime/src/agents/harness/`：
- **生命周期**：lifecycle / lifecycle-hook-helpers / registry / selection / errors / policy
- **Compaction 恢复**：compaction / compaction-recovery / prompt-compaction-hook-helpers
- **Hooks**：hook-context / hook-helpers / hook-history / native-hook-relay / lifecycle-hook-helpers
- **Runtime**：context-engine-lifecycle / runtime-plugin / native-hook-relay
- **其他**：agent-end-side-effects / builtin-openclaw / codex-app-server-extensions / result-classification / tool-result-middleware

### 3.7 Runtime-Core 子系统（86 模块）

#### 3.7.1 COMPASS Memory 系统（31 个 memory-* 文件）

**存储层**：
- `memory-store.ts:164` — `RuntimeMemoryStore` class
- `memory-persistence.ts` — SQLite 持久化
- `memory-observation-store.ts` — 观察索引

**写入与治理**：
- `memory-write-curation.ts` — 写入治理（AUDN：detectConflict + decideAUDN）
- `memory-governance.ts` — 治理规则
- `memory-event-log.ts` — 事件日志（SHA-256 哈希链 + REDACT）
- `memory-entity-extraction.ts` / `memory-entity-resolver.ts` — 实体抽取与解析
- `memory-extraction-prompt.ts` — 抽取提示

**检索层**：
- `memory-hybrid-retrieval.ts` — 混合检索（RRF 融合 + cross-encoder reranking）
- `memory-chained-retrieval.ts` — 链式检索
- `memory-bridge-discovery.ts` — 桥发现（multi-hop）
- `memory-weighted-traversal.ts` — 加权图遍历
- `memory-temporal-detector.ts` / `memory-temporal-policy.ts` — 时间感知（8 个时间桶 RRF Arm）
- `memory-profile-retrieval.ts` — 用户画像检索
- `memory-read-hydration-consumer.ts` / `memory-read-hydration-shadow.ts` — 读水合

**应用层集成**：
- `memory-pre-reply-injection.ts` — SSP + hybrid retrieval 注入（`computeMemoryExtraSystemPrompt`）
- `memory-runtime-integration.ts` — 运行时集成
- `memory-session-state.ts` — SSP（Session State Protocol）+ Goal evolution
- `memory-query-tool.ts` — `createMemoryQueryTool`（memory_query tool）
- `memory-self-edit-tools.ts` — 自编辑工具
- `memory-context.ts` / `memory-budget.ts` — 上下文与预算
- `memory-background-consolidation.ts` — 后台巩固
- `memory-runtime-config.ts` — 运行时配置（feature flags）

**质量与证据**：
- `memory-evidence-discipline.ts` — 证据纪律
- `memory-trace.ts` — 检索追踪
- `memory-agent-state-machine.ts` — Agent 状态机
- `memory-operator-inspection.ts` — 运维检查
- `memory-proposal-shadow.ts` — 提案 shadow
- `memory-embedding-provider.ts` — 嵌入提供者
- `memory-user-profile.ts` — 用户画像

#### 3.7.2 Agent Map 子系统（5 模块）
- `agent-map.ts` / `agent-map-cache.ts`
- 实验：`agent-map-prompt-assembly-experiment.ts` / `agent-map-prompt-candidate-controlled-cutover-pilot.ts` / `agent-map-prompt-candidate-runtime-shadow.ts` / `agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts`

#### 3.7.3 AST Edit Plan 子系统（7 模块）
- `ast-edit-plan.ts` / `ast-grep-edit-plan-adapter.ts` / `ast-patch-planner.ts`
- `ast-edit-plan-apply-gate-readiness.ts` / `ast-edit-plan-controlled-apply-pilot.ts` / `ast-edit-plan-evidence-verifier-readiness.ts`
- `ast-readonly-review-packet.ts`

#### 3.7.4 Event Log 子系统（7 模块）
- `event-log.ts` / `event-log-persistence.ts`
- `event-log-controlled-dual-read-resume-pilot.ts` / `event-log-limited-authority-cutover-pilot.ts` / `event-log-limited-authority-explicit-internal-wiring.ts` / `event-log-operator-inspection.ts` / `event-log-resume-cutover-readiness.ts`

#### 3.7.5 Evidence / Failure 子系统（11 模块）
- `evidence.ts` / `evidence-verifier.ts` / `evidence-verifier-code-task-gate-shadow.ts` / `evidence-verifier-collectors.ts`
- `grounding.ts` / `grounding-shadow-consumers.ts`
- `failure-evidence-envelope-summary.ts` / `failure-evidence-replay-contracts.ts` / `failure-intelligence-passive-shadow.ts` / `failure-replay-harness-core.ts` / `failure-task-outcome-scorecard.ts`
- `failure-tool-invocation-governance-advisory.ts` / `failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.ts` / `failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts` / `failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts`

#### 3.7.6 其他 Runtime-Core
- `checkpoint-serializer.ts` / `state-reducer.ts` / `events.ts`
- `registries.ts` / `registry.ts` / `symbols.ts` / `types.ts` / `index.ts`
- `capability-publications.ts`
- `database-cleanup-for-tests.ts`
- `resume-shadow.ts` / `shadow-safety-boundary.ts` / `verification-shadow-sampling.ts`
- `trace-context.ts` / `trace-context-store.ts`
- `task-loop-memory-shadow-diagnostics.ts`

### 3.8 Role Memory（独立 memory 系统，8 模块）

`openclaw_runtime/src/memory/` — 与 COMPASS 独立的另一套 memory 系统：
- `memory-store.ts` — Role Memory store（SQLite，`~/.openclaw/agents/<id>/role-memory.sqlite`）
- `memory-card.ts` — MemoryCard 类型
- `memory-extractor.ts` — 记忆抽取
- `memory-policy.ts` — 策略
- `gatekeeper.ts` — 守门人
- `context-pack.ts` — 上下文打包
- `root-memory-files.ts` — 根记忆文件
- `types.ts`

### 3.9 Context Engine 子系统（25 模块）

`openclaw_runtime/src/context-engine/` — Context Runtime 核心：

**CVK（Context Validation Kit）**（12 模块）：
- `cvk/codebase-index.ts` — 代码库索引
- `cvk/compiler.ts` — 编译器
- `cvk/engine.ts` — 引擎
- `cvk/eval-report.ts` — 评估报告
- `cvk/recovery-default.ts` / `cvk/recovery.ts` — 恢复（rollback: `legacy_transcript_replay`）
- `cvk/registration.ts` — 注册
- `cvk/resolver.ts` — 解析器
- `cvk/runtime-adapter.ts` — 运行时适配器
- `cvk/shadow-provider.ts` — shadow provider
- `cvk/tool-call-gate.ts` — 工具调用门控
- `cvk/views.ts` — 视图

**Registry**：
- `registry/context-item-registry.ts` / `registry/context-item-store.ts`

**Context Providers**：
- `agent-map-context-provider.ts` — Agent Map 提供者
- `chat-turn-memory-injection.ts` — Chat Turn 记忆注入
- `memory-context-provider.ts` — 记忆提供者
- `role-memory-context-provider.ts` — 角色记忆提供者
- `symbol-context-provider.ts` — 符号提供者
- `trace-context-provider.ts` — 追踪提供者
- `runtime-embedding-adapter.ts` — 嵌入适配器
- `register-memory-providers.ts` — 注册记忆提供者

**核心**：delegate / host-compat / init / legacy / legacy.registration / provider-registry / registry / shadow-flags / types

### 3.10 Knowledge / SEKB 子系统（10 模块）

`openclaw_runtime/src/knowledge/sekb/` — SEKB（Self-Evolving Knowledge Base，自演化知识库）：

- `knowledge-store.ts` — 知识存储（含 `SekbDatabase` / `SekbPrincipleRow` / `SekbRejectionRow` / `SekbTrajectoryRow` / `SekbErrorSignatureCacheRow` 类型）
- `retrieval-engine.ts` — 检索引擎
- `distillation-tool.ts` — 蒸馏工具
- `trajectory-capture.ts` — 轨迹捕获
- `error-signature.ts` — 错误签名
- `harness-integration.ts` — Harness 集成（`SekbTaskClassifier` / `SekbTaskClassification` / `SekbHarnessHookTarget`）
- `operator-report.ts` — 运维报告（`SekbOperatorReport` / `SekbOperatorReportOptions`）
- `types.ts` — 类型（含 `SEKB_L1_TOKEN_BUDGET = 2_000`）
- `index.ts` / `sekb.test.ts`

**State 层 SEKB 表**（`openclaw_runtime/src/state/`）：
- `openclaw-state-db.generated.d.ts` 含 `SekbPrinciples` / `SekbTrajectories` / `SekbDistillationRejections` / `SekbErrorSignatureCache` 接口

### 3.11 State 子系统（10 模块）

`openclaw_runtime/src/state/`：
- `openclaw-agent-db.ts` / `openclaw-agent-db.paths.ts` / `openclaw-agent-db.generated.d.ts` / `openclaw-agent-schema.generated.ts` / `openclaw-agent-schema.sql` — Agent DB
- `openclaw-state-db.ts` / `openclaw-state-db.paths.ts` / `openclaw-state-db.generated.d.ts` / `openclaw-state-schema.generated.ts` / `openclaw-state-schema.sql` — State DB（含 SEKB 表）
- `sqlite-schema-shape.test-support.ts` — 测试支持

### 3.12 Plugins 子系统（300+ 模块）

`openclaw_runtime/src/plugins/` 是 Runtime 最大的子系统，负责插件生命周期管理：

**核心**：plugin-registry / registry / registry-types / registry-lifecycle / registry-empty / active-runtime-registry / plugin-registry-contributions / plugin-registry-snapshot / plugin-registry-id-normalizer

**Loader**：loader / loader-cache-state / loader-channel-setup / loader-provenance / loader-records / loader.test-fixtures / loader.built-artifacts.test / module-export / native-module-require / package-entry-resolution / package-entrypoints

**Manifest**：manifest / manifest-types / manifest-registry / manifest-registry-installed / manifest-metadata-scan / manifest-contract-runtime / manifest-contract-eligibility / manifest-contribution-ids / manifest-command-aliases / manifest-command-aliases.runtime / manifest-model-id-normalization / manifest-model-suppression / manifest-owner-policy / manifest-tool-availability

**Install**：install / install.runtime / installs / install-paths / install-policy-context / install-source-info / install-overrides / install-channel-specs / install-security-scan / install-security-scan.runtime / install-security-scan.types / uninstall / update / git-install

**Bundled**：bundled-capability-runtime / bundled-channel-config-metadata / bundled-channel-runtime / bundled-compat / bundled-dir / bundled-load-path-aliases / bundled-manifest-contract-plugins / bundled-package-channel-metadata / bundled-plugin-metadata / bundled-plugin-roots / bundled-plugin-scan / bundled-source-overlays / bundled-sources / externalized-bundled-plugins

**Provider**：provider-runtime / provider-runtime.runtime / provider-discovery / provider-discovery.runtime / provider-auth-*（15+ 模块） / provider-catalog / provider-catalog-result / provider-catalog-unified-text / provider-config-context.types / provider-config-owner / provider-contract-public-artifacts / provider-external-auth.types / provider-hook-runtime / provider-install-catalog / provider-model-compat / provider-model-helpers / provider-model-primary / provider-oauth-flow / provider-openai-chatgpt-oauth / provider-openai-chatgpt-oauth-tls / provider-public-artifacts / provider-replay-helpers / provider-runtime-model.types / provider-self-hosted-setup / provider-thinking / provider-thinking.types / provider-validation / provider-wizard / providers / providers.runtime

**Channel**：channel-catalog-registry / channel-plugin-ids / channel-presence-policy / channel-registry-state.types / channel-validation / runtime-channel-state

**Hooks**：hooks / hooks.test-helpers / hook-types / hook-registry.types / hook-decision-types / hook-message.types / hook-before-agent-start.types / hook-before-tool-call-result / hook-agent-context / host-hooks / host-hook-attachments / host-hook-cleanup / host-hook-cleanup-timeout / host-hook-json / host-hook-runtime / host-hook-scheduled-turns / host-hook-state / host-hook-turn-types

**Memory**：memory-runtime / memory-state / memory-embedding-provider-runtime / memory-embedding-providers / embedding-provider-config / embedding-provider-runtime / embedding-provider-runtime-shared / embedding-provider-types / embedding-providers / openai-compatible-embedding-provider / migration-provider-runtime

**Interactive**：interactive / interactive-binding-helpers / interactive-registry / interactive-shared / interactive-state

**HTTP**：http-registry / http-route-overlap / http-path

**Compaction**：compaction-provider

**Runtime 子系统**：runtime/（30+ 模块）：channel-runtime-contexts / gateway-bindings / gateway-request-scope / index / load-context / metadata-registry-loader / model-auth-types / native-deps / runtime-agent / runtime-cache / runtime-channel / runtime-config / runtime-embedded-agent.runtime / runtime-events / runtime-llm.runtime / runtime-logging / runtime-media / runtime-model-auth.runtime / runtime-plugin-boundary / runtime-registry-loader / runtime-system / runtime-taskflow / runtime-taskflow.types / runtime-tasks / runtime-tasks.types / runtime-web-channel-plugin / standalone-runtime-registry-loader / task-domain-types / types-channel / types-core / types

### 3.13 其他 Runtime 子系统

#### ACP（Agent Communication Protocol，15 模块）
`openclaw_runtime/src/acp/`：server / client / client-helpers / commands / conversation-id / event-ledger / event-mapper / permission-relay / policy / secret-file / session-mapper / translator / types
- `runtime/`：errors / registry

#### Config 系统（50+ 模块）
`openclaw_runtime/src/config/`：
- 核心：config / schema / io / io.audit / io.meta / validation / materialize / merge-patch / paths / mutate / defaults
- 类型（25 个 types.*.ts）：types.agents / types.auth / types.base / types.browser / types.cli / types.cron / types.discord / types.gateway / types.hooks / types.irc / types.mcp / types.memory / types.models / types.msteams / types.plugins / types.queue / types.sandbox / types.secrets / types.signal / types.skills / types.slack / types.tools / types.tts / types.acp
- 辅助：schema-base / schema.help / schema.hints / schema.labels / schema.shared / schema.tags / zod-schema / legacy / legacy.shared / config-paths / port-defaults / byte-size / cache-utils / commands / env-preserve / env-vars / group-policy / includes / includes-scan / issue-format / logging / model-input / silent-reply / talk / talk-defaults / doc-baseline / version / agent-dirs / agent-limits / allowed-values / bindings / cron-limits
- `sessions/`：goals / group / paths / reset / store / types

#### Channels 子系统（20 模块）
`openclaw_runtime/src/channels/`：allow-from / chat-meta / chat-type / direct-dm / ids / location / logging / registry / reply-prefix / sender-label / session-meta / session / streaming / targets / typing
- `message/`：live / send
- `turn/`：kernel / types

#### Auto-Reply 子系统（15 模块）
`openclaw_runtime/src/auto-reply/`：chunk / dispatch / envelope / heartbeat / media-note / model / reply / status / templating / thinking / tokens / tool-meta / types
- `reply/`：body / exec

#### Cron 子系统（30+ 模块）
`openclaw_runtime/src/cron/`：
- 核心：service / store / command-runner / delivery / delivery-plan / schedule / schedule-number / stagger / session-reaper / session-target / normalize / parse / persisted-shape / retry-hint / run-diagnostics / run-id / run-log / run-log-jsonl / run-log-types / run-log / active-jobs / isolated-agent / webhook-url / types / types-shared
- `service/`：jobs / locked / ops / state / store / timer / wake
- `store/`：key / row-codec / schema / types

#### Daemon 子系统（30+ 模块）
`openclaw_runtime/src/daemon/`：跨平台 daemon（launchd / schtasks / systemd）
- service / launchd / launchd-plist / schtasks / schtasks-exec / systemd / systemd-hints / systemd-unit / diagnostics / paths / program-args / restart-logs / runtime-hints / runtime-parse / runtime-paths / service-audit / service-env / service-types / arg-split / cmd-argv / cmd-set / constants / exec-file / inspect / node-service / output

#### Hooks 子系统（20+ 模块）
`openclaw_runtime/src/hooks/`：hooks / config / configured / frontmatter / loader / module-loader / policy / install / installs / update / workspace / bundled-dir / import-url / internal-hooks / plugin-hooks / hooks-status / legacy-config / types
- `gmail.ts` / `gmail-ops.ts` / `gmail-watcher.ts` — Gmail 集成

#### Infra 子系统（80+ 模块）
`openclaw_runtime/src/infra/`：
- `net/`：fetch-guard / hostname / proxy-env / proxy-fetch / ssrf
- `outbound/`：abort / format / mirror
- `tls/`：fingerprint / gateway
- 顶级（80+ 模块）：abort-signal / agent-events / approval-types / archive / archive-path / backoff / binaries / boundary-path / brew / browser-open / clawhub / clawhub-spec / clipboard / dedupe / detect-binary / device-pairing / disk-space / dotenv / dotenv-global / embedded-mode / env / errors / exec-approvals / exec-host / exec-safety / fetch / fetch-headers / file-lock / file-store / fs-safe / gateway-lock / gemini-auth / git-commit / git-root / heartbeat-wake / home-dir / http-body / install-flow / install-target / is-main / json-file / json-files / jsonl-socket / kysely-sync / lru-cache / machine-name / map-size / node-commands / node-pairing / node-shell / node-sqlite / npm-integrity / openclaw-root / os-summary / package-json / package-tag / pairing-files / pairing-token / path-env / path-guards / path-prepend / path-safety / permissions / plain-object / ports / ports-inspect / ports-lsof / ports-probe / ports-types / prototype-keys / provider-usage / push-apns / push-web / regular-file / remote-env / replace-file / restart / restart.types / retry / retry-policy / root-paths / runtime-guard / runtime-status / scp-host / secret-file / secure-random / semver-compare / shell-env / sqlite-wal / ssh-config / ssh-tunnel / system-events / system-message / tailnet / tailscale / tcp-port / temp-download / update-check / update-global / update-runner / update-startup / voicewake / warning-filter / widearea-dns / ws / wsl

#### Observability 子系统（9 模块）
`openclaw_runtime/src/observability/`：trace-recorder / trace-buffer / metrics / scorecard / role-first-observer / decision-quality-auditor / deprecation-counters / namespace-governance / types

#### Commitments 子系统（7 模块）
`openclaw_runtime/src/commitments/`：
- `config.ts` — 配置
- `extraction.ts` — 提取
- `model-selection.runtime.ts` — 模型选择
- `runtime.ts` — 运行时
- `store-writer.ts` — 存储写入
- `store.ts` — 存储
- `types.ts` — 类型

#### 其他
- `bindings/records.ts` — 绑定记录
- `chat/`：canvas-render / tool-content — Chat 渲染
- `cli/`：cli-utils / help-format / parse-duration / progress — CLI 工具
- `compat/legacy-names.ts` — 兼容性
- `interactive/payload.ts` — 交互载荷
- 顶级文件：entry.compile-cache / entry / extensionAPI / global-state / globals / index / library

### 3.14 Extensions（100+ 扩展）

`openclaw_runtime/extensions/` 是 Runtime 的扩展生态：

#### LLM Providers（40+）
anthropic / openai / google / deepseek / qwen / moonshot / minimax / openrouter / groq / cerebras / mistral / arcee / byteplus / chutes / clickclack / copilot / copilot-proxy / deepinfra / exa / fal / fireworks / gmi / gradium / huggingface / kilocode / kimi-coding / litellm / lmstudio / lobster / novita / nvidia / opencode / opencode-go / parallel / perplexity / pixverse / qianfan / runway / sglang / github-copilot / amazon-bedrock / alibaba / brave / duckduckgo / searxng / firecrawl

#### Channels（15+）
discord / feishu / irc / line / matrix / mattermost / msteams / nextcloud-talk / nostr / qqbot / telegram / wechat / wecom / whatsapp / imessage / signal / slack / googlechat

#### TTS（8+）
azure-speech / deepgram / elevenlabs / gradium / inworld / microsoft / minimax / openai

#### Memory 扩展（4）
- `active-memory/`：index / openclaw.plugin.json / doctor-contract-api
- `memory-core/`（最大）：含 `src/memory/`（38 模块：embeddings / hybrid / manager-*（20+ 状态管理）/ mmr / provider-adapter-registration / provider-adapters / qmd-compat / qmd-manager / search-manager / temporal-decay / tokenize / watch-pressure / watch-settle） + dreaming 全套（dreaming-command / dreaming-dreams-file / dreaming-markdown / dreaming-narrative / dreaming-phases / dreaming-repair / dreaming-shadow-trial / dreaming-shared / dreaming-state / dreaming） + rem-evidence / rem-harness + tools（citations / runtime / shared） + flush-plan / memory-budget / prompt-section / public-artifacts / session-search-visibility / short-term-promotion / runtime-provider / concept-vocabulary / time
- `memory-lancedb/`：api
- `memory-wiki/`（最大知识库扩展）：含 `src/`（30 模块：apply / bridge / chatgpt-import / claim-health / cli / compile / config-compat / config / corpus-supplement / gateway / import-insights / import-runs-state / import-runs / ingest / lint / log / markdown / memory-palace / obsidian / prompt-section / query / source-page-shared / source-path-shared / source-sync-state / source-sync / status / time / tool / unsafe-local / vault） + skills（obsidian-vault-maintainer / wiki-maintainer） + api / contract-api / doctor-contract-api / setup-api / cli-metadata / openclaw.plugin.json

#### 工具/能力扩展（30+）
browser / canvas / codegraph / codex / copilot / diffs / file-transfer / github-copilot / google-meet / llm-task / oc-path / openshell / phone-control / policy / qa-channel / qa-lab / qa-matrix / senseaudio / acpx / alibaba / amazon-bedrock / brave / comfy / migrate-claude / migrate-hermes / open-prose / parallel / lobster / clickclack / arcee

#### 设备与配对
bonjour / device-pair

---

## 4. Shared 层（shared/）

### 4.1 Host API 契约（单一真相源）
- `shared/host-api/contract.ts` — ~110KB，所有 host-api 模块的契约定义
- `shared/host-api/types.ts` / `agent-dev-schemas.ts`
- `shared/host-events/contract.ts` — 事件契约

### 4.2 Types（30+ 类型文件）
agent / channel / clawgraph / code-review / context-family / context-item / context-runtime-kit / cron / evidence / gateway / git / long-task-control / mcp / memory / mission-control / observability / remote-tasks / resource-tracker / role-identity / runtime-tool-shadow / sandbox / skill / task-ledger-reference / task-ledger / team / work-artifact / work-mode / work-provider / workspace

### 4.3 Agent Dev 控制面
- `shared/agent-dev/scenarios.ts` — 单一 scenario registry
- `shared/agent-dev/scenario-composer.ts` — `?devScenario=a+b` 组合
- `shared/agent-dev/trace-contract.ts`

### 4.4 Chat Runtime Events
- `shared/chat-runtime-events.ts`
- `shared/chat/types.ts`

### 4.5 Knowledge
- `shared/knowledge/error-experience.ts` / `quality-metrics.ts`

### 4.6 语义与边界
- `product-semantics.ts` / `product-semantic-unsafe-claims.ts` / `sensitive-content-boundary.ts` / `reliability-boundaries.ts` / `capability-claims.ts`

### 4.7 其他
- `language.ts` / `sidebar-layout.ts` / `cron-browser-automation.ts`

### 4.8 i18n（4 语言 × 17 namespace = 68 文件）
- **语言**：en / zh / ja / ru
- **namespace**：agents / channels / chat / clawGraph / codeReview / common / cron / dashboard / dreams / knowledge / menu / observability / remoteTasks / settings / setup / skills / taskLedger
- `shared/i18n/resources.ts`

---

## 5. 关键集成点与调用关系

### 5.1 IPC 调用链（Renderer → Main）
```
src/lib/host-api.ts (Renderer 唯一入口)
  → ipcRenderer.invoke(channel, action, ...args)
  → electron/preload/index.ts (bridge)
  → electron/main/ipc-handlers.ts:111 registerIpcHandlers
    → 17 个 register*Handlers
    → 对应 electron/services/*-api.ts 模块
```

### 5.2 Gateway 调用链（Main → Runtime）
```
electron/services/gateway-api.ts
  → electron/gateway/manager.ts:226 GatewayManager
  → electron/gateway/client.ts (WS/HTTP)
  → openclaw_runtime/src/gateway/server.impl.ts:544 startGatewayServer
  → GatewayServer (port 18789)
```

### 5.3 Chat 回复调用链
```
src/pages/Chat/index.tsx
  → src/stores/chat/runtime-send-actions.ts
  → src/lib/host-api.ts → chat-api.ts
  → gateway-api.ts → GatewayManager
  → Runtime server-chat.ts
  → agents/agent-command.ts → runPreparedReply
  → runtime-core/memory-pre-reply-injection.ts (COMPASS 注入，main-only scope)
  → llm/stream.ts → LLM Provider
```

### 5.4 Multi-Agent 编排调用链
```
src/components/agents/RolesOrchestrationPanel.tsx
  → src/lib/host-api.ts → roles-api.ts → gateway-api.ts
  → Runtime gateway/server-methods/role-orchestration-methods.ts
  → agents/role-router.ts:140 routeRole (角色路由)
  → agents/role-spawn.ts:224 spawnRoleSubagent
    → compileRoleContractToSoul (角色契约 → SOUL)
    → resolveRoleMemoryCards (Role Memory，非 COMPASS)
    → buildContextPack → buildRoleSystemPrompt
    → ctx.inheritedToolAllowlist (硬白名单)
  → agents/orchestrator.ts (编排执行)
```

### 5.5 COMPASS Memory 调用链
```
runPreparedReply (main session)
  → runtime-core/memory-pre-reply-injection.ts
    → computeMemoryExtraSystemPrompt (唯一注入缝，callers=1)
    → loadCompassFacts
    → memory-hybrid-retrieval.ts (RRF + cross-encoder)
    → memory-store.ts:164 RuntimeMemoryStore

createMemoryQueryTool (memory_query tool)
  → loadCompassFacts (显式调用)
  → 注册于 agents/agent-tools.ts:805-809 base[]
  → 但 role-first 硬白名单过滤掉未列出的工具
```

### 5.6 Role Memory 调用链
```
agents/role-spawn.ts
  → memory/memory-store.ts getMemoryCards (callers=16)
  → memory/context-pack.ts buildContextPack (callers=11)
  → 注入 subagent system prompt
```

### 5.7 Task Loop 调用链
```
role-orchestration-methods.ts:517 task_loop.run
  → agents/task-loop-controller.ts runTaskLoop
    → task-loop-context.ts buildTaskLoopContextPack
    → task-loop-self-check.ts runTaskLoopSelfCheck
    → task-loop-runtime-memory-read-hydration-shadow.ts (COMPASS read-hydration)
  → agents/tools/task-loop-tool.ts (工具入口)
```

### 5.8 Cron 调用链
```
src/pages/Cron/index.tsx
  → src/stores/cron.ts
  → src/lib/host-api.ts → cron-api.ts
  → gateway-api.ts → GatewayManager
  → Runtime gateway/server-methods/cron.ts
  → cron/service.ts → cron/schedule.ts → cron/delivery.ts
  → cron/service/（jobs/locked/ops/state/store/timer/wake）
```

### 5.9 扩展注册机制
```
electron/extensions/index.ts
  → loader.ts → registry.ts
  → extensions/builtin/ (diagnostics / clawhub-marketplace)
  → HostApiProviderExtension (通过 isHostApiProviderExtension 识别)
  → registerExtensionContributions (host-invoke.ts:34)

openclaw_runtime/extensions/*/index.ts
  → 100+ 扩展（LLM / Channels / TTS / Memory / Tools）
  → 通过 extensionAPI.ts 注册到 Runtime
  → plugins/ 子系统负责加载/管理
```

### 5.10 Git 管理调用链
```
# Main 侧
electron/services/git-api.ts:636 createGitApi
  → git() (L134) — 执行 git 命令
  → gitTextAt (L142) — 读取 ref 内容
  → gitChangeFromStatus (L225) — 解析 status
  → readCurrentGitStatus (L417) — 读取仓库状态

electron/services/code-review-api.ts:92 git() — 代码审查专用 git

# Renderer 侧
src/lib/git-ui.ts — Git UI 工具
src/components/file-preview/WorkspaceGitPanel.tsx — Git 面板
src/components/file-preview/MonacoDiffViewer.tsx — Diff 查看
src/components/assistant-render/GitHubCard.tsx — GitHub 卡片渲染

# Runtime 侧
openclaw_runtime/src/agents/utils/git.ts — Agent git 工具
openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter.ts:202 git() — 快照策略（含 rollback）
openclaw_runtime/src/infra/git-commit.ts — 提交工具
openclaw_runtime/src/infra/git-root.ts — 仓库根查找
openclaw_runtime/extensions/codegraph/dist/sync/git-hooks.js:84 gitHooksDir — CodeGraph git hooks
```

---

## 6. 功能域详细分类

### 6.1 知识沉淀与知识库

#### 6.1.1 SEKB（自演化知识库）
- **位置**：`openclaw_runtime/src/knowledge/sekb/`（10 模块）
- **数据库表**：`SekbPrinciples` / `SekbTrajectories` / `SekbDistillationRejections` / `SekbErrorSignatureCache`（位于 state DB）
- **核心能力**：
  - 知识蒸馏（distillation-tool.ts）
  - 轨迹捕获（trajectory-capture.ts）
  - 错误签名（error-signature.ts）
  - Harness 集成（harness-integration.ts，`SekbTaskClassifier` / `SekbHarnessHookTarget`）
  - 检索引擎（retrieval-engine.ts）
  - 运维报告（operator-report.ts）
- **Token 预算**：`SEKB_L1_TOKEN_BUDGET = 2_000`

#### 6.1.2 Memory 扩展（4 个）
- **active-memory**：轻量级 active memory 索引
- **memory-core**（最大，38+ 模块）：
  - 嵌入管理（embeddings + 20+ manager-* 状态管理）
  - 混合检索（hybrid + mmr + temporal-decay）
  - QMD 管理（qmd-compat / qmd-manager / qmd-query-parser）
  - Dreaming 系统（dreaming-* 10 模块，梦境模式知识巩固）
  - REM 系统（rem-evidence / rem-harness，快速眼动睡眠隐喻）
  - 短期提升（short-term-promotion）
  - 概念词汇（concept-vocabulary）
  - 工具（tools / tools.citations / tools.runtime / tools.shared）
- **memory-lancedb**：LanceDB 向量数据库适配
- **memory-wiki**（30+ 模块）：
  - Obsidian 集成（obsidian / vault / markdown）
  - Wiki 维护（wiki-maintainer skill）
  - Obsidian Vault 维护（obsidian-vault-maintainer skill）
  - 导入（chatgpt-import / import-insights / import-runs-state / import-runs / ingest / source-sync / source-sync-state）
  - 编译（compile / corpus-supplement）
  - 查询（query）
  - 声明健康（claim-health）
  - Memory Palace（memory-palace）
  - Lint（lint）
  - 应用（apply / bridge）

#### 6.1.3 Role Memory
- **位置**：`openclaw_runtime/src/memory/`（8 模块）
- **数据模型**：MemoryCard
- **存储**：SQLite，`~/.openclaw/agents/<id>/role-memory.sqlite`
- **消费方**：`getMemoryCards` 被 16 处消费，`buildContextPack` 被 11 处消费
- **与 COMPASS 关系**：独立，无映射、无迁移路径、无联合检索

#### 6.1.4 COMPASS Runtime Memory
- **位置**：`openclaw_runtime/src/runtime-core/memory-*.ts`（31 模块）
- **数据模型**：TemporalFact（时间事实）
- **存储**：SQLite，session-scoped
- **治理**：AUDN（detectConflict + decideAUDN，SUPERSEDE 优先，UPDATE 禁用）
- **检索**：Hybrid（RRF 融合 + cross-encoder reranking + 8 时间桶 RRF Arm）
- **应用层**：SSP + Page Fault + Post-reply 观测 + memory_query Tool + Flush 协同
- **消费方**：仅 main session（`computeMemoryExtraSystemPrompt` scope=main-only）

#### 6.1.5 Context Engine Context Providers
- **位置**：`openclaw_runtime/src/context-engine/`（25 模块）
- **Providers**：agent-map / chat-turn-memory / memory / role-memory / symbol / trace
- **CVK**（Context Validation Kit）：12 模块，含 recovery（rollback: `legacy_transcript_replay`）

#### 6.1.6 State DB 知识表
- **位置**：`openclaw_runtime/src/state/`
- **表**：SekbPrinciples / SekbTrajectories / SekbDistillationRejections / SekbErrorSignatureCache
- **schema**：`openclaw-state-schema.sql`

### 6.2 多 Agent 协作

#### 6.2.1 Role-First 编排
- **核心**：role-contract / role-registry / role-router / role-spawn / role-effort
- **8 内置角色**：planner / architect / implementer / tester / reviewer / security-reviewer / docs-writer / skeptic
- **3 编排模式**：通过 `resolveMode` 决定
- **硬白名单**：`ctx.inheritedToolAllowlist` 过滤未列出的工具
- **Team 模板**：team-template / team-template.types（`getTeamTemplate` / `resolveTeamTemplate` / `getTeamTemplateSnapshot` / `normalizeTeamTemplate`）

#### 6.2.2 Orchestrator
- **位置**：`openclaw_runtime/src/agents/orchestrator.ts`
- **入口**：`role-orchestration-methods.ts` 的 `orchestrator.plan` / `orchestrator.run`
- **状态解析**：`resolveOrchestratorRunStatus`（accepted / partial / error）

#### 6.2.3 ACP（Agent Communication Protocol）
- **位置**：`openclaw_runtime/src/acp/`（15 模块）+ `packages/acp-core/`
- **核心**：server / client / client-helpers / commands / conversation-id / event-ledger / event-mapper / permission-relay / policy / secret-file / session-mapper / translator / types
- **runtime/**：errors / registry

#### 6.2.4 Sessions 工具（多 Agent 协作工具集）
- **位置**：`openclaw_runtime/src/agents/tools/`
- **会话协作工具**：
  - `sessions-send-tool.ts` / `sessions-send-tool.a2a.ts` — 跨 agent 发送（A2A）
  - `sessions-spawn-tool.ts` — 生成子 agent
  - `sessions-yield-tool.ts` — 让出控制
  - `sessions-list-tool.ts` / `sessions-history-tool.ts` — 列表/历史
  - `subagents-tool.ts` — 子 agent 管理
  - `agents-list-tool.ts` — agent 列表
  - `message-tool.ts` — 消息工具
  - `session-status-tool.ts` / `session-status.runtime.ts` — 状态
  - `transcripts-tool.ts` — 转录
- **编排工具**：
  - `team-orchestrate-tool.ts` — 团队编排
  - `task-loop-tool.ts` — 任务循环
  - `mission-loop-tool.ts` — 使命循环
  - `goal-tools.ts` — 目标工具
  - `update-plan-tool.ts` — 更新计划
  - `heartbeat-response-tool.ts` — 心跳响应
  - `agent-step.ts` — agent 步进
  - `skill-workshop-tool.ts` — 技能工坊

#### 6.2.5 Compaction（会话压缩）
- **位置**：`openclaw_runtime/src/agents/sessions/compaction/`（3 模块）+ `packages/agent-core/src/harness/compaction/`（5 模块）+ `agents/harness/compaction.ts` + `compaction-recovery.ts`
- **核心**：branch-summarization / compaction / compression-artifact / compression-planner / utils
- **接口**：`CompactionResult` / `CompactionDetails` / `CompactionSettings`

#### 6.2.6 Sessions Extensions
- **位置**：`openclaw_runtime/src/agents/sessions/extensions/`（7 模块）
- **核心**：loader / runner / wrapper / types
- **policy-light-snapshotter.ts** — 轻量快照（含 git 操作，rollback 支持）
- **shadow-write-event-recorder.ts** — shadow 写入事件记录

### 6.3 Loop 功能

#### 6.3.1 Task Loop
- **入口**：`role-orchestration-methods.ts:517 task_loop.run` / `:584 task_loop.status`
- **核心**：`agents/task-loop-controller.ts` — `runTaskLoop` / `getTaskLoopRun`
- **上下文**：`task-loop-context.ts` — `buildTaskLoopContextPack` / `TaskLoopContextPack`
  - `TASK_LOOP_OBJECTIVE_MAX_CHARS = 2_000`
  - `TASK_LOOP_EVIDENCE_MAX_CHARS = 12_000`
  - `TASK_LOOP_REPAIR_BRIEF_MAX_CHARS = 4_000`
  - `TASK_LOOP_CONTEXT_SUMMARY_MAX_CHARS = 4_000`
- **自检**：`task-loop-self-check.ts` — `runTaskLoopSelfCheck` / `hashTaskLoopRepairInput`
- **COMPASS 集成**：`task-loop-runtime-memory-read-hydration-shadow.ts` — `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics`
- **工具**：`agents/tools/task-loop-tool.ts`
- **UI**：`src/pages/Chat/task-loop-upgrade.ts` / `task-visualization.ts`

#### 6.3.2 Cron（定时任务）
- **位置**：`openclaw_runtime/src/cron/`（30+ 模块）
- **核心**：service / store / schedule / delivery
- **service/**：jobs / locked / ops / state / store / timer / wake
- **store/**：key / row-codec / schema / types
- **辅助**：command-runner / delivery-plan / stagger / session-reaper / session-target / normalize / parse / persisted-shape / retry-hint / run-diagnostics / run-id / run-log / run-log-jsonl / run-log-types / active-jobs / isolated-agent / webhook-url
- **UI**：`src/pages/Cron/index.tsx` + `src/stores/cron.ts`
- **Main**：`electron/services/cron-api.ts`
- **Gateway**：`server-methods/cron.ts`
- **工具**：`agents/tools/cron-tool.ts` / `cron-tool-canonicalize.ts`

#### 6.3.3 Daemon（守护进程）
- **位置**：`openclaw_runtime/src/daemon/`（30+ 模块）
- **跨平台**：
  - macOS：launchd / launchd-plist
  - Windows：schtasks / schtasks-exec
  - Linux：systemd / systemd-hints / systemd-unit
- **辅助**：service / service-audit / service-env / service-types / diagnostics / paths / program-args / restart-logs / runtime-hints / runtime-parse / runtime-paths / arg-split / cmd-argv / cmd-set / constants / exec-file / inspect / node-service / output

#### 6.3.4 Auto-Reply（自动回复）
- **位置**：`openclaw_runtime/src/auto-reply/`（15 模块）
- **核心**：reply / dispatch / envelope / heartbeat
- **reply/**：body / exec
- **辅助**：chunk / media-note / model / status / templating / thinking / tokens / tool-meta / types

#### 6.3.5 Mission Loop
- **工具**：`agents/tools/mission-loop-tool.ts`
- **相关**：`shared/types/mission-control.ts` / `gateway/server-methods/mission-control-methods.ts`

#### 6.3.6 Agent Loop（核心循环）
- **位置**：`packages/agent-core/src/agent-loop.ts`
- **相关**：`packages/agent-core/src/agent.ts` / `llm.ts` / `node.ts` / `runtime-deps.ts`

### 6.4 Git 管理

#### 6.4.1 Main 侧 Git API
- **核心**：`electron/services/git-api.ts`
  - `createGitApi()` (L636) — 创建 Git API
  - `git()` (L134) — 执行 git 命令
  - `gitTextAt()` (L142) — 读取 ref 内容（HEAD / ':' / INDEX）
  - `gitChangeFromStatus()` (L225) — 解析 status
  - `readCurrentGitStatus()` (L417) — 读取仓库状态
- **Code Review**：`electron/services/code-review-api.ts:92 git()` — 代码审查专用

#### 6.4.2 Renderer 侧 Git UI
- **工具**：`src/lib/git-ui.ts`
- **面板**：`src/components/file-preview/WorkspaceGitPanel.tsx`
- **Diff 查看**：`src/components/file-preview/MonacoDiffViewer.tsx`
- **GitHub 卡片**：`src/components/assistant-render/GitHubCard.tsx`
- **Chat 集成**：`src/pages/Chat/ComposerGitStrip.tsx` / `src/pages/Chat/RollbackPlanPanel.tsx` / `src/pages/Chat/rollback-plan.ts`

#### 6.4.3 Runtime 侧 Git
- **Agent 工具**：`openclaw_runtime/src/agents/utils/git.ts`
- **快照策略**：`openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter.ts:202 git()` — 含 rollback 支持
- **基础设施**：
  - `openclaw_runtime/src/infra/git-commit.ts` — 提交工具
  - `openclaw_runtime/src/infra/git-root.ts` — 仓库根查找
- **CodeGraph**：`openclaw_runtime/extensions/codegraph/dist/sync/git-hooks.js:84 gitHooksDir` — CodeGraph git hooks

#### 6.4.4 Rollback 机制
- **Context Engine**：`context-engine/types.ts:127 rollback` — Context Provider rollback
- **CVK 恢复**：`context-engine/cvk/recovery-default.ts` / `recovery.ts` — `legacy_transcript_replay` 策略
- **Sessions Extensions**：`sessions/extensions/policy-light-snapshotter.ts:86 rollback`
- **Event Log Pilots**：3 个 pilot 文件含 rollback 字段（`event-log-controlled-dual-read-resume-pilot` / `event-log-limited-authority-cutover-pilot` / `event-log-resume-cutover-readiness`）
- **Task Loop Memory**：`task-loop-memory-shadow-diagnostics.ts:109 rollback`
- **Failure Governance**：`failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts:84 rollback`
- **Plugins**：`plugins/install.ts:743 rollback`

#### 6.4.5 Rollback Plan（UI 层）
- **位置**：`src/pages/Chat/rollback-plan.ts` / `RollbackPlanPanel.tsx`
- **作用**：Chat 页面的回滚计划可视化
- **类型**：`shared/types/` 相关类型

### 6.5 功能域统计

| 功能域 | 模块数 | 关键位置 |
|--------|--------|---------|
| 聊天与会话 | 50+ | Chat page + chat store + chat-api + server-chat + auto-reply + sessions/ |
| Agent 管理 | 40+ | Agents page + agents store + agents-api + agent-config + agent-browser |
| Role-First 编排 | 20+ | RolesOrchestrationPanel + roles-api + role-contract/registry/router/spawn + orchestrator + team-template |
| 记忆系统（双轨） | 40+ | Role Memory（memory/）+ COMPASS（runtime-core/memory-*） |
| 知识沉淀 | 80+ | SEKB + memory-core + memory-wiki + active-memory + memory-lancedb + Context Engine |
| 工具系统 | 80+ | agent-tools + tool-catalog/policy/mutation + tool-provider-registry + agents/tools/ |
| 可观测性 | 20+ | Observability page + observability store + observability-* services + runtime observability |
| 任务账本 | 10+ | TaskLedger page + task-ledger store + task-ledger-api/service |
| Loop 功能 | 100+ | task-loop + cron + daemon + auto-reply + mission-loop + agent-loop |
| 渠道 | 30+ | Channels page + channels store + channels-api + runtime channels + 15+ channel extensions |
| 技能 | 20+ | Skills page + skills store + skills-api + skill-packs + skill-catalog/installer |
| 模型与提供商 | 30+ | Models page + providers store + providers-api + provider-* + llm/ + 40+ LLM extensions |
| 文件预览 | 25+ | file-preview components + files-api + web-preview-* |
| 图像生成 | 15+ | ImageGeneration page + image-generation lib + openclaw-image-generation |
| 代码图谱 | 10+ | ClawGraph page + clawgraph-api + codegraph extension |
| 代码审查 | 10+ | CodeReview page + code-review-api |
| MCP | 10+ | mcp store + mcp-api + mcp-transport/http/stdio/oauth |
| 沙箱 | 15+ | sandbox-api + sandbox/ + sandbox-policy-resolver |
| 权限 | 10+ | permissions-api + permission-decision-audit + workspace-permissions |
| Git 管理 | 20+ | git-api + git-ui + WorkspaceGitPanel + MonacoDiffViewer + agents/utils/git + infra/git-* + rollback-plan |
| 远程控制 | 10+ | RemoteTasks page + remote-control-api + remote-tasks-api |
| Agent Dev 控制面 | 20+ | AgentDevWorkbenchPanel + agent-dev lib + agent-dev-api + shared/agent-dev |
| 基础设施 | 80+ | runtime infra + Main utils |
| 多 Agent 协作 | 50+ | Role-First + ACP + sessions tools + orchestrator + team-template + compaction |
| Plugins | 300+ | plugins/ 子系统（最大） |
| Extensions | 100+ | extensions/ 目录 |

---

## 7. 治理审计矩阵

### 7.1 模块规模与复杂度

| 子系统 | 文件数 | 复杂度 | 备注 |
|--------|--------|--------|------|
| Renderer Pages | 22 顶级 | 中 | Chat 最复杂（19 子模块） |
| Renderer Stores | 20+ 顶级 | 高 | chat store 22 子模块 |
| Renderer Lib | 35+ | 中 | host-api 唯一入口 |
| Renderer Components | 15+ 子目录 | 中 | file-preview 最复杂（20+ 组件） |
| Main Services | 60+ | 高 | observability 8 模块 |
| Main Gateway | 30+ | 高 | 生命周期管理复杂 |
| Main Utils | 55+ | 中 | agent-config 核心 |
| Runtime Packages | 17 包 | 高 | memory-host-sdk 最大 |
| Runtime Gateway | 90+ | 高 | server.impl.ts 核心 |
| Runtime Server Methods | 86 | 高 | RPC 接口层 |
| Runtime Agents | 90+ | 高 | Role-First 子系统 |
| Runtime Agent Sessions | 45 | 高 | compaction + extensions + tools |
| Runtime Agent Harness | 21 | 中 | 生命周期 + hooks |
| Runtime Runtime-Core | 86 | **极高** | COMPASS 31 + Agent-Map + AST + EventLog + Evidence |
| Runtime Role Memory | 8 | 低 | 与 COMPASS 独立 |
| Runtime Context Engine | 25 | 中 | CVK + 6 Context Providers |
| Runtime Knowledge/SEKB | 10 | 中 | 自演化知识库 |
| Runtime State | 10 | 低 | SQLite schema |
| Runtime Plugins | 300+ | **极高** | 最大子系统 |
| Runtime Channels/Auto-Reply | 35+ | 中 | |
| Runtime Cron/Daemon | 60+ | 中 | 跨平台 daemon |
| Runtime Hooks | 20+ | 中 | 含 Gmail |
| Runtime Infra | 80+ | 中 | 工具函数库 |
| Runtime Observability | 9 | 低 | |
| Runtime ACP | 15 | 中 | Agent 通信协议 |
| Runtime Config | 50+ | 中 | 25 个类型文件 |
| Runtime Commitments | 7 | 低 | |
| Extensions | 100+ | 中 | LLM/Channels/TTS/Memory/Tools |
| Shared Types | 30+ | 低 | |
| Shared i18n | 68 文件 | 低 | 4 语言 × 17 ns |

### 7.2 已识别的耦合问题

**P0 - 关键架构断层**：
1. COMPASS 与 Multi-Agent 完全断开（subagent 不读 COMPASS、不能用 memory_query）
2. 两套 memory store 数据不互通（Role Memory vs COMPASS Runtime Memory）
3. Context Runtime 注入缝单一（`computeMemoryExtraSystemPrompt` callers=1，单点风险）

**P1 - 命名与重复**：
4. `memory-store.ts` 文件名冲突（`memory/` vs `runtime-core/`）
5. 两条 context 注入路径并行（Role Memory vs COMPASS），无统一 budget 协调
6. `memory_query` 不在任何 built-in role 白名单，注册即被过滤

**P2 - 遗留项**：
7. typecheck pre-existing 错误（tool-provider-registry / session-files / host-api / rollback-plan）
8. 50 个非 COMPASS 文件未从 stash 恢复（已有 `backup-pre-component-switch` tag 保护）
9. Runtime-Core 大量 `*-pilot.ts` / `*-shadow.ts` / `*-readiness.ts` 文件（实验性 feature flag 控制面），需评估收敛
10. Plugins 子系统 300+ 模块，复杂度极高，需评估拆分

### 7.3 后续治理建议

#### 7.3.1 立即可做（低风险）
- **D1**：重命名 `runtime-core/memory-store.ts` → `runtime-memory-store.ts` 消除命名冲突
- **D2**：清理 4 个 typecheck pre-existing 错误
- **D3**：评估 50 个 stash 文件的恢复或废弃决策
- **D4**：Runtime-Core 实验性文件收敛评估（`*-pilot.ts` / `*-shadow.ts`）

#### 7.3.2 中期治理（需设计）
- **M1**：COMPASS 质量门达标后接入 multi-agent（B1-B3 阶段）
- **M2**：统一 context budget 协调器（Role Memory + COMPASS + Context Engine 三路注入）
- **M3**：Plugins 子系统 300+ 模块的分类治理（Provider / Channel / Memory / Tools / Hooks 边界明确化）
- **M4**：SEKB 与 COMPASS 的知识沉淀协调（SEKB 蒸馏 vs COMPASS 事实治理）
- **M5**：Extensions 100+ 的生命周期管理（LLM/Channels/TTS/Memory/Tools 分类标准化）

#### 7.3.3 长期演进（需决策）
- **L1**：两套 memory 系统的 C-merge（合并）vs C-split（桥接层）决策
- **L2**：Runtime-Core 86 模块的子系统边界明确化（COMPASS / Agent-Map / AST / EventLog / Evidence 是否独立包）
- **L3**：ACP 与 Role-First 的统一编排协议决策
- **L4**：知识库系统统一（SEKB + memory-core + memory-wiki + active-memory + memory-lancedb 的语义分工）

---

## 8. 给 agent 审计的核心问题

1. **COMPASS 质量门阈值**：J Score 从 53-56% → 65% 是否合理？
2. **B1 的 `role-aware` scope**：应由 `RoleContract.tags` 还是新增 `RoleContract.memoryAccess` 字段控制？
3. **C-merge vs C-split**：`getMemoryCards` 16 处消费的迁移成本是否可接受？
4. **memory_query tool**：应升级为 built-in 工具还是保持按角色白名单？
5. **stash 恢复决策**：50 个文件中是否有应废弃的？
6. **Plugins 子系统**：300+ 模块是否应拆分为独立包？
7. **SEKB 与 COMPASS**：知识蒸馏（SEKB）与事实治理（COMPASS）的边界如何划分？
8. **Extensions 治理**：100+ 扩展的生命周期管理（弃用/合并/升级）策略？
9. **ACP 与 Role-First**：是否应统一为单一编排协议？
10. **Loop 功能收敛**：task-loop / cron / daemon / auto-reply / mission-loop 的职责边界是否清晰？

---

**报告结束**。如需针对某一子系统做更深入的细化扫描，或针对某一治理建议展开实施方案，请告知。
