---
id: system-maturity-privacy-controls
title: Enforce privacy data-flow inventory and sensitive capture controls
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 97885f9ac4a18f0ce3ae3a50f2948d2f94c5f7fe
intent: Complete P7-003 by making third-party data flows visible and enforcing sensitive capture kill switch/grants plus UI error sanitization.
touchedAreas:
  - package.json
  - plans/system-maturity/privacy-data-flow-inventory.json
  - plans/system-maturity/findings-registry.json
  - plans/system-maturity/phase7-continuous-governance/**
  - shared/privacy/**
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - electron/services/sensitive-capture-gate.ts
  - electron/services/agent-browser-api.ts
  - electron/services/remote-control-api.ts
  - electron/services/gateway-api.ts
  - src/components/common/ErrorBoundary.tsx
  - scripts/lib/system-maturity-privacy.mjs
  - scripts/lib/sensitive-capture-policy-node.mjs
  - scripts/lib/ui-error-sanitize-node.mjs
  - scripts/validate-system-maturity-privacy.mjs
  - scripts/collect-p7-003-evidence.mjs
  - tests/unit/system-maturity-privacy-p7-003.test.ts
  - plans/system-maturity/phase1-direct-boundaries/tasks/**
  - tests/unit/gateway-control-ui-token-p4-001.test.ts
  - tests/unit/agent-browser-service.test.ts
  - tests/unit/remote-control-api.test.ts
  - harness/specs/rules/system-maturity-privacy-controls.md
  - harness/specs/tasks/system-maturity-privacy-controls.md
  - artifacts/system-maturity/P7-003/**
  - artifacts/system-maturity/P7-001/**
  - artifacts/system-maturity/P0-001/**
  - artifacts/system-maturity/P0-002/**
  - artifacts/system-maturity/P0-003/**
  - artifacts/system-maturity/P0-004/**
  - plans/system-maturity/phase0-foundation/tasks/**
expectedUserBehavior:
  - Data flows for model, OAuth, MCP, update, telemetry, and sensitive capture list destinations and controls.
  - Kill switch and grant policy deny unauthorized clipboard/screenshot/desktop automation capture.
  - ErrorBoundary shows sanitized messages without stack or secrets.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - system-maturity-privacy-controls
requiredTests:
  - tests/unit/system-maturity-privacy-p7-003.test.ts
acceptance:
  - Privacy inventory covers required categories with existing evidence paths.
  - Sensitive capture decisions fail closed for kill switch and missing/expired grants.
  - UI error sanitizer removes stack and secret-shaped content; ErrorBoundary uses it.
  - Main capture entry points call assertSensitiveCaptureAllowed.
docs:
  required: false
---

This task is the harness projection of System Maturity task P7-003 and Findings
F-DATA-004, F-DATA-005, and F-UX-002.
