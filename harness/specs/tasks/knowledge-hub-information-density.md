---
id: knowledge-hub-information-density
title: Knowledge Hub workspace-first information density
scenario: windows-ui-v2
taskType: implementation
intent: Make the Knowledge Hub open directly into a focused document workspace while preserving every existing governed knowledge workflow behind compact navigation and on-demand utility panels.
touchedAreas:
  - harness/specs/tasks/knowledge-hub-information-density.md
  - src/pages/Knowledge/**
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-page.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-ux-cdp.spec.ts
expectedUserBehavior:
  - Opening Knowledge shows document search, results, and the Markdown workspace in the first viewport without repeated overview dashboards.
  - Library and Review Queue are the only primary navigation views; Inbox, Drafts, and Proposal become status filters inside Review Queue.
  - Runtime Lessons, Governance, OKF validation, Source Sets, Studio actions, and related pages appear only under More > Maintenance or Source tools.
  - Knowledge Librarian is available as the Chat "ask the knowledge base" mode and keeps citations, draft save, review submission, and existing governed write boundaries.
  - Edit is an explicit mode; Preview and Edit never stack side-by-side at the 960px minimum window width.
requiredProfiles:
  - fast
requiredRules:
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm exec eslint src/pages/Knowledge/index.tsx tests/unit/knowledge-page.test.tsx tests/e2e/knowledge-hub.spec.ts tests/e2e/knowledge-ux-cdp.spec.ts
  - pnpm exec vitest run tests/unit/knowledge-page.test.tsx
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/knowledge-hub.spec.ts tests/e2e/knowledge-ux-cdp.spec.ts
acceptance:
  - At 1280x800, the Library document list and Markdown editor are visible without scrolling the page shell.
  - At the 960px minimum window width, the Library split view does not overlap or force horizontal page scrolling.
  - Import, OKF, Vault, refresh, configure, initialize, Governance, Source Set, Studio, and Librarian workflows remain reachable through progressive disclosure.
  - Existing Knowledge Host API calls, write confirmation policy, persistence, and backend contracts are unchanged.
  - Inbox, Drafts, Proposal, Review, and Governance retain their existing internal business content and actions through the unified Review Queue or on-demand tools.
docs:
  required: false
  note: README capability descriptions remain accurate because this task changes layout and disclosure only.
---

This task removes repeated dashboard-style summaries from the Knowledge Hub and uses progressive disclosure for low-frequency utilities. It must not remove governed workflows or introduce a second knowledge backend.
