---
id: code-review-center-vnext
title: Code Review Center MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a read-only Code Review Center MVP that reviews Git diffs through Main-owned host APIs, normalizes findings, and can create Task Ledger review nodes.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-design-overview.md
  - harness/specs/tasks/code-review-center-vnext.md
  - shared/types/**
  - shared/host-api/contract.ts
  - shared/i18n/resources.ts
  - src/lib/host-api.ts
  - electron/main/ipc-handlers.ts
  - electron/services/**
  - src/App.tsx
  - src/pages/**
  - src/components/**
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
expectedUserBehavior:
  - Users can launch a read-only Review Center from the Verse Claw sidebar.
  - Users can review uncommitted changes, changes against a base branch, or a selected commit.
  - Users can add a custom review focus before starting a review run.
  - Review results show normalized findings ordered by severity.
  - Each finding shows severity, file, line, reason, and suggested fix.
  - Review runs do not stage, commit, checkout, stash, push, pull, or write workspace files.
  - Users can create a Task Ledger review node from a finding or from the whole review run.
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
  - tests/unit/code-review-center.test.ts
  - tests/unit/host-api-facade.test.ts
  - pnpm run test:e2e -- tests/e2e/code-review-center.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/code-review-center-vnext.md
acceptance:
  - The UI exposes a clear Review Center or Review changes entry.
  - Review targets include uncommitted changes, base branch comparison, and selected commit; E2E covers at least two target selections.
  - Findings are normalized to severity, file, line, reason, and suggested fix, then sorted by severity.
  - Review runs are read-only and must not stage, commit, revert, checkout, push, pull, or write workspace files.
  - At least one finding can create a Task Ledger node with kind review and status review.
  - Renderer review UI uses typed host-api/api-client calls only.
  - Main collects Git diffs through read-only argument-array commands and runs runtime review without renderer-owned Gateway HTTP or IPC.
  - Review payloads summarize evidence without storing raw prompts or full patch output in Observability.
  - No auto-fix, apply, stage, commit, or file-editing action is exposed from Review Center.
  - All user-facing strings are covered in en, zh, ja, and ru locale files.
  - Electron E2E covers opening the center, selecting targets, custom focus, findings display, Task Ledger node creation, and read-only behavior.
docs:
  required: true
---

Use this task spec when implementing the P0 Code Review Center MVP described in `docs/clawx-design-overview.md`.

The center should reuse existing foundations instead of inventing a second review system: Review Work Mode conventions, Observability trace summaries, Task Ledger review nodes, Git diff types, and the typed host-api bridge. The MVP may add host-api/runtime capabilities, but renderer code must not call Git, Gateway HTTP, or IPC directly.

Out of scope:

- Auto-editing code during review.
- Merging PRs or creating commits as a side effect of marking a finding.
- Replacing Chat Review mode, Observability, Task Ledger, or ClawGraph review state.
