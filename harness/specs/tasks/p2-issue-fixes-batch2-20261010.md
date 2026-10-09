---
id: p2-issue-fixes-batch2-20261010
title: P2 issue batch 2 - gateway endpoint single source, session-activity unknown state, error-message i18n
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close three open [P2] issues (#89, #121, #120) with verified fixes, shared-type/boundary discipline and fail-closed guards.
touchedAreas:
  - shared/gateway-endpoint.ts
  - shared/types/**
  - shared/i18n/**
  - electron/utils/**
  - electron/main/index.ts
  - electron/services/**
  - src/stores/**
  - src/lib/**
  - src/pages/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/auto-reply/**
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/**
  - docs/dev/p2-issue-fixes-batch2-20261010.md
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - A background-activity read failure is visible as an unknown state instead of an empty list.
  - User-facing error text follows the selected language and says what happened, whose problem it is and what to do next.
  - The local Gateway endpoint has one source of truth, so changing the port updates detection and copy.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - gateway-endpoint-single-source
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/gateway-endpoint-single-source.test.ts tests/unit/project-rules-api.test.ts tests/unit/session-activity.test.ts tests/unit/session-activity-background-read.test.ts tests/unit/session-activity-owner-read-status.test.ts tests/unit/session-activity-panel.test.tsx tests/unit/error-message.test.ts tests/unit/error-model.test.ts tests/unit/user-error.test.ts tests/unit/provider-request-error-classifier.test.ts
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node scripts/i18n-lint.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch2-20261010.md
acceptance:
  - Issue #89 - the Gateway port literal exists only in shared/gateway-endpoint.ts (plus tests); project-rules detection and its generated AGENTS.md copy derive from the constant; the Control-UI URL filter, Main defaults, renderer stores and the mock bridge all reference it.
  - Issue #121 - RPC timeout, owner read exception and missing projection fields surface as unknown; a successful empty read shows the normal empty state without a false warning; main-run-finished-with-live-background-facts keeps activity; recovery returns to known with correct stale marking.
  - Issue #120 - every error class resolves to en/zh/ja/ru keys, classification reads structured error data rather than translated text, refusal/balance classes do not offer only "retry now", and UNKNOWN redaction plus error-reference behaviour are unchanged.
  - Renderer/Main boundary and transport policy are unchanged; no product default, feature flag or product lock is modified.
  - Electron E2E coverage is added for the two user-visible changes; when the E2E gate cannot be executed in this environment that is reported, not implied.
docs:
  required: false
---

# P2 issue batch 2

Second batch of open `[P2]` issues on the private remote:

- **#89** Gateway port hardcoded in eight-plus places, including rule-detection
  regexes and user-facing copy;
- **#121** background activity read failures silently rendered as empty, with no
  unknown state in Session Activity;
- **#120** the unified user-error exit still returns hardcoded English with no
  responsibility/next-step guidance for high-frequency provider errors.

Both #121 and #120 are user-visible and cross the renderer/Main (and, for the
session-activity chain, Gateway owner views) boundary, so this spec carries the
`gateway-backend-communication` scenario and the boundary rules. The transport
policy (`WS -> HTTP -> IPC`) and the host-api/api-client entry points are
unchanged.

Evidence is agent-driven (`driven_by: agent`). Nothing here claims human
execution, and no E2E result is asserted without running the gate.
