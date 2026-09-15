---
id: knowledge-hub-information-density
title: Knowledge Hub workspace-first information density
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
intent: Make the Knowledge Hub open directly into a focused document workspace while preserving every existing governed knowledge workflow behind compact navigation and on-demand utility panels.
touchedAreas:
  - harness/specs/tasks/knowledge-hub-information-density.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/renderer-main-boundary.md
  - src/pages/Knowledge/**
  - src/pages/Chat/KnowledgeChat.tsx
  - src/lib/knowledge-review-items.ts
  - src/App.tsx
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-page.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-ux-cdp.spec.ts
  - tests/e2e/knowledge-review-queue.spec.ts
  - tests/unit/knowledge-review-items.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-design-overview.md
expectedUserBehavior:
  - Opening Knowledge shows document search, results, and the Markdown workspace in the first viewport without repeated overview dashboards.
  - Library and Review Queue are the only primary navigation views; Inbox, Drafts, and Proposal become status filters inside Review Queue.
  - Runtime Lessons, Governance, OKF validation, Source Sets, Studio actions, and related pages appear only under More > Maintenance or Source tools.
  - Knowledge Librarian is available as the Chat "ask the knowledge base" mode and keeps citations, draft save, review submission, and existing governed write boundaries.
  - Edit is an explicit mode; Preview and Edit never stack side-by-side at the 960px minimum window width.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm exec eslint src/pages/Knowledge src/pages/Chat/KnowledgeChat.tsx src/lib/knowledge-review-items.ts src/App.tsx tests/unit/knowledge-page.test.tsx tests/unit/knowledge-review-items.test.ts tests/unit/knowledge-chat.test.tsx tests/e2e/knowledge-hub.spec.ts tests/e2e/knowledge-ux-cdp.spec.ts tests/e2e/knowledge-review-queue.spec.ts
  - pnpm exec vitest run tests/unit/knowledge-page.test.tsx tests/unit/knowledge-review-items.test.ts tests/unit/knowledge-chat.test.tsx
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/knowledge-hub.spec.ts tests/e2e/knowledge-ux-cdp.spec.ts tests/e2e/knowledge-review-queue.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - At 1280x800, the Library document list and Markdown preview are visible without scrolling the page shell; entering the editor requires an explicit Edit or New action.
  - At the 960px minimum window width, the Library split view does not overlap or force horizontal page scrolling.
  - Import, OKF, Vault, refresh, configure, initialize, Governance, Source Set, Studio, and Librarian workflows remain reachable through progressive disclosure.
  - Knowledge uses the existing Host API contracts, write confirmation policy, persistence, and backend authority.
  - Inbox, Drafts, Proposal, Review, and Governance retain their existing internal business content and actions through the unified Review Queue or on-demand tools.
  - KnowledgeReviewItem is a renderer projection of existing Inbox, Draft and Proposal DTOs; selecting an item reaches its existing governed actions without introducing a second queue authority.
  - The Chat knowledge mode reuses the bounded Librarian lookup/answer/draft/review paths and existing version-1 local checkpoint, with explicit navigation back to Library or Review Queue.
  - A draft without a proposal requires an explicit Prepare proposal action before approval; changing the selected draft clears the previous proposal and unrelated steward results.
  - Visiting Chat knowledge mode and returning preserves unsaved Library content, search results, and selected source context without applying changes.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

This task removes repeated dashboard-style summaries from the Knowledge Hub and uses progressive disclosure for low-frequency utilities. It must not remove governed workflows or introduce a second knowledge backend.
