---
id: p1-issue-fixes-batch5-20261010
title: P1 issue batch 5 - evidence paths, repository artifacts and public identity
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issues #63, #68, #77, #84, #85, #88 and #92 by making evidence paths verifiable, preserving the shadow-tracking gate, covering codex/* pushes, replacing internal help links, and aligning public product attribution.
expectedUserBehavior:
  - Capability/reliability evidence paths are checked against the clean checkout and fail when a referenced source disappears.
  - Repository artifact checks fail on tracked-and-ignored shadow files and already pass on this candidate.
  - Codex branches get automated check, comms, harness, security and Electron E2E feedback on push.
  - Channel help links use public docs.openclaw.ai rather than an internal Feishu tenant wiki.
  - OpenRouter attribution uses one Verse Claw identity and no conflicting claw-x.com/ClawX values.
  - Active backend references point to the real src/lib/host-api-client.ts rather than the nonexistent api-client.ts.
touchedAreas:
  - AGENTS.md
  - .gitignore
  - .github/workflows/**
  - electron/**
  - eslint.config.mjs
  - harness/**
  - package.json
  - scripts/**
  - shared/**
  - src/**
  - tests/**
  - docs/**
  - harness/specs/tasks/p1-issue-fixes-batch5-20261010.md
  - docs/dev/p1-issue-fixes-batch5-20261010.md
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/check-evidence-refs.mjs
  - node scripts/check-repository-artifacts.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/evidence-refs-exist.test.ts tests/unit/p1-repo-identity-boundaries.test.ts tests/unit/repository-artifact-retention.test.ts --maxWorkers=1
  - pnpm i18n:lint
  - pnpm run typecheck
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch5-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issues #63/#68 - the existing repository artifact gate rejects tracked paths that are also ignored and passes on this candidate with zero shadow-tracking findings.
  - Issue #77 - the five active CI workflows include codex/** push triggers.
  - Issue #84 - no internal Feishu tenant wiki URL remains in channel help links.
  - Issue #85 - OpenRouter attribution has one consistent public identity and no claw-x.com conflict.
  - Issue #88 - exact production ClawX literals are replaced by Verse Claw in the identified active surfaces.
  - Issue #92 - stale src/lib/api-client.ts references are replaced by src/lib/host-api-client.ts and the new evidence-reference gate resolves the declared shared/AGENTS paths.
  - Verification is static/synthetic; it does not claim remote CI execution or a packaged desktop release.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch5-20261010.md
---

# P1 issue batch 5

This batch turns repository identity and evidence references into executable
checks. It keeps historical artifacts out of scope while requiring active docs,
shared capability claims and source references to resolve in a clean checkout.
