---
id: browser-supervised-component-graduation
title: Browser supervised component graduation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Graduate managed browser tasks from a create-and-open shell to an explicitly approved, multi-step, verifiable workflow while preserving private-network denial, Vault-only credentials, and user-controlled cancellation.
touchedAreas:
  - harness/specs/tasks/browser-supervised-component-graduation.md
  - harness/specs/rules/agent-browser-supervised-task-boundary.md
  - electron/services/agent-browser-api.ts
  - electron/services/agent-browser-service.ts
  - electron/services/agent-browser-task-service.ts
  - electron/services/agent-browser-supervised-task-executor.ts
  - electron/services/agent-browser/**
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Browser/index.tsx
  - src/components/file-preview/WorkspaceLiveBrowserPanel.tsx
  - src/components/file-preview/WorkspaceWebPreviewPanel.tsx
  - shared/i18n/locales/**/browser.json
  - tests/unit/agent-browser-task-service.test.ts
  - tests/unit/agent-browser-service.test.ts
  - tests/unit/agent-browser-supervised-task-executor.test.ts
  - tests/unit/agent-browser-browser-control.test.ts
  - tests/unit/browser-workbench.test.tsx
  - tests/unit/workspace-live-browser-panel.test.tsx
  - tests/e2e/agent-browser-workbench.spec.ts
  - tests/e2e/browser-security-recovery.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - artifacts/first-product-preview/FP-P4-02/**
  - artifacts/browser-security-recovery/evidence.json
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-02.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - The workspace Browser control can open an isolated visible or headless session using the selected profile and records the workspace/session/agent context as non-authorizing metadata.
  - A user can create an approval-bound automation from the current workspace page without exposing raw browser-debug controls by default.
  - Creating a browser task records it in a waiting-approval state and does not start a browser session.
  - The approval surface shows the objective, target site, allowed domains, browser mode, and action scope before the user can approve.
  - Approval starts an ordered browser workflow that performs more than initial navigation and reports per-step progress.
  - Completion requires an explicit success-condition result; failures remain explainable and retryable.
  - Cancelling a run remains the immediate kill path and feature-off behavior preserves the existing baseline.
  - Private-network targets remain denied and credentials remain Main-owned Vault references that never enter task evidence or screenshots.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - comms-regression
  - agent-browser-multi-tab
  - agent-browser-tool-interception
  - agent-browser-supervised-task-boundary
acceptance:
  - Renderer uses only the typed host API and adds no direct IPC or Gateway transport.
  - Workspace session and task provenance remains metadata only and cannot grant tools, bypass approval, widen domains, or alter browser runtime policy.
  - Every new task requires explicit user approval before Main executes any browser action.
  - Approval metadata is derived from the persisted task and cannot broaden its target or action scope.
  - The executor supports ordered navigation, bounded page-read waits, and interaction steps with cancellation checks.
  - Success verification produces a typed passed or failed result with a stable reason code and redacted evidence.
  - Private-network and restricted-scheme denial remains fail closed for the initial URL and every navigation step.
  - Credential secrets never cross the Main/Renderer boundary and do not appear in task logs, errors, or screenshots.
  - Unit coverage includes success, failure, approval denial, private-network denial, and kill paths.
  - Electron E2E covers approval, multi-step completion, verification failure, and cancellation.
  - User-visible strings cover en, zh, ja, and ru.
docs:
  required: true
---

Use this task spec for `FP-P4-02`. This is an engineering-validation-only component graduation and does not authorize unattended browsing, private-network access, real credentials, public release, default-on, or product approval.
