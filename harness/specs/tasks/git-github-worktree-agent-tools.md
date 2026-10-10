---
lifecycleStatus: archived
id: git-github-worktree-agent-tools
title: Add structured Git, GitHub PR, and worktree controls
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose Git/GitHub/worktree operations through the typed host API, Workspace UI, and a built-in Verse Claw Git MCP tool surface while preserving workspace permissions and approval auditing.
touchedAreas:
  - shared/host-api/contract.ts
  - shared/types/git.ts
  - shared/types/workspace.ts
  - electron/services/git-api.ts
  - electron/services/mcp-api.ts
  - electron/services/permissions-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/git-ui.ts
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/components/file-preview/**
  - shared/i18n/locales/**
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/workspace-git-mcp-runtime.spec.ts
  - tests/unit/**
  - harness/specs/tasks/git-github-worktree-agent-tools.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users can see active branch, dirty/conflict state, ahead/behind counts, and current worktree folder in a compact Chat composer Git strip when the active workspace is a repository.
  - Users can refresh Git context, search and switch branches, create a checked-out branch, add a worktree with a default-path preview, switch to a worktree workspace profile, and open the full Git panel from the composer strip.
  - Users can inspect Git status and file diffs from the Workspace Git panel.
  - Users can stage, unstage, copy file patches, revert selected files with approval, commit, create branches, add worktrees, list PRs, and create PRs through host-api-backed UI actions.
  - The Workspace Git panel shows side-by-side file diffs when text content is available and falls back to patch text for unsupported diffs.
  - Agents and tooling can discover the built-in clawx-git MCP catalog through the host MCP API and call Git tools through the same Main-side Git service.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
  - comms-regression
requiredTests:
  - tests/unit/git-api.test.ts
  - tests/unit/git-ui.test.ts
  - tests/unit/composer-git-strip.test.tsx
  - tests/unit/mcp-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/workspace-git-mcp-runtime.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer Git/GitHub UI calls only the typed hostApi.git facade.
  - Chat composer Git controls use existing hostApi.git and workspace store calls; they do not introduce direct renderer shell/git execution or new model tool exposure.
  - Worktree switching from the composer persists the current workspace session state before creating or switching to the target workspace profile.
  - Main executes git and gh through argument-array child_process calls, not shell-composed commands.
  - Git path operations validate active-workspace containment.
  - Read operations are allowed, normal write operations follow workspace permission mode, and dangerous Git/GH operations create git-sourced approval records.
  - Reverting a selected file is treated as a dangerous Git operation and requires approval before discarding local changes.
  - File diff responses can include original/modified text for Monaco side-by-side rendering while retaining patch output for copy/fallback.
  - The built-in clawx-git MCP server appears in host MCP resolution and exposes Git status/diff/stage/commit plus GitHub PR list/create tools.
docs:
  required: true
---

## Scope

This task adds a first-class version-control surface for active workspaces. It
does not replace the interactive terminal; it gives UI and agent workflows a
structured, auditable path for common Git and GitHub PR actions.

The Chat composer strip is a compact navigation and context affordance. Full
commit, push, pull request, diff, stash, and destructive worktree operations
remain in the Workspace Git panel.

## Out of scope

- GitHub issues, checks, releases, reviews, and merge automation.
- Bundling Git or GitHub CLI binaries.
- Bypassing workspace permission mode or approval audit records for agent calls.
