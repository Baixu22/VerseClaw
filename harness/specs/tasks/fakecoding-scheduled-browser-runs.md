---
lifecycleStatus: archived
id: fakecoding-scheduled-browser-runs
title: FakeCoding Scheduled workbench and Browser settings convergence
scenario: windows-ui-v2
taskType: implementation
intent: Project existing Cron jobs and supervised Browser Tasks into one truthful Scheduled workbench while moving Browser Profile and Vault management into Settings without changing backend models, approval policy, or transport.
touchedAreas:
  - harness/specs/tasks/fakecoding-scheduled-browser-runs.md
  - src/pages/Cron/**
  - src/pages/Settings/**
  - src/components/settings/BrowserSettingsPanel.tsx
  - src/stores/scheduled.ts
  - shared/i18n/locales/**/cron.json
  - shared/i18n/locales/**/browser.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/scheduled-store.test.ts
  - tests/e2e/fakecoding-scheduled-browser-runs.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Scheduled shows Cron jobs and supervised Browser Tasks in one compact, searchable list with an explicit source filter.
  - Cron jobs retain create, edit, enable or pause, delete, run now, delivery configuration, and run history.
  - Browser Tasks retain approval, rejection, retry, cancellation, ordered steps, verification result, and error evidence.
  - A Browser Task action refreshes the Scheduled projection and the shared Inbox pending count immediately.
  - Browser Profiles and protected credential metadata are reachable through Settings > Browser; profile create or edit and credential save or delete use the existing typed host API.
  - At 960px, selecting an item replaces the list with a detail view that has a visible back control.
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
  - pnpm harness validate --spec harness/specs/tasks/fakecoding-scheduled-browser-runs.md
  - pnpm exec vitest run tests/unit/scheduled-store.test.ts tests/unit/fakecoding-design-system.test.ts
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/fakecoding-scheduled-browser-runs.spec.ts tests/e2e/cron-browser-automation.spec.ts tests/e2e/cron-card-long-title.spec.ts
acceptance:
  - ScheduledItem is a renderer-only discriminated union of cron-job and browser-task records; Cron and Agent Browser remain separate backend sources of truth.
  - Renderer uses only hostApi.cron and hostApi.agentBrowser for the new surface and adds no direct IPC, Gateway request, backend model, or security-policy changes.
  - Waiting Browser Tasks can only approve-and-run or reject; failed, cancelled, and interrupted tasks can retry; running tasks can cancel.
  - Browser Task details show target, allowed domains, profile, mode, permission scope, success criterion, ordered step status, verification result, timestamps, and available actions.
  - Browser source failure preserves usable Cron data and Cron source failure preserves usable Browser data.
  - The page has one primary action in each visible state, no solid blue CTA, no nested page cards, and no horizontal overflow at 1280x800 or 960x800.
  - Settings > Browser shows Profile and Vault capabilities without exposing stored passwords or bypassing host-api encryption.
  - All new user-facing strings have en, zh, ja, and ru coverage.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This task does not move live Browser sessions into Chat, add Review workspace tabs, converge Knowledge, or remove the legacy rollback. Those remain serial TF-0025 through TF-0027 work.
