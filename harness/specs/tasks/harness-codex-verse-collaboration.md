---
lifecycleStatus: active
id: harness-codex-verse-collaboration
title: Verse Tools and Harness Collaboration Boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove one real VerseBrowser, VerseShell and VerseGit collaboration seam while keeping each product owner authoritative and the harness execution-only.
touchedAreas:
  - tests/e2e/versegit-candidate-apply.spec.ts
  - scripts/versegit-candidate-apply-probe.mts
  # Predecessor TF-0567/TF-0568 paths on this branch.
  - .gitignore
  - docs/modules/harness-and-codex.md
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
  - shared/harness-adapter-contract.ts
  - scripts/verify-harness-adapter-pilot.mjs
  - scripts/mock-acp-agent.mjs
  - scripts/mock-acp-client.mjs
  - harness/specs/tasks/harness-codex-adapter-pilot.md
  - harness/specs/fixtures/harness-codex-adapter-pilot/**
  - harness/specs/tasks/harness-codex-product-integration.md
  - harness/specs/fixtures/harness-codex-product-integration/**
  - tests/unit/harness-codex-adapter-pilot.test.ts
  - tests/unit/harness-codex-product-integration.test.ts
  - harness/specs/tasks/harness-codex-verse-collaboration.md
  - harness/specs/fixtures/harness-codex-verse-collaboration/**
  - tests/unit/harness-codex-verse-collaboration.test.ts
expectedUserBehavior:
  - VerseBrowser keeps browser session, approval and private-network authority; a harness cannot bypass them.
  - VerseShell keeps frozen argv, bounded output, timeout/cancel and journal receipt authority.
  - VerseGit provides workspace/session/candidate/advisory facts but cannot replace harness verdict, task completion or Git apply.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - pnpm exec playwright test tests/e2e/versebrowser-host-invocation.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/verseshell-facade.test.ts tests/unit/uas-05-verseshell-process-lifecycle.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts src/agents/verseshell/governed-process.real-limits.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/versegit-candidate-apply.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/harness-codex-verse-collaboration.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/harness-codex-verse-collaboration.md
  - git diff --check
acceptance:
  - One real VerseBrowser scenario covers open, observe, act, re-observe and verify, plus private-network/approval negative cases that fail closed without switching drivers.
  - One VerseShell scenario uses frozen argv, bounded output, timeout/cancel and a receipt; the harness does not self-approve or hide external-write limits.
  - One VerseGit scenario exposes workspace/session/candidate/advisory facts without replacing harness verdict, task completion or Git apply.
  - At least one cross-component positive and one negative case retain readback events/logs/hashes labelled driven_by=agent and actor.
  - VG M4 landing/admission stays disabled, VS remains default-off, and VB contract method counts are not presented as runtime coverage.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
---

# TF-0569 Verse Tools and Harness Collaboration Boundary

This node proves the collaboration seam between a harness and the three Verse tool owners. The harness executes work; VB, VS and VG retain their own authority.

## Scope

- One real VerseBrowser embedded-browser scenario with positive and negative safety cases.
- One VerseShell facade/lifecycle scenario with frozen argv and lifecycle receipts.
- One VerseGit candidate/apply scenario with journal and boundary assertions.
- Evidence is agent-driven and contains no credentials.

## Non-goals

- No VG M4 landing/admission.
- No VS default-on change.
- No harness-owned browser approval, command approval, task completion or Git apply.
- No contract-method-count claim as runtime coverage.

## Validation

Run the commands in the frontmatter. A green UI or contract count is insufficient; each scenario must retain a readback artifact. For the real VerseShell process gate, point `TEMP`/`TMP` at an agent-owned writable directory inside the workspace; the host `D:\tmp` ACL may deny `.ae/process-lifecycle` persistence and that denial is an execution-environment limitation, not a product pass.
