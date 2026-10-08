---
id: boot-md-deprecation
title: BOOT.md Deprecation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove BOOT.md from host API read/write paths without deleting existing user files, and reject new writes with explicit migration guidance during the compatibility window.
touchedAreas:
  - harness/specs/tasks/boot-md-deprecation.md
  - electron/utils/agent-config.ts
  - electron/services/agents-api.ts
  - shared/host-api/contract.ts
  - tests/unit/agents-api-bootstrap-deprecation.test.ts
expectedUserBehavior:
  - getBootstrap no longer reads BOOT.md and returns empty legacy fields plus BOOT_MD_DEPRECATED metadata.
  - updateBootstrap rejects BOOT.md writes and never touches existing files.
  - New agent workspace inheritance no longer copies BOOT.md.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/agents-api-bootstrap-deprecation.test.ts tests/unit/agents-api-reasoning-effort.test.ts
  - pnpm run typecheck
  - pnpm run contract:check
acceptance:
  - BOOT.md invalid write paths are zero.
  - Existing BOOT.md files are never deleted silently.
  - Contract fields remain for compatibility and document the next-major removal.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

User-confirmed export/migration remains the only path for converting old BOOT.md content.
