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
  - Library, Inbox, Drafts, and Review remain primary navigation; Governance and maintenance actions remain reachable from the page menu.
  - Vault status, OKF validation, Source Sets, Studio actions, and related pages appear only when the user opens their utility panel.
  - Knowledge Librarian remains available from the compact page header and keeps its existing governed write boundaries.
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
  - Import, OKF, Vault, refresh, configure, initialize, Governance, Source Set, Studio, and Librarian workflows remain reachable within two interactions.
  - Existing Knowledge Host API calls, write confirmation policy, persistence, and backend contracts are unchanged.
  - Inbox, Drafts, Review, and Governance retain their existing internal business content and actions.
docs:
  required: false
  note: README capability descriptions remain accurate because this task changes layout and disclosure only.
---

This task removes repeated dashboard-style summaries from the Knowledge Hub and uses progressive disclosure for low-frequency utilities. It must not remove governed workflows or introduce a second knowledge backend.
