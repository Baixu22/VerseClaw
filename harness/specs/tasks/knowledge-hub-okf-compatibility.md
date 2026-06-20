---
id: knowledge-hub-okf-compatibility
title: Knowledge Hub OKF compatibility
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add local-folder OKF v0.1 validation and import as a thin Knowledge Hub adapter over memory-wiki.
touchedAreas:
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - src/pages/Knowledge/**
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Users explicitly select a local OKF folder before validation or import.
  - Validation shows concepts, reserved files, type distribution, warnings, broken links, and hard errors.
  - Users can import all valid concepts or only selected concepts after reviewing validation output.
  - OKF import calls memory-wiki ingest for selected concept Markdown files and never calls wiki.apply.
  - Obsidian absence does not block OKF validation or import.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/knowledge-hub.spec.ts
acceptance:
  - Renderer calls OKF actions through src/lib/host-api.ts and never directly calls Gateway wiki endpoints.
  - validateOkfBundle accepts local folders only, skips reserved index.md/log.md as concepts, and rejects concept files without parseable frontmatter or type.
  - Unknown OKF fields/types, missing optional fields, missing root index.md, and broken internal links are warnings rather than hard failures.
  - importOkfBundle writes bundle mapping metadata under knowledge/okf/bundles and appends audit events.
  - Chat knowledgeScope remains read-only and does not grant OKF write/apply authority.
docs:
  required: true
---

OKF compatibility is a format adapter for local Markdown/YAML-frontmatter bundles. It must not add a new RAG stack, Google service dependency, vector database, graph database, zip/tar import, Git import, OKF export, or Obsidian requirement.
