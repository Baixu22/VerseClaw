---
id: prompt-quality-round1-bugfix
title: Prompt Quality Round 1 Bugfix
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix user-visible prompt-quality and reasoning-effort bugs before the larger PCS/Linked-v1 refactor: accept max effort, send truthful DeepSeek effort payloads, remove duplicated legacy workspace blocks, declare precedence for user-editable context, and align effort copy/docs with actual behavior.
touchedAreas:
  - harness/specs/tasks/prompt-quality-round1-bugfix.md
  - electron/services/agents-api.ts
  - electron/utils/openclaw-workspace.ts
  - openclaw_runtime/src/plugin-sdk/provider-stream-shared.ts
  - openclaw_runtime/extensions/deepseek/thinking.ts
  - openclaw_runtime/src/agents/system-prompt.ts
  - openclaw_runtime/src/agents/system-prompt-report.ts
  - openclaw_runtime/src/skills/loading/skill-contract.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/plugins/activation-planner.ts
  - openclaw_runtime/docs/reference/templates/AGENTS.md
  - openclaw_runtime/docs/reference/templates/TOOLS.md
  - openclaw_runtime/docs/reference/templates/USER.md
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - docs/clawx-design-overview.md
  - tests/unit/agents-api-reasoning-effort.test.ts
  - tests/unit/strip-first-run.test.ts
  - openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts
  - openclaw_runtime/src/skills/loading/skill-contract.test.ts
  - tests/unit/prompt-quality-budget.test.ts
  - openclaw_runtime/test/helpers/agents/happy-path-prompt-snapshots.ts
  - scripts/prompt-snapshots-check.mjs
  - package.json
expectedUserBehavior:
  - The chat composer can persist every AgentReasoningEffort value exposed in shared types, including max.
  - DeepSeek V4 requests carry reasoning_effort low/high/max with the provider-documented aliases; app-level minimal is clamped to low and never produces an unsupported payload.
  - Workspace context merging removes the legacy clawx block and does not double near-identical Verse Claw instructions in the final prompt.
  - User-editable workspace files are presented as lower-priority context with an explicit precedence note; ordinary chat run context is not labeled Group Chat Context.
  - Effort help copy in all four locales explains the reasoning-depth + context-density coupling.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/agents-api-reasoning-effort.test.ts tests/unit/strip-first-run.test.ts tests/unit/runtime-intensity-policy.test.ts tests/unit/chat-agent-effort-popover.test.tsx tests/unit/agent-config.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.plugin-sdk.config.ts src/plugin-sdk/provider-stream-shared.test.ts
  - pnpm run prompt-quality:budget
  - pnpm run agent-dev:fast
  # Codex snapshot check is optional CI evidence, not part of ClawX fast gates:
  # OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED=1 pnpm run prompt:snapshots:check:available
  - pnpm run i18n:lint
  - pnpm run typecheck
acceptance:
  - max effort persists through the real agents host API and invalid values are rejected before config writes.
  - DeepSeek payload mapping matches https://api-docs.deepseek.com/guides/thinking_mode.
  - The default workspace no longer contains a legacy clawx block; merge tests prove the pipeline strips it.
  - Focused unit tests pass and typecheck introduces no new node-project errors.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - docs/architecture-overview.md
---

This task is a user-authorized hotfix lane. It does not create Task Forest nodes, does not start TF-0066, and does not change Runtime Convergence or PCS status.
