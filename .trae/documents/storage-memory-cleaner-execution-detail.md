# Storage & Memory Cleaner — 详细执行计划

> 本文件是 `storage-memory-cleaner-implementation-plan.md` 的执行细化版，覆盖剩余所有任务的精确改动点。
> 计划批准后立即按本文件顺序实现，不再重新规划。

## Summary

在 Settings 页新增 "Storage & Memory Cleaner" 节，提供：
1. 系统信息卡片（RAM / Disk / CPU）+ 8 类可清理项扫描与删除
2. RAM/Disk 低水位轮询 → Sidebar 告警 banner + toast
3. 虚拟 MCP server `clawx-storage`，让 Agent 通过 `OptionListCard` 推荐并执行删除
4. chat-api 注入 `Tool UI response:` 契约说明，让 Agent 正确解析卡片回传

v1 范围（已批准）：仅 app 自有数据目录；RAM 不足仅提醒+引导，不做内存操作；含 Agent 卡片回路。

## Current State Analysis

### Phase 1 后端（已完成，1 处 typecheck 待修复）

| 文件 | 状态 |
|---|---|
| [shared/host-api/contract.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/host-api/contract.ts) | ✅ 已加 system 模块类型（SystemInfoResult / SystemScanResult / SystemDeleteItemsPayload 等） |
| [electron/services/system-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/services/system-api.ts) | ✅ 新文件，~620 行，info/scan/deleteItems 三动作 + dryRun 缓存 + 路径守卫 |
| [electron/main/ipc-handlers.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/main/ipc-handlers.ts) | ✅ L88 import + L215 注册 `system: createSystemApi()` |
| [electron/utils/token-usage.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/utils/token-usage.ts) | ✅ L24 `listAgentIdsWithSessionDirs` 已 export |
| [shared/types/workspace.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/types/workspace.ts) | ✅ L9 `PermissionApprovalSource` 已加 `'cleaner'` |
| [electron/services/permissions-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/services/permissions-api.ts) | ✅ L48 `VALID_SOURCES` 已加 `'cleaner'` |
| [src/lib/host-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/src/lib/host-api.ts) | ⚠️ L428-435 re-export 已加 7 个 system 类型；L644-648 hostApi.system 已加；但 L646-647 用到的 `SystemScanPayload` / `SystemDeleteItemsPayload` **未在 L1-263 的 import type 块中导入**，导致 typecheck 报 TS2304 |

### Phase 2-5（待实现）

剩余 12 个任务：#3 修复、#8 单测、#9-#11 Settings UI + i18n、#12-#14 健康轮询 + Sidebar banner、#15-#17 MCP server + chat 契约 + handleAskAgent、#18-#19 E2E + 验证。

## Proposed Changes

### Task #3 — 修复 host-api.ts 类型导入（5 分钟）

**What**: 把 `SystemScanPayload` 和 `SystemDeleteItemsPayload` 加进本地 import type 块。
**Why**: re-export (`export type {...} from`) 不导入到本地作用域，hostApi 对象定义里用到这两个类型作为参数注解，必须从 L1-263 的 `import type {...} from '@shared/host-api/contract'` 导入。
**How**:
- 文件：[src/lib/host-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/src/lib/host-api.ts)
- 位置：L262 `WorkspaceWebPreviewStopPayload,` 之后、L263 `} from '@shared/host-api/contract';` 之前
- 改动：插入两行
  ```
  SystemScanPayload,
  SystemDeleteItemsPayload,
  ```
**Verify**: `pnpm run typecheck` 全绿。

---

### Task #8 — system-api 单元测试

**What**: 为 `electron/services/system-api.ts` 加单元测试，覆盖核心路径与守卫。
**Why**: 后端涉及删除文件，必须有测试守卫路径白名单、dryRun approvalId 匹配、活跃会话/日志守卫。
**How**:
- 新文件：`tests/unit/system-api.test.ts`
- 用 `vitest` + `tmpdir` 构造临时目录树（logs/sessions/trajectories/mediaOutbound/electronCache/uvCache/trash）
- Mock `getOpenClawConfigDir`/`getDataDir`/`getLogsDir`/`getElectronCacheDir` 指向 tmpdir 子目录
- Mock `recordPermissionAudit` 验证 `source:'cleaner'` / `risk:'destructive'`
- 测试用例（≥10）：
  1. `info()` 返回 ram/disk/cpu 字段且 platform/arch 正确
  2. `scan({})` 返回 8 个 category，每个有 totalBytes/itemCount/items
  3. `scan({ categories: ['logs'] })` 只返回 logs category
  4. `scan` 标记活跃会话的 `safeToDelete:false` / `deletable:'never'`
  5. `scan` 标记孤立轨迹的 `safeToDelete:true`
  6. `scan` 截断超 500 item 的 category，`truncated:true`
  7. `deleteItems({ dryRun:true })` 返回 approvalId 且不实际删除
  8. `deleteItems({ dryRun:false })` 无 approvalId → 拒绝
  9. `deleteItems({ dryRun:false, approvalId })` approvalId 不匹配 60s 内缓存 → 拒绝
  10. `deleteItems({ dryRun:false, approvalId })` 匹配 → 实际删除 + 返回 removed/freedBytes/auditId
  11. `deleteItems` 路径白名单外（如 `/etc/passwd`）→ 拒绝并报错
  12. `deleteItems` 删除会话产物时调 `sweepSessionArtefacts`（spy 验证调用）
  13. `deleteItems` 删除活跃日志文件时守卫（不删 `logger.getLogFilePath()` 当前文件）
**Verify**: `pnpm test tests/unit/system-api.test.ts` 全绿。

---

### Task #9 — Settings 接入 storage 节（6 处）

**What**: 在 Settings 页注册新的 `storage` section。
**Why**: 用户可见入口；遵循现有 9 个 section 的统一接入模式。
**How**:
- 单一文件：[src/pages/Settings/index.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/pages/Settings/index.tsx)
- 6 处精确改动：
  1. **L76-85 SettingsSectionId** — 末尾加 `| 'storage'`
  2. **L87-96 SETTINGS_SECTION_SEGMENTS** — 加 `storage: 'storage',`
  3. **L1236-1269 sectionMeta** — 加 `storage: { title: t('navigation.storage.title'), description: t('navigation.storage.description') },`
  4. **L1271-1328 settingsSections** — 加 `{ id: 'storage', to: '/settings/storage', icon: <Trash2 className="size-4" />, ...sectionMeta.storage, testId: 'settings-nav-storage' }`（`Trash2` 已在 L26 import）
  5. **L1329-1345 settingsSectionGroups** — `operations` 组（L1343）的数组里加 `'storage'`
  6. **L1389-2234 render block** — 在 developer section 块（L2191 结束）后插入：
     ```
     {currentSection === 'storage' && (
       <>
         <Separator className="bg-black/5 dark:bg-white/5" />
         <div data-testid="settings-storage-section">
           <h2 data-testid="settings-storage-title" className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
             {t('storage.title')}
           </h2>
           <StorageCleanerSection />
         </div>
       </>
     )}
     ```
- 新建组件文件（见 Task #10），在 index.tsx 顶部加 import。

---

### Task #10 — 创建 StorageCleanerSection 组件

**What**: 新建 `src/pages/Settings/sections/StorageCleanerSection.tsx`，承载全部清理 UI。
**Why**: Settings index.tsx 已 2000+ 行，inline 会让维护困难；独立文件便于 E2E 定位与单测。这是物理拆分，不引入新抽象层。
**How**:
- 新文件：`src/pages/Settings/sections/StorageCleanerSection.tsx`
- 顶部结构：
  ```tsx
  import { useCallback, useEffect, useState } from 'react';
  import { useTranslation } from 'react-i18next';
  import { toast } from 'sonner';
  import { Activity, HardDrive, Cpu, RefreshCw, Trash2, Loader2, AlertTriangle } from 'lucide-react';
  import { hostApi } from '@/lib/host-api';
  import type { SystemInfoResult, SystemScanResult, SystemScanCategory, SystemScanItem, SystemDeleteItemsResult } from '@shared/host-api/contract';
  ```
- 状态：
  - `info: SystemInfoResult | null`
  - `scan: SystemScanResult | null`
  - `scanning: boolean`
  - `selected: Set<string>`（item id 多选）
  - `deleting: boolean`
  - `lastError: string | null`
- UI 布局（用 design tokens，遵循 globals.css）：
  1. **系统信息卡片**（3 张）：RAM / Disk / CPU，用 `bg-surface-modal rounded-lg p-4`，每张含图标 + 数值 + 进度条（用 `<div className="h-2 bg-black/5 dark:bg-white/10 rounded-full">` + 内层 fill）
  2. **操作工具栏**：刷新按钮（`RefreshCw` + 旋转动画）+ "Ask Agent to Recommend" 按钮（连 Task #17 的 handleAskAgent）
  3. **8 个 category 折叠区**：每个 category 一行 header（labelKey + totalBytes + itemCount + chevron），展开后列 items 表格（path / size / mtime / safeToDelete 标记 / checkbox）
  4. **底部删除栏**：选中数 + "Delete Selected" 按钮（red tokens `bg-red-600 hover:bg-red-700 text-white`），点击走 dryRun → 确认 → 实删
- 关键交互：
  - `handleScan()` = `hostApi.system.scan({})` → setScan
  - `handleDelete()` = 先 `deleteItems({ items, dryRun:true })` 拿 approvalId → 弹确认对话框（用 `hostApi.dialog.message` 或内联 modal）→ `deleteItems({ items, dryRun:false, approvalId })` → toast.success + 重新 scan
  - `handleAskAgent()` 见 Task #17
- `useEffect` 初始挂载即调 `hostApi.system.info()` + `hostApi.system.scan({})`
- `formatBytes()` helper：B/KB/MB/GB 自适应
- `formatDate()` helper：用 `Intl.DateTimeFormat`
- data-testid：`storage-info-ram` / `storage-info-disk` / `storage-info-cpu` / `storage-scan-refresh` / `storage-category-{id}` / `storage-item-checkbox-{id}` / `storage-delete-button` / `storage-ask-agent-button`

---

### Task #11 — i18n 4 语言 storage 命名空间

**What**: 在 `settings` 命名空间下加 `storage` 顶级 key + `navigation.storage.*`。
**Why**: AGENTS.md 强制要求 4 语言全覆盖，禁止硬编码字符串。
**How**:
- 4 文件并行修改：
  - [shared/i18n/locales/en/settings.json](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/i18n/locales/en/settings.json)
  - [shared/i18n/locales/zh/settings.json](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/i18n/locales/zh/settings.json)
  - [shared/i18n/locales/ja/settings.json](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/i18n/locales/ja/settings.json)
  - [shared/i18n/locales/ru/settings.json](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/i18n/locales/ru/settings.json)
- 在 `navigation` 对象内加：
  ```json
  "storage": { "title": "Storage & Memory", "description": "Scan and clean app caches, logs, and session artefacts" }
  ```
  （zh/ja/ru 对应翻译）
- 加顶级 `storage` 对象，含：
  - `title` / `description`
  - `systemInfo`: `ram`/`disk`/`cpu`/`used`/`free`/`total`/`cores`/`load`/`notAvailable`
  - `categories`: 8 个 key（`logs`/`sessions`/`trajectories`/`mediaOutbound`/`mediaThumbs`/`uvCache`/`electronCache`/`trash`）每个 `{ label, description }`
  - `actions`: `refresh`/`scan`/`deleteSelected`/`askAgent`/`confirmDelete`/`cancel`/`dryRun`/`itemsSelected`
  - `status`: `scanning`/`deleting`/`empty`/`truncated`/`safeToDelete`/`notDeletable`/`regenerable`
  - `toast`: `deleteSucceeded`/`deleteFailed`/`scanFailed`/`ramLow`/`diskLow`
  - `agent`: `recommendPrompt`（注入给 agent 的推荐指令模板）
- 同时在 4 个 `common.json` 加 `storageHealth.ramLow` / `storageHealth.diskLow`（供 Sidebar banner + toast 用）

---

### Task #12 — 创建 storage-health store

**What**: 新建 `src/stores/storage-health.ts`，定时轮询 `hostApi.system.info()` 并暴露低水位标志。
**Why**: Sidebar banner 和 toast 需要一个跨组件共享的健康状态源；遵循 `gateway.ts` store 模式。
**How**:
- 新文件：`src/stores/storage-health.ts`
- 用 `zustand` 的 `create`（参考 [src/stores/gateway.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/src/stores/gateway.ts) L302 模板）
- State shape：
  ```ts
  interface StorageHealthState {
    info: SystemInfoResult | null;
    isInitialized: boolean;
    lastError: string | null;
    ramLow: boolean;   // freeBytes < 512MB
    diskLow: boolean;  // freeBytes / totalBytes < 0.1
    init: () => Promise<void>;
    refresh: () => Promise<void>;
    stop: () => void;
  }
  ```
- `init()`：调一次 `refresh()`，然后 `setInterval(refresh, 60000)`（60s），存 timer 到模块级变量
- `refresh()`：`hostApi.system.info()` → set info → 计算 ramLow/diskLow；首次进入低水位时 `toast.error(t('common:storageHealth.ramLow'))`（用 i18n 的 key，需在 store 里 `import i18n from 'i18next'` 直接取 t，避免 React hook 限制）
- `stop()`：clearInterval
- 模块级 `storageHealthTimer: ReturnType<typeof setInterval> | null = null`

---

### Task #13 — App.tsx init storage health

**What**: 在 App.tsx 挂载时调 `useStorageHealthStore.init()`。
**Why**: 让健康轮询随应用启动；遵循 gateway store 的 init 模式。
**How**:
- 文件：[src/App.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/App.tsx)
- 位置：L148-156 的 useEffect 链后追加：
  ```ts
  const initStorageHealth = useStorageHealthStore((s) => s.init);
  useEffect(() => { initStorageHealth(); }, [initStorageHealth]);
  ```
- 顶部加 `import { useStorageHealthStore } from '@/stores/storage-health';`

---

### Task #14 — Sidebar 告警 banner

**What**: 在 Sidebar 加 RAM/Disk 低水位 banner，镜像 gateway-restarting 模式。
**Why**: 用户可见的实时提醒，引导跳转到 Settings > Storage。
**How**:
- 文件：[src/components/layout/Sidebar.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/components/layout/Sidebar.tsx)
- 位置：L898-924 的 `sidebar-gateway-restarting` banner 块后，追加 storage-health banner
- 结构（CSS transition，不用 framer-motion，与 gateway 一致）：
  ```tsx
  <div
    data-testid="sidebar-storage-low"
    data-state={storageLow ? 'visible' : 'hidden'}
    className={`overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out ${storageLow ? 'max-h-12 translate-y-0 opacity-100' : 'max-h-0 translate-y-1 opacity-0'}`}
  >
    <button
      onClick={() => navigate('/settings/storage')}
      className="sidebar-nav-text flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-red-700 dark:text-red-400"
      aria-live="polite"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="text-2xs">{t('common:storageHealth.bannerLow')}</span>
    </button>
  </div>
  ```
- 在 Sidebar 顶部加：
  ```ts
  const storageLow = useStorageHealthStore((s) => s.ramLow || s.diskLow);
  ```
- 点击跳转到 `/settings/storage`（用 react-router 的 `useNavigate`，Sidebar 已有）

---

### Task #15 — clawx-storage MCP server

**What**: 在 mcp-api.ts 加虚拟 MCP server `clawx-storage`，暴露 4 个工具给 agent。
**Why**: 让 agent 能 scan/list/delete/recommend，通过 `OptionListCard` 与用户交互。
**How**:
- 文件：[electron/services/mcp-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/services/mcp-api.ts)
- 在 L61 `VERSE_CLAW_GIT_MCP_SERVER_ID` 旁加：
  ```ts
  const VERSE_CLAW_STORAGE_MCP_SERVER_ID = 'clawx-storage';
  const VERSE_CLAW_STORAGE_MCP_SERVER: McpServerConfig = { ... }; // 镜像 L63-77
  const VERSE_CLAW_STORAGE_MCP_TOOLS: McpToolDefinition[] = [
    { name: 'storage_info', description: 'Read system RAM/Disk/CPU usage.', inputSchema: { type:'object', properties:{}, additionalProperties:false }, serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID },
    { name: 'storage_scan', description: 'Scan app-owned data directories for cleanable items.', inputSchema: { type:'object', properties:{ categories:{ type:'array', items:{ type:'string', enum:['logs','sessions','trajectories','mediaOutbound','mediaThumbs','uvCache','electronCache','trash'] } } }, additionalProperties:false }, serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID },
    { name: 'storage_delete', description: 'Delete specified items. Requires prior dryRun approvalId.', inputSchema: { type:'object', properties:{ items:{ type:'array', items:{ type:'object', properties:{ id:{type:'string'}, path:{type:'string'} }, required:['id','path'] } }, approvalId:{ type:'string' } }, required:['items','approvalId'], additionalProperties:false }, serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID },
    { name: 'storage_recommend', description: 'Get a recommended deletion plan (dryRun) for agent to present via tool-ui OptionListCard.', inputSchema: { type:'object', properties:{ categories:{ type:'array', items:{type:'string'} } }, additionalProperties:false }, serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID },
  ];
  ```
- 在 L726 `callClawxGitTool` 旁加 `callClawxStorageTool(toolName, args)`：
  ```ts
  async function callClawxStorageTool(toolName: string, args: Record<string, unknown>) {
    const systemApi = createSystemApi();
    switch (toolName) {
      case 'storage_info': return await systemApi.info();
      case 'storage_scan': return await systemApi.scan({ categories: args.categories as SystemScanCategoryId[] | undefined });
      case 'storage_delete': return await systemApi.deleteItems({ items: args.items as any, dryRun: false, approvalId: args.approvalId as string });
      case 'storage_recommend': {
        const scan = await systemApi.scan({ categories: args.categories as SystemScanCategoryId[] | undefined });
        // 挑 safeToDelete:true 且 sizeBytes 最大的 top 20
        const candidates = scan.categories.flatMap(c => c.items).filter(i => i.safeToDelete).sort((a,b)=>b.sizeBytes-a.sizeBytes).slice(0,20);
        const dryRun = await systemApi.deleteItems({ items: candidates.map(c=>({id:c.id,path:c.path})), dryRun: true });
        return { approvalId: dryRun.approvalId, candidates, totalBytes: candidates.reduce((s,c)=>s+c.sizeBytes,0) };
      }
      default: throw new Error(`Unknown Verse Claw Storage tool: ${toolName}`);
    }
  }
  ```
- 在 L613 `listResult`、L641-655 `resolveMcpServersForContext`、L720 `findServer`、L950 `testServer`、L981 `heartbeat`、L1099 `callTool` 6 处分支里，把 clawx-storage 与 clawx-git 同等处理（prepend / short-circuit / dispatch）
- 顶部 import 加 `createSystemApi` 和 `SystemScanCategoryId` type

---

### Task #16 — chat-api applyToolUiResponseContract

**What**: 在 chat-api.ts 的 sendWithMedia 管道里，给以 `Tool UI response:` 开头的消息前置一段契约说明。
**Why**: Agent 收到 OptionListCard 回传的 `Tool UI response:\n{json}` 文本时，没有系统提示词解释这个格式，可能误解为普通用户输入；注入契约让 agent 知道这是结构化卡片响应，应解析 JSON 并按 action 字段处理。
**How**:
- 文件：[electron/services/chat-api.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/services/chat-api.ts)
- 新增 helper（在 L79 `capContextText` 附近）：
  ```ts
  const TOOL_UI_CONTRACT = `[Tool UI contract] The next user message starts with "Tool UI response:" followed by a JSON object {type, id, action, value}. This is a structured response from a tool-ui interaction card (e.g., OptionListCard), NOT a natural-language user message. Parse the JSON and treat 'value' as the user's selection. Continue the task based on the selection.`;
  function applyToolUiResponseContract(message: string): string {
    if (!message.startsWith('Tool UI response:')) return message;
    return `${TOOL_UI_CONTRACT}\n\n${message}`;
  }
  ```
- 在 L282-284 的注入链**最前面**（applyKnowledgeMetadata 之前）加：
  ```ts
  message = applyToolUiResponseContract(message);
  ```
- 用 `capContextText` 不必包裹（契约很短，~400 字符）

---

### Task #17 — SystemCleaner handleAskAgent 接线

**What**: StorageCleanerSection 的 "Ask Agent to Recommend" 按钮调 chat.send，注入推荐指令。
**Why**: 用户在 Settings 触发 agent 卡片回路，agent 通过 clawx-storage MCP 工具 scan + recommend，回 OptionListCard 让用户在 chat 里确认删除。
**How**:
- 文件：`src/pages/Settings/sections/StorageCleanerSection.tsx`（Task #10 创建的）
- 实现 `handleAskAgent()`：
  ```ts
  const handleAskAgent = useCallback(async () => {
    const prompt = t('storage.agent.recommendPrompt', { /* 可注入当前 scan 摘要 */ });
    // 跳转到 chat 页并发送消息；参考 workspace-session.ts 里的 useChatStore.getState().sendMessage 先例
    const { sendMessage } = useChatStore.getState();
    await sendMessage(prompt);
    navigate('/chat');
  }, [t, navigate]);
  ```
- 顶部加 `import { useChatStore } from '@/stores/chat';` 和 `import { useNavigate } from 'react-router-dom';`
- 注意：如果 `useChatStore.getState().sendMessage` 签名需要 workspaceId/sessionId，需先确保有 active session（参考 workspace-session.ts 的处理）；若无 active session 则先 `createSession` 再 send

---

### Task #18 — E2E: settings-storage spec

**What**: 新建 Playwright E2E 覆盖 storage section 的端到端交互。
**Why**: AGENTS.md 强制要求 "Any user-visible UI change should include or update an Electron E2E spec in the same PR"。
**How**:
- 新文件：`tests/e2e/settings-storage.spec.ts`
- 用例（≥5）：
  1. 导航到 `/settings/storage`，验证 `settings-storage-section` / `settings-storage-title` 可见
  2. 验证 3 张系统信息卡片渲染（`storage-info-ram` / `storage-info-disk` / `storage-info-cpu`）
  3. 点击 `storage-scan-refresh`，验证 8 个 category 区块出现（`storage-category-logs` 等）
  4. 勾选一个 safeToDelete item，点击 `storage-delete-button`，验证确认对话框出现 → 确认 → toast.success 出现 → 该 item 从列表消失
  5. 点击 `storage-ask-agent-button`，验证跳转到 `/chat` 且 chat 输入框出现推荐 prompt（或消息已发送）
- 参考 [tests/e2e/sidebar-session-folders-archive.spec.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/e2e/sidebar-session-folders-archive.spec.ts) 的 Electron 启动模板

---

### Task #19 — 验证: typecheck + lint + test

**What**: 全量验证 + harness spec validate。
**How**:
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`（单元）
- `pnpm run test:e2e tests/e2e/settings-storage.spec.ts`
- `pnpm harness validate --spec storage-memory-cleaner`
- `pnpm run comms:replay` + `pnpm run comms:compare`（因 Task #16 改了 chat-api，触及通信路径，按 AGENTS.md comms-change checklist 执行）

---

## Assumptions & Decisions

1. **StorageCleanerSection 独立文件 vs inline**：选独立文件 `src/pages/Settings/sections/StorageCleanerSection.tsx`。理由：index.tsx 已 2000+ 行，storage UI 复杂（~300 行），inline 会显著降低可读性。这是物理拆分，不引入新抽象。

2. **Sidebar banner 用 CSS transition 而非 framer-motion**：与现有 `sidebar-gateway-restarting` 完全一致，保持视觉/动画统一。

3. **storage-health store 用 i18next 直接取 t**：store 不在 React 组件树内，不能用 `useTranslation` hook，直接 `import i18n from 'i18next'` + `i18n.t(key)`。

4. **clawx-storage 不持久化到 mcp-servers.json**：与 clawx-git 一致，始终 in-memory prepend。

5. **storage_recommend 工具内置 dryRun**：agent 调一次即拿到 approvalId + candidates，不必先 scan 再 dryRun 两步。简化 agent 工作流。

6. **handleAskAgent 跨模块访问 chat store**：用 `useChatStore.getState().sendMessage`，参考 workspace-session.ts 先例。

7. **删除确认用 hostApi.dialog.message**：避免在 StorageCleanerSection 内再写一个 modal 组件，复用原生确认对话框。

8. **v1 不做项**（已批准）：不删用户文件系统任意目录；不操作 RAM（kill 进程/释放内存）；不调度定时自动清理；不做删除历史记录 UI。

## Verification Steps

实现完成后按顺序执行：

1. `pnpm run typecheck` — 0 error
2. `pnpm run lint` — 0 error（warning 可接受）
3. `pnpm test tests/unit/system-api.test.ts` — 全绿
4. `pnpm test` — 全绿（无回归）
5. `pnpm run test:e2e tests/e2e/settings-storage.spec.ts` — 全绿
6. `pnpm harness validate --spec storage-memory-cleaner` — pass
7. `pnpm run comms:replay` + `pnpm run comms:compare` — 无回归（因 Task #16 改 chat-api）
8. 手动 `pnpm dev` 启动，进入 Settings > Storage，验证：
   - 系统信息卡片有数值
   - 扫描后 8 个 category 出现
   - 勾选 + 删除流程走通
   - 点 "Ask Agent" 跳转到 chat 且消息已发送
   - Sidebar banner 在 RAM/Disk 低水位时出现（可手动构造低水位测试）

## 执行顺序

按依赖关系分批：

- **批次 A（后端收尾）**：#3 → #8
- **批次 B（Settings UI）**：#11（i18n 先行）→ #10 → #9
- **批次 C（健康轮询）**：#12 → #13 → #14
- **批次 D（Agent 回路）**：#15 → #16 → #17
- **批次 E（验证）**：#18 → #19

每批完成后跑一次 typecheck，确保不累积错误。
