---
id: role-first-end-to-end
title: Role-first runtime MVP — real integration, observability, steering, and verification
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete the role-first MVP so role contracts genuinely change agent behavior end-to-end (trace auto-emission, real steering, memory persistence, policy-gate enforcement, i18n, and integration tests).
touchedAreas:
  - harness/specs/tasks/role-first-end-to-end.md
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/memory/memory-store.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/pages/Observability/index.tsx
  - shared/i18n/resources.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/en/observability.json
  - shared/i18n/locales/zh/observability.json
  - shared/i18n/locales/ja/observability.json
  - shared/i18n/locales/ru/observability.json
  - vitest.config.ts
  - tests/unit/helpers/role-gateway-test-utils.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/role-input-mode-chat.test.ts
expectedUserBehavior:
  - orchestrator.run spawns role-driven subagents AND records a role-first trace (orchestrator/role-router/subagent/verifier spans) visible in the Observability page.
  - When a user sends a message during an active run classified as guide (or explicitly set to guide), the message is injected into the active run via the embedded-agent queue without aborting it.
  - An explicit inputMode ("interrupt"|"guide"|"queue") from the UI is honored over the regex classifier.
  - Memory cards written via memory.store survive gateway restarts (persisted to <state-dir>/role-memory.sqlite).
  - A role with tools=[read,glob,grep] cannot use write/edit/exec/bash — enforced at isToolAllowedByPolicyName, not advisory.
  - The orchestrator.run approval round-trip works in acceptEdits mode (inline approve → retry with approvalId).
  - The Roles panel and Observability page render fully translated in en/zh/ja/ru.
  - Config-defined roles participate in orchestration routing; a caller-pinned preferredLeadRole is honored when it exists.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - i18n-coverage
requiredTests:
  - pnpm run build:runtime
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/role-input-mode-chat.test.ts tests/unit/observability-mvp.test.ts tests/unit/observability-service.test.ts
acceptance:
  - orchestrator.run produces a trace stored in the runtime trace buffer with span kinds beyond "tool" (orchestrator/subagent/verifier).
  - chat.send guide branch injects via queueEmbeddedAgentMessageWithOutcomeAsync, not a dead nodeSendToSession event.
  - params.inputMode is passed to createInputModeAction as the explicit mode.
  - setMemoryStorePath is called at gateway startup with a state-dir-relative path.
  - isToolAllowedByPolicyName denies a tool not in a non-empty role.tools allowlist.
  - RolesOrchestrationPanel renders an inline approve control on approvalRequired responses and retries with the approvalId.
  - roles.* / observability strings are present in all 4 locale files; no Chinese defaultValue leaks to en/ja/ru.
  - All 53 role-first + observability tests pass.
docs:
  required: true
  note: Update reports/role-first-implementation-report-zh.md §12 to reflect the gap fixes.
---
