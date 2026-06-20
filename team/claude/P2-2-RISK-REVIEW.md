# P2-2 风险审查（只读）

> 审查人：Claude  
> 日期：2026-06-09  
> 范围：P2-2 风险审查；只读源码与已有可见测试，不跑 smoke、不启动 UI、不改 OpenClaw runtime 源码。

## 0. 前置说明

用户要求先读的以下交接/审计文档在当前 checkout 中未找到：

- `team/codex/LEADER-HANDOFF-R9-P2.md`
- `team/codex/R9-MISSING-METHODS-AUDIT.md`
- `team/trae_cn/R9-METHOD-SEMANTICS.md`
- `team/opencode/R9-TERMINAL-CHANNELS-INDEX.md`
- `team/trae_cn/R7-RPC-GATE-PLAN.md`

因此本报告基于当前源码与已有单测可见行为做风险审查；未验证 leader 文档中的具体执行清单。未运行 smoke、未启动 UI、未运行测试。

## 1. 总体结论

P2-2 如果只是补 host-api/Electron 层单测、且全部 mock `GatewayManager.rpc`、`fetch/proxyAwareFetch`、Electron store/userData，则风险可控。

但如果 P2-2 使用真实 app/Gateway/runtime 做“缺失方法”验证，当前代码里存在以下高风险误触发面：

1. `gateway.rpc({ method: 'chat.send' })` 被权限分类列为 safe，可能直达真实 Runtime 并触发 LLM 费用。
2. `providers.validateKey` 在某些 fallback 路径会 POST `/responses`、`/chat/completions` 或 Anthropic `/messages`，可能触发第三方网络与极小但真实的推理计费。
3. `channels.startLogin` 会启动 WhatsApp/WeChat 登录流程；`channels.saveConfig` 会安装/复制插件、写配置并触发 Gateway reload/restart。
4. `terminal.run` 会尝试 `terminal.run`/`shell.run`/`exec.run`/`tools.exec` 直连 Runtime；若未 mock，可能真实执行命令。
5. `mcp.listTools`/`mcp.callTool` 在 Gateway running 时会优先调用 Runtime RPC；`callTool` 可能真实调用工具。
6. approval block 是预期的安全返回，不应被测试框架误判为 handler failure。

## 2. 风险矩阵

| 审查项 | 风险等级 | 结论 | 证据 | 建议护栏 |
|---|---:|---|---|---|
| 触发真实 LLM 费用 | 高 | 有误触发可能 | `chat.send` 在 `SAFE_GATEWAY_METHODS` 中，`gateway.rpc` 会放行并调用 Runtime：`electron/services/workspace-permissions.ts:50`、`electron/services/gateway-api.ts:118`、`electron/services/gateway-api.ts:173` | P2-2 不要通过真实 `gateway.rpc('chat.send')` 测试；只用 mock。Provider validation 也不要连真实 key/baseUrl。 |
| 外部网络 / uvx / npx / 第三方服务 | 高 | 有误触发可能 | provider validation 使用 `proxyAwareFetch`，fallback 会 POST probe：`electron/services/providers/provider-validation.ts:261`、`electron/services/providers/provider-validation.ts:287`、`electron/services/providers/provider-validation.ts:314`；channel validation/login 会请求 Discord/Telegram/WhatsApp/WeChat：`electron/utils/channel-config.ts:1508`、`electron/utils/channel-config.ts:1592`、`electron/services/channels-api.ts:1220` | P2-2 不测真实 provider/channel login/validate；mock `fetch/proxyAwareFetch`、`whatsAppLoginManager`、`startWeChatLoginSession`。 |
| 写入真实用户配置 | 高 | 有误触发可能 | `electron-store` 默认会写 app userData；workspace/permission store 名称为 `workspaces`、`workspace-permissions`：`electron/services/workspaces-api.ts:62`、`electron/services/permissions-api.ts:53`；OpenClaw 启动 sanitize 会同步 sandbox/exec 设置到 runtime config：`electron/utils/openclaw-auth.ts:2606` | 仅用 isolated Electron userData/state 或 mocked `electron-store`；不要启动真实 app/Gateway；不要调用会写 openclaw config 的 channel/provider/agent save 路径。 |
| approval block 被当作 handler 失败 | 中 | 易误判 | Terminal/Gateway/File approval 均返回 `success:false` + `blocked:true`/`approvalRequired:true`，不是 throw：`electron/services/terminal-api.ts:269`、`electron/services/gateway-api.ts:136`、`electron/services/files-api.ts:382` | 单测断言 block shape；不要把所有 `success:false` 统一视为 test failure。 |
| 误测 direct `mcp.listTools/callTool` | 高 | 有误触发可能 | `listTools` 在 Gateway running 时调用 `mcp.listTools`；`callTool` 调用 `mcp.callTool`，失败才 fallback blocked：`electron/services/mcp-api.ts:391`、`electron/services/mcp-api.ts:717`、`electron/services/mcp-api.ts:738` | 对 `getStatus().state` 设为 stopped，或 mock `rpc` 抛 unknown method；不要连真实 Runtime/MCP server；不要断言真实 tools。 |
| 误测 `shutdown` | 中/高 | 可能关掉外部 Gateway | `GatewayManager.stop()` 在 `!ownsProcess` 且 ws open 时会发 `shutdown` RPC：`electron/gateway/manager.ts:478`；`rpc('shutdown')` 会直接发帧：`electron/gateway/manager.ts:867` | 不对真实 external Gateway 调 `stop`/`shutdown`；用 fake manager/ws。 |
| 误测 terminal direct exec | 高 | 可能真实执行命令 | `terminal.run` 依次尝试 `terminal.run`/`shell.run`/`exec.run`/`tools.exec`：`electron/services/terminal-api.ts:37`、`electron/services/terminal-api.ts:180`、`electron/services/terminal-api.ts:322` | 必须 mock `gatewayManager.rpc`；不要用真实 Gateway；不要传可联网/可写命令。 |
| 误测 `channels.add/requestQr` | 高 | 当前 contract 不存在这些方法，QR 实际入口是 login | host contract 只有 `saveConfig/setEnabled/startLogin/cancelLogin`，没有 `channels.add`/`requestQr`：`shared/host-api/contract.ts:1181`；`startLogin` 会真实启动 QR 登录：`electron/services/channels-api.ts:1220` | 不测旧方法名；不通过 Gateway 直发 `channels.add/requestQr`；QR 只用 mock 验证事件形状。 |
| 修改 OpenClaw runtime src | 中 | 无必要 | 缺失方法的防护/fallback 在 Electron host 层已有入口：`electron/services/mcp-api.ts:717`、`electron/services/terminal-api.ts:180`、`electron/services/gateway-api.ts:108` | P2-2 不应改 `openclaw_runtime/src`；如需补行为，优先补 Electron adapter 或测试。 |

## 3. 具体发现

### 3.1 真实 LLM 费用风险

`workspace-permissions.ts` 把 `chat.send` 放进 `SAFE_GATEWAY_METHODS`：`electron/services/workspace-permissions.ts:50`。这意味着如果 P2-2 通过 `hostApi.gateway.rpc({ method: 'chat.send', ... })` 做真实 smoke，它不会触发 approval gate，而会在 `createGatewayApi` 里走到 `runGatewayRpc`：`electron/services/gateway-api.ts:173`。

这对“只测 RPC 是否存在”的场景风险很高：`chat.send` 不是纯探测，它可能驱动真实模型调用并产生费用。P2-2 应避免所有真实 `chat.send`、agent run、provider probe。

Provider key validation 也不是完全无费用：当 `/models` 不可用时，会 fallback 到 POST probe：

- OpenAI Responses probe：`electron/services/providers/provider-validation.ts:261`
- Chat Completions probe：`electron/services/providers/provider-validation.ts:287`
- Anthropic Messages probe：`electron/services/providers/provider-validation.ts:314`

这些请求使用 `validation-probe` + `max_tokens: 1`，通常会失败或很小，但仍可能到达第三方服务并计费/产生日志。

### 3.2 外部网络与第三方服务风险

以下路径不适合 P2-2 用真实环境触发：

- Provider validation/model discovery：`proxyAwareFetch` 到 provider endpoint。
- Discord/Telegram channel credential validation：`electron/utils/channel-config.ts:1508`、`electron/utils/channel-config.ts:1592`。
- WeChat/WhatsApp login：`electron/services/channels-api.ts:1220` 会启动登录流程，WeChat 分支还会安装/确保插件、清理状态并生成 QR。
- MCP HTTP heartbeat：非-stdio 且 networkPolicy 允许时会 `fetch(server.url)`：`electron/services/mcp-api.ts:336`。

`plugin-install.ts` 当前看起来主要从 bundled mirror 或 local `node_modules` 复制插件，没有直接 `npx/uvx` 调用；但 channel `saveConfig/startLogin` 会写入插件/config 并触发 Gateway refresh，仍不应在只读风险审查或未隔离测试中执行。

### 3.3 真实用户配置写入风险

多处 Electron service 默认使用 `electron-store`，如果没有 isolated `userData` 或 mock，会写入真实用户状态：

- workspace store：`electron/services/workspaces-api.ts:62`
- permission approval store：`electron/services/permissions-api.ts:53`
- runtime permission sync 读取 workspace store 并映射到 OpenClaw config：`electron/utils/workspace-runtime-permissions.ts:55`
- startup sanitize 会把 workspace permission 同步到 OpenClaw sandbox/exec 配置：`electron/utils/openclaw-auth.ts:2606`

此外，channels/providers/agents 的 save/update/delete 路径会同步到 OpenClaw runtime config 并触发 reload/restart。P2-2 若需要验证这些 API，只能使用 mocked store/temp userData/temp OpenClaw config dir。

### 3.4 approval block 语义

审批 gate 的安全返回是“成功进入 block 状态”，不是 handler 崩溃：

- terminal dangerous command 返回 `success:false, blocked:true, approvalRequired:true`：`electron/services/terminal-api.ts:269`
- gateway dangerous RPC 返回同类 shape：`electron/services/gateway-api.ts:136`
- file write approval 返回 `ok:false, error:'approvalRequired', approvalRequired:true`：`electron/services/files-api.ts:382`

P2-2 测试如果统一把 `success:false` / `ok:false` 视为失败，会误报。正确断言应区分：

- handler throw / rejected promise：真正失败。
- blocked + approvalRequired：权限系统按预期拦截。
- blocked without approvalRequired：当前模式硬阻止，仍可能是预期行为。

### 3.5 direct MCP 方法误测风险

`mcp.listTools`/`mcp.callTool` 当前不是纯本地 no-op：

- `tryGatewayMcpRpc` 在 Gateway running 时会调用 Runtime：`electron/services/mcp-api.ts:391`
- `listTools` 优先走 `mcp.listTools`，只有无 runtime success 才返回空 tools fallback：`electron/services/mcp-api.ts:717`
- `callTool` 优先走 `mcp.callTool`，只有无 runtime result 才返回 blocked fallback：`electron/services/mcp-api.ts:738`

因此 P2-2 不应对真实 Gateway/Runtime 做 direct MCP callTool/listTools smoke。若要测试“缺失方法 fallback”，应 mock：

- `gatewayManager.getStatus().state` 为 `stopped`；或
- `gatewayManager.rpc` 抛 `unknown method`，并断言 fallback shape。

### 3.6 direct terminal exec 风险

`terminal.run` 会把允许的命令发到 Runtime，并依次尝试多个 method：`terminal.run`、`shell.run`、`exec.run`、`tools.exec`：`electron/services/terminal-api.ts:37`、`electron/services/terminal-api.ts:180`。

已有单测已经用 mock 验证“不 fallback 到本地 shell”：`tests/unit/terminal-api.test.ts:92`。P2-2 不应再用真实 Gateway 验证 direct exec。

额外注意：`classifyWorkspaceCommand` 以命令首词判断 read-only，例如 `pwd`/`ls` 会被视为 safe：`electron/services/workspace-permissions.ts:90`。不要传 `pwd && curl ...` 这类 compound shell 命令做测试；它可能被误判为 read-only 并放行到 Runtime。

### 3.7 channels.add/requestQr 风险

当前 `HostApiContract['channels']` 没有 `channels.add` 或 `requestQr`：`shared/host-api/contract.ts:1181`。当前 QR 相关入口是 `startLogin/cancelLogin`，而 `startLogin` 会真实启动 WhatsApp/WeChat login：`electron/services/channels-api.ts:1220`。

因此：

- 不应为了“补缺失方法”向 Gateway 直发旧 method `channels.add` / `channels.requestQr`。
- 不应用真实 `startLogin` 测 QR；应 mock login manager、mock event emit。

### 3.8 shutdown 风险

`GatewayManager.stop()` 在连接外部 Gateway 时会先发 `shutdown` RPC：`electron/gateway/manager.ts:478`。如果 P2-2 使用真实外部 Gateway 做 stop/shutdown smoke，可能关掉用户正在使用的 Gateway。

P2-2 不应直测真实 `shutdown`；只在 fake ws/fake manager 中验证 unsupported shutdown 的容错逻辑。

### 3.9 OpenClaw runtime src 修改风险

从当前源码看，P2-2 目标涉及的缺失方法/fallback/权限语义主要在 Electron host adapter 层：

- MCP fallback：`electron/services/mcp-api.ts:717`
- Terminal direct exec fallback：`electron/services/terminal-api.ts:180`
- Gateway approval gate：`electron/services/gateway-api.ts:108`
- Channels host contract：`shared/host-api/contract.ts:1181`

没有看到必须改 `openclaw_runtime/src` 的证据。P2-2 应避免修改 OpenClaw runtime 源码；否则会扩大同步/上游兼容风险。

## 4. P2-2 执行前建议的安全边界

如果 leader 后续批准执行 P2-2，建议把执行边界写死：

1. **只跑 unit tests，不跑 smoke/E2E/UI**，除非 leader 单独批准 isolated 环境。
2. **全量 mock GatewayManager**：`getStatus()`、`rpc()`、`debouncedRestart()`、`debouncedReload()`。
3. **mock 网络**：`fetch`、`proxyAwareFetch`、provider validation、Discord/Telegram/WhatsApp/WeChat login。
4. **mock/隔离 store**：`electron-store`、Electron `app.getPath('userData')`、OpenClaw config dir。
5. **禁止真实命令执行**：terminal tests 只断言 `gatewayManager.rpc` 被调用/未调用；不要连接 Runtime。
6. **禁止 direct old methods**：不要直发 `channels.add/requestQr/shutdown/mcp.callTool/tools.exec/chat.send` 到真实 Gateway。
7. **approval block 按预期断言**：blocked/approvalRequired 是 pass 条件，不是 handler failure。
8. **不修改 `openclaw_runtime/src`**，除非后续 leader 明确改范围。

## 5. 等待 leader

本轮已按要求完成只读风险审查报告。未运行 smoke，未启动 UI，未修改除本报告（以及为容纳报告创建的 `team/claude` 目录）以外的源码文件。等待 leader 下一步指示。
