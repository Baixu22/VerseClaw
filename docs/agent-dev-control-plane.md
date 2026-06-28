# Agent Dev Control Plane

Verse Claw exposes a typed `hostApi.agentDev` surface for agent-authored page work and functional tests. The API is read-only in production and enables mutating helpers only in development, E2E, or when `CLAWX_AGENT_DEV=1` is set.

## Capabilities

1. `seedState`, `resetState`, `createConversation`, and `createProviderConfig` provide test-state seeds.
2. Renderer host API record/replay is available through `window.__CLAWX_TEST__.setHostApiReplay(...)` and `localStorage.clawx.agentDev.hostApiReplay`.
3. `?devScenario=<id>` routes directly to seeded page-development scenarios.
4. `selectorContract()` documents the stable `data-testid` contract for agent-authored E2E specs.
5. `diagnosticsSnapshot()` collects app, settings, gateway, sandbox, host-call, transport, and log-tail context.
6. `window.__CLAWX_TEST__.getSnapshot()` reports route, language, theme, active modal, visible toasts, active test id, flags, and visual mode.
7. `featureFlags()` and `setFeatureFlags()` expose dev/E2E feature flags. Query `?flags=a,b` also feeds the renderer surface.
8. `visualPreset()` plus `?visual=1`/`CLAWX_VISUAL_MODE=1` stabilize visual-regression runs.
9. `transportTrace()` returns recent gateway/transport events collected in Main.
10. `pnpm agent-dev:make <page|e2e|host-route> <name>` scaffolds common agent development artifacts.
11. `pnpm agent-dev:workbench` generates a static scenario index at `artifacts/agent-dev-workbench/index.html`.
12. `pnpm agent-dev:evaluate` writes a quantified tooling benefit report under `artifacts/agent-dev-benefit-eval/`.

## E2E Helpers

Use helpers from `tests/e2e/fixtures/electron.ts`:

```ts
await openAgentDevScenario(page, 'doctor-failed', { visualMode: true });
await configureAgentDevHostReplay(page, {
  mode: 'replay',
  fixtures: [{ module: 'settings', action: 'getAll', result: { theme: 'dark' } }],
});
const snapshot = await getAgentDevSnapshot(page);
const calls = await getAgentDevHostCalls(page);
```

Renderer code must still call backend data through `src/lib/host-api.ts`; these helpers exist to make that boundary faster to test, not to bypass it.

See also [`docs/agent-dev-tooling-evaluation.md`](agent-dev-tooling-evaluation.md) for the current external-tool adoption plan and measured benefit report.
