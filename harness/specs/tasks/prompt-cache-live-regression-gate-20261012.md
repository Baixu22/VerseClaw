---
id: prompt-cache-live-regression-gate-20261012
title: Make the live prompt-cache regression baseline executable (issue #165)
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Restore the missing live-cache test support module and add an opt-in weekly/manual CI entry that runs the existing provider cache baseline runner, writes a secret-free JSON report, and fails closed when the measurement is unavailable.
expectedUserBehavior:
  - Maintainers can manually dispatch "Live Cache Regression" or let its weekly schedule run it; the workflow is not a PR hard gate.
  - A measured clean run uploads artifacts/prompt-cache-live-cache/report.json with threshold, perTurn, promptCache, result.passed and artifactSafety.apiKeyCaptured=false.
  - A missing credential or disabled live-test prerequisites produces an explicit unmeasured report and a non-zero exit code instead of a green skip.
  - Anthropic floor misses are hard regressions; OpenAI warn-only lane misses produce warnings only.
touchedAreas:
  - .github/workflows/live-cache-regression.yml
  - openclaw_runtime/scripts/check-live-cache.ts
  - openclaw_runtime/src/agents/live-cache-regression-report.ts
  - openclaw_runtime/src/agents/live-cache-regression-runner.ts
  - openclaw_runtime/src/agents/live-cache-test-support.ts
  - openclaw_runtime/src/agents/live-test-helpers.ts
  - openclaw_runtime/tsconfig.core.json
  - tests/unit/live-cache-regression-gate.test.ts
  - harness/specs/tasks/prompt-cache-live-regression-gate-20261012.md
  - docs/dev/prompt-cache-live-regression-gate-20261012.md
requiredRules:
  - prompt-cache-observation-boundary
  - active-config-guards
  - comms-regression
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/live-cache-regression-gate.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/prompt-cache-live-regression-gate-20261012.md
acceptance:
  - The runner and its restored support module compile in the OpenClaw core typecheck.
  - The workflow contains workflow_dispatch, a weekly schedule, the real test:live:cache command and artifact upload.
  - The generated report contains threshold, perTurn, promptCache, measured, result.passed and artifactSafety.apiKeyCaptured=false.
  - An unmeasured run exits non-zero and writes result.passed=false.
  - Injected Anthropic floor misses become hard regressions; injected OpenAI misses remain warnings.
  - No provider key or raw credential is written into the report, and no external telemetry or PR blocking dependency is introduced.
docs:
  required: true
  paths:
    - docs/dev/prompt-cache-live-regression-gate-20261012.md
---

# Scope

This issue is a CI and evidence repair, not a cache optimization. The existing
baseline thresholds and provider lane runner remain the source of truth. The
missing upstream `live-cache-test-support.ts` is restored from the matching
upstream source, and `live-cache-regression-runner.ts` returns to the core
typecheck.

The scheduled workflow is intentionally opt-in/periodic. It is not added to PR
checks because live providers can be unavailable, rate-limited or costly.
Missing prerequisites must be visible as a failed/unmeasured run, never as a
green skip.
