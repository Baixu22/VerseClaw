---
id: audit-wiring-quick-fixes
title: Restore skill configuration, managed uninstall, and Agent Dev event collection
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c7573ec11095b541f3a4a9c5470bf4e0727489bc
intent: Repair the reproduced configuration and event wiring defects using the existing runtime config, skill service, and Gateway event channels.
ownedPaths:
  - electron/utils/skill-config.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/clawhub.ts
  - electron/services/skills-api.ts
  - electron/services/agent-dev-api.ts
  - src/pages/Skills/index.tsx
  - tests/unit/skill-config-runtime-sync.test.ts
  - tests/unit/skill-config-bundled-defaults.test.ts
  - tests/unit/skills-api-install-trust-gate.test.ts
  - tests/unit/clawhub-service.test.ts
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - tests/unit/agent-dev-api.test.ts
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/e2e/skills-runtime-config.spec.ts
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/rules/agent-dev-conformance-evidence.md
  - harness/specs/scenarios/agent-dev-composable-scenarios.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/agent-dev-control-plane.md
touchedAreas:
  - electron/utils/skill-config.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/clawhub.ts
  - electron/services/skills-api.ts
  - electron/services/agent-dev-api.ts
  - src/pages/Skills/index.tsx
  - tests/unit/skill-config-runtime-sync.test.ts
  - tests/unit/skills-api-install-trust-gate.test.ts
  - tests/unit/agent-dev-api.test.ts
  - tests/unit/clawhub-service.test.ts
  - tests/e2e/skills-runtime-config.spec.ts
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/rules/agent-dev-conformance-evidence.md
  - harness/specs/scenarios/agent-dev-composable-scenarios.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/agent-dev-control-plane.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
expectedUserBehavior:
  - Skill choices persist to the config read by runtime; legacy choices migrate once without overriding canonical settings.
  - Uninstall removes only the selected managed skill and its config, and persistence or filesystem failures reach the UI.
  - Agent Dev trace and cost reports include normal chat and tool events without counting duplicated usage twice.
acceptance:
  - Existing skill configuration regression tests and canonical migration tests pass.
  - Managed uninstall rejects traversal, resolves the actual managed directory, and reports failed cleanup.
  - The Skills detail action invokes uninstall and the removed skill stays absent after reload.
  - Normalized Gateway runtime events populate trace and completed effects; reported usage is correlated and deduplicated.
  - Host contracts, focused type checks, comms replay/compare, and diff-aware Harness validation pass.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/audit-wiring-quick-fixes.md
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/audit-wiring-quick-fixes.md
docs:
  required: true
  note: Document canonical skill persistence and the runtime event sources used by Agent Dev reports.
---

Restore the three reproduced behavior defects from the unused/wiring audit. Reuse the canonical configuration fix from 458a1570b and the existing uninstall and event services. Sandbox reports describe observed events; they do not create an independent execution policy.
