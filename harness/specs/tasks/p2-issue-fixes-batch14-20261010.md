---
id: p2-issue-fixes-batch14-20261010
title: P2 issue batch 14 - deprecated zero-call exports
lifecycleStatus: active
taskType: dead-code-governance
intent: Remove the runtime-internal deprecated exports that the repository's own deprecated-API guard proved had zero call sites, keep the public plugin-SDK compatibility surfaces inside their deprecation window, and add a curated guard so removed exports cannot silently reappear.
touchedAreas:
  - openclaw_runtime/src/**
  - openclaw_runtime/packages/**
  - openclaw_runtime/extensions/**
  - openclaw_runtime/scripts/**
  - openclaw_runtime/package.json
  - package.json
  - harness/specs/**
  - docs/**
  - docs/README.md
expectedUserBehavior:
  - Runtime-internal deprecated aliases with zero call sites no longer ship.
  - Public plugin-SDK compatibility exports remain available for the deprecation window but cannot gain new internal call sites.
  - A curated guard fails if a removed export reappears or a deprecated-public export is used or silently deleted.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - deleting plugin-SDK public compatibility exports before their deprecation cycle completes
  - trusting a generic unused-export scan in a runtime with thousands of dynamic imports
  - removing an export without verifying its private helpers are still referenced by live code
  - weakening the deprecated-API or deprecated-JSDoc guards
requiredTests:
  - pnpm --dir openclaw_runtime run check:deprecated-api-usage
  - pnpm --dir openclaw_runtime run check:deprecated-zero-call
  - node scripts/run-tsgo.mjs -p tsconfig.core.json --noEmit
  - node scripts/run-tsgo.mjs -p tsconfig.extensions.json --noEmit
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch14-20261010.md
acceptance:
  - Issue #90 - the runtime-internal deprecated exports in the curated list are removed and have zero remaining references.
  - Issue #90 - the plugin-SDK/extension compatibility exports are retained, documented as still in their deprecation window, and verified to have zero call sites.
  - Issue #90 - check-deprecated-zero-call.mjs fails if a removed export reappears as an exported declaration, or a deprecated-public export gains a call site / disappears without a recorded decision.
  - Issue #90 - the guard runs in the runtime architecture check and the repository runtime:source:check entry point.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch14-20261010.md
---

# P2 issue batch 14

This batch addresses issue #90. It removes the runtime-internal deprecated
exports that the repository's own deprecated-API guard proved were unused, and
adds a curated zero-call guard. Public plugin-SDK compatibility surfaces stay
inside their deprecation window rather than being deleted early.