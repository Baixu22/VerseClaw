---
lifecycleStatus: active
id: chat-worktree-session-navigation
title: Keep checkout, conversation and draft aligned when navigating sessions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore the selected conversation in its owning workspace, refresh Git labels after branch operations, and make related conversations readable without duplicates.
touchedAreas:
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/components/chat/CheckpointsDialog.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/rareui/HookSidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/lib/workspace-session.ts
  - src/stores/workspaces.ts
  - src/styles/codex-sidebar.css
  - src/styles/codex-composer-material.css
  - src/styles/codex-responsive.css
  - shared/i18n/locales/**/chat.json
  - tests/unit/workspace-session.test.ts
  - tests/unit/chat-workspace-session-target.test.ts
  - tests/unit/composer-git-strip.test.tsx
  - tests/unit/session-folder-tree.test.tsx
  - tests/unit/session-workstreams.test.ts
  - tests/e2e/chat-worktree-session-navigation.spec.ts
  - tests/e2e/sidebar-session-family-connectors.spec.ts
  - tests/e2e/chat-session-derived.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/chat-checkpoints.spec.ts
  - docs/dev/chat-worktree-session-navigation.md
  - harness/specs/tasks/chat-worktree-session-navigation.md
  - harness/specs/scenarios/session-derivation-ui.md
  - harness/specs/rules/sidebar-session-row-controls.md
  - harness/specs/fixtures/chat-worktree-session-navigation/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Opening a conversation activates its owning workspace and restores its saved draft.
  - Branch operations refresh checkout identity across the header, composer and status card.
  - Parents disclose their related conversations, and the searchable session menu lists each child once with a source link.
  - Family disclosure and relationship connectors have one owner; selection and hover rails do not draw over them.
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - comms-regression
  - i18n-locale-coverage
  - docs-sync
  - ui-motion-material-system
requiredProfiles:
  - fast
  - e2e
  - comms
requiredTests:
  - pnpm run test:e2e:run tests/e2e/sidebar-session-family-connectors.spec.ts
  - pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/chat-workspace-session-target.test.ts tests/unit/composer-git-strip.test.tsx tests/unit/session-folder-tree.test.tsx tests/unit/session-workstreams.test.ts
  - pnpm run test:e2e:run tests/e2e/chat-worktree-session-navigation.spec.ts tests/e2e/chat-session-derived.spec.ts tests/e2e/chat-composer-git-strip.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Selecting a session in another workspace restores that exact session and its draft; the former workspace never acquires the target session.
  - A pending draft save remains bound to its original workspace and session during immediate navigation.
  - Switching a branch refreshes the header, composer and session activity from the existing Host routes.
  - Reopening a known worktree restores its saved session instead of creating a new one.
  - Related sessions appear once in the header menu, the current session stays visible, and source navigation is explicit.
  - A child with no saved workspace UI state opens in its recorded parent's workspace, while an explicit child workspace always takes precedence.
  - Agent-driven Electron tests capture light, dark and narrow layouts with two workspaces, distinct histories and drafts.
  - Light and dark screenshots cover parent/child selection, family hover and collapse without duplicate travelling rails; ordinary projects keep their existing rail.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The existing workspaces and chat stores own persistent state. Navigation must
finish in the selected workspace before loading that workspace's conversation.
