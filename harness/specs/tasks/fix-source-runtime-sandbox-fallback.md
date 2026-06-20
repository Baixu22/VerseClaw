---
id: fix-source-runtime-sandbox-fallback
title: Restore source runtime sandbox fallback so Gateway can start without Docker
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure ClawX can launch the editable openclaw_runtime even when Docker sandbox prerequisites are missing by applying an explicit, testable sandbox fallback instead of letting runtime startup fail.
touchedAreas:
  - harness/specs/tasks/fix-source-runtime-sandbox-fallback.md
  - electron/gateway/config-sync.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/supervisor.ts
  - electron/services/gateway-api.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/openclaw-doctor.ts
  - electron/utils/paths.ts
  - openclaw_runtime/src/agents/sandbox/**
  - openclaw_runtime/extensions/codex/src/app-server/dynamic-tool-build.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/common.json
  - shared/i18n/locales/zh/common.json
  - shared/i18n/locales/ja/common.json
  - shared/i18n/locales/ru/common.json
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
expectedUserBehavior:
  - Starting ClawX in development still launches Gateway from openclaw_runtime by default.
  - When Docker or the required sandbox image is unavailable, Gateway starts with an explicit degraded sandbox fallback instead of hanging or failing to connect.
  - The UI can tell the difference between gateway unavailable and sandbox downgraded.
  - Doctor and runtime helper commands report the same effective runtime and sandbox mode used by Gateway.
  - Users can still force npm runtime or a strict source-only mode explicitly through environment/config overrides.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fix-source-runtime-sandbox-fallback.md
  - pnpm run build:runtime
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/openclaw-cli.test.ts tests/unit/openclaw-doctor.test.ts tests/unit/gateway-ws-client.test.ts tests/unit/host-services.test.ts
  - pnpm run build:vite && pnpm exec playwright test tests/e2e/gateway-lifecycle.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Gateway startup computes one effective sandbox mode before spawn and applies it consistently to source runtime config, diagnostics, doctor, and helper commands.
  - Missing Docker/image prerequisites downgrade source runtime sandbox to a supported mode (`off` or another explicit non-Docker fallback), and the reason is recorded in diagnostics.
  - A strict mode still exists for developers who want startup to fail rather than downgrade.
  - Logs clearly distinguish runtime selection (`source` vs `npm`) from sandbox selection (`docker` vs fallback/degraded).
  - Tests cover both Docker-available and Docker-unavailable source runtime startup paths.
docs:
  required: true
---
