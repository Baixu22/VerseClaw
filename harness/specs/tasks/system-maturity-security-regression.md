---
id: system-maturity-security-regression
title: Run long-lived security red-team and fault-injection regression
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e3fa1eea1c5f7eaf096177247b779e38ab837cc0
intent: Complete P7-002 by composing the existing Renderer, Main, Gateway, approval, path, data, Cron, update, and multi-window regression tests into fail-closed PR and release suites with evidence.
touchedAreas:
  - package.json
  - plans/system-maturity/gates.json
  - plans/system-maturity/security-regression-suite.json
  - plans/system-maturity/findings-registry.json
  - plans/system-maturity/phase7-continuous-governance/**
  - scripts/run-system-maturity-security-suite.mjs
  - scripts/lib/system-maturity-security-suite.mjs
  - scripts/collect-p7-002-evidence.mjs
  - tests/unit/system-maturity-security-suite-p7-002.test.ts
  - tests/e2e/chat-plan-mode-write-challenge.spec.ts
  - .github/workflows/system-maturity-security.yml
  - harness/specs/rules/system-maturity-security-regression.md
  - harness/specs/tasks/system-maturity-security-regression.md
  - artifacts/system-maturity/P7-002/**
  - scripts/lib/system-maturity-traceability.mjs
  - tests/unit/system-maturity-traceability-p7-001.test.ts
  - plans/system-maturity/phase0-foundation/tasks/P0-001.delivery.md
  - plans/system-maturity/phase0-foundation/tasks/P0-003.delivery.md
  - plans/system-maturity/phase0-foundation/tasks/P0-004.delivery.md
  - artifacts/system-maturity/P0-001/**
  - artifacts/system-maturity/P0-002/**
  - artifacts/system-maturity/P0-003/**
  - artifacts/system-maturity/P0-004/**
  - artifacts/system-maturity/P7-001/**
expectedUserBehavior:
  - Every P0/P1 security scenario can be run from one PR command and cannot pass through an empty shard.
  - Renderer compromise, prompt injection, path escape, approval replay, SEKB deletion/redaction, Cron lease faults, update tamper, and multi-window sender isolation remain covered.
  - A failed scenario makes the PR/release suite non-zero and records the exact failed command and Finding IDs.
  - Full mode includes communication replay/compare and selected Electron E2E flows without changing transport authority.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - system-maturity-security-regression
requiredTests:
  - tests/unit/system-maturity-security-suite-p7-002.test.ts
  - tests/unit/host-invoke-security.test.ts
  - tests/unit/path-broker-resolved.test.ts
  - tests/unit/permissions-api.test.ts
  - tests/unit/channels-p4-004-inbound-trust.test.ts
  - tests/unit/windows-update-feed-p6-002.test.ts
acceptance:
  - P0/P1 scenarios are uniquely registered, Finding-linked, executable, and included in PR mode.
  - Negative tests prove a missing command, empty selection, non-zero command, or malformed report fails closed.
  - Full mode runs comms replay/compare and selected built Electron E2E flows, and release/CI entry points invoke the suite.
  - Evidence report records exact commands, exit codes, durations, output hashes, scenario IDs, and Finding IDs.
docs:
  required: false
---

This task is the harness projection of System Maturity task P7-002 and Findings
F-SEC-003, F-SEC-006, F-AUTH-006, F-DATA-005, F-REL-001, F-REL-004,
F-SUPPLY-001, F-GOV-001, and F-GOV-002.
