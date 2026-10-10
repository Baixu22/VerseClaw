---
lifecycleStatus: archived
id: project-rules-center-vnext
title: Project Rules Center vNext
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose active project instructions, harness task context, required rules, validation commands, and rule drift warnings through a product surface backed by AGENTS.md and harness/specs.
touchedAreas:
  - docs/clawx-design-overview.md
  - harness/specs/tasks/code-review-center-vnext.md
  - harness/specs/tasks/diff-workbench-vnext.md
  - harness/specs/tasks/project-rules-center-vnext.md
  - AGENTS.md
  - harness/specs/**
  - shared/types/**
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/**
  - src/pages/**
  - src/components/**
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
expectedUserBehavior:
  - Users can inspect active project instructions from AGENTS.md and selected harness specs.
  - Users can select a task spec and see harness context read order, required rules, required profiles, and validation commands.
  - Users can identify missing specs, drift warnings, and whether a lesson belongs in rules, guides, layers, scenarios, or tasks.
  - Users can run or copy safe validation commands through the Developer Command Surface when available.
  - The center never creates a parallel rules source outside harness/specs.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - workspace-harness-single-source
requiredTests:
  - pnpm run typecheck
  - tests/unit/project-rules-center.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/host-api-facade.test.ts
  - pnpm run test:e2e -- tests/e2e/project-rules-center.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/project-rules-center-vnext.md
acceptance:
  - Renderer rules UI uses typed host-api/api-client calls only.
  - AGENTS.md remains the lightweight entry point and durable rules remain under harness/specs.
  - The center displays harness context, required rules, required tests, profiles, and validation commands for a selected task spec.
  - Drift or missing-spec warnings are advisory and do not mutate specs without an explicit user action.
  - All user-facing strings are covered in en, zh, ja, and ru locale files.
  - Electron E2E covers opening the center, selecting a task spec, viewing required rules, and copying or running a validation command.
docs:
  required: true
---

Use this task spec when implementing the P0 Project Rules Center described in `docs/clawx-design-overview.md`.

The center should reuse `AGENTS.md`, `harness/specs/rules`, `harness/specs/scenarios`, `harness/specs/tasks`, `harness/specs/guides`, `harness/specs/layers`, and the harness context/validate CLI. It may add host-api/runtime capabilities at implementation time, but this spec intentionally does not define final wire schemas.

Out of scope:

- Replacing `AGENTS.md`.
- Moving durable policy out of `harness/specs/**`.
- Creating `.trellis` or any other parallel agent truth source.
