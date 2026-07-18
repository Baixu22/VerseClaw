---
id: system-maturity-traceability
title: Enforce Finding-to-test-code-evidence traceability
scenario: system-maturity-traceability
taskType: program-governance
intent: Complete P7-001 with a fail-closed, bidirectional traceability and evidence freshness gate.
touchedAreas:
  - package.json
  - plans/system-maturity/findings-registry.json
  - plans/system-maturity/phase7-continuous-governance/**
  - scripts/validate-system-maturity-traceability.mjs
  - scripts/collect-p7-001-evidence.mjs
  - scripts/lib/system-maturity-traceability.mjs
  - tests/unit/system-maturity-traceability-p7-001.test.ts
  - harness/specs/scenarios/system-maturity-traceability.md
  - harness/specs/rules/system-maturity-traceability.md
  - harness/specs/tasks/system-maturity-traceability.md
  - artifacts/system-maturity/P7-001/**
expectedUserBehavior:
  - Governance reports identify the owner, task, test, code, evidence, acceptance, and next review for every Finding.
  - Orphan Finding, task, or test links fail the maturity gate.
  - Evidence older than its covered sources is reported as stale and blocks a successful gate.
  - A task cannot remain done without checked acceptance and hash-addressed evidence.
requiredProfiles:
  - fast
requiredRules:
  - system-maturity-traceability
requiredTests:
  - tests/unit/system-maturity-traceability-p7-001.test.ts
acceptance:
  - Every Finding and task link resolves in both directions and every Finding has a stable test ID.
  - The generated report resolves test commands, changed sources, hash-addressed evidence, owners, and review cadence.
  - Negative tests prove orphan links, stale evidence, and done-without-acceptance fail closed.
  - The System Maturity combined validation command includes the traceability gate.
docs:
  required: false
---

This task is the harness projection of System Maturity task P7-001 and Findings
F-GOV-001 and F-GOV-002.
