---
id: diff-workbench-vnext
title: Diff Workbench vNext
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Unify Git staged/unstaged diffs, file preview diffs, runtime diffs artifacts, and proposal diffs into one inspectable, evidence-linked workbench.
touchedAreas:
  - docs/clawx-design-overview.md
  - harness/specs/tasks/code-review-center-vnext.md
  - harness/specs/tasks/diff-workbench-vnext.md
  - harness/specs/tasks/project-rules-center-vnext.md
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
  - Users can inspect staged, unstaged, generated, file-preview, runtime, and proposal diffs from one workbench.
  - Users can filter diffs by source, status, file path, review disposition, and linked task or finding.
  - Diff details show before/after hunks with workspace-contained file links and redacted metadata where needed.
  - Review findings and tests can link to specific diff entries.
  - Apply or reject actions, when implemented, require explicit confirmation and Main-owned path checks.
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
requiredTests:
  - pnpm run typecheck
  - tests/unit/diff-workbench.test.ts
  - tests/unit/git-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - pnpm run test:e2e -- tests/e2e/diff-workbench.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/diff-workbench-vnext.md
acceptance:
  - Renderer diff UI reads data through typed host-api/api-client calls only.
  - Diff sources are labeled as Git, file preview, runtime diffs, Knowledge proposal, or review artifact.
  - File paths are normalized and checked in Main before any filesystem-backed read or mutation.
  - The workbench links diffs to Code Review Center findings, tests, and evidence refs without duplicating state ownership.
  - All user-facing strings are covered in en, zh, ja, and ru locale files.
  - Electron E2E covers opening the workbench, filtering diffs, inspecting hunks, and following an evidence link.
docs:
  required: true
---

Use this task spec when implementing the P0 Diff Workbench described in `docs/clawx-design-overview.md`.

The workbench should consolidate existing surfaces instead of creating a new VCS layer: Workspace Git panel, Monaco diff preview, `shared/types/git.ts`, runtime `diffs` extension artifacts, Knowledge proposal diffs, and file preview infrastructure. It may add host-api/runtime capabilities at implementation time, but this spec intentionally does not define final wire schemas.

Out of scope:

- Replacing Git or GitHub CLI.
- Applying patches without explicit confirmation.
- Storing runtime diffs in renderer-owned state.
