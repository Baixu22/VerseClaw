---
id: sidebar-session-workgroup-drag-drop
title: Sidebar Session Workgroup Drag-and-Drop Auto-Grouping
type: scenario
requiredRules:
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/Sidebar.tsx
  - src/stores/workspaces.ts
  - src/styles/codex-sidebar.css
  - shared/i18n/locales/**
  - tests/unit/session-folder-tree.test.tsx
  - tests/unit/workspaces-store.test.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
---

# Sidebar Session Workgroup Drag-and-Drop Auto-Grouping

## Purpose

Let users organize project conversations by dragging one session row onto
another session row. The drop creates or reuses a single-level workgroup, with
rename/remove affordances and a guide rail inside each group.

## Flow

1. In the sidebar's project view, every conversation row is an HTML5 drag
   handle scoped to its own workspace.
2. Dragging a source conversation over a different conversation shows an
   after-target guide line on that row.
3. Dropping after the target reuses the target's existing workgroup when it has
   one; otherwise the store creates one root-level workgroup named after the
   target and files both conversations into it.
4. New groups never nest: auto-created folders always use `parentId: null`, and
   the sidebar continues to flatten legacy nested folder data to one level.
5. Group headers keep rename and remove actions. Removing a group un-files its
   members without deleting the conversations.
6. Grouped members render inside a single-level accent guide rail; fork/handoff
   lineage remains a separate one-level relationship glyph.

## Validation

- `pnpm i18n:lint`
- `pnpm exec vitest run tests/unit/session-folder-tree.test.tsx tests/unit/workspaces-store.test.ts`
- `pnpm run build:vite`
- `pnpm exec playwright test tests/e2e/sidebar-session-folders-archive.spec.ts`
