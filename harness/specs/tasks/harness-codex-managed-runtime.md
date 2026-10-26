---
lifecycleStatus: active
id: harness-codex-managed-runtime
title: Codex Managed Runtime Availability
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the managed Codex app-server binary and protocol surface in source and packaged Windows deliveries, without changing product defaults or adding a second execution authority.
touchedAreas:
  - .gitignore
  - docs/README.md
  - docs/modules/README.md
  - docs/modules/harness-and-codex.md
  - harness/specs/fixtures/harness-codex-authority-baseline/**
  - harness/specs/tasks/harness-codex-authority-baseline.md
  - harness/src/git.mjs
  - scripts/repository-artifacts.json
  - tests/unit/harness-codex-authority-baseline.test.ts
  - tests/unit/harness-git.test.ts
  - harness/specs/tasks/harness-codex-managed-runtime.md
  - tests/unit/harness-codex-managed-runtime.test.ts
  - tests/unit/copy-runtime-package.test.ts
  - harness/specs/fixtures/harness-codex-managed-runtime/**
  - scripts/copy-runtime-package.mjs
  - scripts/copy-runtime-package.d.mts
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/verify-codex-managed-runtime.mjs
  - openclaw_runtime/extensions/codex/src/app-server/managed-binary.ts
expectedUserBehavior:
  - A packaged desktop build either contains a runnable managed Codex runtime or reports an explicit unavailable state.
  - Source-only dependency presence is not presented as packaged availability.
  - Missing binary or failed authentication never silently switches to another harness.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - pnpm exec vitest run tests/unit/harness-codex-managed-runtime.test.ts tests/unit/copy-runtime-package.test.ts
  - pnpm run repo:artifacts:check
  - git diff --check
plannedTests:
  - tests/unit/harness-codex-managed-runtime.test.ts
acceptance:
  - Source-managed Codex resolves to an executable and reports its observed version and SHA256.
  - The packaged Windows tree contains the Codex binary and its required platform package, or records packaged-unavailable with the exact missing paths.
  - A local app-server health/protocol check is run against an isolated CODEX_HOME; authentication failure is recorded without retaining credentials.
  - A negative probe proves a missing managed binary fails closed instead of selecting another harness.
  - No product selector, default value, release lock or public state changes.
  - All retained evidence is agent-driven and the package tree version is distinguished from the host Codex version.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
---

# TF-0566 Codex Managed Runtime Availability

This node proves whether the Codex app-server runtime that ClawX already pins can actually be resolved, started and used from both a source checkout and a packaged Windows tree. It does not add a product selector or change the default runtime.

## Scope

- Source-managed `@openai/codex` binary resolution and version.
- Packaged binary/module presence and relocated resolution.
- app-server startup/health and a bounded protocol handshake.
- Authentication failure behavior without retaining credentials.
- Explicit failure when the managed binary or adapter is absent.

## Required evidence

- `harness/specs/fixtures/harness-codex-managed-runtime/`
- a machine-readable probe/report with `driven_by: agent` and `actor`
- binary SHA256 and observed version
- packaged path checks and a negative missing-binary case
- no secrets, auth headers or private prompts

## Non-goals

- No Settings/Chat selector change.
- No ACP fallback or automatic harness switch.
- No default-on, product approval or release change.
- No claim that a source pnpm dependency equals packaged availability.

## Validation

Run the commands in the frontmatter. A passing `--version` alone is insufficient: packaged relocation and an app-server protocol path must be checked separately. If authentication or packaging is unavailable, record that as a limitation rather than a pass.
