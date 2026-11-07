---
id: session-worktree-storage
title: Session worktrees and storage management
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5ad905b44c2822caf6037df9278a8a260a27d3f9
intent: Bind Git checkouts to independent conversations and provide scoped storage and process management through existing owners.
expectedUserBehavior:
  - A working-directory menu creates Git repositories and opens isolated worktrees with independent conversations and restored drafts.
  - /storage and Settings open one resource page with measured usage and scoped release controls.
requiredRules:
  - renderer-main-boundary
  - docs-sync
  - disk-temp-policy
  - session-storage-ownership
touchedAreas:
  - electron/services/session-storage-api.ts
  - electron/services/git-api.ts
  - shared/types/session-storage.ts
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/components/chat/ComposerPopover.tsx
  - src/styles/codex-composer-menu.css
  - scripts/repository-artifacts.json
  - .gitignore
  - src/pages/Settings/sections/StorageSection.tsx
  - tests/unit/session-storage-api.test.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - shared/types/git.ts
  - src/lib/host-api.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Settings/**
  - shared/i18n/locales/**
  - docs/dev/session-worktree-storage.md
  - harness/specs/tasks/session-worktree-storage.md
  - harness/specs/rules/session-storage-ownership.md
  - harness/specs/fixtures/session-worktree-storage/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredProfiles:
  - fast
  - comms
  - e2e
requiredTests:
  - pnpm contract:check
  - pnpm exec vitest run tests/unit/session-storage-api.test.ts tests/unit/git-api.test.ts
  - pnpm exec playwright test tests/e2e/session-worktree-storage.spec.ts --workers=1
acceptance:
  - Chat can initialize a repository, create or select a worktree and resume its own workspace/session state.
  - Existing chat chrome and Settings primitives provide the UI in en, zh, ja and ru.
  - /storage and Settings open the same resource page with measured disk and process data.
  - Resource release is scoped to the selected session; worktree removal refuses active, dirty, locked, shared or primary checkouts and preserves branches.
  - Real Git operations and agent-driven Electron screenshots cover light, dark and narrow layouts.
docs:
  required: true
  readmeTranslations: required
  paths:
    - docs/dev/session-worktree-storage.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Reuse workspace profiles as checkout owners and their existing per-session state. Git remains Main-owned; UI reads typed host snapshots and never executes shell commands.
