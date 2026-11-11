---
lifecycleStatus: archived
id: component-controlled-rollout-readiness
title: DCS and adjacent components controlled rollout readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore reproducible delivery and real Windows Electron integration evidence for DCS, Context, MEM, VToken, SEKB, and Browser before a bounded internal opt-in rollout, without changing fail-closed defaults or claiming joint-system GA.
touchedAreas:
  - .agent-workbench/task-forest/**
  - artifacts/coding-prod-p0/**
  - artifacts/browser-security-recovery/**
  - artifacts/component-controlled-rollout-p0/**
  - artifacts/component-readiness-audit-2026-07-20/**
  - artifacts/p0-production-pass/**
  - artifacts/sekb-golden-path/**
  - artifacts/system-maturity/**
  - artifacts/tf0001-closeout/**
  - artifacts/tf0006-evidence-upgrade/**
  - electron/gateway/config-sync.ts
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/gateway/server-methods/agent.ts
  - openclaw_runtime/CODING-PROD-P0-COMPLETE.md
  - electron/main/ipc/**
  - electron/services/**
  - electron/utils/openclaw-auth.ts
  - harness/specs/**
  - package.json
  - packages/vtoken/**
  - plans/system-maturity/**
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/browser.json
  - src/lib/host-api.ts
  - src/components/settings/BrowserSettingsPanel.tsx
  - tests/unit/**
  - tests/e2e/agent-browser-workbench.spec.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - tests/e2e/dcs-production-wiring-w5.spec.ts
  - tests/e2e/sekb-golden-path.spec.ts
  - tests/e2e/browser-security-recovery.spec.ts
  - tests/e2e/vtoken-bridge-settings.spec.ts
  - docs/dev/**
  - artifacts/component-readiness-audit-2026-07-20/**
expectedUserBehavior:
  - Components remain explicit opt-in and fail closed when disabled or killed.
  - DCS production wiring is exercised through an authorized host sender path; tests must not bypass sender/session binding.
  - SEKB writes only after human confirmation, and Browser private-network access remains denied unless explicitly acknowledged.
  - A controlled internal rollout may begin only after clean-checkout reproducibility, 6/6 selected Electron E2E, and maturity evidence validation pass.
  - This task does not approve default-on behavior, unattended SEKB writeback, unsupervised Browser use, Runtime Memory prompt injection graduation, or joint-system GA.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - production host sender bypass, test-only sender allowlist in production, disabled senderAuth, or direct renderer IPC/Gateway calls
  - default-on flip, unattended SEKB writeback, private-network default allow, unbounded cohort, or joint-system GA claim
  - synthetic or scripted evidence presented as liveReady, productApproved, or sufficient for TF-0006
  - untracked core implementation, E2E, documentation, or evidence used as release proof
featureFlags:
  - DCS, working-memory, VToken, Runtime Memory injection, and SEKB remain explicit opt-in.
  - Browser private-network access remains deny-by-default and acknowledgement-gated.
  - Context enhancement kill switch remains available and fail-closed.
rollback:
  - Disable the component-specific flags and engage the context enhancement kill switch where applicable.
  - Stop the canary cohort, verify flag-off parity and no new writes, and record rollback time and residual state.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/component-controlled-rollout-readiness.md
  - pnpm harness validate --spec harness/specs/tasks/component-controlled-rollout-readiness.md
  - pnpm run p0:accept
  - pnpm test:dcs
  - pnpm lint:dcs
  - pnpm contract:check
  - pnpm exec vitest run tests/unit/vtoken-bridge.test.ts tests/unit/host-api-facade.test.ts tests/unit/knowledge-api.test.ts
  - pnpm run eval:runtime-memory:enhanced
  - pnpm run dcs:prod-p0:smoke
  - pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts --workers=1
  - pnpm run maturity:validate
  - git diff --check
acceptance:
  - All core implementation, tests, docs, and required evidence are tracked and reproducible from a clean checkout.
  - The selected Electron suite passes 6/6 on Windows using authorized sender/session binding.
  - Missing or unauthorized host senders continue to fail closed.
  - P0, DCS, lint, contract, focused host/knowledge, Runtime Memory eval, and DCS smoke gates pass.
  - System maturity evidence validates with no unexplained hash drift.
  - A bounded canary package documents owner, cohort, budget, flags, metrics, privacy boundary, kill switch, and rollback.
  - Default-on, productApproved, liveReady, and joint-system GA remain false/not approved until separate evidence and review.
docs:
  required: true
  files:
    - docs/dev/component-operationalization-index.md
    - docs/architecture-overview.md
    - docs/architecture-overview.md
    - docs/dev/component-operational-readiness-checklist.md
    - docs/dev/Sustained-Development-Playbook.md
---

# Component Controlled Rollout Readiness

This task is the executable Harness projection of the 2026-07-20 component readiness re-audit. It restores delivery and integration evidence before controlled internal use; it does not expand component authority or approve default-on behavior.
