# Agent Browser Capability Absorption Plan

> Scope: 分析 `browser-ai-assistant-master` 项目（Chrome MV3 扩展）中可吸收进 ClawX Agent Browser 子系统的能力，明确已有基础、缺口与适配路径。
> Basis: ClawX 代码审查（`electron/services/agent-browser-*`、`shared/host-api/contract.ts`、`shared/cron-browser-automation.ts`、`src/pages/Browser/index.tsx`）+ browser-ai-assistant 源码与 `AGENTS.md`。
> Related plans: `docs/mcp-custom-agent-and-cdp-remote-control-plan.md`、`docs/workspace-and-permission-control-plan.md`。

## 0. 本条线边界与开发原则

### 0.1 严格边界：只做 Agent Browser，不碰 runtime 层面

**本计划严格限定在 Agent Browser 子系统及其与 Agent 的交互层，明确排除以下 runtime 层面：**

| 排除项 | 排除理由 |
|---|---|
| MCP 远程工具接入（含 HTTP/Streamable HTTP、Bearer Token、`tools/list`、`tools/call`） | 属于 ClawX MCP 子系统，与 Agent Browser 正交 |
| Multi-agent 编排 / Role packs / Typed blackboard / Synthesizer DAG | 属于 ClawX multi-agent orchestration 子系统 |
| Chat runtime 工程项（工具决策非流式/最终回答流式、DSML `<｜tool_calls｜>` 解析、已引导对话请求级覆盖层、上下文压缩边界、会话级任务隔离） | 属于 ClawX chat runtime 子系统，不在 Agent Browser 范畴 |
| Tavily / Web search 工具化 | 属于搜索工具，不是 browser 控制能力 |
| Token 用量监控 / `ChatTokenUsageSource` / `usageSchemaVersion` | 属于 ClawX token usage 子系统 |
| Chrome MV3 service worker / Side Panel / Chrome Sync / manifest 合约 | 平台无关项 |
| `chrome.debugger` 顶部"已开始调试此浏览器"授权锚点 | Electron 内嵌窗口无此原生提示 |

**本计划处理的范围（清晰定义）：**
- ✅ Agent Browser 引擎层（CDP 连接、Session、Profile、tab 管理）
- ✅ Agent Browser 操作层（snapshot/UID、click/fill/press_key、scroll/hover、navigate、screenshot）
- ✅ Agent Browser 诊断层（Network 采集、JS 索引、Source Map、Runtime inspect）
- ✅ Agent Browser 安全层（三模式运行态、Grant、BoundaryDetector、请求重放沙箱）
- ✅ Agent Browser 工具治理层（工具分类、注册表、附件池）
- ✅ Agent Browser 任务策略层（AutomationPlaybook 作为 Skills 子类目）
- ✅ Agent Browser 与 Agent 的交互边界（host-api、Gateway bridge、Cron prompt 约束）

**边界判定规则**：如果某能力离开 Agent Browser session 仍能独立存在并发挥作用，则不属于本条线。例如 DSML 解析离开 browser 仍服务于所有工具调用，故排除；Network 脱敏只在 browser session 内采集请求时生效，故属于本条线。

### 0.2 核心开发原则：能抄绝不手写

**本计划的默认执行方式是直接从 `C:\Users\27933\Desktop\verseshell\browser-ai-assistant-master\` 抄代码到 ClawX，仅在以下情况才手写：**

1. **平台差异**：源码用了 Chrome MV3 / `chrome.debugger` API，ClawX 需要替换为 Electron `webContents.debugger` 或 Node 等价物 —— 这种情况下抄**逻辑结构、常量、类型、正则、阈值、流程编排**，只替换 API 调用层。
2. **类型对接**：源码用了其自有类型（如 `NetworkRequestMeta`），ClawX 需要对齐到 `shared/host-api/contract.ts` 的类型 —— 抄**实现逻辑**，类型签名按 ClawX 既有约定调整。
3. **明显冗余**：源码有 Chrome Sync / MV3 service worker / Side Panel 特定代码 —— 这部分**不抄**，其余全抄。
4. **超出本条线**：源码涉及 MCP / chat runtime / multi-agent / token usage / web search —— **不抄**，见 0.1 边界。

**禁止行为**：
- 看了源码后"凭理解"重写一遍 —— 不允许，必须逐文件对照抄。
- 把多个源文件合并成一个新文件"简化" —— 不允许，保持源码文件粒度便于对照与后续同步上游修复。
- 修改阈值/正则/常量"优化" —— 不允许，先原样抄入，验证通过后再单独提 PR 调优。
- 顺手"修一下"chat runtime 或 MCP 子系统 —— 不允许，超出本条线的一律另立项目。

**抄代码的工作流**：
1. 在本计划第 3 节查到目标能力的源文件路径。
2. 打开源文件，逐函数对照抄写到 ClawX 对应位置。
3. 仅替换 API 调用层（`chrome.debugger` → `webContents.debugger`、`chrome.tabs` → `BrowserWindow`/`webContents` 等）。
4. 类型导入改为 ClawX 既有类型路径。
5. 跑 `pnpm run typecheck` + `pnpm test` 验证。
6. E2E 测试用例同样从 `browser-ai-assistant-master/tests/` 抄，只调整 fixture 启动方式。

**源码根目录常量**：
- 源项目根：`C:\Users\27933\Desktop\verseshell\browser-ai-assistant-master\`（下文简称 `SRC/`）
- ClawX 根：`c:\Users\27933\Desktop\clawx\ClawX\`（下文简称 `DST/`）
- 抄写目标目录约定（严格限定在 agent-browser 子目录内）：
  - `SRC/src/background/browserControl/` → `DST/electron/services/agent-browser/browser-control/`
  - `SRC/src/shared/` 中 browser 控制相关文件 → `DST/shared/agent-browser/`（新建子目录，避免污染既有 `shared/`）
  - `SRC/src/background/automationPlaybookSelector.ts` → `DST/electron/services/agent-browser/automation-playbook-selector.ts`
  - `SRC/tests/` 中 browser 控制相关测试 → `DST/tests/unit/agent-browser/` 与 `DST/tests/e2e/browser-*.spec.ts`
- **禁止抄入的目录**（超出本条线）：
  - `SRC/src/background/mcpMessageHandler.ts` 及 `SRC/src/shared/mcp/`
  - `SRC/src/background/modelResponseToolParser.ts` / `SRC/src/background/toolCalling/` / `SRC/src/shared/chat/`
  - `SRC/src/shared/webSearch/` / `SRC/src/background/webSearchMessageHandler.ts`
  - `SRC/src/shared/models/` 中的 token usage / model catalog 部分

## 1. ClawX Agent Browser 现状基线

### 1.1 引擎与 Session 层（`electron/services/agent-browser-service.ts`）

ClawX 已实现双引擎 Agent Browser：

- **browser-window 引擎**：通过 `new BrowserWindow({ partition: persist:agent-browser-<profile> })` 创建独立隔离的 Electron 窗口，`webContents.executeJavaScript` 执行操作。
- **agent-browser-cli 引擎**：调用打包的 `agent-browser` 二进制（`resources/bin/<platform-arch>/agent-browser`），JSON 输出模式，session/profile/CDP/external-profile 多种连接模式。

Session 模型字段：`id / profile / mode(headless|visible) / authPersistence(session-name|profile|off) / authStateName / connection(managed|auto-connect|cdp|external-profile) / url / title / createdAt / updatedAt`。

已暴露动作：`open / navigate / focus / show / hide / waitForSelector / click / type / evaluate / screenshot / command / close`。

### 1.2 任务与凭证层

- `agent-browser-task-service.ts`：任务生命周期 `queued → running → waiting-approval → paused → completed/failed/cancelled`，`AbortController` 取消，仅 `failed/cancelled` 可重试。
- `agent-browser-vault.ts`：`safeStorage`（OS keychain）加密存储 HTTPS origin 凭据，profile 绑定。
- `agent-browser-cli-runner.ts`：CLI flag 白名单（`--json/--session/--profile/--headed/--max-output/--session-name/--state/--auto-connect/--cdp/--executable-path`），禁止覆盖受管 flag。

### 1.3 验证与诊断层

`AgentBrowserService.validate()` 已实现：

- 打开 session → 检查 `expectedDomains` → 采集 `snapshot / console / errors / network / screenshot` 诊断 → 持久化 `BrowserAutomationRunResult`（`schemaVersion:1`）到 `userData/agent-browser/run-artifacts/<runId>/`：
  - `manifest.json`（runResult）
  - `<kind>.json`（snapshot/console/errors/network）
  - `screenshot.<ext>`
- `loginState` 启发式检测（`login|sign in|password|验证码|登录` → login-required；`logout|account|profile|dashboard|退出登录` → authenticated）。
- `consoleErrors / networkErrors` 自动提取（匹配 `error|failed|exception|ERR_|4xx|5xx`）。

### 1.4 Host API 与 Gateway 桥接

- `shared/host-api/contract.ts`：`agentBrowser` 命名空间完整 surface，外加独立的 `remoteControl`（CDP 远程控制，dev-mode gated）。
- `electron/main/ipc-handlers.ts:205`：`agentBrowser: createAgentBrowserApi()` 注册到 host-contract。
- `electron/gateway/agent-browser-bridge.ts`：JSON-RPC 通知桥 `agentBrowser.invoke.request → agentBrowser.invoke.result`，让 OpenClaw runtime agents 通过 Gateway 调用 Agent Browser。

### 1.5 UI 与定时任务

- `src/pages/Browser/index.tsx`：Workbench 五标签页（sessions/tasks/profiles/vault/runs），任务创建表单（name/url/objective/profile/mode），session 控制（show/hide/close），任务控制（retry/cancel）。
- `shared/cron-browser-automation.ts` + `shared/types/cron.ts`：Cron 调度的浏览器自动化，4 模板（`checkIn / monitor / publishDraft / custom`），敏感动作策略（`draft-only / auto-submit`），允许域名，瞬时失败重试（仅安全步骤），诊断开关，prompt 内嵌 marker 持久化配置。
- i18n 全 locale 覆盖（`shared/i18n/locales/{en,zh,ja,ru}/cron.json` 的 `browserAutomation*` 字段）。

### 1.6 现状能力清单速查

| 能力 | ClawX 现状 | 实现位置 |
|---|---|---|
| 多引擎（Electron 窗口 + CLI） | ✅ | `agent-browser-service.ts` |
| Session/Profile/Connection 管理 | ✅ | `agent-browser-service.ts` |
| Headless/Visible 模式切换 | ✅ | `show/hide` |
| CSS Selector 操作（click/type/waitForSelector） | ✅ | `agent-browser-service.ts` |
| 任意 JS evaluate | ✅ | `evaluate` |
| 截图 | ✅ | `screenshot` |
| 任务生命周期 + 取消 | ✅ | `agent-browser-task-service.ts` |
| OS keychain 凭据保管 | ✅ | `agent-browser-vault.ts` |
| 允许域名强制 | ✅ | `validate()` |
| 诊断采集（snapshot/console/errors/network/screenshot） | ✅ | `validate()` |
| Run artifact 持久化 | ✅ | `persistBrowserAutomationRunResult` |
| Gateway 桥接给 runtime agents | ✅ | `agent-browser-bridge.ts` |
| Cron 定时浏览器任务 | ✅ | `cron-browser-automation.ts` |
| 敏感动作策略（draft-only/auto-submit） | ✅ | `CronBrowserAutomationConfig` |
| i18n 全 locale | ✅ | `cron.json` |

## 2. browser-ai-assistant 可吸收能力对比

下表对照 browser-ai-assistant 的能力，标注 ClawX 当前状态与适配价值。

| # | 能力 | browser-ai-assistant | ClawX 现状 | 适配价值 |
|---|---|---|---|---|
| A1 | Accessibility Tree 快照 + UID 映射 | `Accessibility.getFullAXTree` 生成模型可读文本 + 稳定 UID → DOM backend node | ❌ 仅 `captureValidationSnapshot` 抓 text/links/buttons，无 UID | **P0** |
| A2 | 真实 CDP 输入事件优先 + JS fallback | `Input.dispatchMouseEvent` 真实事件，布局失败才 JS | ❌ browser-window 引擎用合成 `MouseEvent` dispatch；CLI 引擎可能已支持 | **P0** |
| A3 | CDP 连接生命周期 + onDetach 区分原因 + 受限 URL 黑名单 + 显式开关不持久化 | 完整 | ⚠️ 部分（session 显式 open/close，但无 detach 原因区分、无受限 URL 黑名单、无"显式开关不持久化"语义） | **P1** |
| A4 | UID 绑定页面身份：URL/标题变化、导航、detach 后旧 UID 全部失效 | 完整 | ❌ 无 UID 概念 | **P0**（依赖 A1） |
| A5 | 多标签页受控（navigate_page/new_page/list_pages/select_page/close_page） | 完整 | ❌ 一个 session = 一个窗口/CLI 进程，无 tab 概念 | **P1** |
| B1 | Network 后台采集（不依赖 DevTools 页面） | `chrome.debugger` + `Network.enable` | ⚠️ CLI 引擎有 `network requests` 子命令；browser-window 引擎无 CDP 采集 | **P1** |
| B2 | Network 工具集（list/get/clear/wait_for/compare/find_parameter_candidates/extract_js_candidates） | 完整 | ❌ 仅 `network requests` 列表 | **P1** |
| B3 | Network 默认脱敏（Authorization/Cookie/Set-Cookie/token/api_key/password/secret/session/csrf） | 完整 | ❌ 无脱敏 | **P1** |
| B4 | JS 资源索引 + 同源补位（list_resources/search_sources/extract_context） | 完整 | ❌ 无 | **P2** |
| B5 | Source Map 解析（list_candidates/resolve_location/extract_original_context） | 完整，`@jridgewell/trace-mapping` | ❌ 无 | **P2** |
| B6 | 受控只读 Runtime（inspect_globals/search_modules/describe_function） | 结构化参数 + 固定只读模板 + `returnByValue:true` | ⚠️ 有 `evaluate`（任意 JS，强但不安全） | **P2** |
| C1 | 三模式运行态（normal_restricted/controlled_enhanced/full_access） | 完整 | ⚠️ 仅 `sensitiveActionPolicy` 二态（draft-only/auto-submit），无 normal_restricted 概念 | **P0** |
| C2 | 一次性 Grant + scopeKey（绑定工具名+关键参数签名） | 完整 | ⚠️ 任务级 `waiting-approval`，但无 per-action grant | **P0** |
| C3 | 请求重放沙箱（prepare→boundary→send→compare，默认无凭据，方法/大小/并发限制） | 完整 | ❌ 无 | **P2** |
| C4 | automationBoundaryDetector（自动触发边界确认） | 完整 | ❌ 无自动检测 | **P1** |
| C5 | 完全访问模式（execute_script/fetch with credentials/read_storage/revoke） | 完整 | ❌ 无（`evaluate` 接近但无 storage 读取、无 revoke） | **P2** |
| D1 | 工具分类三维矩阵（runtime × capabilities × risk） | 完整 | ❌ agent_browser 是单一工具，无分类 | **P1** |
| D2 | 四层拦截链路（UI 置灰 → 批量启用 → 模型请求过滤 → background 二次校验） | 完整 | ⚠️ host-api 是单一入口，但无多层校验 | **P1** |
| D3 | 统一工具注册表（唯一 allow-list，runtime message 只传 enabledToolIds） | 完整 | ❌ agent_browser 单一工具暴露给 runtime | **P1** |
| D4 | 预设批量启用策略（只读观察/基础操作/页面巡检/接口分析/受控增强/完全访问） | 完整 | ❌ 无 | **P2** |
| E5 | 工具附件池（会话级仓库 + 消息只存引用 + 同 ID 只展开一次 + 噪音过滤） | 完整 | ⚠️ 有 run artifact 持久化，但无 session 级附件池注入模型上下文 | **P1** |
| F1 | AutomationPlaybook（6 内置 + 字段：id/title/description/tags/defaultEnabled/risk/recommendedCapabilities/selectionHints/prompt） | 完整 | ⚠️ ClawX 有 Skills 系统，可映射 | **P1** |
| F2 | automation-report 后台基于真实工具调用记录自动生成 | 完整 | ⚠️ 有 `BrowserAutomationRunResult`，但不是按工具调用记录生成 | **P2** |
| G3 | 页面上下文提取规则（URL 正则 + CSS/XPath 多行选择器 + 全局回退） | 完整 | ⚠️ 有 `captureValidationSnapshot`，但无 URL 正则提取 | **P2** |

**已明确排除的能力（不属于本条线，见 0.1 边界）：**

| 能力 | 排除理由 |
|---|---|
| E1 工具决策非流式 + 最终回答流式 | 属于 chat runtime 子系统 |
| E2 DSML `<｜tool_calls｜>` 解析 | 属于 chat runtime 子系统 |
| E3 已引导对话（运行中跟进） | 属于 chat runtime 子系统 |
| E4 上下文压缩边界 | 属于 chat runtime 子系统 |
| G1 MCP 远程工具接入 | 属于 ClawX MCP 子系统 |
| G2 Tavily / Web search 工具化 | 属于搜索工具，不是 browser 控制能力 |
| G4 会话级任务隔离 | 属于 chat runtime 子系统 |
| G5 Token 用量监控 | 属于 ClawX token usage 子系统 |

## 3. 适配清单与路径（按优先级）

### 3.1 P0：地基与安全（必须先做）

#### P0-1. Accessibility Tree 快照 + UID 映射（对应 A1、A4）

**现状缺口**：ClawX `click/type/waitForSelector` 全部基于 CSS selector，模型容易猜错 selector，且 `captureValidationSnapshot` 只返回 text/links/buttons 列表，模型无法稳定引用页面元素。

**抄代码源文件**：
- `SRC/src/background/browserControl/actions.ts` — `BrowserControlActionExecutor` 整个类（snapshot + click + fill + press_key + scroll + hover + double_click + context_click + drag），常量 `MODIFIER_BITS / MODIFIER_ALIASES / WAIT_FOR_DEFAULT_TIMEOUT_MS / SCROLL_DEFAULT_AMOUNT` 等全部原样抄
- `SRC/src/background/browserControl/` 内涉及 `BrowserDebuggerConnection` 的 snapshot 生成逻辑（AX tree → UID → backendNodeId 映射）
- `SRC/src/shared/browserControl.ts` — UID 失效/页面身份校验逻辑

**适配方案**（仅替换 API 调用层）：
1. 新增 `DST/electron/services/agent-browser/browser-control/actions.ts`，原样抄 `BrowserControlActionExecutor`。
2. `BrowserControlCommandConnection` 接口的实现里，`chrome.debugger` 调用替换为 `webContents.debugger.sendCommand`：
   - `resolveNodeByBackendId` → `DOM.resolveNode`
   - `getBoxModel` → `DOM.getBoxModel`
   - `dispatchMouseEvent` → `Input.dispatchMouseEvent`
   - `dispatchKeyEvent` → `Input.dispatchKeyEvent`
   - `insertText` → `Input.insertText`
   - `callFunctionOn` / `evaluate` → `Runtime.callFunctionOn` / `Runtime.evaluate`
3. `BrowserControlActionSnapshot.takeSnapshot()` 内部用 `Accessibility.getFullAXTree` 生成文本 + UID 映射，逻辑原样抄。
4. 新增 host-api 动作 `agentBrowser.takeSnapshot(sessionId)` / `clickByUid(sessionId, uid)` / `fillByUid(sessionId, uid, text)` / `pressKeyByUid(sessionId, uid, key)`，包装上述类。
5. UID 绑定页面身份：照抄 `SRC/src/shared/browserControl.ts` 中的失效逻辑（URL/标题变化、导航、detach 后旧 UID 全部失效）。
6. 模型协议：照抄 `SRC/src/shared/automationPlaybooks.ts` 与 prompt 中"禁止猜 UID，必须先 take_snapshot"原文。

**验收**：
- `takeSnapshot` 返回的文本可直接喂给 LLM 且包含可点击元素的稳定 UID。
- `clickByUid` 在 SPA 导航后自动失效并提示重新 snapshot。
- E2E 测试从 `SRC/tests/` 中相关 snapshot/UID 测试抄，调整 fixture 为 Electron 启动。

#### P0-2. 真实 CDP 输入事件优先（对应 A2）

**现状缺口**：browser-window 引擎 `click` 用 `el.dispatchEvent(new MouseEvent(...))` 是合成事件，反爬虫站点易识别；`type` 直接赋值 `el.value` 不触发真实键盘事件。

**抄代码源文件**：
- `SRC/src/background/browserControl/actions.ts` — `click` 方法内"真实事件优先 → JS fallback"的分支结构、`fill` 方法内 `Input.insertText` + `Input.dispatchKeyEvent` 序列、`press_key` 的 `MODIFIER_BITS` 位掩码逻辑
- `SRC/src/background/browserControl/` — `BrowserDebuggerConnection` 的 `dispatchMouseEvent / dispatchKeyEvent / insertText` 实现作为接口契约参考

**适配方案**：
1. P0-1 抄入的 `actions.ts` 已包含真实事件优先逻辑，本项不额外写代码。
2. 仅需在 `DST/electron/services/agent-browser/browser-control/` 下新增 `BrowserDebuggerConnection` 的 Electron 实现，对照 `SRC/` 同名类抄，API 替换：
   - `chrome.debugger.attach({ tabId }, '1.3')` → `webContents.debugger.attach('1.3')`
   - `chrome.debugger.sendCommand({ tabId }, method, params)` → `webContents.debugger.sendCommand(method, params)`
   - `chrome.debugger.onDetach.addListener` → `webContents.debugger.on('detach')`
   - `chrome.debugger.getTargets` → 用 `webContents.id` 作为 target 标识
3. 增加开关 `useRealInputEvents`（默认 false，dev-mode 可开），仅在开启时初始化 `BrowserDebuggerConnection`，否则走原 `agent-browser-service.ts` 的合成事件路径。

**验收**：
- 开关开启时，click/type 通过 CDP 真实事件触发，反爬虫站点行为更接近真人。
- 开关关闭时，行为与现有完全一致（向后兼容）。
- 单测：从 `SRC/tests/` 抄 `actions` 相关测试，mock `BrowserControlCommandConnection`。

#### P0-3. 三模式运行态 + 一次性 Grant（对应 C1、C2）

**现状缺口**：ClawX 只有任务级 `waiting-approval` 和 Cron `sensitiveActionPolicy` 二态，缺运行态模式概念；无 per-action grant。

**抄代码源文件**：
- `SRC/src/shared/toolAuthorization.ts` — **整个文件原样抄**，包括 `BrowserAutomationMode / ToolAuthorizationMode / ToolRiskCapability / BrowserAutomationGrant` 类型、`BoundaryGrantContext`、`NORMAL_TOOL_AUTHORIZATION_CONTEXT`、`isRuntimeReadonlyAuthorized / isFullAccessAuthorized / isControlledEnhancedAuthorized / createBoundaryGrantScopeKey` 全部函数
- `SRC/src/background/browserControl/boundaryChoiceToolExecutor.ts` — **整个文件原样抄**，包括 `BoundaryChoiceToolExecutor` 类、`ALLOWED_GRANTS / DISALLOWED_TEXT_PATTERN / DEFAULT_EXPIRES_IN_MS / MAX_EXPIRES_IN_MS / MAX_CHOICES / MAX_TEXT_LENGTH` 常量、scopeKey 兼容点号/下划线的逻辑
- `SRC/src/side-panel/components/BoundaryChoiceDialog.tsx` — UI 组件原样抄，调整到 ClawX 设计 token

**适配方案**：
1. `SRC/src/shared/toolAuthorization.ts` → `DST/shared/agent-browser/tool-authorization.ts`，原样抄。
2. `SRC/src/background/browserControl/boundaryChoiceToolExecutor.ts` → `DST/electron/services/agent-browser/browser-control/boundary-choice-tool-executor.ts`，原样抄。
3. `BoundaryChoiceNotifier` 的实现里，`chrome.runtime.sendMessage` 替换为 ClawX 的 `dialog-api` 或新的 IPC 通道。
4. `BoundaryChoiceDialog.tsx` → `DST/src/components/agent-browser/BoundaryChoiceDialog.tsx`，照抄 UI 结构与状态机，样式类名替换为 ClawX 的 `src/styles/globals.css` 设计 token。
5. 在 `AgentBrowserSession` 增加 `runtimeMode` 字段（类型直接用抄来的 `BrowserAutomationMode`）。
6. 新增 host-api 动作 `agentBrowser.requestModeUpgrade(sessionId, targetMode, reason)`，内部调用抄来的 `BoundaryChoiceToolExecutor`。
7. `AgentBrowserService` 执行高风险动作前调用抄来的 `isRuntimeReadonlyAuthorized / isControlledEnhancedAuthorized / isFullAccessAuthorized` 校验。

**验收**：
- 模式不持久化：刷新/重开 session 后回退 `normal_restricted`。
- Grant 一次性：同一 scopeKey 第二次调用必须重新请求。
- 单测：从 `SRC/tests/` 抄 `toolAuthorization` 与 `boundaryChoiceToolExecutor` 测试到 `DST/tests/unit/agent-browser/`，原样跑。

### 3.2 P1：工具治理与诊断增强

#### P1-1. CDP 连接生命周期加固（对应 A3）

**现状缺口**：browser-window 引擎无 detach 原因区分、无受限 URL 黑名单、无"显式开关不持久化"语义。

**抄代码源文件**：
- `SRC/src/background/browserControl/` — `BrowserDebuggerConnection` 类的 `onDetach` 事件处理与 `canceled_by_user / target_closed / tab_removed / disabled_by_user` 原因区分逻辑
- `SRC/AGENTS.md` 中"受限 URL 黑名单"段落（`chrome://` / `edge://` / `about:` / `chrome-extension://` / `view-source:` / Chrome Web Store）原样作为常量抄
- `SRC/src/background/browserControl/` — `browserControlEnabled` 显式开关不持久化的语义实现

**适配方案**：
1. 在 P0-2 抄入的 `BrowserDebuggerConnection` Electron 实现里，照抄 `onDetach` 原因区分逻辑，`chrome.debugger.onDetach` 事件替换为 `webContents.debugger.on('detach', (reason) => ...)`。
2. `DST/electron/services/agent-browser/browser-control/restricted-urls.ts` 新建文件，照抄黑名单常量，追加 Electron 特有条目（`chrome-extension://` 改为 ClawX 内部页 `app://` / `clawx://` 等）。
3. `normalizeHttpUrl` 后调用抄来的黑名单检查函数。
4. 新增 `agentBrowser.setEnabled(enabled)` 全局开关（照抄 `SRC/` 中 `browserControlEnabled` 不持久化语义），UI 顶部增加显式开关按钮，关闭立即 detach 所有 session。

**验收**：受限 URL 拒绝打开；开关关闭后所有 session 立即关闭且不可新开。

#### P1-2. Network 工具集 + 脱敏（对应 B1、B2、B3）

**现状缺口**：CLI 引擎有 `network requests` 但无详情/对比/参数候选/JS 候选；browser-window 引擎无 Network 采集；无脱敏。

**抄代码源文件**：
- `SRC/src/background/browserControl/networkRecorder.ts` — **整个文件原样抄**，包括 `BrowserNetworkRecorder` 类、`MAX_BODY_LENGTH=12000 / MAX_CACHED_REQUESTS=1000 / DEFAULT_LIST_LIMIT=200 / DEFAULT_WAIT_TIMEOUT_MS=5000 / MAX_WAIT_TIMEOUT_MS=30000` 等全部常量、`BrowserNetworkConnection` 接口、`NetworkRequestFilter / NetworkWaitFilter / NetworkIdleWaitOptions` 类型
- `SRC/src/background/browserControl/networkToolExecutor.ts` — **整个文件原样抄**，包括 `list_requests / get_request_details / clear_requests / wait_for_requests / compare_requests / find_parameter_candidates / extract_js_candidates` 工具执行器
- `SRC/src/shared/networkContext.ts` — **整个文件原样抄**，包括 `redactNetworkRequestDetail / redactNetworkRequestMeta / redactNetworkText / parseRelevantNetworkRequestIds`、`SENSITIVE_NAME_PATTERN` 正则、`REDACTED_VALUE="[已脱敏]" / BODY_LIMIT=6000 / FIELD_LIMIT=1200` 常量
- `SRC/src/shared/types.ts` 中 `NetworkRequestMeta / NetworkRequestDetail / NetworkHeader` 类型定义

**适配方案**：
1. `SRC/src/background/browserControl/networkRecorder.ts` → `DST/electron/services/agent-browser/browser-control/network-recorder.ts`，原样抄。`BrowserNetworkConnection.addEventListener` 的实现里，`chrome.debugger` 事件订阅替换为 `webContents.debugger.on('message', (event, method, params) => ...)`。
2. `SRC/src/background/browserControl/networkToolExecutor.ts` → `DST/electron/services/agent-browser/browser-control/network-tool-executor.ts`，原样抄。
3. `SRC/src/shared/networkContext.ts` → `DST/shared/agent-browser/network-context.ts`，原样抄，零修改。
4. `SRC/src/shared/types.ts` 中 Network 相关类型 → `DST/shared/agent-browser/types.ts`，原样抄。
5. `Network.enable / Network.responseReceived / Network.loadingFinished / Network.getResponseBody` 等 CDP 命令名不变，仅 `sendCommand` 调用形式从 `chrome.debugger.sendCommand({tabId}, method, params)` 改为 `webContents.debugger.sendCommand(method, params)`。
6. 二进制 MIME 跳过逻辑（图片/音视频/字体/压缩包/PDF/octet-stream）照抄 `SRC/` 中 `getResponseBody` 内的判断。
7. 新增 host-api 动作 `listRequests / getRequestDetail / clearRequests / waitForRequests / compareRequests / findParameterCandidates / extractJsCandidates`，包装抄来的 `NetworkToolExecutor`。

**验收**：能在 headless session 内抓包并按 pattern 检索；脱敏字段不泄露；二进制 body 跳过。单测从 `SRC/tests/` 抄 `networkRecorder / networkToolExecutor / networkContext` 测试原样跑。

#### P1-3. automationBoundaryDetector（对应 C4）

**现状缺口**：无自动边界检测，全靠 Cron prompt 约束或模型自觉。

**抄代码源文件**：
- `SRC/src/background/browserControl/automationBoundaryDetector.ts` — **整个文件原样抄**，包括 `AutomationBoundaryConfirmationRequest / AutomationBoundaryConfirmation / BoundarySignal` 类型、`REDACTED_PATTERNS / TRUNCATED_PATTERNS / REPLAY_CONFIRMATION_PATTERNS / REPLAY_SANDBOX_BOUNDARY_PATTERNS / JS_CONTEXT_PATTERNS` 全部正则数组、所有 signal 检测函数

**适配方案**：
1. `SRC/src/background/browserControl/automationBoundaryDetector.ts` → `DST/electron/services/agent-browser/browser-control/automation-boundary-detector.ts`，原样抄，零修改。
2. `AutomationBoundaryConfirmation` 回调的实现里，调用 P0-3 抄来的 `BoundaryChoiceToolExecutor` 触发用户确认。
3. 在 `AgentBrowserService` 每个工具执行后调用抄来的检测器，命中则在 tool result 追加 `requiresBoundaryConfirmation: true`。
4. 区分越权失败 vs 普通参数错误的逻辑（空 UID、等待超时不弹边界确认）照抄。

**验收**：检测器命中后工具结果包含 `requiresBoundaryConfirmation: true`，模型必须下一步调用 `requestUserChoice`。单测从 `SRC/tests/` 抄 `automationBoundaryDetector` 测试原样跑。

#### P1-4. 工具分类矩阵 + 统一注册表（对应 D1、D2、D3）

**现状缺口**：agent_browser 是单一工具，无分类、无多层拦截、无注册表。

**抄代码源文件**：
- `SRC/src/shared/models/toolRegistry.ts` — 工具注册表数据结构与 allow-list 逻辑
- `SRC/AGENTS.md` 中"工具分类三维矩阵"段落（`runtime × capabilities × risk` 矩阵定义、各工具的分类标注）作为数据源抄
- `SRC/AGENTS.md` 中"四层拦截链路"段落作为流程规范抄

**适配方案**：
1. `SRC/src/shared/models/toolRegistry.ts` → `DST/shared/agent-browser/tool-registry.ts`，原样抄注册表数据结构与 allow-list 逻辑。
2. 工具分类标注数据从 `SRC/AGENTS.md` 抄到 `DST/shared/agent-browser/tool-classification.ts`，作为静态常量表。
3. 决策点：保持 `agent_browser` 单一工具但内部按 `runtimeMode` 限制可用子动作（推荐），分类矩阵用于 UI 筛选与审计而非拆分工具。
4. 在 `shared/host-api/contract.ts` 增加 `AgentBrowserToolClassification`：`{ runtime, capabilities, risk }`，类型直接用抄来的 `ToolRiskCapability`。
5. 四层拦截照抄 `SRC/AGENTS.md` 流程：
   - L1：UI 置灰（dev-mode 未开时 Agent Browser 页面置灰）
   - L2：批量启用预设（只读观察/基础操作/页面巡检/接口分析/受控增强/完全访问）—— 预设定义照抄 `SRC/AGENTS.md`
   - L3：Gateway bridge 构造请求时按 `runtimeMode` 过滤子动作
   - L4：`AgentBrowserService` 执行前二次校验 `runtimeMode + grant`（用 P0-3 抄来的授权函数）

**验收**：dev-mode 关闭时 Agent Browser 完全不可用；runtimeMode=normal_restricted 时 `evaluate` 与 `command` 不可用。

#### P1-5. 工具附件池（对应 E5）

**现状缺口**：有 run artifact 持久化但无 session 级附件池注入模型上下文。

**抄代码源文件**：
- `SRC/src/shared/toolArtifacts.ts` — **整个文件原样抄**，包括 `TOOL_ATTACHMENT_KIND_PATTERN / GENERIC_DETAIL_LIMIT=4000 / AUTOMATION_EVIDENCE_LIMIT=500 / AUTOMATION_CONCLUSION_LIMIT=800 / TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT=50 / TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT=500 / TOOL_ATTACHMENT_CONTEXT_URL_LIMIT=240` 全部常量、附件池数据结构与展开/去重/噪音过滤逻辑
- `SRC/src/shared/networkContext.ts` — `formatNetworkAttachmentSummary / formatNetworkAttachmentForExport` 函数（P1-2 已抄，此处复用）

**适配方案**：
1. `SRC/src/shared/toolArtifacts.ts` → `DST/shared/agent-browser/tool-artifacts.ts`，原样抄，零修改。
2. session 级 `toolAttachmentsById: Map<id, Artifact>`，照抄 `SRC/` 中的仓库实现。
3. 消息只保存 `toolAttachmentIds` 引用，照抄 `SRC/` 中 `ChatMessage.toolAttachmentIds` 模式。
4. 同一上下文范围内相同附件 ID 只展开一次 —— 照抄 `SRC/` 中展开去重逻辑。
5. 详情池上限 500 + 噪音过滤（静态资源/广告/埋点/失败噪音直接丢弃）—— 照抄 `SRC/` 中噪音过滤规则。
6. Network/JS/Source Map 完整详情只在附件弹窗/复制/导出用，后续模型上下文只注入摘要 —— 照抄 `SRC/` 中摘要注入逻辑。

**验收**：模型上下文不再被大 body 撑爆；附件可在 UI 复用。单测从 `SRC/tests/` 抄 `toolArtifacts` 测试原样跑。

#### P1-6. AutomationPlaybook 映射到 Skills（对应 F1）

**现状缺口**：ClawX 有 Skills 系统但无内置浏览器自动化 playbook。

**抄代码源文件**：
- `SRC/src/shared/automationPlaybooks.ts` — **整个文件原样抄**，包括 `AutomationPlaybook` 接口、`BUILTIN_AUTOMATION_PLAYBOOKS` 数组（6 个 playbook 的 id/title/description/tags/source/defaultEnabled/risk/recommendedCapabilities/selectionHints/prompt 全部字段）、`AUTOMATION_PLAYBOOK_SETTINGS_KEY` 常量、`PLAYBOOK_SELECTION_REASON_LIMIT=200`
- `SRC/src/background/automationPlaybookSelector.ts` — 预选路由逻辑原样抄
- `SRC/src/side-panel/components/settings/AutomationPlaybookSettings.tsx` — UI 组件原样抄，调整到 ClawX 设计 token

**适配方案**：
1. `SRC/src/shared/automationPlaybooks.ts` → `DST/shared/agent-browser/automation-playbooks.ts`，原样抄，零修改。
2. `SRC/src/background/automationPlaybookSelector.ts` → `DST/electron/services/agent-browser/automation-playbook-selector.ts`，原样抄。
3. 6 个 playbook 的 `prompt` 字段中文原文直接复用，不重写。
4. 包装为 ClawX Skills 包：在 `DST/resources/skills/` 下新建 6 个目录，每个目录的 `SOUL.md` 内容为对应 playbook 的 `prompt` 字段，`manifest.json` 包含 `recommendedCapabilities / risk / selectionHints`。
5. `AutomationPlaybookSettings.tsx` → `DST/src/components/agent-browser/AutomationPlaybookSettings.tsx`，照抄 UI 结构，样式类名替换为 ClawX 设计 token。
6. 预选是内部路由：预选 Prompt/候选列表/模型原始响应不进入正式聊天上下文 —— 照抄 `SRC/` 中路由隔离逻辑。
7. `automation-report` 后台基于真实工具调用记录自动生成 —— 照抄 `SRC/src/shared/toolArtifacts.ts` 中 `AutomationReportStep / AutomationTimelineEvent` 相关逻辑。

**验收**：6 个 playbook 在 Skills 页面可见且可启用；启用后 chat 自动注入对应 prompt。单测从 `SRC/tests/` 抄 `automationPlaybooks` 测试原样跑。

#### P1-7. 多标签页受控（对应 A5）

**现状缺口**：一个 session = 一个窗口/CLI 进程，无 tab 概念。

**抄代码源文件**：
- `SRC/AGENTS.md` 中"多页面受控列表"段落 —— `controlledTabIds` 维护、`navigate_page / new_page / list_pages / select_page / close_page` 动作语义
- `SRC/src/background/browserControl/` 内 tab 管理相关逻辑
- `SRC/src/shared/browserControl.ts` — 导航后清理旧 UID 逻辑

**适配方案**：
1. browser-window 引擎：session 内维护 `tabs: Map<tabId, WebContents>`，主窗口 + 多个 `BrowserView`（Electron 等价于 Chrome tab）。tab 管理逻辑照抄 `SRC/` 中 `controlledTabIds` 模式。
2. CLI 引擎：调用 `agent-browser` 的 tab 子命令（若 CLI 支持）；若不支持，本项在 CLI 引擎下不可用，仅 browser-window 引擎支持。
3. 新增 host-api 动作 `agentBrowser.newPage / listPages / selectPage / closePage / navigatePage`，参数与返回结构照抄 `SRC/AGENTS.md` 定义。
4. 导航后清理旧 UID —— 复用 P0-1 抄来的 UID 失效逻辑。
5. JS 弹窗只等用户手动处理（最长 60s），不自动确认 —— 照抄 `SRC/AGENTS.md` 此条约束。

**验收**：一个 session 可同时持有多个 tab 并切换操作。E2E 从 `SRC/tests/` 抄多 tab 测试，调整 fixture。

### 3.3 P2：差异化能力（按需启用）

#### P2-1. JS 资源索引 + 同源补位（对应 B4）

**抄代码源文件**：
- `SRC/src/background/browserControl/jsSourceIndex.ts` — **整个文件原样抄**
- `SRC/src/background/browserControl/jsSourceToolExecutor.ts` — **整个文件原样抄**，包括 `js.list_resources / js.search_sources / js.extract_context` 工具执行器
- `SRC/src/background/browserControl/sameOriginJsFetcher.ts` — **整个文件原样抄**，包括同源校验（协议/host/port 一致）、跨域重定向拒绝、不携带凭据逻辑
- `SRC/src/shared/types.ts` 中 `JsSourceResource / JsSourceMatch / JsSourceContext / JsSourceFetchFailure` 类型

**适配方案**：照抄到 `DST/electron/services/agent-browser/browser-control/` 与 `DST/shared/agent-browser/types.ts`，新增 host-api 动作 `listJsResources / searchJsSources / extractJsContext`，API 调用层 `chrome.debugger` → `webContents.debugger`。

#### P2-2. Source Map 解析（对应 B5）

**抄代码源文件**：
- `SRC/src/background/browserControl/sameOriginSourceMapFetcher.ts` — **整个文件原样抄**，包括候选发现优先级（`SourceMap` header → `X-SourceMap` header → `sourceMappingURL` 源码尾部 → inline data URL）、`credentials: "omit"` + `redirect: "manual"` 约束、`@jridgewell/trace-mapping` 用法、一基行列对外/行一基列零基对内转换
- `SRC/src/background/browserControl/sourceMapFetchGuards.ts` — **整个文件原样抄**
- `SRC/src/background/browserControl/sourceMapToolExecutor.ts` — **整个文件原样抄**，包括 `sourcemap.list_candidates / resolve_location / extract_original_context` 工具执行器
- `SRC/src/shared/types.ts` 中 `SourceMapCandidate / SourceMapResolvedLocation / SourceMapOriginalContext` 类型

**适配方案**：照抄到 `DST/electron/services/agent-browser/browser-control/`，引入 `@jridgewell/trace-mapping` 依赖（`pnpm add @jridgewell/trace-mapping`），新增 host-api 动作 `listSourceMapCandidates / resolveSourceMapLocation / extractOriginalContext`。

#### P2-3. 受控只读 Runtime（对应 B6）

**抄代码源文件**：
- `SRC/src/background/browserControl/runtimeReadToolExecutor.ts` — **整个文件原样抄**，包括 `runtime.inspect_globals / search_modules / describe_function` 工具执行器、固定只读模板拼装、`returnByValue: true` 约束、accessor 跳过并标记、每个属性独立容错、返回值结构化归一化 + 敏感字段值级脱敏 + 深度/条目数/字符串长度/总字节预算

**适配方案**：照抄到 `DST/electron/services/agent-browser/browser-control/runtime-read-tool-executor.ts`，新增 host-api 动作 `inspectGlobals / searchModules / describeFunction`，禁止模型传任意 JS 表达式，只传路径/关键词/模块索引/数量上限等结构化参数。

#### P2-4. 请求重放沙箱（对应 C3）

**抄代码源文件**：
- `SRC/src/background/browserControl/replayToolExecutor.ts` — **整个文件原样抄**，包括 `prepare_request / send_request / compare_responses` 工具执行器、强制流程 `prepare → boundary.request_user_choice → send → compare`、默认无凭据剥离（Cookie/Authorization/Proxy-Authorization/API Key/Storage/IndexedDB/证书）、method/协议/host/header/body 类型/大小/响应体大小/超时/重定向次数/并发/本轮调用次数限制、默认只允许 GET/HEAD + 可证明无凭据的受限 POST、PUT/PATCH/DELETE/文件上传禁用

**适配方案**：照抄到 `DST/electron/services/agent-browser/browser-control/replay-tool-executor.ts`，依赖 P0-3 抄来的 `BoundaryChoiceToolExecutor` 与 P1-3 抄来的 `automationBoundaryDetector`。background 受控沙箱发起请求用 Node `fetch`，禁止注入页面 fetch。

#### P2-5. 完全访问模式（对应 C5）

**抄代码源文件**：
- `SRC/src/background/browserControl/fullAccessToolExecutor.ts` — **整个文件原样抄**，包括 `full_access.execute_script / fetch / get_network_details / read_storage / revoke` 工具执行器、`credentials: "include"` 默认、工具结果原样回灌 AI 不脱敏逻辑、附件链路识别 `fullAccess: true + redacted: false`

**适配方案**：照抄到 `DST/electron/services/agent-browser/browser-control/full-access-tool-executor.ts`，仅在 P0-3 的 `runtimeMode === 'full_access'` 时启用，依赖 P0-3 抄来的 `isFullAccessAuthorized` 校验。仍受 Chrome/网页 CSP/站点权限/扩展平台硬限制约束 —— 此约束照抄 `SRC/AGENTS.md`。

#### P2-6. 页面上下文提取规则（对应 G3）

**抄代码源文件**：
- `SRC/src/shared/extractionRules/urlPatternGeneration.ts` — URL 正则生成逻辑
- `SRC/src/shared/extractionRules/validation.ts` — 提取规则校验
- `SRC/src/background/urlPatternGenerationMessageHandler.ts` — URL 正则生成消息处理
- `SRC/src/background/pageContextMessageHandler.ts` — 页面上下文提取主逻辑（URL 正则 + CSS/XPath 多行选择器 + 未匹配/未命中/执行失败/空结果统一回退全局提取）
- `SRC/src/shared/chat/pageContextPrompt.ts` — 上下文 prompt 构造

**适配方案**：照抄到 `DST/electron/services/agent-browser/` 与 `DST/shared/agent-browser/`，扩展 `captureValidationSnapshot` 支持多行选择器与全局回退。AI 生成 URL 正则只允许 `new RegExp(pattern)` 可接受的候选 —— 照抄 `SRC/` 中此约束。

### 3.4 P3：低优先级

- Tavily 搜索工具化（G2）：取决于 ClawX 是否需要内置搜索。
- automation-report 按工具调用记录生成（F2）：现有 `BrowserAutomationRunResult` 已够用。

## 4. 架构决策点

### 4.1 单一工具 vs 拆分子工具

**推荐**：保持 `agent_browser` 单一工具，内部按 `runtimeMode` 限制子动作。理由：
- OpenClaw tool registry 不膨胀
- runtimeMode 升级流程更清晰
- 兼容现有 Gateway bridge 协议

### 4.2 browser-window 引擎是否启用 `webContents.debugger`

**推荐**：P1-2（Network 采集）与 P0-2（真实输入事件）启用，但默认关闭，dev-mode 可开。理由：
- `webContents.debugger` 会在 Electron 窗口顶部显示"正在调试此窗口"提示，影响普通用户体验
- 启用后可解锁 AX tree / Network / 真实输入 / Runtime inspect 全部能力
- 与现有 `remoteControl`（独立 CDP endpoint，dev-mode gated）形成互补：`remoteControl` 控外部 Chrome，`agentBrowser` 控内嵌窗口

### 4.3 UID 与现有 CSS selector 共存策略

**推荐**：双轨制。新增 UID-based 动作，保留 selector-based 动作向后兼容。模型协议优先 UID，selector 仅作为 fallback。

### 4.4 Playbook 与 Skills 系统的关系

**推荐**：Playbook 作为 Skills 系统的 browser 子类目，不另起炉灶。每个 Playbook 对应一个 skill 包，复用现有 skill lifecycle。

## 5. 实施顺序建议

```
阶段 1（P0 地基）
├─ P0-1 Accessibility Tree + UID 映射
├─ P0-2 真实 CDP 输入事件优先
└─ P0-3 三模式运行态 + 一次性 Grant
   验收：typecheck + 新增 E2E + 单测全绿

阶段 2（P1 工具治理与诊断）
├─ P1-1 CDP 连接生命周期加固
├─ P1-2 Network 工具集 + 脱敏
├─ P1-3 automationBoundaryDetector
├─ P1-4 工具分类矩阵 + 统一注册表
├─ P1-5 工具附件池
├─ P1-6 AutomationPlaybook → Skills
└─ P1-7 多标签页受控
   验收：harness validate --spec + comms:replay + comms:compare

阶段 3（P2 差异化，按需）
├─ P2-1 JS 资源索引 + 同源补位
├─ P2-2 Source Map 解析
├─ P2-3 受控只读 Runtime
├─ P2-4 请求重放沙箱
├─ P2-5 完全访问模式
└─ P2-6 页面上下文提取规则
   验收：按用例驱动，每个能力配套 E2E
```

**注**：原 P2-6 Chat runtime 工程项核查、P3 Tavily/automation-report 等已移除，见 0.1 边界。Chat runtime / MCP / multi-agent / token usage / web search 均不在本条线，需另立项目。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `webContents.debugger` 在 packaged app 中行为不稳定 | 阶段 1 先在 dev 模式验证，packaged 模式增加 fallback |
| AX tree 在 SPA 上过大撑爆模型上下文 | 复用 browser-ai-assistant 的深度/节点数/字符预算限制 |
| UID 跨导航失效导致模型频繁重新 snapshot | 在 prompt 中明确"导航后必须重新 take_snapshot"，并在 `clickByUid` 失败时自动提示 |
| 三模式运行态与现有 `sensitiveActionPolicy` 语义冲突 | `sensitiveActionPolicy` 保留为 Cron 层约束，`runtimeMode` 为 session 层运行态，二者正交 |
| Network 脱敏遗漏导致凭据泄露 | 单测覆盖所有脱敏字段名变体；详情池上限 + 噪音过滤 |
| 工具附件池与现有 run artifact 重复 | run artifact 保留为离线审计，附件池为 session 级模型上下文注入，用途不同 |
| Playbook 与现有 Skills 系统语义冲突 | Playbook 是 Skills 的 browser 子类目，不引入新概念 |

## 7. 与现有约束的兼容性

- **AGENTS.md Renderer/Main API boundary**：所有新增动作通过 `shared/host-api/contract.ts` + `electron/services/agent-browser-api.ts` 暴露，renderer 不直接 `ipcRenderer.invoke`，不直接 fetch Gateway。
- **i18n 全 locale 覆盖**：新增 UI 字段同步到 `en/zh/ja/ru` 的 `cron.json` 与新增 `browser.json`。
- **Comms-change checklist**：若改动 Gateway bridge 协议（如新增子动作），运行 `pnpm run comms:replay` 与 `pnpm run comms:compare`。
- **Spec-driven harness rule**：若改动涉及 renderer/Main/host-api/api-client/Gateway/OpenClaw runtime 路径，在 `harness/specs/tasks/` 下新增 task spec 并 `pnpm harness validate --spec`。
- **UI change validation**：每个用户可见 UI 改动配套 E2E spec（`tests/e2e/browser-*.spec.ts`）。
- **Doc sync rule**：行为/流程/接口变更同步更新 `README.md` / `README.zh-CN.md` / `README.ja-JP.md`。

## 8. 不吸收的内容（明确排除，见 0.1 边界）

| 能力 | 排除理由 |
|---|---|
| MCP 远程工具接入（G1，含 HTTP/Streamable HTTP、Bearer Token、`tools/list`、`tools/call`） | 属于 ClawX MCP 子系统，与 Agent Browser 正交 |
| Multi-agent 编排 / Role packs / Typed blackboard / Synthesizer DAG | 属于 ClawX multi-agent orchestration 子系统 |
| Chat runtime 工程项（E1 工具决策非流式/E2 DSML 解析/E3 已引导对话/E4 上下文压缩边界/G4 会话级任务隔离） | 属于 ClawX chat runtime 子系统，离开 browser 仍服务于所有工具调用 |
| Tavily / Web search 工具化（G2） | 属于搜索工具，不是 browser 控制能力 |
| Token 用量监控（G5，`ChatTokenUsageSource` / `usageSchemaVersion`） | 属于 ClawX token usage 子系统 |
| Chrome MV3 service worker / Side Panel / Chrome Sync / manifest 合约 | 平台无关项，ClawX 是 Electron 桌面应用 |
| `chrome.debugger` 顶部"已开始调试此浏览器"提示作为授权锚点 | Electron 内嵌窗口无此原生提示，需自行设计等价 UI |

**边界自检**：执行任何能力前，先问"这个能力离开 Agent Browser session 还能独立工作吗？" 若能，则不属于本条线。例如：
- DSML 解析 → 离开 browser 仍服务于所有工具调用 → 排除
- Network 脱敏 → 只在 browser session 内采集请求时生效 → 保留
- 上下文压缩 → 离开 browser 仍用于所有对话 → 排除
- 请求重放沙箱 → 只在 browser session 内重放请求时生效 → 保留

## 9. 附录：抄代码源文件清单（按优先级排序）

> 本附录是执行抄写时的快速查阅表，按优先级排列。每个条目格式：`源文件 → 目标文件 | 优先级 | 修改程度`

### P0 阶段（地基与安全）

| 源文件（SRC/） | 目标文件（DST/） | 优先级 | 修改程度 |
|---|---|---|---|
| `src/background/browserControl/actions.ts` | `electron/services/agent-browser/browser-control/actions.ts` | P0 | API 调用层替换 |
| `src/background/browserControl/`（BrowserDebuggerConnection） | `electron/services/agent-browser/browser-control/browser-debugger-connection.ts` | P0 | `chrome.debugger` → `webContents.debugger` |
| `src/shared/browserControl.ts` | `shared/agent-browser/browser-control.ts` | P0 | 零修改 |
| `src/shared/toolAuthorization.ts` | `shared/agent-browser/tool-authorization.ts` | P0 | 零修改 |
| `src/background/browserControl/boundaryChoiceToolExecutor.ts` | `electron/services/agent-browser/browser-control/boundary-choice-tool-executor.ts` | P0 | `chrome.runtime.sendMessage` → IPC |
| `src/side-panel/components/BoundaryChoiceDialog.tsx` | `src/components/agent-browser/BoundaryChoiceDialog.tsx` | P0 | 样式类名替换 |

### P1 阶段（工具治理与诊断）

| 源文件（SRC/） | 目标文件（DST/） | 优先级 | 修改程度 |
|---|---|---|---|
| `src/background/browserControl/networkRecorder.ts` | `electron/services/agent-browser/browser-control/network-recorder.ts` | P1 | API 调用层替换 |
| `src/background/browserControl/networkToolExecutor.ts` | `electron/services/agent-browser/browser-control/network-tool-executor.ts` | P1 | 零修改 |
| `src/shared/networkContext.ts` | `shared/agent-browser/network-context.ts` | P1 | 零修改 |
| `src/shared/types.ts`（Network 部分） | `shared/agent-browser/types.ts` | P1 | 零修改 |
| `src/background/browserControl/automationBoundaryDetector.ts` | `electron/services/agent-browser/browser-control/automation-boundary-detector.ts` | P1 | 零修改 |
| `src/shared/models/toolRegistry.ts` | `shared/agent-browser/tool-registry.ts` | P1 | 零修改 |
| `src/shared/toolArtifacts.ts` | `shared/agent-browser/tool-artifacts.ts` | P1 | 零修改 |
| `src/shared/automationPlaybooks.ts` | `shared/agent-browser/automation-playbooks.ts` | P1 | 零修改 |
| `src/background/automationPlaybookSelector.ts` | `electron/services/agent-browser/automation-playbook-selector.ts` | P1 | 零修改 |
| `src/side-panel/components/settings/AutomationPlaybookSettings.tsx` | `src/components/agent-browser/AutomationPlaybookSettings.tsx` | P1 | 样式类名替换 |

### P2 阶段（差异化能力）

| 源文件（SRC/） | 目标文件（DST/） | 优先级 | 修改程度 |
|---|---|---|---|
| `src/background/browserControl/jsSourceIndex.ts` | `electron/services/agent-browser/browser-control/js-source-index.ts` | P2 | API 调用层替换 |
| `src/background/browserControl/jsSourceToolExecutor.ts` | `electron/services/agent-browser/browser-control/js-source-tool-executor.ts` | P2 | 零修改 |
| `src/background/browserControl/sameOriginJsFetcher.ts` | `electron/services/agent-browser/browser-control/same-origin-js-fetcher.ts` | P2 | 零修改 |
| `src/background/browserControl/sameOriginSourceMapFetcher.ts` | `electron/services/agent-browser/browser-control/same-origin-source-map-fetcher.ts` | P2 | 零修改 |
| `src/background/browserControl/sourceMapFetchGuards.ts` | `electron/services/agent-browser/browser-control/source-map-fetch-guards.ts` | P2 | 零修改 |
| `src/background/browserControl/sourceMapToolExecutor.ts` | `electron/services/agent-browser/browser-control/source-map-tool-executor.ts` | P2 | 零修改 |
| `src/background/browserControl/runtimeReadToolExecutor.ts` | `electron/services/agent-browser/browser-control/runtime-read-tool-executor.ts` | P2 | API 调用层替换 |
| `src/background/browserControl/replayToolExecutor.ts` | `electron/services/agent-browser/browser-control/replay-tool-executor.ts` | P2 | API 调用层替换 |
| `src/background/browserControl/fullAccessToolExecutor.ts` | `electron/services/agent-browser/browser-control/full-access-tool-executor.ts` | P2 | API 调用层替换 |
| `src/shared/extractionRules/urlPatternGeneration.ts` | `shared/agent-browser/extraction-rules/url-pattern-generation.ts` | P2 | 零修改 |
| `src/shared/extractionRules/validation.ts` | `shared/agent-browser/extraction-rules/validation.ts` | P2 | 零修改 |
| `src/background/urlPatternGenerationMessageHandler.ts` | `electron/services/agent-browser/url-pattern-generation-handler.ts` | P2 | API 调用层替换 |
| `src/background/pageContextMessageHandler.ts` | `electron/services/agent-browser/page-context-handler.ts` | P2 | API 调用层替换 |
| `src/shared/chat/pageContextPrompt.ts` | `shared/agent-browser/page-context-prompt.ts` | P2 | 零修改（仅 pageContext 提示词部分，非 chat runtime） |

> **已排除**：`modelResponseToolParser.ts` / `toolCalling/toolLoop.ts` / `chat/contextCompression.ts` / `chat/buildChatRequestMessages.ts` 属于 chat runtime 子系统，不在本条线，见 0.1 边界。

### 测试文件抄写清单

| 源文件（SRC/tests/） | 目标文件（DST/tests/） | 优先级 |
|---|---|---|
| `toolAuthorization.test.ts` | `unit/agent-browser/tool-authorization.test.ts` | P0 |
| `boundaryChoiceToolExecutor.test.ts` | `unit/agent-browser/boundary-choice-tool-executor.test.ts` | P0 |
| `actions.test.ts` | `unit/agent-browser/actions.test.ts` | P0 |
| `networkRecorder.test.ts` | `unit/agent-browser/network-recorder.test.ts` | P1 |
| `networkToolExecutor.test.ts` | `unit/agent-browser/network-tool-executor.test.ts` | P1 |
| `networkContext.test.ts` | `unit/agent-browser/network-context.test.ts` | P1 |
| `automationBoundaryDetector.test.ts` | `unit/agent-browser/automation-boundary-detector.test.ts` | P1 |
| `toolArtifacts.test.ts` | `unit/agent-browser/tool-artifacts.test.ts` | P1 |
| `automationPlaybooks.test.ts` | `unit/agent-browser/automation-playbooks.test.ts` | P1 |
| `jsSourceIndex.test.ts` | `unit/agent-browser/js-source-index.test.ts` | P2 |
| `sameOriginSourceMapFetcher.test.ts` | `unit/agent-browser/same-origin-source-map-fetcher.test.ts` | P2 |
| `runtimeReadToolExecutor.test.ts` | `unit/agent-browser/runtime-read-tool-executor.test.ts` | P2 |
| `replayToolExecutor.test.ts` | `unit/agent-browser/replay-tool-executor.test.ts` | P2 |
| `fullAccessToolExecutor.test.ts` | `unit/agent-browser/full-access-tool-executor.test.ts` | P2 |
| E2E：snapshot/UID/click | `e2e/browser-snapshot-uid.spec.ts` | P0 |
| E2E：multi-tab | `e2e/browser-multi-tab.spec.ts` | P1 |
| E2E：network | `e2e/browser-network.spec.ts` | P1 |

### 修改程度说明

- **零修改**：逐字照抄，仅调整 import 路径。
- **API 调用层替换**：抄逻辑结构、常量、类型、正则、阈值、流程编排，仅把 `chrome.debugger.*` / `chrome.tabs.*` / `chrome.runtime.*` 替换为 Electron 等价 API。
- **样式类名替换**：抄组件结构、状态机、事件处理，仅把 Tailwind/CSS 类名替换为 ClawX `src/styles/globals.css` 设计 token。

### 依赖新增

抄写过程需要新增的 npm 依赖（按 P2 阶段需要）：

```bash
pnpm add @jridgewell/trace-mapping
```

其余能力无新增依赖，全部复用 ClawX 既有 stack（Electron、React、TypeScript、Vitest、Playwright）。