---
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
  - src/components/file-preview/**
  - shared/i18n/locales/**
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/workspace-git-mcp-runtime.spec.ts
  - tests/unit/**
  - harness/specs/tasks/git-github-worktree-agent-tools.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
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
  - tests/unit/mcp-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/workspace-git-mcp-runtime.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer Git/GitHub UI calls only the typed hostApi.git facade.
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

## Out of scope

- GitHub issues, checks, releases, reviews, and merge automation.
- Bundling Git or GitHub CLI binaries.
- Bypassing workspace permission mode or approval audit records for agent calls.
