---
id: sidebar-session-row-management
title: Managing conversations from sidebar rows and following live activity
type: scenario
requiredRules:
  - sidebar-session-row-controls
  - rareui-interaction-adaptation
  - ui-motion-material-system
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionContextMenu.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/use-title-marquee.ts
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/components/rareui/HookSidebar.tsx
  - src/styles/codex-sidebar.css
  - src/styles/rareui-interactions.css
  - tests/e2e/sidebar-session-row-polish.spec.ts
---

# Managing conversations from sidebar rows

1. Hover a conversation row. Pin and ⋯ appear at its right edge, the title
   stops before them, and a running conversation keeps its status orb.
2. Hover a row whose title is longer than the row. After a short dwell the
   title scrolls as a loop; moving the pointer away returns it to rest. With
   reduced motion enabled it stays still and the tooltip shows the full title.
3. Open ⋯. The menu opens under the button with rename, move to a workgroup,
   unread, pin, fork, hand off, copy, archive and delete; right-click on the row
   opens the same menu at the pointer. Arrow keys move through it and Escape
   closes it.
4. Choose Archive. The row leaves the list and a toast offers Undo, which
   restores it. Delete still asks for confirmation.
5. Start a run in any conversation. The header bell shows a blue ring; when a
   run waits for approval or input the ring turns amber and the bell swings
   once. Open the bell: running conversations are listed with elapsed time
   above the recent completions, errors and approval requests.

Run with agent-driven Electron automation (`tests/e2e/sidebar-session-row-polish.spec.ts`)
and record light, dark and reduced-motion states as `driven_by: agent`; do not
claim human review.
