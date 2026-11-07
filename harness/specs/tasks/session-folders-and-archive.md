---
lifecycleStatus: archived
id: session-folders-and-archive
title: Sidebar session folders and archive (recycle bin)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let users group conversations into nested folders within a workspace and archive (soft-delete) conversations into a recycle-bin-style modal from which they can be restored or permanently deleted.
touchedAreas:
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - electron/utils/session-files.ts
  - src/lib/host-api.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat.ts
  - src/stores/workspaces.ts
  - src/components/layout/session-buckets.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/ArchiveModal.tsx
  - shared/types/workspace.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/chat-production-session-actions.test.ts
  - tests/unit/session-buckets-folders.test.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
  - harness/specs/tasks/session-folders-and-archive.md
expectedUserBehavior:
  - User clicks "New folder" in a workspace's session group, enters a name, and the folder appears in the sidebar.
  - Folders can be nested by specifying a parent folder when creating.
  - User hovers a session row, clicks the move button, and selects a target folder from the dropdown menu; the session moves into that folder.
  - Moving a session to "No folder" (root) removes it from its current folder and places it back at the workspace root.
  - User renames a folder via its row menu; the folder name updates in place.
  - User deletes a folder; the folder and its descendants are removed. Sessions inside the deleted folder are moved to the parent folder (or to the workspace root if the deleted folder was a root folder).
  - User clicks the delete (trash) button on a session row; a dialog appears with three options: Cancel, Archive, Permanent Delete.
  - Archiving a session removes it from the sidebar and moves it to the archive index. The on-disk transcript is renamed to <id>.archived.jsonl so sessions.list stops surfacing it.
  - User opens the Archive modal from the sidebar footer; the modal lists all archived sessions with their labels and archived-at timestamps.
  - User clicks Restore on an archived entry; the session reappears in the sidebar (sessions.list includes it again) and disappears from the archive modal.
  - User clicks Permanent Delete on an archived entry; the .archived.jsonl transcript and its sibling artefacts are hard-deleted from disk and the entry is removed from the archive index.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/chat-production-session-actions.test.ts
  - tests/unit/session-buckets-folders.test.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
acceptance:
  - Renderer continues to use src/lib/host-api.ts as the single entry for backend calls; no new direct ipcRenderer or Gateway HTTP calls are introduced for folder or archive operations.
  - Folder CRUD (create / rename / delete / moveSession) is persisted in the workspace document (electron-store JSON) via workspaces-api.ts and surfaces a success snapshot that the workspaces store applies with applySnapshot.
  - Deleting a folder moves its sessions to the parent folder (or root) rather than orphaning or deleting them. Descendant sub-folders are removed.
  - buildSidebarWorkspaceFolderGroups preserves empty folders so the sidebar can render the folder shell even when it has no sessions yet (lets the user drop sessions into it).
  - Sessions whose assignment points to a non-existent folder fall through to rootSessions (defence-in-depth against stale assignments).
  - Archiving renames <id>.jsonl to <id>.archived.jsonl on disk and adds an entry to sessions.archives.json (the Verse-Claw-owned archive index) with originalWorkspaceId and originalFolderId so the session can be restored to its original location.
  - Restoring renames <id>.archived.jsonl back to <id>.jsonl and removes the entry from the archive index; the renderer's loadSessions call re-surfaces it.
  - Permanent delete runs the same sweepSessionArtefacts path as hard-delete but targets the .archived.jsonl base id, removing the transcript and any sibling artefacts from disk.
  - The delete dialog in Sidebar.tsx offers Cancel, Archive, and Permanent Delete; the Archive modal in ArchiveModal.tsx lists archived entries with restore and permanent-delete actions.
  - All user-facing strings are routed through react-i18next with full locale coverage (en / zh / ja / ru) under the chat namespace.
  - agentId from the sessionKey is validated against /^[A-Za-z0-9][A-Za-z0-9_-]*$/ in the archive/restore/permanentDelete paths, consistent with the hard-delete session path.
docs:
  required: true
---

## Overview

The sidebar previously listed conversations only as a flat list per workspace.
This task adds two capabilities:

1. **Session folders** — nested, folder-like grouping within a workspace's
   session group. Folders are persisted in the workspace document alongside
   `sessionStates` and `agentBindings`; session-to-folder membership is stored
   in `sessionFolderAssignments` (a `Record<sessionKey, folderId>`).

2. **Archive (recycle bin)** — a soft-delete path that renames the on-disk
   transcript to `<id>.archived.jsonl` so `sessions.list` stops surfacing it,
   while keeping a Verse-Claw-owned index (`sessions.archives.json`) beside
   `sessions.json` so the session can be restored verbatim. The Archive modal
   in the sidebar footer lists archived entries and offers Restore or
   Permanent Delete.

## Architecture

### Folder persistence (workspaces-api.ts)

Folder CRUD operates on the workspace document (electron-store JSON). Each
`WorkspaceProfile` gains two optional fields:

  - `sessionFolders: SessionFolder[]` — the folder tree (id, name, parentId,
    order, createdAt, updatedAt).
  - `sessionFolderAssignments: Record<string, string>` — maps a session key
    to the folder id it belongs to.

`createFolder` generates a stable id derived from the folder name (slugified)
with a numeric suffix for de-duplication. `deleteFolder` collects the folder
and all descendant folder ids, removes them, and re-parents affected sessions
to the deleted folder's parent (or root if the deleted folder was a root
folder). `moveSessionToFolder` updates the assignment map; a null `folderId`
removes the session from any folder.

### Sidebar grouping (session-buckets.ts)

`buildSidebarWorkspaceFolderGroups` takes the flat session list, the folder
tree, and the assignment map, and produces a tree of `SidebarFolderNode`
objects. Sessions whose assignment points to a non-existent folder fall
through to `rootSessions`. Empty folders are preserved so the sidebar can
render the folder shell.

### Archive index (sessions-api.ts + session-files.ts)

`archiveSessionTranscript` (in `electron/utils/session-files.ts`) renames
`<id>.jsonl` to `<id>.archived.jsonl`. The archive index
(`sessions.archives.json`) stores `SessionArchiveEntry` records with
`originalWorkspaceId` and `originalFolderId` so restoration can place the
session back in its original location. `permanentDeleteSession` runs the same
`sweepSessionArtefacts` path as hard-delete but targets the `.archived.jsonl`
base id.

### Renderer surface

  - `src/stores/chat/session-actions.ts` — `archiveSession`,
    `restoreSession`, `permanentDeleteSession`, `loadArchivedSessions`.
  - `src/stores/workspaces.ts` — `createWorkspaceFolder`,
    `renameWorkspaceFolder`, `deleteWorkspaceFolder`,
    `moveSessionToFolder`.
  - `src/components/layout/Sidebar.tsx` — delete dialog with Archive +
    Permanent Delete options; footer Archive button.
  - `src/components/layout/SessionFolderTree.tsx` — recursive folder tree
    with create / rename / delete / move-session actions.
  - `src/components/layout/ArchiveModal.tsx` — modal listing archived
    entries with restore and permanent-delete actions.

### Transport policy

All folder and archive operations go through `hostApi.workspaces.*` and
`hostApi.sessions.*` (typed Host API IPC). No direct `ipcRenderer` or
Gateway HTTP calls are introduced.
