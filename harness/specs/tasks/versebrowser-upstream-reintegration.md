---
id: versebrowser-upstream-reintegration
title: Reintegrate the pinned VerseBrowser module without capability or task loss
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Plan and then execute a source-preserving module reintegration through existing ClawX owners, with explicit capability, task, runtime-state, dependency and package boundaries.
expectedUserBehavior:
  - Existing browser sessions, tasks, credentials, approval and desktop workflows retain their defined behavior.
  - New browser capabilities reach the actual host and model through typed and authorized interfaces with faithful results.
  - Cancellation, restart, unavailable capabilities and incomplete collection remain explicit and recoverable.
touchedAreas:
  - .gitignore
  - harness/specs/tasks/versebrowser-upstream-reintegration.md
  - harness/specs/rules/versebrowser-upstream-preservation.md
  - harness/specs/guides/versebrowser-reintegration-playbook.md
  - harness/specs/fixtures/versebrowser-reintegration/**
  - packages/versebrowser/**
  - packages/README.md
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - package.json
  - electron/services/agent-browser*.ts
  - electron/services/agent-browser/**
  - electron/gateway/agent-browser-bridge.ts
  - electron/gateway/ws-client.ts
  - electron/main/ipc-handlers.ts
  - shared/agent-browser/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
  - src/components/settings/BrowserSettingsPanel.tsx
  - src/pages/Cron/**
  - src/components/agent-browser/**
  - shared/i18n/locales/**
  - openclaw_runtime/src/agents/tools/agent-browser-*.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/gateway/server-methods/agent-browser.ts
  - openclaw_runtime/src/gateway/server-broadcast.ts
  - openclaw_runtime/packages/gateway-protocol/src/client-info.ts
  - scripts/versebrowser-*.mjs
  - scripts/bundle-main-runtime.mjs
  - scripts/copy-runtime-package.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - vite.config.ts
  - tests/unit/agent-browser-*.test.ts
  - tests/unit/versebrowser-*.test.ts
  - tests/e2e/agent-browser-workbench.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/unit/gateway-p4-001-auth-binding.test.ts
  - tests/e2e/versebrowser-*.spec.ts
  - tests/e2e/browser-security-recovery.spec.ts
  - artifacts/browser-security-recovery/evidence.json
  - harness/specs/rules/agent-browser-multi-tab.md
  - docs/dev/browser-security-recovery.md
  - docs/dev/error-governance-decision-record.md
  - docs/dev/dcs-visible-production/P1-06-BROWSER-SUPERVISED-SOAK.md
  - tests/unit/r0-4-agent-browser-nav-timeout.test.ts
  - tests/unit/copy-runtime-package.test.ts
  - tests/unit/p0-production-acceptance.test.ts
  - plans/system-maturity/privacy-data-flow-inventory.json
  - plans/system-maturity/security-regression-suite.json
  - harness/specs/tasks/phase-a-sandbox-truth-20261012.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - AGENTS.md
  - docs/dev/repo-hygiene-20261017.md
  - docs/dev/versegit-validation-layer/**
  - harness/src/git.mjs
  - scripts/check-duplicate-assets.mjs
  - scripts/repository-artifacts.json
  - tests/unit/runtime-source-policy.test.ts
  - harness/specs/fixtures/versebrowser-invocation-maturity/**
  - harness/specs/tasks/versebrowser-invocation-maturity.md
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - artifacts/versebrowser-acceptance/2026-10-16T000000Z/**
  - artifacts/system-maturity/P0-004/evidence-index.json
  - artifacts/system-maturity/P0-004/validate-system-maturity-evidence.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/first-product-preview/TF-0009/agent-surrogate-report.json
  - artifacts/agent-dev-workbench/evidence.json
  - reports/real-runtime-task-validation-2026-07-04.md
  - reports/report-authenticity-true-false-positive-matrix-2026-07-04.md
  - plans/system-maturity/BASELINE.json
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-02.md
  - harness/specs/tasks/agent-browser-browserwindow-playwright-prototype.md
  - harness/specs/tasks/browser-supervised-component-graduation.md
  - harness/specs/tasks/browser-effect-session-click-provenance-boundary.md
  - harness/specs/tasks/runtime-resource-governance-p0b-20261014.md
  - openclaw_runtime/scripts/tf0009-agent-surrogate.mts
  - harness/specs/rules/tf0009-real-canary-authority.md
requiredRules:
  - versebrowser-upstream-preservation
  - backend-communication-boundary
  - renderer-main-boundary
  - contract-first-boundary
  - supply-chain-integrity-pinning
  - error-governance-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node --test scripts/versebrowser-build-wiring.test.mjs
  - pnpm exec vitest run tests/unit/versebrowser-host-adapter.test.ts tests/unit/versebrowser-driver-capabilities.test.ts
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run test:e2e tests/e2e/agent-browser-workbench.spec.ts
  - pnpm exec playwright test tests/e2e/versebrowser-host-invocation.spec.ts
acceptance:
  - The pinned source and necessary regression inputs are preserved by a verified mechanical import plus declared patches, with a module/package allowlist that excludes project and process artifacts.
  - Every source task has a project-qualified provenance and a reviewed integration, constraint, historical or deferred disposition without overwriting the existing host forest or losing list fields.
  - All 67 existing methods and 13 additional source methods have an explicit owner and outcome mapping; required capabilities are verified through their actual host consumers.
  - ClawX task IDs, status, approvals, recovery, profiles, credentials, workspace evidence and resource accounting remain intact under upgrade, cancellation and restart.
  - Both source fixes and host-only behavior are preserved, including terminal-task guards, sensitive URL rejection, Gateway sandbox checks, structured denial errors and resource registration.
  - Dependency resolution and upstream patches retain the fixed runtime families and are verified under pnpm without contaminating other package instances or the shared store.
  - Real Runtime, Gateway, Main, model-result and Electron packaged paths pass scoped positive and adversarial flows with independently frozen expectations.
  - Source, package, SDK/MCP, 24-task migration, prior Agent72 and new host evidence remain separately counted; unknown/not_run/platform limits never become pass by aggregation.
  - Automated continuation uses labeled agent-driven equivalents and does not require owner actions or claim human evidence.
  - Cutover and a matched-version rollback are tested, required duplicate implementations are retired only after all callers are accounted for, and final evidence is tied to the final candidate.
  - Product defaults, publication authority, unrelated dirty changes and intentionally deferred scopes are preserved.
docs:
  required: true
  paths:
    - harness/specs/guides/versebrowser-reintegration-playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The workspace now contains the M00-M12 module, adapter and migration artifacts; the earlier planning-only description is obsolete. The 2026-10-16 hygiene audit adds automatic module builds, restores the existing optional CLI runner injection, and separates 80 declared host methods from 67 implemented Electron-driver methods. The 13 facade-only additions remain explicit E_NOT_IMPLEMENTED, not accepted runtime capabilities. Historical receipts do not validate subsequent edits or the current packaged application.

Execute M00 through M12 serially. Before implementation run harness context with this spec, inspect the current diff, and verify the frozen inputs. Implement the bounded conservation/source checker in M01; run original runtime regressions and their exact dependency closure as specified in the playbook. The listed requiredTests are existing host entry points, not the entire migration acceptance suite. Harness profiles do not automatically execute every requiredTests entry; run phase-specific source, module, state, business, dependency and package checks explicitly.

The current root has unrelated VerseShell changes. Keep that work outside this change set, use isolated implementation checkouts, and do not edit its locks, task graph or evidence. Tests and expectations are frozen before candidate edits. Planning validation and dry-run do not constitute behavioral acceptance.
