---
lifecycleStatus: completed
id: kitesurf-loopback-cdp
title: Loopback Kitesurf CDP attach for the standalone VerseBrowser driver
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Accept a loopback Kitesurf CDP endpoint on the standalone driver, use its native page/target capabilities, and keep desktop managed sessions on the browser-window engine.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - docs-sync
  - error-governance-boundary
  - capability-owner-resolution
expectedUserBehavior:
  - `vb open --kitesurf --cdp` attaches only to a loopback endpoint whose /json/version identifies Kitesurf.
  - Page script, accessibility, input, network and target actions use the native Kitesurf CDP capabilities.
  - Desktop managed open refuses a kitesurf browser field before creating a window.
  - Remote Browser Run endpoints are refused.
  - A restored CLI command uses the live loopback control process because Kitesurf targets belong to the original WebSocket.
  - The driver never launches Chromium for Kitesurf, and status remains synchronous.
  - A plain Chromium CDP attach remains functional when its version probe fails.
  - Real Kitesurf tests cover input, script evaluation, accessibility, screenshots, network observations and multi-page lifecycle.
  - The real engine also verifies PDF, form, exact-element and same-origin frame reads; `vb pdf` writes a real PDF file in the workspace evidence root.
  - Loopback control authentication, session cleanup and worker exit are verified.
  - The CLI checks a public page load as well as engine-local fixtures.
  - The local runtime uses the host proxy for real public egress and preserves private-network rejection.
  - A snapshot of a closed CLI session retains the E_NO_SESSION error code.
  - Closing an owned upstream session aborts guarded transfers before waiting for native page shutdown.
  - Popup console messages emitted before page attachment remain in that page's observation window.
  - Changing an existing root or runtime pnpm workspace configuration invalidates cached type checks.
  - Unavailable bounded runtime inspection and JavaScript confirm are refused explicitly.
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - pnpm-workspace.yaml
  - scripts/contract-check.mjs
  - vitest.agent-dev.node.config.ts
  - scripts/typecheck-agent-dev.mjs
  - tests/unit/typecheck-gate.test.ts
  - packages/versebrowser/**
  - packages/README.md
  - docs/modules/verse-tools.md
  - scripts/kitesurf-loopback-cdp-verify.mjs
  - scripts/kitesurf-live-verify.mjs
  - scripts/kitesurf-local-runtime.mjs
  - docs/dev/kitesurf-loopback-cdp.md
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-workbench/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-audit/**
  - harness/specs/tasks/kitesurf-loopback-cdp.md
  - harness/specs/fixtures/kitesurf-loopback-cdp/**
requiredTests:
  - pnpm --dir packages/versebrowser exec vitest run tests/kitesurf-cdp.test.ts
  - pnpm --dir packages/versebrowser exec vitest run tests/kitesurf-live.test.ts
  - node scripts/kitesurf-live-verify.mjs
  - node scripts/kitesurf-loopback-cdp-verify.mjs
acceptance:
  - The behavior receipt records an agent-driven desktop rejection, a refused remote endpoint, a kitesurf session engine, and native page/script actions.
  - The verifier rereads the behavior and live receipts against the current source, with distinct evidence for the real engine and the protocol fixture.
  - Every claimed live action has a completed assertion and an actual recorded call; filtered runs preserve the previous complete receipt.
  - A plain loopback attach whose version payload identifies Kitesurf uses the same native adapter.
  - Desktop managed sessions stay on the browser-window engine.
  - The receipt covers native actions, PDF, separate file/AI authorization, CLI forwarding, synchronous status, and real Chromium fallback.
  - A real public document loads with HTTP 200, while its loopback fetch is rejected before reaching the private fixture.
docs:
  required: true
  paths:
    - packages/README.md
    - docs/modules/verse-tools.md
    - docs/dev/kitesurf-loopback-cdp.md
    - harness/specs/tasks/kitesurf-loopback-cdp.md
---

# Acceptance

The receipts are agent-driven and record the real engine separately from the
protocol fixture. `node scripts/kitesurf-loopback-cdp-verify.mjs` must pass against
the current source hashes before the task is completed.

Tests use a loopback HTTP version endpoint and a controlled CDP page double for
the safety boundary, plus a real Kitesurf engine and real Chromium process for
the behavior and fallback. A failed test leaves the previous receipt untouched,
so its observations and hashes cannot be replaced by a partial run.

The initial acceptance is preserved in
`harness/specs/fixtures/kitesurf-loopback-cdp/acceptance-initial-20261115.json`.
The final functional acceptance and its complete package, live CLI, source-hash
and export evidence are recorded in
`harness/specs/fixtures/kitesurf-loopback-cdp/acceptance-20261115.md`.
