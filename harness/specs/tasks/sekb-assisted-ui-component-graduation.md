---
id: sekb-assisted-ui-component-graduation
title: SEKB assisted UI component graduation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose the existing manual SEKB suggest, review, confirm or reject, and retrieve workflow in the Knowledge page without introducing automatic writeback, hidden promotion, or a second knowledge authority.
touchedAreas:
  - harness/specs/tasks/sekb-assisted-ui-component-graduation.md
  - harness/specs/rules/sekb-assisted-review-boundary.md
  - electron/services/knowledge-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Knowledge/index.tsx
  - shared/i18n/locales/**/knowledge.json
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/sekb-golden-path.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - artifacts/first-product-preview/FP-P4-01/**
  - artifacts/sekb-golden-path/evidence.json
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-01.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - The Knowledge page exposes a Runtime Lessons workspace that lists undistilled trajectories and active confirmed principles.
  - Requesting suggestions produces review-only candidates with source trajectory lineage and no durable principle write.
  - A candidate can be inspected before the user explicitly confirms or rejects that exact candidate.
  - Confirm requires visible session lineage and persists through the existing Main-owned confirm_and_save path.
  - Reject removes the candidate from the current review queue and never creates a principle or DCS experience block.
  - Retrieval searches only confirmed active principles and shows the returned advisory injection text for conversation use.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - comms-regression
  - sekb-hermes-write-path-boundary
  - sekb-hermes-default-off-boundary
  - sekb-assisted-review-boundary
acceptance:
  - Renderer calls only existing typed host-api methods and adds no direct IPC or Gateway transport.
  - Deterministic suggestion and review produce no principle, ContextBlock, trajectory, or index write before confirmation.
  - The review surface shows the cluster summary, confidence, source trajectories, and proposed principle fields.
  - Confirm is disabled without explicit session lineage and sends sourceSystem ui-confirm with confirmed integrity.
  - Reject records only the existing rejection action and cannot call confirm or any durable wiki apply path.
  - Retrieval displays confirmed principles and bounded advisory injection text without enabling automatic prompt injection.
  - Unit coverage proves zero-write-before-confirm, exact confirm payload, reject behavior, and retrieval rendering.
  - Electron E2E covers suggest, review, confirm, retrieve, and reject through the typed Main route.
  - User-visible strings cover en, zh, ja, and ru.
docs:
  required: true
---

Use this task spec for `FP-P4-01`. This is an engineering-validation-only component graduation. It does not authorize automatic SEKB writeback, default-on capture or injection, batch assistant enablement, Controlled Preview inclusion, product approval, or GA.
