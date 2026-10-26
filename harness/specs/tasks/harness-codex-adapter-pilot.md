---
lifecycleStatus: active
id: harness-codex-adapter-pilot
title: Harness Adapter Contract and One Real Pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define one adapter contract and run one real adapter pilot without adding a selector, default path, scheduler, or second product authority.
touchedAreas:
  - shared/harness-adapter-contract.ts
  - scripts/verify-harness-adapter-pilot.mjs
  - harness/specs/tasks/harness-codex-adapter-pilot.md
  - harness/specs/fixtures/harness-codex-adapter-pilot/**
  - tests/unit/harness-codex-adapter-pilot.test.ts
  - docs/modules/harness-and-codex.md
  # Predecessor TF-0567 paths already committed on this branch; retained for branch-scoped validation.
  - openclaw_runtime/src/gateway/session-effective-policy.ts
  - shared/types/session-effective-policy.ts
  - src/pages/Chat/SessionActivityPanel.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/long-session-policy-surface.spec.ts
  - tests/unit/long-session-effective-policy.test.ts
  - tests/unit/session-activity-panel-sections.test.tsx
  - tests/unit/session-activity-store-scope.test.ts
  - tests/unit/harness-codex-product-integration.test.ts
  - harness/specs/tasks/harness-codex-product-integration.md
  - harness/specs/fixtures/harness-codex-product-integration/**
expectedUserBehavior:
  - A configured adapter can be inspected by protocol, session, permission, lifecycle, cost, evidence and fail-closed fields.
  - An unavailable or unauthenticated adapter fails explicitly and does not silently switch to native Codex.
  - Registry/package presence is not presented as local runtime availability.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node scripts/verify-harness-adapter-pilot.mjs
  - pnpm exec vitest run tests/unit/harness-codex-adapter-pilot.test.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/harness-codex-adapter-pilot.md
  - git diff --check
acceptance:
  - The adapter contract covers protocol, health, session identity, permission, cancel, timeout, cost, evidence and fail-closed behavior.
  - At least one real pilot records official/local source checks and distinguishes local availability from registry/package presence.
  - The pilot records not-run quality, latency and cost comparisons rather than inventing a parity claim.
  - No second scheduler/task/approval/memory/context/trace authority, product selector, default value, product lock or release state is added.
  - Failure can disable the adapter and preserve residual/rollback facts.
  - No credentials, tokens or private prompts are retained; all evidence is agent-driven.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
---

# TF-0568 Harness Adapter Contract and One Real Pilot

This node freezes an adapter contract and runs a bounded pilot. It does not adopt an alternate harness or add a product selector.

## Scope

- One typed adapter contract for protocol, session, permission, lifecycle, cost, evidence and fail-closed behavior.
- One real pilot: ACPX + Codex ACP initialize, with isolated CODEX_HOME.
- OpenCode local availability probe and its pre-turn DB failure as a negative candidate.
- Native/Codex/ACP/OpenCode comparison fields remain explicitly not-run where not measured.

## Non-goals

- No batch installation of ACP, OpenCode, Goose, OpenHands or Copilot.
- No product runtime selector or default path.
- No claim that an adapter is equivalent to Codex/native.
- No credentials or private prompts retained.

## Required evidence

- `harness/specs/fixtures/harness-codex-adapter-pilot/acceptance.json`
- `harness/specs/fixtures/harness-codex-adapter-pilot/REPORT.md`
- `harness/specs/fixtures/harness-codex-adapter-pilot/SHA256SUMS`
- `scripts/verify-harness-adapter-pilot.mjs`
- `tests/unit/harness-codex-adapter-pilot.test.ts`

## Validation

Run the commands in the frontmatter. A green contract test is insufficient without the verifier and harness validation. If a model turn is not run, the evidence must say not-run and must not infer quality, latency or cost.
