---
id: p2-issue-fixes-batch12-20261010
title: P2 issue batch 12 - cross-run observability Problems
lifecycleStatus: active
taskType: observability-governance
intent: Add a bounded, idempotent agent batch entry over the existing sanitized observability trace index so repeated trace Issues form cross-run Problems, promote by signature/window/threshold, preserve lifecycle state, and export manifest/evidence/resolution artifacts without a second runtime log store.
touchedAreas:
  - electron/services/**
  - shared/types/**
  - scripts/**
  - tests/unit/**
  - harness/specs/**
  - docs/**
  - docs/README.md
  - package.json
expectedUserBehavior:
  - Repeated Issues in the seven-day window collapse into one stable Problem signature instead of three unrelated trace-only diagnostics.
  - The second/third occurrence threshold and critical single-occurrence promotion are deterministic; out-of-window rows are excluded.
  - Repeated CLI/import runs are idempotent; later recurrence links to the same Problem and preserves its timeline and resolution evidence.
  - Manifest/evidence/resolution files contain bounded, redacted refs and explicitly record driven_by: agent / actor, never raw logs or human verdict claims.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new resident governance service, telemetry server, or second runtime log database
  - counting issues.length as occurrence count or using timestamp ordering as a substitute for source-event identity
  - model-guessed root causes being presented as verified facts
  - raw prompts, tool output, credentials, or unsanitized file paths in exported evidence
  - requiring real-human verdicts or production incident data
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/observability-problems.test.ts
  - pnpm observability:problems --index <fixture-index.jsonl> --out <fixture-output-dir> --now <iso>
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch12-20261010.md
acceptance:
  - Issue #122 - a bounded signature combines category, normalized title, model/agent and optional tool identity; source issue IDs deduplicate repeated imports and same-trace diagnostics count once per Problem occurrence.
  - Issue #122 - seven-day threshold promotion, critical promotion, out-of-window exclusion and idempotent re-import are covered by automated tests.
  - Issue #122 - the export writes manifest.json, evidence.json and resolution.md with open/mitigated/closed state, timeline, bounded evidence refs and driven_by: agent / actor; later recurrence cannot create a duplicate Problem.
  - Issue #122 - the CLI batch entry consumes the existing sanitized trace index and creates no permanent runtime state store beyond the export artifacts.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch12-20261010.md
---

# P2 issue batch 12

This batch closes the cross-run Problem aggregation gap in issue #122 on top of
the existing trace index and redaction boundary. It adds a bounded agent batch
entry and export artifacts, not a resident observability platform.