---
lifecycleStatus: active
id: versegit-wp4-behavior-coverage
title: WP4 - behavior coverage vector and feedback delivery evidence
scenario: versegit-validation-layer-extension
taskType: planning
intent: Summarize normalized WP1 behavior events into a bounded, redacted coverage vector and require evidence before claiming produced, host-delivered, transcript-confirmed or behavior-shift feedback.
touchedAreas:
  - harness/specs/tasks/versegit-wp4-behavior-coverage.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/wp4-behavior-coverage-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp4-evidence/**
  - artifacts/versegit/wp4/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - electron/services/versegit-behavior-coverage.ts
  - scripts/versegit-wp4-coverage.mjs
  - scripts/verify-versegit-wp4.mjs
  - tests/unit/versegit-wp4-coverage.test.ts
expectedUserBehavior:
  - Normalized WP1 events are deduplicated into explicit coverage surfaces without claiming that Bash, direct filesystem, network or MCP effects were observed.
  - Feedback delivery is reported only as produced, host-delivered, transcript-confirmed or behavior-shift when all prior evidence exists; absence is not a higher tier.
  - The projection is bounded, stores no raw payload, secret or absolute user path, and leaves the host verdict unchanged.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp4-coverage.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp4-behavior-coverage-fixture.json --out artifacts/versegit/wp4/coverage.json
  - node scripts/verify-versegit-wp4.mjs --artifact artifacts/versegit/wp4/coverage.json
  - pnpm exec vitest run tests/unit/versegit-wp4-coverage.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp4-behavior-coverage.md
acceptance:
  - WP1 source has 20 evidence lines, 12 unique behavior/session events, one source duplicate and one unobserved event; stale and rejected lines are excluded from normalized event counts.
  - Coverage retains shellRead=unobserved, shellWrite=inferred, directFs=unobserved and partial MCP/network surfaces; no missing event is treated as zero behavior.
  - Feedback cases produce each of the four tiers only with the required evidence chain; a behavior-shift without evidence is rejected.
  - The report is bounded by maxEvents, stores no raw payload/secret/absolute user path and keeps host verdict unchanged.
  - Independent verifier replays the source event/report inputs, checks digest reproducibility and rejects execution-surface imports.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
---

# WP4 behavior coverage

WP4 consumes the WP1 event stream as evidence, not as a substitute for it. The source
contains duplicate/stale/rejected lines, so the aggregate is derived only from actual
normalized behavior events and explicitly accounts for the duplicate/unobserved inputs.

## Feedback tiers

`produced`, `host-delivered`, `transcript-confirmed` and `behavior-shift` are a chain.
A report may not skip a link or turn an artifact reference into a transcript or paired
behavior claim.