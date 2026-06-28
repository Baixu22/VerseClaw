---
id: agent-dev-control-plane
title: Agent development control plane for fast page and functional testing
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose typed, gated agent-development APIs for state seeding, host-api replay, diagnostics, visual presets, selector contracts, transport traces, and scaffolding.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/services/agent-dev-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
  - src/lib/agent-dev.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/a11y.ts
  - tests/e2e/agent-dev-quality.spec.ts
  - scripts/agent-dev-scaffold.mjs
  - scripts/agent-dev-workbench.mjs
  - scripts/agent-dev-benefit-eval.mjs
  - docs/agent-dev-control-plane.md
  - docs/agent-dev-tooling-evaluation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - package.json
  - shared/host-api/agent-dev-schemas.ts
  - tests/unit/agent-dev-schemas.test.ts
  - tests/unit/agent-dev-api.test.ts
  - tests/unit/host-api-facade.test.ts
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - docs-sync
expectedUserBehavior:
  - Agent-authored E2E specs can enter known app states through `hostApi.agentDev` and `openAgentDevScenario`.
  - Page development can use `?devScenario=...`, `?flags=...`, and `?visual=1` without bypassing host-api.
  - Production mode keeps mutating agent-dev APIs disabled unless explicitly opted in.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/agent-dev-api.test.ts
  - tests/unit/agent-dev-schemas.test.ts
  - tests/unit/host-api-facade.test.ts
acceptance:
  - New backend-facing helpers are exposed through typed host-api only.
  - Host-api record/replay records calls and can replay fixtures without invoking Main.
  - Diagnostics snapshot includes app, gateway, settings, sandbox, host-call, transport, and log-tail context.
  - Agent-dev mutating payloads have runtime schema validation.
  - Basic a11y and visual artifact generation can run from a seeded Playwright scenario.
  - `pnpm agent-dev:evaluate` writes a quantified benefit report.
  - Selector contract requires stable `data-testid` locators for agent-authored E2E specs.
  - `pnpm agent-dev:make <page|e2e|host-route> <name>` exists and refuses to overwrite files.
docs:
  required: true
---

Use this spec for changes to the agent development control plane and its testing helpers.
