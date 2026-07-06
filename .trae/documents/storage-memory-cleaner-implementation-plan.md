# 存储与内存优化工具 — 实现计划

## Context（背景与目标）

用户在设置页需要一个小工具，帮助应对"运存/存储不足"的场景：
- 扫描 app 自有数据目录，分类展示磁盘占用；
- Agent 分析并推荐可删项，用户选择性删除，Agent 可辅助执行删除；
- 当 RAM 或磁盘紧张时，主动提醒并引导用户进入清理页。

v1 范围已与用户确认：
- **双路径删除**：UI 直删（设置页内闭环）+ Agent 卡片回路（chat + tool-ui OptionListCard → agent 调 MCP 工具执行）。
- **扫描范围**：仅 app 自有数据目录（`~/.openclaw` / `userData` / `logs` / `cache`），不含外部文件夹。
- **RAM**：仅提醒+引导，不做内存操作。
- **磁盘**：扫描 → 展示 → agent 推荐 → 用户选择 → dryRun 预演 → 确认 → 删除 + 审计。

预期产出：设置页新增 `/settings/storage` 节，含系统信息卡 + 分类清理树；后台健康轮询 + 侧栏告警 banner；`clawx-storage` 虚拟 MCP server 暴露 `storage_scan` / `storage_delete_items` 工具；chat 注入 scan 摘要 + `Tool UI response:` 契约提示词。

---

## 架构与关键复用点

| 关注点 | 复用模板 | 路径 |
|--------|----------|------|
| host-api 4 接入点 | `logs` 模块（最简） | `shared/host-api/contract.ts` + `src/lib/host-api.ts` + `electron/services/logs-api.ts` + `electron/main/ipc-handlers.ts` |
| 虚拟 MCP server | `clawx-git` | `electron/services/mcp-api.ts`（SERVER_ID L61、SERVER config L63-77、TOOLS L79-413、callTool dispatch L726-859、注册点 L613/L654/L720/L951/L981/L1038/L1099） |
| 路径解析 | 已有 helpers | `electron/utils/paths.ts`：`getOpenClawConfigDir()` / `getDataDir()` / `getLogsDir()` |
| 会话/轨迹清理 | `sweepSessionArtefacts` | `electron/utils/session-files.ts:201`（已 export，ENOENT 容忍 + 指针跟随） |
| Agent 发现 | `listAgentIdsWithSessionDirs` | `electron/utils/token-usage.ts:24`（**需补 export**） |
| 日志列举 + 活跃文件守卫 | `listLogFiles` / `getLogFilePath` | `electron/utils/logger.ts:269/125` |
| Doctor UI 状态机 | `doctorRunningMode` | `src/pages/Settings/index.tsx:201,337-387,2016-2094` |
| 设置节接入 6 处 | 现有模式 | `src/pages/Settings/index.tsx`：union L76-85、segments L87-96、sectionMeta L1236-1269、settingsSections L1271-1328、groups L1329-1345、render block |
| 侧栏告警 banner | `sidebar-gateway-restarting` | `src/components/layout/Sidebar.tsx:898-924` |
| 轮询 + 可见性门控 | Models 页轮询 | `src/pages/Models/index.tsx:114-143` |
| App bootstrap init | gateway/providers init | `src/App.tsx:137-156` |
| 跨模块发消息 | `useChatStore.getState()` | `src/lib/workspace-session.ts:47,53,69,75,85,102,127` |
| chat 上下文注入 | `applyKnowledgeMetadata` | `electron/services/chat-api.ts:120,214,282-284`（`CONTEXT_FRAGMENT_LIMITS` L15） |
| tool-ui 多选卡 | `OptionListCard` | `src/components/tool-ui/agent-interactions.tsx:1713`（`selectionMode:'multi'` 已支持，`createInteractionResponse` L1605） |
| 审计 | `recordPermissionAudit` | `electron/services/permissions-api.ts:188`（`CreateApprovalInput` L29，`VALID_SOURCES` L48） |
| E2E 模板 | `settings-proxy.spec.ts` | `tests/e2e/settings-proxy.spec.ts`（54 行），fixtures `tests/e2e/fixtures/electron.ts` |
| i18n | 现有 `settings` 命名空间 | `shared/i18n/locales/{en,zh,ja,ru}/settings.json`（Option A：在 `settings` 命名空间内加 `storage` key，**不动** `resources.ts`） |

**新模块清单**：`electron/services/system-api.ts`、`src/pages/Settings/SystemCleaner.tsx`、`src/stores/storage-health.ts`、`tests/e2e/settings-storage.spec.ts`。

---

## 实现阶段（按依赖排序）

```
Phase 1（后端 host-api + 扫描器）
   |
   +---> Phase 2（设置页 UI + 直删）  --\
   +---> Phase 3（健康轮询 + 侧栏 banner） --> Phase 5（chat 契约 + 注入）
   +---> Phase 4（clawx-storage MCP server） --/
```

Phase 2/3/4 在 Phase 1 落地后可并行。Phase 5 依赖 1+4。

---

### Phase 1 — 后端 `system` host-api 模块 + 扫描器（基础）

**目标**：搭好后端 scan/delete/info 管线，无 UI。App 保持可用，新模块仅通过 `hostApi.system.*` 可达。

**文件改动**：

1. **`shared/host-api/contract.ts`** — 在 `HostApiContract`（L2623 起）追加 `system` 模块；在 `LogFilesResult`（~L887）附近新增类型：
   - `SystemInfoResult`（ram/disk/cpu/platform/arch）
   - `SystemScanCategory`、`SystemScanItem`、`SystemScanResult`、`SystemScanPayload`、`SystemDeleteItemsPayload`、`SystemDeleteItemsResult`
   - `system: { info; scan; deleteItems }` 签名

2. **`src/lib/host-api.ts`** — 在 `logs`（L629-636）后追加 `system` 模块（纯 `invokeHost` 包装），并在 L277-428 重导出类型。

3. **`electron/services/system-api.ts`**（新）— 镜像 `logs-api.ts` 结构：
   ```ts
   export function createSystemApi(): CompleteHostServiceRegistry['system'] {
     return {
       info: async () => { /* os.totalmem/freemem + process.memoryUsage().rss + fs.statfs × 3 + os.cpus */ },
       scan: async (payload) => { /* 分发各类扫描器，聚合 SystemScanResult */ },
       deleteItems: async (payload) => { /* dryRun 预演 / 实删 + 审计 */ },
     };
   }
   ```
   内部 helper：
   - `scanRam()`：`os.totalmem()` / `os.freemem()` / `process.memoryUsage().rss`
   - `scanDisk()`：`fs.promises.statfs` on `getDataDir()` / `getLogsDir()` / `getOpenClawConfigDir()`；`totalBytes = bsize * blocks`，`freeBytes = bsize * bavail`
   - `scanCpu()`：`os.cpus().length`；`loadPercent` POSIX 用 `os.loadavg()[0]/cpus*100`，Windows 返回 `0`（UI 标注"Windows 不可用"）
   - `scanLogsCategory()`：调 `logger.listLogFiles()`，过滤 `logger.getLogFilePath()`（当日活跃日志），映射为 `ScanItem[]`，`deletable:'always'`
   - `scanSessionsCategory()`：调 `listAgentIdsWithSessionDirs()`，遍历 `<configDir>/agents/<id>/sessions/`，读各 agent `sessions.json` 标记活跃会话为 `never`，`.archived.jsonl` 标 `conditional`
   - `scanTrajectoriesCategory()`：扫 `*.trajectory.jsonl` + 孤立 `*.trajectory-path.json`（runtimeFile 不存在）
   - `scanMediaCategories()` / `scanCacheCategories()`：outbound/thumbs/uvCache/electronCache/trash
   - `deleteItems(payload)`：`dryRun:true` 仅返回预演；`dryRun:false` 按类别分组——sessions/trajectories 调 `sweepSessionArtefacts(sessionsDirAbs, baseId)`；logs 调 `fs.unlink`（带活跃文件守卫）；其余 `fs.rm(path,{recursive:true,force:false})`。删除后调 `recordPermissionAudit({ workspace: <合成 stub>, source:'cleaner', risk:'destructive', paths, reason:'Storage Cleaner deletion', paramsPreview })`

4. **`electron/main/ipc-handlers.ts`** — L56 附近加 `import { createSystemApi }`；L213 `registerCoreServices` 块内加 `system: createSystemApi(),`

5. **`electron/utils/token-usage.ts`** — L24 `async function listAgentIdsWithSessionDirs()` 改为 `export async function`。

6. **`shared/types/workspace.ts`** — L9 `PermissionApprovalSource` union 末尾加 `| 'cleaner'`。

7. **`electron/services/permissions-api.ts`** — L48 `VALID_SOURCES` set 加 `'cleaner'`。

**风险点**：
- **Windows statfs**：Node 18+ 支持，但需验证 `bsize`/`bavail` 语义。降级方案：若异常则 disk 返回 `totalBytes:0, freeBytes:0` 并 UI 标注"不可用"，RAM 不受影响。
- **扫描阻塞主线程**：`readdir`+`stat` 异步非阻塞，但 sessions 目录可能上万文件。缓解：每类别 `items` 上限 500，目录递归深度 ≤2，大目录用 `fs.opendir` 流式。v1 不上 worker_thread。
- **`recordPermissionAudit` 的 workspace 必填**：合成 stub `WorkspaceProfile`（`id:'clawx-storage-cleaner'`, `name:'Storage Cleaner'`, `permissionMode:'off'`，其余必填字段填默认值）。实现前先核对 `WorkspaceProfile` 完整 shape。

**验证**：
- 单测 `electron/services/__tests__/system-api.test.ts`：mock `os`/`fs.promises`/`logger`/`listAgentIdsWithSessionDirs`；断言 `scan()` 返回类别 shape 正确；`deleteItems({dryRun:true})` 返回预演路径且不 unlink；`deleteItems({dryRun:false})` unlink 并返回 auditId。
- `pnpm test` + `pnpm run typecheck` 通过。

---

### Phase 2 — 设置页 `/settings/storage` + `SystemCleaner`（路径 A：UI 直删）

**目标**：用户可进入设置 > Storage，扫描、查看分类、直接删除。App 保持可用。

**文件改动**：

1. **`src/pages/Settings/index.tsx`** — 6 处接入：
   - L76-85 `SettingsSectionId` 加 `| 'storage'`
   - L87-96 `SETTINGS_SECTION_SEGMENTS` 加 `storage: 'storage'`
   - L1236-1269 `sectionMeta` 加 `storage: { title: t('navigation.storage.title'), description: t('navigation.storage.description') }`
   - L1271-1328 `settingsSections` 加 `{ id:'storage', to:'/settings/storage', icon:<HardDrive className="h-5 w-5"/>, ...sectionMeta.storage, testId:'settings-nav-storage' }`（import `HardDrive` from `lucide-react`）
   - L1329-1345 `settingsSectionGroups` 的 `operations` 组 filter 加 `'storage'`
   - render block 加 `{currentSection === 'storage' && <SystemCleaner />}`

2. **`src/pages/Settings/SystemCleaner.tsx`**（新）— 镜像 Doctor UI 状态机：
   ```ts
   type CleanerMode = 'idle' | 'scanning' | 'scanned' | 'deleting' | 'deleted';
   export function SystemCleaner(): JSX.Element
   ```
   状态：`mode` / `scanResult` / `selectedItemIds: Set<string>` / `deleteResult` / `error`。
   handlers：`handleScan`、`handleDelete`（先 dryRun 弹确认 modal 再实删）、`handleAskAgent`（Phase 5 接线，本阶段先 disabled）。
   UI 区块：系统信息卡（RAM/Disk/CPU 进度条 + 状态色）、分类树（checkbox + size badge + risk note + 展开箭头）、Action Bar（已选汇总 + 删除按钮 + 让 Agent 分析按钮）、删除结果面板。
   设计令牌：`bg-surface-modal` / `bg-surface-input`；warning `text-amber-700 dark:text-amber-400`；never-deletable `text-red-700 dark:text-red-400`；H1 `font-serif font-normal tracking-tight`。
   testid：`settings-storage-section` / `settings-storage-scan` / `settings-storage-category-<id>` / `settings-storage-delete` / `settings-storage-confirm` / `settings-storage-deleted-summary`。

3. **i18n 4 文件**（`shared/i18n/locales/{en,zh,ja,ru}/settings.json`）：
   - `navigation.storage.title` / `navigation.storage.description`
   - 新增顶层 `storage` 对象：`title` / `subtitle` / `scan` / `scanning` / `scanEmpty` / `systemInfo` / `ram` / `disk` / `cpu` / `cpuUnavailable` / `categories` / `category.<id>.{label,description}` / `deletable.{always,conditional,never}` / `riskNote.{activeLog,activeSession,regenerable}` / `delete` / `deleteSelected` / `dryRun` / `dryRunPreview` / `confirmDelete` / `confirmDeletePrompt` / `deleting` / `deleted` / `deletedSummary` / `errors` / `askAgent` / `askAgentPrompt` / `noSelection` / `sidebarCritical` / `sidebarWarning` / `toastCritical` / `itemsCapNote`

**风险点**：
- **活跃会话判定**：定义"活跃"= 任一 agent 的 `sessions.json` 引用的会话。`sessions.json` 缺失/不可读时默认 `conditional`（比 `always` 安全）。
- **大类别列表**：单类别 >500 项加"仅显示前 500 项，另有 N 项隐藏"提示，v1 不做虚拟化。

**验证**：
- E2E `tests/e2e/settings-storage.spec.ts`（镜像 `settings-proxy.spec.ts`）：`completeSetup` → 点 `settings-nav-storage` → 断言 `settings-storage-section` 可见 → 点 `settings-storage-scan` → `installIpcMocks` mock `hostApi.system.scan` 返回 fixture → 断言分类行渲染 → 勾选 → 点 `settings-storage-delete` → 断言确认 modal → 确认 → 断言 `settings-storage-deleted-summary`。
- 手动 `pnpm dev` 进 `/settings/storage` 扫描，检查容量合理，dry-run 删除。

---

### Phase 3 — 健康轮询 store + 侧栏 banner + App bootstrap

**目标**：后台轮询在磁盘/RAM 紧张时通过侧栏 banner + toast 提醒，点击跳清理页。

**文件改动**：

1. **`src/stores/storage-health.ts`**（新）— 镜像 `useGatewayStore`：
   ```ts
   interface StorageHealthState {
     status: 'idle' | 'loading' | 'healthy' | 'warning' | 'critical';
     lastInfo: SystemInfoResult | null;
     lastCheckedAt: number | null;
     error: string | null;
     init: () => void;
     stop: () => void;
     refresh: () => Promise<void>;
   }
   ```
   `init()`：`setInterval(refresh, 5*60*1000)`，立即调一次 `refresh()`。`refresh()`：调 `hostApi.system.info()`，计算 status——`critical` 当 `ram.freeBytes/totalBytes < 0.05` 或任一 disk `freeBytes/totalBytes < 0.02`；`warning` 当 `< 0.15` / `< 0.08`。`document.hidden` 时跳过。`healthy/warning → critical` 转换时 `toast.error(t('settings:storage.toastCritical'))`（store 内 import `sonner`）。

2. **`src/App.tsx`** — L137-156 附近加：
   ```ts
   const initStorageHealth = useStorageHealthStore((s) => s.init);
   useEffect(() => { initStorageHealth(); }, [initStorageHealth]);
   ```

3. **`src/components/layout/Sidebar.tsx`** — 在 `sidebar-gateway-restarting`（L924）后加镜像块 `sidebar-storage-warning`：`critical` 用 `border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400`；`warning` 用 amber 系。仅 `status==='warning'||'critical'` 时渲染。点击 `navigate('/settings/storage')`。

**风险点**：
- **轮询成本**：`info()` = 3× statfs + os 调用，5 分钟一次可接受。`stop()` 清 interval。
- **toast 刷屏**：仅状态转换时触发，非每次轮询。

**验证**：
- 单测 `src/stores/__tests__/storage-health.test.ts`：mock `hostApi.system.info`，断言 RAM free<5% 触发 critical。
- E2E：扩展 `settings-storage.spec.ts` 或新增 `sidebar-storage-warning.spec.ts`——mock `system.info` 返回 critical RAM，断言 `sidebar-storage-warning` 可见，点击跳 `/settings/storage`。

---

### Phase 4 — `clawx-storage` 虚拟 MCP server（路径 B：agent 中介）

**目标**：agent 可调 `storage_scan` / `storage_delete_items` MCP 工具，支撑 chat 中介流程。

**文件改动**：

1. **`electron/services/mcp-api.ts`** — 完整镜像 `clawx-git` 模式：
   - 加 `VERSE_CLAW_STORAGE_MCP_SERVER_ID = 'clawx-storage'`
   - 加 `VERSE_CLAW_STORAGE_MCP_SERVER: McpServerConfig`（`name:'Verse Claw Storage'`, `localAddress:'clawx://mcp/clawx-storage'`, `toolCount:2`）
   - 加 `VERSE_CLAW_STORAGE_MCP_TOOLS`（2 项）：
     - `storage_scan`：inputSchema `{ categories?: string[] }`，返回扫描结果（**items 每类别截断至 200**，agent 看摘要，UI 走 host-api 拿全量）
     - `storage_delete_items`：inputSchema `{ items: Array<{id,path}>, dryRun?: boolean, approvalId?: string }`，required `['items']`
   - 加 `async function callClawxStorageTool(toolName, args)`：实例化 `createSystemApi()` 分发
   - 更新 `listResult`（L613）/`resolveMcpServersForContext`（L654）/`findServer`（L720）/`listTools`（L1038）/`heartbeat`（L981）/`testServer`（L951）/`callTool`（L1099）——每处加 storage 分支

**风险点**：
- **MCP 注册时序**：虚拟 server 硬编码进 `listResult`/`resolveMcpServersForContext`，gateway resolve 时立即可见，无需 store 写入（git 先例已验证）。
- **工具结果体积**：`storage_scan` items 截断至 200/类别。
- **agent 跳过 dryRun**：服务端强制——`dryRun:false` 必须带有效 `approvalId`（匹配 60s 内 dryRun 结果），否则忽略 `dryRun` 直接返回预演。需在 `system-api.ts` 加小型内存 dryRun 缓存。

**验证**：
- 单测 `electron/services/__tests__/mcp-api-storage.test.ts`：断言 `listServers()` 含 `clawx-storage`、`listTools({serverId})` 返回 2 工具、`callTool({toolName:'storage_scan'})` 返回扫描结果、`callTool({toolName:'storage_delete_items', args:{items,dryRun:true}})` 返回预演。
- 手动：dev 模式开 chat，确认 agent 工具列表含 `storage_scan`。

---

### Phase 5 — System prompt 契约 + Settings → chat 注入

**目标**：(a) agent 理解 `Tool UI response:` 载荷以处理 OptionListCard 选择；(b) Settings 可将扫描摘要交给 chat 走 agent 中介清理。

**文件改动**：

1. **`electron/services/chat-api.ts`** — 加 `applyToolUiResponseContract(message)` 镜像 `applyKnowledgeMetadata`（L120）：
   ```ts
   function applyToolUiResponseContract(message: string): string {
     if (!message.startsWith('Tool UI response:')) return message;
     const block = capContextText(
       'Tool UI response contract: 以下用户消息是结构化 Tool UI 响应（option list 选择等）。解析头部后的 JSON。option_list 的 value 字段含所选 option id。请据此用合适工具执行，勿要求用户重述选择。',
       CONTEXT_FRAGMENT_LIMITS.toolUiResponseContractChars,
     );
     return `${block}\n\n${message}`;
   }
   ```
   `CONTEXT_FRAGMENT_LIMITS`（L15）加 `toolUiResponseContractChars: 800`。在 L282-284 调用序列前置 `message = applyToolUiResponseContract(message);`（先于其他 metadata）。**选此方案而非 `resource-loader.ts appendSystemPrompt`**：条件触发、发送时注入、镜像已验证模式，风险更低。

2. **`src/pages/Settings/SystemCleaner.tsx`** — 接线 Phase 2 stub 的 `handleAskAgent`：
   ```ts
   const navigate = useNavigate();
   const handleAskAgent = () => {
     if (!scanResult) return;
     const summary = [
       'Storage scan complete. Here is the summary:',
       JSON.stringify({ categories: scanResult.categories.map(c => ({ id:c.id, totalBytes:c.totalBytes, deletable:c.deletable, itemCount:c.items.length })), system: scanResult.system }, null, 2),
       'Recommend which categories to clean and I will confirm via the option list.',
     ].join('\n');
     useChatStore.getState().sendMessage(summary);
     navigate('/');
   };
   ```
   import `useChatStore` from `@/stores/chat`（先例 `workspace-session.ts:3`）。

3. **`src/components/tool-ui/agent-interactions.tsx`** — **无需改动**。`OptionListCard`（L1713）已支持 `selectionMode:'multi'`，`createInteractionResponse`（L1605）已生成 `Tool UI response:` 文本。仅验证。

**风险点**：
- **agent 忽略契约**：注入片段为 best-effort。退路是 Phase 2 的 UI 直删路径，不依赖 agent 理解——整体特性已去风险。
- **`useChatStore.getState().sendMessage` 在 React 树外**：`workspace-session.ts` 已验证安全。Zustand 单例 `getState()` 是文档化模式。

**验证**：
- 单测 `electron/services/__tests__/chat-api-tool-ui-contract.test.ts`：断言 `applyToolUiResponseContract` 仅在消息以 `Tool UI response:` 开头时前置 block，否则 no-op。
- E2E：扩展 `settings-storage.spec.ts`——点 `settings-storage-ask-agent` → 断言跳 `/` → 断言 chat 发送了扫描摘要。
- 手动：完整 agent 中介流——Settings 扫描 → 让 agent 分析 → agent 调 `storage_scan` → agent 发 OptionListCard → 用户选 → agent 调 `storage_delete_items` dryRun → 报预演 → 用户确认 → agent 删除。

---

## 决策记录（open questions 已自决）

1. **`recordPermissionAudit` workspace 必填** → 采用合成 stub `WorkspaceProfile`（`id:'clawx-storage-cleaner'`），不动共享类型。实现前核对 `WorkspaceProfile` 完整 shape 填默认值。
2. **Windows CPU 负载** → v1 返回 `loadPercent:0` + UI 标注"Windows 不可用"。v2 再考虑 100ms 采样。
3. **`storage_delete_items` 服务端强制 dryRun-first** → 采用。`dryRun:false` 必须带有效 `approvalId`（匹配 60s 内 dryRun），否则忽略并返回预演。`system-api.ts` 加内存 dryRun 缓存。
4. **扫描类别上限** → v1 每类别 500 项 + "N more hidden" 提示，不做虚拟化。
5. **`handleAskAgent` 消息格式** → 纯文本摘要（不依赖契约），让 agent 自行决定调 `storage_scan`。

---

## v1 明确不做

- 不做 RAM 释放/进程杀死/内存压缩/"free RAM" 按钮。
- 不扫外部文件夹、不做路径选择器。
- 不做定时/自动清理（无 cron、无启动清理、无阈值触发清理）。
- 不做删除回收站/撤销（删除是硬删除；dryRun 预演是安全网；会话自有 archive 流，清理器只删 archived/orphaned）。
- 删除后不实时重算 size，需手动重扫。
- Windows CPU 负载 v1 不做。
- 扫描不上 worker_thread。
- 不新增 i18n 命名空间（Option A）。
- 不新增 tool-ui 卡片类型（复用 `OptionListCard`）。
- 不改 gateway/runtime（纯 host-api + 虚拟 MCP server）。

---

## 端到端验证

**质量门禁**（每阶段）：
- `pnpm run typecheck` 通过
- `pnpm run lint` 通过
- `pnpm test`（单测）通过
- 改动涉及 UI 的阶段：对应 E2E spec 通过 `pnpm run test:e2e tests/e2e/settings-storage.spec.ts`

**完整手动验证**（Phase 5 后）：
1. `pnpm dev` → 进入 `/settings/storage` → 点扫描 → 确认分类树与容量合理。
2. 勾选若干 logs/trajectories → 点删除 → 确认 modal 显示 dryRun 预演 → 确认 → 验证文件实际删除 + toast 成功 + 自动重扫。
3. 点"让 Agent 分析" → 跳 chat → 确认 agent 收到扫描摘要 → agent 调 `storage_scan` → 发 OptionListCard → 选若干 → Send Response → agent 调 `storage_delete_items` dryRun → 报预演 → 确认 → agent 删除 → 验证文件删除。
4. 模拟低内存/低磁盘（mock `system.info` 返回临界值）→ 确认侧栏 `sidebar-storage-warning` 出现 + toast → 点击跳 `/settings/storage`。
5. 验证审计日志：删除后 `~/.openclaw` 下审计记录含 `source:'cleaner'`。

**harness 任务 spec**（按 AGENTS.md spec-driven 规则）：实现前创建 `harness/specs/tasks/storage-memory-cleaner.md`，引用 `gateway-backend-communication`，实现评审前跑 `pnpm harness validate --spec storage-memory-cleaner`。

---

## 关键文件清单

| 类型 | 路径 |
|------|------|
| 新建 | `electron/services/system-api.ts` |
| 新建 | `src/pages/Settings/SystemCleaner.tsx` |
| 新建 | `src/stores/storage-health.ts` |
| 新建 | `tests/e2e/settings-storage.spec.ts` |
| 新建 | `harness/specs/tasks/storage-memory-cleaner.md` |
| 改动 | `shared/host-api/contract.ts` |
| 改动 | `src/lib/host-api.ts` |
| 改动 | `electron/main/ipc-handlers.ts` |
| 改动 | `electron/utils/token-usage.ts`（补 export） |
| 改动 | `shared/types/workspace.ts`（source union） |
| 改动 | `electron/services/permissions-api.ts`（VALID_SOURCES） |
| 改动 | `electron/services/mcp-api.ts`（clawx-storage server） |
| 改动 | `electron/services/chat-api.ts`（applyToolUiResponseContract） |
| 改动 | `src/pages/Settings/index.tsx`（6 处接入） |
| 改动 | `src/App.tsx`（init storage health） |
| 改动 | `src/components/layout/Sidebar.tsx`（告警 banner） |
| 改动 | `shared/i18n/locales/{en,zh,ja,ru}/settings.json`（storage 命名空间） |
| 复用不改 | `electron/utils/session-files.ts`（sweepSessionArtefacts） |
| 复用不改 | `electron/utils/logger.ts`（listLogFiles/getLogFilePath） |
| 复用不改 | `electron/utils/paths.ts`（路径 helpers） |
| 复用不改 | `src/components/tool-ui/agent-interactions.tsx`（OptionListCard） |
