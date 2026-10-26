---
lifecycleStatus: active
id: harness-codex-product-integration
title: Codex Product Integration and Effective Harness State
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Project the already-selected agent harness into the existing Session effective-state surface, preserving configured/effective/unverified/stale/mismatch distinctions without adding a second selector or execution authority.
touchedAreas:
  - shared/types/session-effective-policy.ts
  - openclaw_runtime/src/gateway/session-effective-policy.ts
  - src/pages/Chat/SessionActivityPanel.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/long-session-effective-policy.test.ts
  - tests/unit/session-activity-panel-sections.test.tsx
  - tests/unit/session-activity-store-scope.test.ts
  - tests/unit/harness-codex-product-integration.test.ts
  - tests/e2e/long-session-policy-surface.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/fixtures/electron.ts
  - harness/specs/tasks/harness-codex-product-integration.md
  - harness/specs/fixtures/harness-codex-product-integration/**
  - harness/specs/fixtures/harness-codex-product-integration/SHA256SUMS
  - docs/modules/harness-and-codex.md
expectedUserBehavior:
  - Users can see the configured harness and the harness observed for the current session generation, without treating configuration as execution proof.
  - Missing, stale, or mismatched observations remain visibly unverified rather than falling back to a green effective state.
  - Existing model/provider selection remains the only selection surface; no second global runtime selector or scheduler is introduced.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - pnpm exec vitest run tests/unit/harness-codex-product-integration.test.ts tests/unit/long-session-effective-policy.test.ts tests/unit/session-activity-panel-sections.test.tsx tests/unit/session-activity-store-scope.test.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm exec playwright test tests/e2e/long-session-policy-surface.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep "preserves foreground exec output|anchors the live thinking matrix" --workers=1
  - git diff --check
acceptance:
  - SessionEffectivePolicy exposes a harness axis distinct from backend/model, with configured and effective facts and explicit source/reason.
  - Effective harness is populated only from a current runtime capability observation; missing/stale/mismatch observations never promote configured selection to effective.
  - The Session activity panel renders the harness transition and unverified reason using existing host-api/session snapshot data and i18n keys.
  - No Settings selector, scheduler, Task Ledger, approval authority, default value, product lock, or release state is added or changed.
  - Evidence records which checks ran, their exit codes, and proves Electron policy-surface plus success/failure Chat turns through the host/renderer contract.
  - All evidence is agent-driven; no real-human evidence is claimed.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
---

# TF-0567 Codex Product Integration and Effective Harness State

This node connects the current product effective-state surface to the harness already selected by the existing runtime. It does not add a second runtime selector.

## Scope

- Add a harness fact axis to the existing SessionEffectivePolicy.
- Keep configured selection and current-generation observation separate.
- Show the configured and observed harness in the existing Session activity policy section.
- Preserve missing, stale, mismatch, and unverified generation reasons.

## Non-goals

- No Settings runtime selector or Work Mode.
- No new scheduler, Task Ledger, approval plane, trace or memory authority.
- No ACP adapter activation or implicit fallback.
- No product default, release lock or public-state change.
- No claim that a configured harness was actually executed without a current observation.

## Required evidence

- harness/specs/fixtures/harness-codex-product-integration/acceptance.json
- harness/specs/fixtures/harness-codex-product-integration/REPORT.md
- focused unit/component tests
- typecheck, i18n, contract and harness validation receipts
- an explicit not-run entry for Electron E2E when the local Electron binary is unavailable

## Validation

Run the commands in the frontmatter. A green unit/component result is insufficient without typecheck, i18n, contract and harness validation. Electron E2E must be reported as passed or not-run with the exact local error; it must not be silently omitted.
