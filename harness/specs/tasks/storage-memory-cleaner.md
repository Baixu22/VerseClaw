---
lifecycleStatus: archived
id: storage-memory-cleaner
title: Storage & Memory Cleaner (settings tool)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Settings > Storage & Memory section that scans app-owned data directories, displays disk/RAM usage, lets the user selectively delete cached/log/archived items (UI direct path), and optionally hands off a scan summary to the chat agent who recommends deletions via an OptionListCard and executes them through a new clawx-storage MCP tool.
touchedAreas:
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/system-api.ts
  - electron/main/ipc-handlers.ts
  - electron/utils/token-usage.ts
  - shared/types/workspace.ts
  - electron/services/permissions-api.ts
  - electron/services/mcp-api.ts
  - electron/services/chat-api.ts
  - electron/services/sessions-api.ts
  - src/pages/Settings/index.tsx
  - src/pages/Settings/sections/StorageCleanerSection.tsx
  - src/stores/storage-health.ts
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/en/common.json
  - shared/i18n/locales/zh/common.json
  - shared/i18n/locales/ja/common.json
  - shared/i18n/locales/ru/common.json
  - tests/e2e/settings-storage.spec.ts
  - tests/unit/mcp-api.test.ts
  - harness/specs/tasks/storage-memory-cleaner.md
expectedUserBehavior:
  - User navigates to Settings > Storage & Memory and sees system overview cards (RAM, Disk, CPU) populated from a lightweight hostApi.system.info call.
  - User clicks "Scan"; hostApi.system.scan walks app-owned data dirs and returns categories (logs, sessions, trajectories, mediaOutbound, mediaThumbs, uvCache, electronCache, trash) with per-item sizes, mtimes, and safe-to-delete flags.
  - User expands a category, selects items via checkboxes; the action bar shows the running total of selected size.
  - User clicks "Delete selected"; the UI first calls deleteItems with dryRun:true to project removals, shows a confirmation modal with the projected freed bytes and risk notes, then on confirm calls deleteItems with dryRun:false and the approvalId returned by the dry-run.
  - Deletion of session/trajectory artefacts reuses sweepSessionArtefacts (pointer-following, ENOENT-tolerant); deletion of logs guards the active log file; deletion of cache dirs uses fs.rm recursive.
  - User clicks "Ask Agent to analyze"; a plain-text scan summary is sent to the current chat session via useChatStore.getState().sendMessage and the app navigates to the chat route.
  - The agent calls the storage_scan MCP tool, emits an OptionListCard (selectionMode multi) of recommended deletions, the user selects and sends the Tool UI response, and the agent calls storage_delete_items (dryRun first, then real with approvalId) to execute the deletion.
  - When RAM free < 5% of total or any disk free < 2%, the sidebar shows a persistent red banner ("storage critical"); clicking it navigates to /settings/storage. A toast fires only on the healthy/warning -> critical transition, not on every poll.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/e2e/settings-storage.spec.ts
acceptance:
  - Renderer continues to use src/lib/host-api.ts as the single entry for backend calls; no new direct ipcRenderer or Gateway HTTP calls are introduced for system scan/delete/info.
  - The system host-api module is registered through the typed HostApiRegistry (registerCoreServices) and dispatched via the host:invoke channel; no legacy ipcMain.handle channels are added.
  - scan only walks app-owned roots (~/.openclaw, app.getPath('userData'), app.getPath('logs'), app.getPath('cache')); paths outside these roots are rejected at deletion time.
  - Active session transcripts (referenced by an agent's sessions.json) are marked deletable:'never' and never swept; archived (.archived.jsonl) are 'conditional'; legacy .deleted.jsonl and orphaned trajectories (no matching live transcript) are 'always'.
  - deleteItems enforces dry-run-first: a real deletion (dryRun:false) requires an approvalId returned by a prior dry-run within 60 seconds, and the requested item id set must match the dry-run set exactly; otherwise it returns success:false.
  - Every deletion is audited via recordPermissionAudit with source:'cleaner' and risk:'destructive'; the auditId is returned in the deleteItems result.
  - The clawx-storage virtual MCP server mirrors the clawx-git pattern (SERVER_ID, SERVER config, TOOLS array, callTool dispatch) and exposes exactly two tools: storage_scan and storage_delete_items; storage_scan truncates items to 200 per category for the agent view.
  - applyToolUiResponseContract in chat-api.ts prepends a contract block only when the message starts with "Tool UI response:" and is a no-op otherwise; it runs before applyKnowledgeMetadata in the send pipeline.
  - The storage-health Zustand store polls hostApi.system.info every 5 minutes (skipped while document.hidden), computes status with thresholds (critical: RAM free<5% or disk free<2%; warning: RAM free<15% or disk free<8%), and fires a toast only on transition into critical.
  - All user-facing strings are routed through react-i18next with full locale coverage (en / zh / ja / ru) under the settings namespace (storage.* keys); no hardcoded display strings.
  - The Settings section wiring follows the existing 6-point pattern (SettingsSectionId, SETTINGS_SECTION_SEGMENTS, sectionMeta, settingsSections, settingsSectionGroups, render block) with testId 'settings-nav-storage' and 'settings-storage-section'.
docs:
  required: true
---

## Overview

Adds a Storage & Memory Cleaner tool under Settings. The tool addresses
disk-pressure and RAM-pressure scenarios by scanning app-owned data
directories, surfacing deletable categories, and offering two deletion
paths: a direct UI path (scan -> select -> dry-run -> confirm -> delete)
and an agent-mediated path (scan summary injected into chat -> agent
calls clawx-storage MCP tools -> OptionListCard confirmation -> agent
executes deletion).

## Architecture

### Backend (system host-api module)

`createSystemApi()` in `electron/services/system-api.ts` exposes three
actions registered via `registerCoreServices`:

  - `info()` — returns RAM (os.totalmem/freemem + process.memoryUsage().rss),
    disk (fs.statfs on userData/logs/openclaw config roots), CPU
    (os.cpus/loadavg; Windows returns available:false).
  - `scan()` — walks app-owned roots and returns categories with per-item
    sizes. Reuses `listAgentIdsWithSessionDirs` (now exported from
    token-usage.ts), `logger.listLogFiles`, and `sweepSessionArtefacts`
    semantics for session/trajectory classification. Items capped at 500
    per category with a `truncated` flag.
  - `deleteItems()` — dryRun returns projected removals + an approvalId
    cached for 60s; real deletion requires a matching approvalId. Session
    artefacts are swept via `sweepSessionArtefacts`; logs guard the active
    file; cache dirs use `fs.rm`. Every deletion is audited via
    `recordPermissionAudit` with `source:'cleaner'`.

### Agent tool bridge (clawx-storage MCP server)

`electron/services/mcp-api.ts` gains a second virtual MCP server
(`clawx-storage`) mirroring `clawx-git`. It exposes `storage_scan` and
`storage_delete_items` tools; `callTool` dispatches to `createSystemApi()`.
`storage_scan` truncates items to 200/category for the agent view (the UI
gets the full list via host-api directly).

### Chat injection

`applyToolUiResponseContract` in `chat-api.ts` prepends a contract block
when a message starts with `Tool UI response:` so the agent reliably
parses OptionListCard selections. The Settings "Ask Agent to analyze"
button sends a plain-text scan summary to the current chat session via
`useChatStore.getState().sendMessage` and navigates to `/`.

### Reminder system

`useStorageHealthStore` (Zustand) polls `hostApi.system.info` every 5
minutes, computes status, and surfaces a sidebar footer banner
(`sidebar-storage-warning`) mirroring `sidebar-gateway-restarting`. A
toast fires only on transition into critical.

### Transport policy

All scan/delete/info operations go through `hostApi.system.*` (typed
Host API IPC). The agent-mediated path's deletions also go through
`hostApi.system.deleteItems` via the MCP tool bridge — no bypass of the
sandbox or audit.
