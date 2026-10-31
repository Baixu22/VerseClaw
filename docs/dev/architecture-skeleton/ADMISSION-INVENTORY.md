# 接入层盘点与唯一入口裁定（ADMISSION-INVENTORY）

> 状态：`inventory + adjudication`（只盘点、只裁定；**不授权实现**）
> 节点：`TF-0629`（批次 A / A0，父 `TF-0628` 架构骨架收敛）
> 合同：`harness/specs/tasks/architecture-skeleton-admission-inventory.md`
> 宪章：`docs/dev/architecture-skeleton/CHARTER.md` §1.1、§5 批次 A
> 录入日期：2026-10-31，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: claude-fable-5`）；本文件不含任何真人操作或真人数据

本文件回答合同第 49–55 行的五个问题：类型化 Host API 模块与实现文件、extension 贡献、扁平 IPC 全集与前缀、双入口领域及其消费者、每个双入口领域的唯一入口裁定。所有数字由**磁盘静态读取**得到，复现命令见 §10。本轮**不修改**任何 handler / facade / contract / preload，**不**迁移、**不**删除、**不**改名，**不**新增 Host API 模块或 package script。

---

## 0. 基线

| 项 | 值 |
|---|---|
| HEAD | `1bae3240705cb85b100f10ef0de200c4e1865d91` |
| tree | `f8deb42b9c04adfa7a810774d8be5997c2082e07` |
| 分支 | `main`（仓库主检出） |
| 工作区 | 盘点前 `git status --porcelain` 13 行（4 个已修改跟踪文件 + 9 个未跟踪 harness/docs 文件，均为上游本体论/骨架规划件，与被盘点的 7 个源码文件无交集）；未出现大面积瞬时脏化 |
| `shared/host-api/contract.ts` | 6207 行 |
| `src/lib/host-api.ts` | 1812 行 |
| `electron/main/ipc-handlers.ts` | 1746 行 |
| `electron/preload/index.ts` | 200 行 |
| `hostApiRegistry.registerCoreServices({` | `electron/main/ipc-handlers.ts:226` |
| `ipcMain.handle('host:invoke', …)` | `electron/main/ipc/host-invoke.ts:381` |

上一轮（宪章 §1.1）的读数 58 / 1 / 43 / 10 / 8 在本基线上**全部复现**；本轮额外发现见 §7。

---

## 1. 结论摘要

| 项 | 本轮实测 | 备注 |
|---|---|---|
| 类型化 Host API 模块（`HostApiContract` 成员） | **58** | 57 个内联块 + 1 个别名成员 `changeContext`（§7.1） |
| 其中由 `registerCoreServices` 注册 | 57 | `ipc-handlers.ts:226-300` |
| 其中由 extension contribution 注册 | **1**（`diagnostics`） | `electron/extensions/builtin/diagnostics.ts:17` |
| 类型化 action 总数 | 559 | 551 内联 + 8（`changeContext`） |
| 扁平 IPC channel（`ipcMain.handle('x:y')`，`ipc-handlers.ts`） | **43** | 其中 2 个为多行写法（§10 命令已覆盖） |
| 扁平 channel 前缀 | **10** | `provider`12 `file`6 `window`5 `settings`5 `app`4 `shell`3 `openclaw`3 `gateway`2 `dialog`2 `usage`1 |
| 前缀与类型化模块名**字面相同** | **8** | `app` `dialog` `gateway` `openclaw` `settings` `shell` `usage` `window` |
| 前缀与类型化模块名**单复数近似** | 2 | `provider`↔`providers`、`file`↔`files` |
| 有类型化对应领域的扁平前缀 | **10 / 10** | 没有任何扁平前缀是"只有扁平没有类型化"的领域 |
| `ipc-handlers.ts` 之外的 `ipcMain.handle` | 1 | 只有 `host:invoke`（`electron/main/ipc/host-invoke.ts:381`） |
| renderer 源码直接 `ipcRenderer.invoke(` | **0** | `src/**`，排除测试与 `.d.ts` |
| renderer 源码经 preload 包装消费扁平 channel | **1 个 channel / 4 处 / 2 文件** | 仅 `shell:openExternal`，经 `window.electron.openExternal` |
| preload 白名单条目 | 44 | 与 43 个 handler **不一一对应**（§7.2） |

**裁定总纲（§6 逐条展开）**：10 个双入口领域的唯一入口**全部**裁定为类型化 Host API（`host:invoke` + `HostApiRegistry`）。依据不是偏好，而是四条可读证据：(a) `pnpm contract:check` 只覆盖该入口；(b) 该入口有 sender 授权（`requireSender: true` + `allowedWebContentsIds`，`host-invoke.ts:248-249, 301-304`），扁平入口在 `ipc-handlers.ts` 中 **0 处** sender 校验；(c) 该入口有逐 action 的 `ownerId` 与重复注册即抛错（`host-invoke.ts:168-225`），扁平入口没有 owner 概念；(d) renderer 事实上已经只走该入口（唯一例外是 `shell:openExternal` 的 4 处包装调用）。

---

## 2. 接入面 A：类型化 Host API（58 模块）

**路径**：renderer `hostApi.<module>.<action>()`（`src/lib/host-api.ts`）→ `invokeHost(module, action, payload)`（`src/lib/host-api-client.ts:212` 经 `window.verseClaw.hostInvoke`）→ preload `ipcRenderer.invoke('host:invoke', request)`（`electron/preload/index.ts:191`）→ Main `createHostInvokeDispatcher` → `HostApiRegistry.resolve(module, action)` → 服务实现。

**Owner 规则**：`HostApiRegistry.registerAction` 为每个 `(module, action)` 记录 `ownerId`（核心服务为 `'core'`，extension 为其 `id`），重复注册抛 `Host API action already registered`（`electron/main/ipc/host-invoke.ts:211-225`）。

**覆盖的门禁**：`scripts/contract-check.mjs` 以 `parseContractActions`（contract 内联块）/ `parseFacadeActions`（facade）/ `parseRegisteredModules`（`registerCoreServices` + `module: '…'`）三方对账。

下表 "renderer 调用点/文件" 统计 `src/**` 中 `hostApi.<module>.` 的出现次数与文件数（排除 `*.test.*`、`*.d.ts` 与 facade 自身 `src/lib/host-api.ts`、`src/lib/host-api/**`）。

| # | 模块 | contract.ts 行 | 声明形式 | action 数 | facade (src/lib/host-api.ts) 行 | 注册点 (ipc-handlers.ts) 行 | Main 侧实现文件 | owner | renderer 调用点/文件 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `app` | 5494 | inline | 4 | 703 | 227 | `electron/services/app-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 2 | `versegit` | 5500 | inline | 1 | 698 | 228 | `electron/services/versegit-api.ts` | core（`registerCoreServices`） | 0 / 0 |
| 3 | `openclaw` | 5503 | inline | 4 | 730 | 229 | `electron/services/openclaw-api.ts` | core（`registerCoreServices`） | 4 / 3 |
| 4 | `shell` | 5509 | inline | 3 | 736 | 230 | `electron/services/shell-api.ts` | core（`registerCoreServices`） | 25 / 20 |
| 5 | `dialog` | 5514 | inline | 2 | 741 | 231 | `electron/services/dialog-api.ts` | core（`registerCoreServices`） | 10 / 8 |
| 6 | `window` | 5518 | inline | 6 | 745 | 232 | `electron/services/system-notifications-api.ts` | core（`registerCoreServices`） | 7 / 3 |
| 7 | `updates` | 5526 | inline | 3 | 755 | 233 | `electron/services/updates-api.ts` | core（`registerCoreServices`） | 0 / 0 |
| 8 | `uv` | 5531 | inline | 1 | 760 | 234 | `electron/services/uv-api.ts` | core（`registerCoreServices`） | 1 / 1 |
| 9 | `vtoken` | 5534 | inline | 12 | 763 | 235 | `electron/services/vtoken-api.ts` | core（`registerCoreServices`） | 0 / 0 |
| 10 | `dcsProdFlags` | 5549 | inline | 7 | 777 | 236 | `electron/services/dcs-prod-flags-api.ts` | core（`registerCoreServices`） | 8 / 3 |
| 11 | `settings` | 5558 | inline | 5 | 801 | 246 | `electron/services/settings-api.ts` | core（`registerCoreServices`） | 24 / 2 |
| 12 | `efficiency` | 5566 | inline | 2 | 792 | 247 | `electron/services/efficiency-api.ts` | core（`registerCoreServices`） | 3 / 2 |
| 13 | `resourceEnvelope` | 5571 | inline | 1 | 798 | 248 | `electron/services/resource-envelope-api.ts` | core（`registerCoreServices`） | 1 / 1 |
| 14 | `workspaces` | 5574 | inline | 15 | 810 | 237 | `electron/services/workspaces-api.ts` | core（`registerCoreServices`） | 27 / 6 |
| 15 | `projectRules` | 5591 | inline | 3 | 843 | 238 | `electron/services/project-rules-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 16 | `codeReview` | 5596 | inline | 2 | 1572 | 267 | `electron/services/code-review-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 17 | `changeContext` | 5600 | alias → `ChangeContextApiContract`（`shared/types/change-context.ts:510`） | 8 | 1582 | 268 | `electron/services/change-context-api.ts` | core（`registerCoreServices`） | 8 / 1 |
| 18 | `remoteForge` | 5601 | inline | 5 | 1624 | 272 | `electron/services/remote-forge-api.ts` | core（`registerCoreServices`） | 8 / 3 |
| 19 | `terminal` | 5608 | inline | 8 | 848 | 239 | `electron/services/terminal-api.ts` | core（`registerCoreServices`） | 7 / 2 |
| 20 | `sessionActivity` | 5618 | inline | 1 | 858 | 240 | `electron/services/session-activity-api.ts` | core（`registerCoreServices`） | 1 / 1 |
| 21 | `git` | 5621 | inline | 36 | 861 | 241 | `electron/services/git-api.ts` | core（`registerCoreServices`） | 65 / 9 |
| 22 | `permissions` | 5659 | inline | 3 | 899 | 242 | `electron/services/permissions-api.ts` | core（`registerCoreServices`） | 11 / 8 |
| 23 | `orchestrationPresets` | 5664 | inline | 3 | 908 | 244 | `electron/services/orchestration-presets-api.ts` | core（`registerCoreServices`） | 0 / 0 |
| 24 | `webPreview` | 5669 | inline | 5 | 919 | 245 | `electron/services/web-preview-api.ts` | core（`registerCoreServices`） | 4 / 1 |
| 25 | `gateway` | 5676 | inline | 8 | 926 | 249 | `electron/services/gateway-api.ts` | core（`registerCoreServices`） | 54 / 16 |
| 26 | `runtimeApprovals` | 5686 | inline | 2 | 943 | 243 | `electron/services/runtime-approvals-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 27 | `localControlPlane` | 5690 | inline | 3 | 949 | 250 | `electron/services/local-control-plane-api.ts` | core（`registerCoreServices`） | 8 / 1 |
| 28 | `capabilities` | 5695 | inline | 1 | 958 | 251 | `electron/services/capabilities-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 29 | `remoteControl` | 5698 | inline | 7 | 963 | 253 | `electron/services/remote-control-api.ts` | core（`registerCoreServices`） | 12 / 2 |
| 30 | `agentBrowser` | 5707 | inline | 81 | 972 | 254 | `electron/services/agent-browser-api.ts` | core（`registerCoreServices`） | 57 / 7 |
| 31 | `mcp` | 5798 | inline | 10 | 1138 | 255 | `electron/services/mcp-api.ts` | core（`registerCoreServices`） | 16 / 3 |
| 32 | `sandbox` | 5810 | inline | 4 | 1150 | 256 | `electron/services/sandbox-api.ts` | core（`registerCoreServices`） | 4 / 1 |
| 33 | `hooks` | 5816 | inline | 2 | 1160 | 257 | `electron/services/hooks-api.ts` | core（`registerCoreServices`） | 2 / 1 |
| 34 | `logs` | 5820 | inline | 6 | 1164 | 258 | `electron/services/logs-api.ts` | core（`registerCoreServices`） | 4 / 2 |
| 35 | `channels` | 5828 | inline | 14 | 1216 | 259 | `electron/services/channels-api.ts` | core（`registerCoreServices`） | 16 / 5 |
| 36 | `agents` | 5844 | inline | 12 | 1263 | 260 | `electron/services/agents-api.ts` | core（`registerCoreServices`） | 16 / 4 |
| 37 | `roles` | 5858 | inline | 10 | 1292 | 261 | `electron/services/roles-api.ts` | core（`registerCoreServices`） | 10 / 2 |
| 38 | `diagnostics` | 5870 | inline | 2 | 1334 | —（extension） | `electron/services/diagnostics-api.ts`（经 `electron/extensions/builtin/diagnostics.ts:18` 的 `createDiagnosticsApi`） | extension `builtin/diagnostics`（`electron/extensions/builtin/diagnostics.ts:17`） | 2 / 2 |
| 39 | `agentDev` | 5874 | inline | 19 | 1338 | 252 | `electron/services/agent-dev-api.ts` | core（`registerCoreServices`） | 13 / 1 |
| 40 | `providers` | 5895 | inline | 26 | 1387 | 262 | `electron/services/providers-api.ts` | core（`registerCoreServices`） | 15 / 3 |
| 41 | `files` | 5923 | inline | 9 | 1439 | 263 | `electron/services/files-api.ts` | core（`registerCoreServices`） | 11 / 4 |
| 42 | `media` | 5934 | inline | 6 | 1458 | 264 | `electron/services/media-api.ts` | core（`registerCoreServices`） | 8 / 5 |
| 43 | `sessions` | 5942 | inline | 31 | 1470 | 265 | `electron/services/sessions-api.ts` | core（`registerCoreServices`） | 39 / 11 |
| 44 | `chat` | 5975 | inline | 2 | 1567 | 266 | `electron/services/chat-api.ts` | core（`registerCoreServices`） | 4 / 2 |
| 45 | `workProviders` | 5979 | inline | 3 | 1641 | 273 | `electron/services/work-providers-api.ts` | core（`registerCoreServices`） | 1 / 1 |
| 46 | `knowledge` | 5984 | inline | 56 | 1650（`knowledgeHostApi` → `src/lib/host-api/knowledge/index.ts`） | 274 | `electron/services/knowledge-api.ts` | core（`registerCoreServices`） | 70 / 5 |
| 47 | `cron` | 6045 | inline | 8 | 1651 | 275 | `electron/services/cron-api.ts` | core（`registerCoreServices`） | 9 / 3 |
| 48 | `taskLedger` | 6055 | inline | 9 | 1749 | 285 | `electron/services/task-ledger-api.ts` | core（`registerCoreServices`） | 18 / 9 |
| 49 | `remoteTasks` | 6066 | inline | 6 | 1760 | 286 | `electron/services/remote-tasks-api.ts` | core（`registerCoreServices`） | 12 / 3 |
| 50 | `clawGraph` | 6074 | inline | 7 | 1768 | 287 | `electron/services/clawgraph-api.ts` | core（`registerCoreServices`） | 8 / 1 |
| 51 | `skills` | 6083 | inline | 16 | 1661 | 276 | `electron/services/skills-api.ts` | core（`registerCoreServices`） | 8 / 3 |
| 52 | `skillPacks` | 6101 | inline | 5 | 1683 | 277 | `electron/services/skill-packs-api.ts` | core（`registerCoreServices`） | 5 / 1 |
| 53 | `officeTools` | 6108 | inline | 14 | 1694 | 278 | `electron/services/office-tools-api.ts` | core（`registerCoreServices`） | 12 / 2 |
| 54 | `usage` | 6124 | inline | 6 | 1720 | 283 | `electron/services/usage-api.ts` | core（`registerCoreServices`） | 9 / 4 |
| 55 | `topics` | 6132 | inline | 5 | 1740 | 284 | `electron/services/topics-api.ts` | core（`registerCoreServices`） | 0 / 0 |
| 56 | `observability` | 6139 | inline | 10 | 1791 | 288 | `electron/services/observability-api.ts` | core（`registerCoreServices`） | 8 / 2 |
| 57 | `resourceTracker` | 6151 | inline | 3 | 1174 | 295 | `electron/services/resource-tracker-api.ts` | core（`registerCoreServices`） | 3 / 1 |
| 58 | `memory` | 6162 | inline | 16 | 1183 | 296 | `electron/services/memory-api.ts` | core（`registerCoreServices`） | 18 / 5 |

**对账结果**：contract 58 成员 ∩ facade 58 模块 ∩ 注册 58 模块 = 58；无未注册模块、无缺失 facade、无缺失实现文件。

**观察（非本轮裁定对象，记给 TF-0631）**：5 个模块在 renderer 源码中 0 处调用——`versegit`、`updates`、`vtoken`、`orchestrationPresets`、`topics`。本扫描只覆盖 `src/**`，未判断它们是否有 Main 内部 / 测试 / 外部消费者，**不得据此退役**。

---

## 3. 接入面 B：extension contribution（1 模块）

| 模块 | 贡献文件:行 | 机制 | 实现 | 注册入口 | 消费者 |
|---|---|---|---|---|---|
| `diagnostics` | `electron/extensions/builtin/diagnostics.ts:15-20`（`module: 'diagnostics'` 在 :17） | `HostApiProviderExtension.getHostApiContributions(ctx)` → `ExtensionRegistry.registerHostApiContributions`（`electron/extensions/registry.ts:77-90`）→ `ctx.hostApi.register(ext.id, contributions)` → `HostApiRegistry.registerExtensionContributions`（`host-invoke.ts:181-205`，`ownerId = 'builtin/diagnostics'`） | `electron/services/diagnostics-api.ts`（`createDiagnosticsApi`） | `electron/extensions/builtin/index.ts:7`（`registerBuiltinExtension('builtin/diagnostics', …)`）；`electron/main/index.ts:1186` `extensionRegistry.initialize({...})` | renderer 2 处 / 2 文件 |

- 内建 extension 共 2 个（`clawhub-marketplace.ts`、`diagnostics.ts`），只有 `diagnostics` 实现 `getHostApiContributions`（`grep -rn getHostApiContributions electron/` 仅命中 `diagnostics.ts:15` 与类型/注册表）。
- `diagnostics` 同时出现在 `HostApiContract`（`contract.ts:5870`）与 facade（`host-api.ts:1334`），因此**它属于接入面 A 的地址空间**，只是 owner 是 extension 而非 core。它**不是**第三条接入面；它是 A 的一种 owner 形态。
- `contract:check` 已把 `electron/extensions/builtin/diagnostics.ts` 拼进 `ipcHandlersText`（`scripts/contract-check.mjs:257-260`）并靠 `module: '…'` 正则识别，因此 B 被门禁覆盖。

**三类交集**：A ∩ B = {`diagnostics`}（1）；B ∩ C = ∅；A ∩ C 见 §5。

---

## 4. 接入面 C：扁平 IPC（43 channel / 10 前缀）

**路径**：renderer `window.electron.ipcRenderer.invoke(channel, …args)`（`electron/preload/index.ts:35-99`，带 44 项白名单）→ Main `ipcMain.handle(channel, handler)`（全部位于 `electron/main/ipc-handlers.ts`）。

**Owner 规则**：没有注册表、没有 `ownerId`、没有重复注册保护（Electron 自身在重复 `handle` 时抛错，但没有归属信息）、没有 sender 校验（`grep -cE 'assertAuthorizedHostSender|event\.sender\b' electron/main/ipc-handlers.ts` = 0）。实际 "owner" 只能按所在的 `register*Handlers` 函数段归属，见下表第 5 列。

**覆盖的门禁**：**无**。`contract:check` 不读取任何 `ipcMain.handle('x:y')`；preload 白名单也不受任何脚本校验。

**特殊项**：`app:request`（:320-713）本身是一个**嵌套的第三地址空间**——以 `{module, action}` 分发到 `case 'app'`(:332) / `'provider'`(:348) / `'usage'`(:595) / `'settings'`(:622) 四个 legacy module。它是 `host:invoke` 的前身。

| # | channel | ipc-handlers.ts 行 | 前缀 | 注册函数（owner 段） | preload 白名单行 | 类型化对应 action | renderer 消费者（src/，非测试） | 测试消费者 |
|---|---|---|---|---|---|---|---|---|
| 1 | `app:request` | 320 | `app` | `registerUnifiedRequestHandlers`（:309） | 52 | —（legacy 统一分发器，内嵌 app/provider/usage/settings 四个 module；由 `host:invoke` 整体取代） | 0 | `tests/unit/host-api-facade.test.ts:1318-1319`（注释 + 断言 `case 'cron':` 已移除） |
| 2 | `gateway:status` | 731 | `gateway` | `registerGatewayHandlers`（:729） | 38 | `gateway.status` | 0 | E2E mock 覆盖 26 处（`tests/e2e/fixtures/electron.ts:860-861` 等）；`tests/unit/gateway-events.test.ts:55,87,96,122` |
| 3 | `gateway:rpc` | 736 | `gateway` | `registerGatewayHandlers`（:729） | **否（renderer 不可达）** | `gateway.rpc`（返回形状不同：扁平为 `{success,result}` 信封） | 0 | E2E mock 覆盖 30 处（fixture `tests/e2e/fixtures/electron.ts:688,788` 把 typed `gateway.rpc` 桥接到此覆盖） |
| 4 | `openclaw:status` | 762 | `openclaw` | `registerOpenClawHandlers`（:760） | 40 | `openclaw.status` | 0 | 0 |
| 5 | `openclaw:getSkillsDir` | 769 | `openclaw` | `registerOpenClawHandlers`（:760） | 90 | `openclaw.getSkillsDir` | 0 | 0 |
| 6 | `openclaw:getCliCommand` | 776 | `openclaw` | `registerOpenClawHandlers`（:760） | 91 | `openclaw.getCliCommand` | 0 | 0 |
| 7 | `provider:list` | 845 | `provider` | `registerProviderHandlers`（:821） | 71 | `providers.list` | 0 | 0 |
| 8 | `provider:get` | 851 | `provider` | `registerProviderHandlers`（:821） | 72 | `providers.get` | 0 | 0 |
| 9 | `provider:save` | 857 | `provider` | `registerProviderHandlers`（:821） | 73 | `providers.save` | 0 | E2E 直接 invoke：`tests/e2e/provider-lifecycle.spec.ts:11` |
| 10 | `provider:delete` | 892 | `provider` | `registerProviderHandlers`（:821） | 74 | `providers.delete` | 0 | 0 |
| 11 | `provider:setApiKey` | 914 | `provider` | `registerProviderHandlers`（:821） | 75 | `providers.setApiKey` | 0 | 0 |
| 12 | `provider:updateWithKey` | 935 | `provider` | `registerProviderHandlers`（:821） | 76 | `providers.updateWithKey` | 0 | 0 |
| 13 | `provider:deleteApiKey` | 1003 | `provider` | `registerProviderHandlers`（:821） | 77 | `providers.deleteApiKey` | 0 | 0 |
| 14 | `provider:hasApiKey` | 1023 | `provider` | `registerProviderHandlers`（:821） | 78 | `providers.hasApiKey` | 0 | 0 |
| 15 | `provider:getApiKey` | 1029 | `provider` | `registerProviderHandlers`（:821） | **否（renderer 不可达）** | —（类型化侧已明确移除，见 ipc-handlers.ts:372 报错文案） | 0 | 0 |
| 16 | `provider:setDefault` | 1035 | `provider` | `registerProviderHandlers`（:821） | 79 | `providers.setDefault` | 0 | 0 |
| 17 | `provider:getDefault` | 1060 | `provider` | `registerProviderHandlers`（:821） | 80 | `providers.getDefault` | 0 | 0 |
| 18 | `provider:validateKey` | 1067 | `provider` | `registerProviderHandlers`（:821） | 81 | `providers.validateKey` | 0 | 0 |
| 19 | `shell:openExternal` | 1115 | `shell` | `registerShellHandlers`（:1113） | 42 | `shell.openExternal` | 4 处 / 2 文件，经 preload 包装 `window.electron.openExternal`（`electron/preload/index.ts:170`）：`src/components/channels/ChannelConfigModal.tsx:424`、`src/pages/Settings/index.tsx:2289,2292,2295` | 0 |
| 20 | `shell:showItemInFolder` | 1120 | `shell` | `registerShellHandlers`（:1113） | 43 | `shell.showItemInFolder` | 0 | 0 |
| 21 | `shell:openPath` | 1125 | `shell` | `registerShellHandlers`（:1113） | 44 | `shell.openPath` | 0 | 0 |
| 22 | `dialog:open` | 1135 | `dialog` | `registerDialogHandlers`（:1133） | 46 | `dialog.open` | 0 | 0 |
| 23 | `dialog:message` | 1141 | `dialog` | `registerDialogHandlers`（:1133） | 47 | `dialog.message` | 0 | 0 |
| 24 | `app:version` | 1152 | `app` | `registerAppHandlers`（:1150） | 49 | `app.version` | 0 | 0 |
| 25 | `app:name` | 1157 | `app` | `registerAppHandlers`（:1150） | 50 | — | 0 | 0 |
| 26 | `app:platform` | 1162 | `app` | `registerAppHandlers`（:1150） | 51 | —（renderer 使用 preload 静态属性 `window.electron.platform`） | 0 | 0 |
| 27 | `settings:get` | 1178 | `settings` | `registerSettingsHandlers`（:1168） | 60 | `settings.get` | 0 | 0 |
| 28 | `settings:getAll` | 1182 | `settings` | `registerSettingsHandlers`（:1168） | 63 | `settings.getAll` | 0 | E2E 直接 invoke 4 处：`dcs-prod-p0-settings.spec.ts:41`、`settings-memory-embedding.spec.ts:14`、`settings-proxy.spec.ts:14`、`telemetry-consent.spec.ts:6` |
| 29 | `settings:set` | 1186 | `settings` | `registerSettingsHandlers`（:1168） | 61 | `settings.set` | 0 | 0 |
| 30 | `settings:setMany` | 1209 | `settings` | `registerSettingsHandlers`（:1168） | 62 | `settings.setMany` | 0 | 0 |
| 31 | `settings:reset` | 1235 | `settings` | `registerSettingsHandlers`（:1168） | 64 | `settings.reset` | 0 | 0 |
| 32 | `usage:recentTokenHistory` | 1245 | `usage` | `registerUsageHandlers`（:1244） | 65 | `usage.recentTokenHistory` | 0 | E2E 直接 invoke：`tests/e2e/token-usage.spec.ts:106,129` |
| 33 | `window:syncTrafficLightPosition` | 1256 | `window` | `registerWindowHandlers`（:1255） | 58 | `window.syncTrafficLightPosition` | 0 | 0 |
| 34 | `window:minimize` | 1263 | `window` | `registerWindowHandlers`（:1255） | 54 | `window.minimize` | 0 | 0 |
| 35 | `window:maximize` | 1267 | `window` | `registerWindowHandlers`（:1255） | 55 | `window.maximize` | 0 | 0 |
| 36 | `window:close` | 1275 | `window` | `registerWindowHandlers`（:1255） | 56 | `window.close` | 0 | 0 |
| 37 | `window:isMaximized` | 1279 | `window` | `registerWindowHandlers`（:1255） | 57 | `window.isMaximized` | 0 | 0 |
| 38 | `file:readText` | 1481 | `file` | `registerFilePreviewHandlers`（:1480） | 83 | `files.readText` | 0 | E2E mock 覆盖 4 处（`chat-file-changes.spec.ts:295-296,420-421`；fixture `:690,848` 桥接 typed `files.readText`） |
| 39 | `file:readBinary` | 1515 | `file` | `registerFilePreviewHandlers`（:1480） | 84 | `files.readBinary` | 0（`src/components/file-preview/ImageViewer.tsx:4`、`PdfViewer.tsx:4` 仅为过时注释，实际调用 `hostApi.files.readBinary`） | 0 |
| 40 | `file:writeText` | 1554 | `file` | `registerFilePreviewHandlers`（:1480） | 85 | `files.writeText` | 0 | 0 |
| 41 | `file:stat` | 1588 | `file` | `registerFilePreviewHandlers`（:1480） | 86 | `files.stat` | 0 | E2E mock 覆盖 4 处（`chat-file-changes.spec.ts:287-288,412-413`；fixture `:689,842` 桥接 typed `files.stat`） |
| 42 | `file:listDir` | 1613 | `file` | `registerFilePreviewHandlers`（:1480） | 87 | `files.listDir` | 0 | 0 |
| 43 | `file:listTree` | 1648 | `file` | `registerFilePreviewHandlers`（:1480） | 88 | `files.listTree` | 0 | 0 |

**消费者口径说明**：

- "renderer 消费者" = `src/**`（排除 `*.test.*`、`*.d.ts`）中出现该 channel 字面量或经 preload 包装函数的调用。`src/**` 中 `ipcRenderer.invoke(` 字面出现 0 次；`window.electron` 的 18 处使用里，除 `openExternal`（4 处）外全部是读静态属性 `platform`、`getPathForFile`，或 `ipcRenderer.on` 事件订阅（`src/lib/host-events.ts:17`、`src/lib/mock-host-bridge.ts`）。
- "测试消费者" 分两类：**直接 invoke**（E2E 在 renderer 上下文 `page.evaluate(() => window.electron.ipcRenderer.invoke('…'))`，共 7 个 spec、3 个 channel）与 **mock 覆盖**（E2E 在 Main 上下文 `ipcMain.removeHandler/handle('…')` 替换 handler，再由 `tests/e2e/fixtures/electron.ts` 的 `host:invoke` 拦截器把类型化 action 桥接到这个覆盖；见 fixture :688-693、:788-791、:840-851）。后者说明这些扁平 handler 当前的**唯一活体用途是 E2E 的 mock 注入缝**。

---

## 5. 交集与双入口领域

| 扁平前缀 | 扁平 channel 数 | 类型化模块 | 匹配方式 | 类型化 action 数 | 扁平→类型化逐条对应 |
|---|---|---|---|---|---|
| `app` | 4 | `app` | 字面相同 | 4 | 1/4 有对应（`version`）；`name`、`platform` 无类型化 action；`request` 是 legacy 分发器 |
| `dialog` | 2 | `dialog` | 字面相同 | 2 | 2/2 |
| `gateway` | 2 | `gateway` | 字面相同 | 8 | 2/2（`rpc` 返回形状不同） |
| `openclaw` | 3 | `openclaw` | 字面相同 | 4 | 3/3 |
| `settings` | 5 | `settings` | 字面相同 | 5 | 5/5 |
| `shell` | 3 | `shell` | 字面相同 | 3 | 3/3 |
| `usage` | 1 | `usage` | 字面相同 | 6 | 1/1 |
| `window` | 5 | `window` | 字面相同 | 6 | 5/5 |
| `provider` | 12 | `providers` | 单复数近似 | 26 | 11/12（`getApiKey` 类型化侧已移除） |
| `file` | 6 | `files` | 单复数近似 | 9 | 6/6 |

- 字面相同前缀 **8 个**（与上一轮一致）。
- 近似前缀 **2 个**（上一轮未列）。按"同一领域同时存在两条入口"的合同定义（合同第 23 行），它们**也是双入口领域**，本轮一并裁定。
- 结论：**10 个扁平前缀 100% 落在已有类型化领域内**；扁平入口没有任何独占领域。43 个 channel 中 39 个有逐条类型化对应；4 个没有（`app:request`、`app:name`、`app:platform`、`provider:getApiKey`），而这 4 个 renderer 消费者均为 0。

---

## 6. 唯一入口裁定（逐领域）

**统一裁定**：10 个领域的唯一入口均为**类型化 Host API 模块**（`host:invoke` → `HostApiRegistry`）。另一入口的处置分三档：

- **退役（retire）**：扁平 channel 当前 renderer / 测试消费者为 0，或仅剩过时注释。退役 = 删除 handler + 删除 preload 白名单条目；本轮不执行。
- **迁移后退役（migrate → retire）**：存在活体消费者，先把消费者改到类型化入口（给出位点），再退役。
- **冻结（freeze）**：短期保留但禁止新增消费者；适用于 E2E mock 缝尚未改造的 channel。

"迁移位点" 指需要改动的**消费者**文件（非 handler 本身）。所有处置均为**后续节点**（TF-0630 覆盖门禁 / A2 兼容回归）的输入，本轮不动代码。

| 领域 | 唯一入口 | 另一入口（扁平） | 处置 | 迁移位点 / 前置条件 | 证据 |
|---|---|---|---|---|---|
| `app` | `hostApi.app`（`app-api.ts`） | `app:version` | retire | 无消费者 | §4 #24 |
| | | `app:name` | retire | 无消费者；无类型化对应——若未来需要，走类型化 `app` 新增 action（**非本轮**） | §4 #25 |
| | | `app:platform` | retire | 无消费者；该事实的 owner 已是 preload 静态属性 `window.electron.platform`（renderer 11 文件在用），不需要 IPC | §4 #26；`grep -rn "window.electron" src/` |
| | | `app:request`（含嵌套 app/provider/usage/settings） | retire | 无消费者；`tests/unit/host-api-facade.test.ts:1310-1325` 已把它记为 residual。退役时同步删除白名单 :52 | §4 #1 |
| `dialog` | `hostApi.dialog`（`dialog-api.ts`） | `dialog:open`、`dialog:message` | retire | 无消费者；类型化侧 10 处 / 8 文件在用 | §4 #22-23 |
| `gateway` | `hostApi.gateway`（`gateway-api.ts`） | `gateway:status` | freeze → retire | 前置：E2E mock 缝改为拦截 `host:invoke` 的 `gateway.status`（fixture 已拦截 `host:invoke`，改动集中在 `tests/e2e/fixtures/electron.ts:858-862` 与各 spec 的 `ipcMain.handle('gateway:status'` 26 处）；`tests/unit/gateway-events.test.ts:55,87,96,122` 同步 | §4 #2 |
| | | `gateway:rpc` | freeze → retire | 已对 renderer 不可达（白名单无此项）。前置：E2E 30 处 `ipcMain.handle('gateway:rpc'` 覆盖改为直接向 fixture 的 `host:invoke` 拦截器提供 `gateway.rpc` 响应（fixture :688、:788-791 现已有桥接逻辑，去掉"legacy override"分支即可）。注意返回信封差异（扁平 `{success,result}` vs 类型化 payload） | §4 #3 |
| `openclaw` | `hostApi.openclaw`（`openclaw-api.ts`） | 3 个 `openclaw:*` | retire | 无消费者 | §4 #4-6 |
| `settings` | `hostApi.settings`（`settings-api.ts`，为扁平侧副作用逻辑的**超集**：含 proxy 同步与 gateway restart，`settings-api.ts:91-100`） | `settings:getAll` | migrate → retire | 4 个 E2E spec 的 `page.evaluate(... invoke('settings:getAll'))` 改为经 `window.verseClaw.hostInvoke({module:'settings',action:'getAll'})` 或改读 UI：`dcs-prod-p0-settings.spec.ts:41`、`settings-memory-embedding.spec.ts:14`、`settings-proxy.spec.ts:14`、`telemetry-consent.spec.ts:6` | §4 #28 |
| | | `settings:get/set/setMany/reset` | retire | 无消费者。**附带风险**：`set/setMany/reset` 的副作用（`syncLaunchAtStartupSettingFromStore` / `createMenu` / proxy）在两侧**各写一份**（`ipc-handlers.ts:1186-1243` vs `settings-api.ts:91-154`），是语义漂移源；退役扁平侧即消除 | §4 #27,29-31 |
| `shell` | `hostApi.shell`（`shell-api.ts`；renderer 25 处 / 20 文件在用） | `shell:openExternal` | **migrate → retire** | **本轮唯一有活体 renderer 双消费的 channel。** 位点 4 处：`src/components/channels/ChannelConfigModal.tsx:423-424`、`src/pages/Settings/index.tsx:2289,2292,2295` → 改为 `hostApi.shell.openExternal(url)`；随后退役 preload 包装 `electronAPI.openExternal`（`preload/index.ts:170-172`）与白名单 :42 | §4 #19 |
| | | `shell:showItemInFolder`、`shell:openPath` | retire | 无消费者 | §4 #20-21 |
| `usage` | `hostApi.usage`（`usage-api.ts`） | `usage:recentTokenHistory` | migrate → retire | `tests/e2e/token-usage.spec.ts:106,129` 改走 `host:invoke` `usage.recentTokenHistory` | §4 #32 |
| `window` | `hostApi.window`（**实现文件为 `system-notifications-api.ts`**） | 5 个 `window:*` | retire | 无消费者。**语义 gap**：模块名 `window` 与实现文件 / 工厂名 `createSystemNotificationsApi` 不一致，且该模块混有 `notify` 与窗口控制两类职责——交 TF-0631 语义权威对齐，**非本轮** | §4 #33-37；§2 #6 |
| `provider`→`providers` | `hostApi.providers`（`providers-api.ts`，26 action 超集） | `provider:save` | migrate → retire | `tests/e2e/provider-lifecycle.spec.ts:8-14` 的 seeding 改走 `host:invoke` `providers.save` | §4 #9 |
| | | `provider:getApiKey` | **retire（优先）** | 无消费者且 renderer 不可达；类型化侧已在 `ipc-handlers.ts:372` 以报错方式**明确废止**明文取 key。扁平 handler（:1029）是一条仍可返回明文密钥的死路径——**安全卫生项**，建议在 TF-0630 第一批退役 | §4 #15 |
| | | 其余 10 个 `provider:*` | retire | 无消费者 | §4 #7-8,10-14,16-18 |
| `file`→`files` | `hostApi.files`（`files-api.ts`，9 action 超集；renderer 经 `src/lib/file-preview-client.ts:21-37` 全部走类型化） | `file:stat`、`file:readText` | freeze → retire | 前置：E2E mock 缝改为向 fixture `host:invoke` 拦截器直接提供 `files.stat/readText` 响应（`chat-file-changes.spec.ts:285-297,410-422`；fixture :689-690、:840-851 去掉 legacy override 分支） | §4 #38,#41 |
| | | `file:readBinary` | retire | 无消费者；顺手修正 `ImageViewer.tsx:4`、`PdfViewer.tsx:4` 两处过时注释（文档级，不改行为） | §4 #39 |
| | | `file:writeText/listDir/listTree` | retire | 无消费者 | §4 #40,42-43 |

**裁定汇总**：

| 处置 | channel 数 | 清单 |
|---|---|---|
| retire（可直接退役） | 35 | `app:version/name/platform/request`(4)、`dialog:*`(2)、`openclaw:*`(3)、`settings:get/set/setMany/reset`(4)、`shell:showItemInFolder/openPath`(2)、`window:*`(5)、`provider:*` 除 `save`(11，含 `getApiKey`)、`file:readBinary/writeText/listDir/listTree`(4) |
| migrate → retire（有活体消费者） | 4 | `shell:openExternal`（renderer 4 处）、`settings:getAll`（E2E 4 spec）、`usage:recentTokenHistory`（E2E 1 spec）、`provider:save`（E2E 1 spec） |
| freeze → retire（E2E mock 缝） | 4 | `gateway:status`、`gateway:rpc`、`file:stat`、`file:readText` |
| gap（无法裁定） | **0** | 见 §7，所有发现项都能给出处置或归属到后续节点 |
| 未分类 | **0** | |

> 勘误（TF-0630，2026-10-31）：本表首版把 retire 写成 32，但逐行相加为 35（4+2+3+4+2+5+11+4），35+4+4=43 才与 §4 的 43 条一致。机器清单 `scripts/contract-check-flat-ipc.json` 以逐行裁定为准（35 / 4 / 4）；TF-0629 节点摘要中的 "32 retire" 为同一笔误，裁定内容本身未变。

**不是裁定对象但附带退役**：preload 白名单 3 个无 handler 的 `env:*` 条目（§7.2）。

---

## 7. 额外发现（本轮新增，上一轮未列）

### 7.1 `contract:check` 对 `changeContext` 存在解析盲区

- `HostApiContract` 第 58 个成员 `changeContext: ChangeContextApiContract;`（`contract.ts:5600`）是**别名成员**，类型本体在 `shared/types/change-context.ts:510`（8 个 action）。
- `scripts/contract-check.mjs:36` 的正则 `^  ([A-Za-z]…): \{\r?\n…^  \};` 只匹配**内联块**，因此 `parseContractActions` 返回 57 个模块，`changeContext` 的 8 个 action **不参与** facade / `invokeHost` 对账。
- 现状下 facade（`host-api.ts:1582-1624`）恰好也是 8 个 action，所以没有实际漂移；但这是**门禁覆盖缺口**，不是"已验证一致"。
- **归属**：TF-0630（contract:check 覆盖面）。本轮不改 checker。
- **后续（TF-0630 已落地）**：`parseContractActions` 现在解析别名成员并从 `import type` 的相对路径读取定义文件；无法解析的别名成员以 `[host-api/unresolved-alias-member]` 失败。见 `ADMISSION-GATE.md`。

### 7.2 preload 白名单是第三份未受校验的清单，且已漂移

| 方向 | 条目 | 位置 |
|---|---|---|
| handler 存在、白名单缺失（renderer 不可达） | `gateway:rpc`、`provider:getApiKey` | `ipc-handlers.ts:736`、`:1029` |
| 白名单存在、handler 不存在（悬空） | `env:getConfig`、`env:setApiKey`、`env:deleteApiKey` | `preload/index.ts:67-69`；`grep -rn "'env:" electron/ src/ shared/` 仅命中 preload |

- 44 ≠ 43，交集 41。没有任何脚本校验该白名单与 handler 集合或与类型化合同的一致性。
- **裁定**：白名单的 owner 应与 `host:invoke` 相同（类型化接入面），终态白名单收敛为 `host:invoke` 单项；`env:*` 三条直接退役。**归属**：TF-0630 把白名单纳入 fail-closed 对账。
- **后续（TF-0630 已落地）**：白名单与 handler 集合双向对账；2 条不可达 handler 以 `preload: "unreachable"`、3 条 `env:*` 以 `danglingAllowlistEntries` 显式登记在 `scripts/contract-check-flat-ipc.json`，任何未登记漂移以 `[flat-ipc/preload-mismatch]` / `[flat-ipc/allowlist-dangling]` 失败。

### 7.3 两条入口在 Main 侧**重复实现**而非共享

以 `settings` 为例：扁平 `settings:set/setMany/reset`（`ipc-handlers.ts:1186-1243`）与类型化 `settings-api.ts:91-154` 各自实现 `syncLaunchAtStartupSettingFromStore` / `createMenu` / proxy 同步 / gateway restart 的副作用序列，类型化侧为超集。`gateway:rpc` 的返回信封（`{success,result}`）与类型化 `gateway.rpc`（payload 对象）形状不同。退役扁平侧会**消除**而不是**制造**漂移。

### 7.4 `app:request` 是嵌套的第三地址空间

`ipc-handlers.ts:320-713`，以 `request.module/action` 分发 `app` / `provider` / `usage` / `settings`。它与 `host:invoke` 同构但无注册表、无 sender 校验、无合同。消费者 0。

### 7.5 事件通道（Main → renderer）未纳入本轮

`ipcMain.handle` 之外还有 `webContents.send(...)` 事件面：类型化 `HOST_EVENT_CHANNELS`（`shared/host-events/contract.ts`，preload :9-11 校验）、动态 `channel:*-(qr|success|error)`（preload :19）、`ext:` 前缀（preload :24），以及一处裸字符串 `'observability:runtime-event'`（`ipc-handlers.ts:290`）。本轮合同只覆盖 request/response 接入，事件面**明确记为范围外**，建议作为 A2 或独立节点盘点。

### 7.6 模块名与实现命名漂移

`window` 模块由 `createSystemNotificationsApi`（`system-notifications-api.ts`）实现，混有 `notify` 与 5 个窗口控制 action。属于语义权威问题，归 TF-0631。

---

## 8. 与宪章 §8 成功判据的对应

| 判据 | 本轮状态 |
|---|---|
| 未分类接入通道 = 0 | **达成（盘点口径）**：58 + 1 + 43（+1 `host:invoke`）全部有 owner 段与处置；但这是人工表格，**尚无脚本门禁**，脚本化是 TF-0630 |
| 坏例被门禁拒绝（未登记通道 / 双入口同域 / 绕过 registry） | **未达成**，本轮不做；§7.1/7.2 给出了两类现成坏例 |
| 现有产品行为变化 = 0 | 本轮无代码改动，`git diff` 仅文档 |

---

## 9. 边界声明

- 本文件只产出盘点与裁定，**不产出实现**。所有 "retire / migrate / freeze" 都是对后续节点的输入。
- 未修改 `electron/main/ipc-handlers.ts`、`src/lib/host-api.ts`、`shared/host-api/contract.ts`、`electron/preload/index.ts` 或任何 handler / facade / service。
- 未新增 Host API 模块、action、channel、package script、运行时组件。
- 未改变产品锁、默认矩阵、权限、UI 行为、发布状态。
- 本文件的消费者统计是**静态文本扫描**，不是运行时观测；它证明"源码里没有调用"，不证明"运行时从未被调用"。
- 本文件不声称任何性能、收益或采用率。
- 全部产出为 agent 驱动（`driven_by: agent`）；没有真人操作、真人数据或真人 verdict 参与。

---

## 10. 复现命令（离线，仓库根目录，Git Bash）

```bash
# 10.1 基线
git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l
wc -l shared/host-api/contract.ts src/lib/host-api.ts electron/main/ipc-handlers.ts electron/preload/index.ts
grep -n "registerCoreServices" electron/main/ipc-handlers.ts          # → 226
grep -rnE "ipcMain\.handle\(" electron/ --include=*.ts | grep -vE "ipc-handlers\.ts|\.test\."   # → 仅 host-invoke.ts:381
```

```bash
# 10.2 接入面 A：类型化模块（复用 contract-check 自己的解析器）
node --input-type=module -e '
import { readFile } from "node:fs/promises";
import { parseContractActions, parseFacadeActions, parseRegisteredModules, inlineModuleFacadeAliases } from "./scripts/contract-check.mjs";
const r=(p)=>readFile(p,"utf8");
const contract=await r("shared/host-api/contract.ts");
const kn={};for(const [k,p] of Object.entries({knowledgeHostApi:"src/lib/host-api/knowledge/index.ts",knowledgeLibraryApi:"src/lib/host-api/knowledge/library.ts",knowledgeRoutingApi:"src/lib/host-api/knowledge/routing.ts",knowledgeInboxApi:"src/lib/host-api/knowledge/inbox.ts",knowledgeDraftsApi:"src/lib/host-api/knowledge/drafts.ts",knowledgeProposalsApi:"src/lib/host-api/knowledge/proposals.ts",knowledgeStewardApi:"src/lib/host-api/knowledge/steward.ts",knowledgeRuntimeLessonsApi:"src/lib/host-api/knowledge/runtime-lessons.ts",knowledgeSourceSetApi:"src/lib/host-api/knowledge/source-set.ts",knowledgeProvenanceApi:"src/lib/host-api/knowledge/provenance.ts",knowledgeWatchedDirectoriesApi:"src/lib/host-api/knowledge/watched-directories.ts"}))kn[k]=await r(p);
const facade=parseFacadeActions(inlineModuleFacadeAliases(await r("src/lib/host-api.ts"),kn));
const ipc=await r("electron/main/ipc-handlers.ts"), diag=await r("electron/extensions/builtin/diagnostics.ts");
const c=parseContractActions(contract), regCore=parseRegisteredModules(ipc), regAll=parseRegisteredModules(ipc+"\n"+diag);
// HostApiContract 全部成员（含别名成员）
const s=contract.indexOf("export type HostApiContract = {"); const members=[];
for(const l of contract.slice(s).split("\n").slice(1)){ if(/^\};/.test(l))break; const m=l.match(/^  ([A-Za-z]\w*): (.*)$/); if(m)members.push(m[1]+(m[2].trim()==="{"?"":" [alias]")); }
console.log("HostApiContract members:",members.length, "| parseContractActions sees:",c.size, "| facade:",facade.size, "| registered core:",regCore.size, "| registered core+ext:",regAll.size);
console.log("alias members:",members.filter(m=>m.endsWith("[alias]")));
console.log("extension-contributed:",[...regAll].filter(m=>!regCore.has(m)));
let n=0;for(const a of c.values())n+=a.size;console.log("inline actions:",n);
'
# 期望：members 58 | sees 57 | facade 58 | core 57 | core+ext 58 ；alias ["changeContext [alias]"]；ext ["diagnostics"]；inline actions 551

# changeContext 的 8 个 action
grep -n "export type ChangeContextApiContract" shared/types/change-context.ts   # → 510
```

```bash
# 10.3 接入面 B：extension contribution
grep -rnE "module:\s*'[^']+'" electron/extensions/ --include=*.ts               # → diagnostics.ts:17
grep -rn "getHostApiContributions" electron/ --include=*.ts | grep -v "\.test\."  # → 仅 diagnostics.ts 实现
```

```bash
# 10.4 接入面 C：扁平 channel（多行写法安全）
node -e "
const t=require('fs').readFileSync('electron/main/ipc-handlers.ts','utf8');
const re=/ipcMain\.handle\(\s*'([^']+)'/g;let m,n=0;const pre={};
while((m=re.exec(t))){n++;const line=t.slice(0,m.index).split('\n').length;const p=m[1].split(':')[0];pre[p]=(pre[p]||0)+1;console.log(line+'\t'+m[1]);}
console.log('TOTAL',n);console.log('PREFIXES',Object.keys(pre).length,JSON.stringify(pre));"
# 期望：TOTAL 43；PREFIXES 10

# 前缀 ∩ 类型化模块名（字面）
node --input-type=module -e '
import { readFile } from "node:fs/promises"; import { parseContractActions } from "./scripts/contract-check.mjs";
const c=parseContractActions(await readFile("shared/host-api/contract.ts","utf8"));
const t=await readFile("electron/main/ipc-handlers.ts","utf8");
const pre=new Set([...t.matchAll(/ipcMain\.handle\(\s*\x27([^\x27:]+):/g)].map(m=>m[1]));
console.log("exact:",[...pre].filter(p=>c.has(p)).sort()); console.log("near:",[...pre].filter(p=>!c.has(p)&&c.has(p+"s")).map(p=>p+"->"+p+"s"));'
# 期望：exact 8 个；near ["provider->providers","file->files"]
```

```bash
# 10.5 preload 白名单对账
node -e "
const fs=require('fs');const ipc=fs.readFileSync('electron/main/ipc-handlers.ts','utf8');const pre=fs.readFileSync('electron/preload/index.ts','utf8');
const H=new Set([...ipc.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map(m=>m[1]));
const s=pre.indexOf('const validChannels = [');const A=new Set([...pre.slice(s,pre.indexOf('];',s)).matchAll(/'([^']+)'/g)].map(m=>m[1]));
console.log('handlers',H.size,'allowlist',A.size,'unreachable',[...H].filter(x=>!A.has(x)),'dangling',[...A].filter(x=>!H.has(x)));"
# 期望：43 / 44 / ['gateway:rpc','provider:getApiKey'] / ['env:getConfig','env:setApiKey','env:deleteApiKey']
```

```bash
# 10.6 消费者
grep -rlE "ipcRenderer\.invoke\(" src/ --include=*.ts --include=*.tsx | grep -v "\.test\." | wc -l        # → 0
grep -rnE "window\.electron(\?)?\.openExternal" src/ --include=*.ts --include=*.tsx | grep -v "\.test\."   # → 4 处 / 2 文件
grep -rhoE "window\.electron\.ipcRenderer\.invoke\('[^']+'" tests/e2e/ | sed -E "s/.*'([^']+)'/\1/" | sort | uniq -c   # → provider:save 1, settings:getAll 4, usage:recentTokenHistory 2
grep -rhoE "ipcMain\.(handle|removeHandler)\(\s*'[^']+'" tests/ | sed -E "s/.*'([^']+)'/\1/" | sort | uniq -c           # → host:invoke, gateway:rpc, gateway:status, file:stat, file:readText
grep -cE "assertAuthorizedHostSender|event\.sender\b" electron/main/ipc-handlers.ts    # → 0（扁平入口无 sender 校验）
```

每个类型化模块的 renderer 调用点统计：对每个模块名 `M` 执行
`grep -rE "\bhostApi\.M\." src/ --include=*.ts --include=*.tsx | grep -vE "\.test\.|\.d\.ts|src/lib/host-api(\.ts|/)" | wc -l`。

---

## 11. 证据链

以下命令于 2026-10-31 在基线 `1bae32407` 上、本文件写入之后运行（临时目录指向 `D:\tmp`，日志 `D:\tmp\tf0629-gate-<name>.log`，仅本地保留）。退出码由 shell 直接捕获；关键输出行为从日志尾部回读。

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `pnpm harness context --spec harness/specs/tasks/architecture-skeleton-admission-inventory.md` | 0 | 输出最小阅读清单（rules: `contract-first-boundary` / `renderer-main-boundary` / `repository-artifact-retention`；layer: `harness`） |
| 2 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-inventory.md --no-diff` | 0 | `Spec is valid: harness\specs\tasks\architecture-skeleton-admission-inventory.md` |
| 3 | `pnpm contract:check` | 0 | `Contract check passed.` |
| 4 | `git diff --check` | 0 | 无输出 |
| 5 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS active docs contain no developer-local absolute paths` |
| 6 | `node scripts/check-repository-artifacts.mjs` | 0 | `Repository artifact retention passed (19965 tracked paths).` |
| 7 | `node scripts/check-evidence-refs.mjs` | 0 | `[evidence-refs] PASS 188 referenced path(s)` |
| 8 | `pnpm harness:specs:lifecycle` | 0 | `[specs] lifecycle status present for 685 task specs.` |
| 9 | `pnpm exec vitest run tests/unit/docs-index.test.ts --maxWorkers=1` | 0 | `Test Files 1 passed (1)`，`Tests 3 passed (3)` |

**本轮明确未运行**（不在合同 `requiredTests` 内，且本轮无运行时代码改动）：`pnpm run typecheck`、`pnpm test`（全量）、`pnpm run test:e2e`、`pnpm run lint`、`pnpm agent-dev:*`、任何 live provider / Gateway 运行。这些项记为 `not-run`，不得被解读为已通过。

**验收逐条对照**（合同 frontmatter `acceptance`）：

| 验收条 | 状态 | 证据位置 |
|---|---|---|
| 盘点由磁盘静态读取产生，每通道有名称 / 文件 / 行号 / owner / 消费者 | 达成 | §2 表（58 行）、§3 表、§4 表（43 行）；§10 可复现 |
| 三类分别计数并列出交集 | 达成 | §1（58 / 1 / 43）、§3 末尾（A∩B、B∩C）、§5（A∩C：8 字面 + 2 近似） |
| 对每个双入口领域给出唯一入口与另一入口处置，或记 gap | 达成 | §6（10 领域、43 channel 全部有处置；gap = 0） |
| 不改变运行时路径 / 默认值 / 权限 / UI，不新增 Host API 模块 | 达成 | `git status` 本轮仅新增本文件；`contract:check` 仍为 58 模块；§9 |
| 文档标注只产出盘点与裁定、不产出实现，且计数可离线复现 | 达成 | 文件头、§9、§10（所有命令已在本基线上逐条执行并与期望值一致） |
