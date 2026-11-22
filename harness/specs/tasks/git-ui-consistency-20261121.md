---
lifecycleStatus: active
id: git-ui-consistency-20261121
title: Unify Git review, workspace audit and worktree controls
scenario: windows-ui-v2
taskType: runtime-bridge
intent: Give conversation Git cards, repository review, audit and worktree management the shared neutral material and clear progressive actions.
touchedAreas:
  - src/components/file-preview/WorkspaceGitPanel.tsx
  - src/components/file-preview/WorkspaceAuditPanel.tsx
  - src/components/file-preview/MonacoDiffViewer.tsx
  - src/components/file-preview/GeneratedFilesPanel.tsx
  - src/components/ai-elements/commit.tsx
  - src/components/assistant-render/GitHubCard.tsx
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Settings/sections/StorageSection.tsx
  - src/styles/globals.css
  - src/styles/codex-git-surfaces.css
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/settings.json
  - tests/unit/workspace-git-panel.test.tsx
  - tests/unit/github-card.test.tsx
  - tests/unit/workspace-audit-panel.test.tsx
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - tests/e2e/git-ui-consistency.spec.ts
  - harness/specs/tasks/git-ui-consistency-20261121.md
  - harness/specs/fixtures/git-ui-consistency-20261121/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - Git surfaces share semantic theme colors, compact type, line icons and clear secondary actions.
  - Audit entries can be searched and expanded to read full subjects, commands and paths; stale workspace responses never replace the active audit.
  - Worktree context, protection and path remain readable; filtering separates removable and protected checkouts.
  - Review modes expose selection state and adapt to narrow panels; host approval and cleanup protections remain authoritative.
requiredProfiles:
  - fast
requiredRules:
  - renderer-main-boundary
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - tests/unit/workspace-git-panel.test.tsx
  - tests/unit/workspace-audit-panel.test.tsx
  - tests/e2e/git-ui-consistency.spec.ts
  - tests/e2e/workspace-git-panel.spec.ts
acceptance:
  - Verify dark/light, narrow layout, keyboard focus, search, disclosures, worktree filters and approval feedback in a real renderer.
  - Preserve full paths and commit identity in expanded details and copy actions.
  - Label controlled inputs and agent-driven evidence; keep raw screenshots and first failures.
docs:
  required: true
---

Inventory: conversation GitHub cards and composer Git strip; Workspace Git file groups, diffs, branch history, commit form and tools; Workspace Audit permission/reflog timeline; SessionWorkspacePicker; Settings Storage worktree management.
