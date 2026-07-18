---
id: system-maturity-quarterly-audit
title: Enforce quarterly maturity audit and phase review gates
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: bafd6f0249c9818681f7ae0c8f258d3a5e548b63
intent: Complete P7-004 by adding quarterly maturity scorecard, risk acceptance deadlines, and incomplete P0/P1 release blocking.
touchedAreas:
  - package.json
  - plans/system-maturity/risk-acceptance.json
  - plans/system-maturity/findings-registry.json
  - plans/system-maturity/phase7-continuous-governance/**
  - scripts/lib/system-maturity-quarterly-audit.mjs
  - scripts/run-system-maturity-quarterly-audit.mjs
  - scripts/collect-p7-004-evidence.mjs
  - tests/unit/system-maturity-quarterly-audit-p7-004.test.ts
  - harness/specs/rules/system-maturity-quarterly-audit.md
  - harness/specs/tasks/system-maturity-quarterly-audit.md
  - artifacts/system-maturity/P7-004/**
  - artifacts/system-maturity/P7-001/**
  - artifacts/agent-dev-audit/**
  - artifacts/agent-dev-deep-test/**
expectedUserBehavior:
  - Every phase STATUS is readable and consistent for quarterly review.
  - Risk acceptance entries carry future reviewBy deadlines for Track/Accept findings.
  - Incomplete P0/P1 blocks release decision automatically.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - system-maturity-quarterly-audit
requiredTests:
  - tests/unit/system-maturity-quarterly-audit-p7-004.test.ts
acceptance:
  - Phase statuses are fully traceable in the quarterly audit report.
  - Risk acceptance missing or expired reviewBy fails closed.
  - Incomplete P0/P1 yields release-blocked.
  - Agent Dev audit is recorded with non-extrapolation caveat.
docs:
  required: false
---

This task is the harness projection of System Maturity task P7-004 and Findings
F-GOV-002 and F-GOV-003.
