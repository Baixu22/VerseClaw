---
id: frozen-windows-acceptance
title: Qualify the frozen Windows candidate and installer lifecycle
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: cb33fad04fb3e98d0cd252f5f61afb542db7c349
intent: Record current complete regression and installer evidence, rejecting delivery when a required behavior fails.
expectedUserBehavior:
  - The current installer contains the frozen product sources and starts from its own delivered resources.
  - Installation, candidate replacement and uninstallation preserve existing user configuration.
  - Failed tests and unexpected CLI behavior remain visible instead of becoming an all-green release claim.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - tests/e2e/chat-model-scope-runtime.spec.ts
  - tests/e2e/workspace-web-preview-panel.spec.ts
  - tests/e2e/workspace-web-preview-panel.spec.ts-snapshots/workspace-web-preview-browser-menu-win32.png
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/frozen-windows-acceptance-20261007/report.json
  - artifacts/frozen-windows-acceptance-20261007/credential-scan.json
  - artifacts/frozen-windows-acceptance-20261007/SHA256SUMS
  - docs/dev/frozen-windows-acceptance-20261007.md
  - harness/specs/tasks/frozen-windows-acceptance.md
  - .gitignore
  - .gitattributes
docs:
  required: true
  paths:
    - docs/dev/frozen-windows-acceptance-20261007.md
requiredTests:
  - pnpm test
  - pnpm exec playwright test
  - pnpm agent-dev:deep-test
acceptance:
  - Preserve candidate identities, full-suite discovery/counts and every failed gate; corrected test baselines do not rewrite the first full run.
  - Record NSIS output hash and actual dependency, GUI and lifecycle observations.
  - Preserve current user configuration and restore only the test's environment changes.
  - Explicitly reject delivery for unresolved functional defects; do not publish or change product locks.
---

All actions and fault observations are agent-driven. The only fixture correction
is the intentional B2 brand geometry in a full-page preview baseline; screenshot
tolerances and retry settings remain unchanged. The product-code candidate is
cb33fad04; later test/evidence commits must not be represented as a new product build.
