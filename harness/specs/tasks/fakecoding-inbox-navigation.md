---
id: fakecoding-inbox-navigation
title: FakeCoding four-entry navigation and real Inbox aggregation
scenario: windows-ui-v2
taskType: implementation
intent: Reduce the primary sidebar to New task, Inbox, Scheduled, and Knowledge while projecting existing permission approvals, Remote Tasks, and waiting Browser Tasks into one truthful Inbox without changing backend models or security policy.
touchedAreas:
  - harness/specs/tasks/fakecoding-inbox-navigation.md
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/settings/RemoteTaskDeveloperPanel.tsx
  - src/pages/Inbox/**
  - src/stores/inbox.ts
  - shared/i18n/resources.ts
  - shared/i18n/locales/**/common.json
  - shared/i18n/locales/**/inbox.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/inbox-store.test.ts
  - tests/e2e/fakecoding-inbox-navigation.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The fixed primary sidebar contains New task plus exactly three business destinations: Inbox, Scheduled, and Knowledge.
  - Inbox combines permission approvals, Remote Tasks, and Browser Tasks that are waiting for approval, with source, risk, evidence, time, status, and available decisions.
  - Inbox decisions call the existing typed host API and refresh both the list and sidebar pending count immediately.
  - Remote Task history remains visible in Inbox while its local test-envelope creator is available only under Settings > Developer.
  - The legacy Remote Tasks route redirects to the Inbox Remote Tasks filter; Browser, Review, Task Ledger, and ClawGraph routes remain directly compatible without top-level sidebar duplication.
  - At 960px the Inbox switches between list and detail instead of compressing both into a narrow multi-column layout.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - renderer-main-boundary
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fakecoding-inbox-navigation.md
  - pnpm exec vitest run tests/unit/inbox-store.test.ts tests/unit/fakecoding-design-system.test.ts
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/fakecoding-inbox-navigation.spec.ts
acceptance:
  - Renderer calls only hostApi.permissions, hostApi.remoteTasks, and hostApi.agentBrowser; it adds no direct IPC, Gateway transport, backend model, or security-policy changes.
  - InboxItem is a discriminated union whose action set is constrained by permission, Remote Task, and Browser Task source types.
  - Sidebar pending count is derived from actionable aggregate items and updates after every decision without a reload.
  - Permission approvals preserve approved/denied semantics, Remote Tasks preserve approve/reject/execute semantics, and Browser Tasks preserve approve-and-run/reject semantics.
  - Source failures are shown as partial-data errors and do not erase successfully loaded Inbox sources.
  - The primary sidebar exposes exactly three business links and no visible Browser or Review duplicates.
  - All new user-facing strings have en, zh, ja, and ru coverage.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This task reorganizes renderer entry points only. Scheduled Browser Runs belong to TF-0024, Chat workspace Browser/Review belongs to TF-0025, and Knowledge convergence belongs to TF-0026.
