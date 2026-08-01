---
id: fakecoding-workspace-convergence
title: FakeCoding conversation workspace convergence
scenario: windows-ui-v2
taskType: implementation
intent: Converge the Chat workspace into a restrained FakeCoding-style Review, Terminal, Browser, Files, Artifacts, and Audit surface while preserving the existing real renderer-to-Main capabilities and compatibility routes.
touchedAreas:
  - harness/specs/tasks/fakecoding-workspace-convergence.md
  - shared/types/workspace.ts
  - src/stores/artifact-panel.ts
  - src/components/icons/**
  - src/components/file-preview/**
  - src/components/ai-elements/web-preview.tsx
  - src/pages/Chat/**
  - src/pages/CodeReview/**
  - src/pages/TaskLedger/**
  - src/pages/ClawGraph/**
  - src/App.tsx
  - src/styles/codex-workspace-panel.css
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/workspace-*.spec.ts
  - tests/e2e/code-review-center.spec.ts
  - tests/e2e/remote-forge-controlled-preview.spec.ts
  - tests/e2e/agent-browser-workbench.spec.ts
expectedUserBehavior:
  - The workspace exposes only Review, Terminal, Browser, Files, Artifacts, and Audit as visible top-level tabs.
  - Review contains Changes, AI Review, and Pull Requests without restoring a separate top-level review page.
  - Browser contains Preview and Live; Live exposes supervised session navigation, visibility, screenshots, snapshots, UID interactions, and mode-upgrade approval without moving scheduled tasks or profile management into Chat.
  - Terminal can be shown in the bottom panel or the side tab while retaining one backend session, scrollback, and permission state.
  - Files uses a tree-and-preview split on wide panels and a tree-or-preview single view at 960px.
  - Task Ledger and ClawGraph remain full-page tools reached from workspace context links with optional nodeId or runId focus.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - renderer-main-boundary
  - agent-browser-supervised-task-boundary
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fakecoding-workspace-convergence.md
  - pnpm exec vitest run tests/unit/artifact-panel-store.test.ts tests/unit/fakecoding-workspace-icons.test.ts
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/workspace-terminal-panel.spec.ts tests/e2e/workspace-web-preview-panel.spec.ts tests/e2e/workspace-git-panel.spec.ts tests/e2e/code-review-center.spec.ts tests/e2e/remote-forge-controlled-preview.spec.ts tests/e2e/agent-browser-workbench.spec.ts
acceptance:
  - WorkspacePanelIntent is the only renderer entry for opening a workspace capability and persists only canonical tab and subview values.
  - Legacy changes and preview tabs restore as Review Changes and Files respectively; legacy workspaceView web and git restore as Browser Preview and Review Changes.
  - Switching Terminal between bottom and side placement does not open a second terminal session, duplicate host event subscriptions, or discard scrollback.
  - Browser Preview keeps dev-server detection, start, stop, logs, component selection, and composer capture; Browser Live uses existing typed hostApi.agentBrowser methods for all displayed actions.
  - Review Changes retains Git operations, AI Review retains codeReview execution and Task Ledger node creation, and Pull Requests retains Remote Forge approval and stale-head protections.
  - Official workspace tab icons preserve the exact FakeCoding 20x20 filled path geometry; command icons preserve their source 24x24 stroke geometry and attributes.
  - At 1280x800 and 960x800 in light and dark themes there is no horizontal overflow, clipped control text, incoherent overlap, duplicate heading, or duplicate primary action.
  - The renderer adds no direct IPC or Gateway calls and does not change backend, Host API, persistence, browser security, or approval contracts.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

This task is TF-0025. Knowledge convergence and removal of `?uiVersion=legacy` remain TF-0026 and TF-0027. Browser Tasks stay in Scheduled, and Browser Profiles or Vault stay in Settings > Browser.
