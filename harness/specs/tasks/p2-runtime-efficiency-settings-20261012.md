---
id: p2-runtime-efficiency-settings-20261012
title: Settings toggle and host-api surface for runtime efficiency sampling (issue #161)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Expose the Main-process runtime efficiency sampler to the renderer through host-api with a persisted Settings opt-out, fail-closed "not sampled" readout, four-locale i18n and Electron E2E; make no performance claim.
expectedUserBehavior:
  - Settings > Developer shows a runtime efficiency sampling switch and a live readout sourced only through host-api.
  - Toggling the switch off stops the sampling timer entirely (zero interval work, no pending handle); toggling on restarts it.
  - Before any real sample the readout says "not sampled" instead of showing a healthy-looking zero.
  - All user-facing text is localized in en / zh / ja / ru.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - electron/services/efficiency-api.ts
  - electron/main/ipc-handlers.ts
  - electron/main/index.ts
  - src/lib/host-api.ts
  - src/components/settings/EfficiencySamplingPanel.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/runtime-efficiency-api.test.ts
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/e2e/settings-efficiency-sampling.spec.ts
  - harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - harness/specs/rules/runtime-efficiency-observability-boundary.md
  - docs/dev/windows-runtime-efficiency-observability.md
  - docs/dev/p2-runtime-efficiency-settings-20261012.md
  - docs/dev/p2-runtime-efficiency-settings-20261012/acceptance.json
  - docs/dev/p2-runtime-efficiency-settings-20261012/SHA256SUMS
  - harness/specs/tasks/p2-runtime-efficiency-settings-20261012.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - runtime-efficiency-observability-boundary
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-efficiency-api.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm contract:check
  - pnpm run i18n:lint
  - pnpm run test:e2e tests/e2e/settings-efficiency-sampling.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-runtime-efficiency-settings-20261012.md
acceptance:
  - The Settings switch can be turned on and off; disabling stops the interval work with no residual timer, and the persisted setting is read back through host-api.
  - host-api exposes the latest sample plus the bounded rolling summary and shed state; a read failure surfaces an error rather than a silently empty value.
  - The renderer reads the sampler only through host-api/api-client; no new ipcRenderer.invoke or direct gateway HTTP is added.
  - All four locales carry the new strings and the i18n lint passes; an Electron E2E spec covers the switch and the readout.
  - Before any real sample the UI states "not sampled" and never renders a healthy zero.
  - No performance improvement is claimed; no frozen product default is changed.
docs:
  required: true
  paths:
    - docs/dev/p2-runtime-efficiency-settings-20261012.md
---

# Settings toggle and host-api surface for runtime efficiency sampling

The Main-process measurement core landed earlier
(`windows-runtime-efficiency-observability-v1`), but the sampler state lived only
inside the Main process: there was no Settings switch, no host-api read method,
and no renderer surface.

This change adds the user-visible surface and keeps it honest:

- `shared/host-api/contract.ts` gains an `efficiency` module
  (`getState` / `setEnabled`) plus the `RuntimeEfficiencyState` shapes.
- `electron/services/efficiency-api.ts` reads the orchestrator (latest sample,
  bounded rolling summary, shed state) and persists the toggle via
  `efficiencySamplingEnabled` in app settings.
- `electron/main/index.ts` starts sampling only when the persisted setting is not
  `false`, so an opt-out survives restarts.
- `src/components/settings/EfficiencySamplingPanel.tsx` renders the switch and
  readout inside Settings > Developer; it reads exclusively through
  `hostApi.efficiency`.
- Four-locale i18n plus an Electron E2E spec cover the interaction.

## Fail-closed readout

The sampler returns a zeroed summary before its first sample. The host API
collapses that to `summary: null` with `measured: false`, so the UI shows an
explicit "not sampled" state. An unmeasured runtime is never rendered as a
healthy zero, matching `runtime-efficiency-observability-boundary`.

## Boundary

- No performance optimization and no improvement claim; a before/after artifact
  pair is still required for that.
- Sampling stays local; nothing is uploaded.
- No frozen product default changes: `efficiencySamplingEnabled` defaults to
  `true`, preserving the pre-existing always-on behaviour, and is user-settable.
- Subagent fan-out quotas are untouched; the terminal exec lease remains the
  owner of that surface.
