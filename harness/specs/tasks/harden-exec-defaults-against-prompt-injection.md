---
id: harden-exec-defaults-against-prompt-injection
title: Harden missing-config exec defaults against prompt injection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep an unconfigured OpenClaw exec surface useful for ordinary allowlisted work while preventing prompt-injected or unattended commands from inheriting full host access.
touchedAreas:
  - harness/specs/tasks/harden-exec-defaults-against-prompt-injection.md
  - harness/specs/rules/exec-default-safety.md
  - openclaw_runtime/src/infra/exec-approvals.ts
  - openclaw_runtime/src/infra/exec-approvals-effective.ts
  - openclaw_runtime/src/agents/exec-defaults.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
  - openclaw_runtime/src/infra/exec-approvals-defaults.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Missing tools.exec configuration defaults to allowlist security with on-miss approval.
  - A missing or expired approval never upgrades an unconfigured command to full execution.
  - Explicit workspace permission modes and explicit fullAccess/full policies remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - exec-default-safety
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/harden-exec-defaults-against-prompt-injection.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/exec-approvals-defaults.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/exec-defaults.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - One canonical default tuple is used by runtime resolution and effective-policy reporting.
  - The default tuple is security=allowlist, ask=on-miss, askFallback=allowlist.
  - Explicit security=full and ask=off remain available only through explicit config/permission selection.
docs:
  required: true
  note: README variants state the safe missing-config default and the explicit fullAccess exception.
---

This task applies defense in depth at the tool authorization boundary. It does not attempt to
classify or rewrite model prompts, and it does not treat external content as trusted instructions.
