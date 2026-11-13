# Agent Dev Control Plane

Verse Claw exposes a typed `hostApi.agentDev` surface for agent-authored page work and functional tests. The API is read-only in production and enables mutating helpers only in development, E2E, or when `CLAWX_AGENT_DEV=1` is set.

## Capabilities

Main records normal `chat:message` and `chat:runtime-event` events, associates request timelines
with their run IDs, and deduplicates stable message usage against final run totals. Tool effect
rows describe observed completion or failure without retaining raw arguments or results.
Sandbox capability gates and budgets remain report configuration; effect rows do not enforce policy.

1. `seedState`, `resetState`, `createConversation`, and `createProviderConfig` provide test-state seeds.
2. Renderer host API record/replay is available through `window.__CLAWX_TEST__.setHostApiReplay(...)` and `localStorage.clawx.agentDev.hostApiReplay`.
3. `?devScenario=<id>` routes directly to seeded page-development scenarios. `?devScenario=a+b` composes scenarios from the shared registry, ignores unknown ids safely, and lets later scenario seed values override earlier ones.
4. `selectorContract()` documents the stable `data-testid` contract for agent-authored E2E specs.
5. `diagnosticsSnapshot()` collects app, settings, gateway, sandbox, host-call, transport, and log-tail context.
6. `window.__CLAWX_TEST__.getSnapshot()` reports route, language, theme, active modal, visible toasts, active test id, flags, and visual mode.
7. `featureFlags()` and `setFeatureFlags()` expose dev/E2E feature flags. Query `?flags=a,b` also feeds the renderer surface.
8. `visualPreset()` plus `?visual=1`/`CLAWX_VISUAL_MODE=1` stabilize visual-regression runs.
9. `transportTrace()` returns recent gateway/transport events collected in Main, while `traceTimeline()` filters the typed trace envelope by `requestId`.
10. `recordScenario()` writes a redacted scenario artifact under `artifacts/agent-dev-scenarios/` for manual review before promotion.
11. `costReport()` and `skillSandboxReport()` expose typed Cost Simulator and Skill Sandbox evidence for Workbench and CI surfaces.
12. `pnpm agent-dev:make <page|e2e|host-route|skill|channel|plugin|scenario> <name>` scaffolds common agent development artifacts without overwriting existing files.
13. `pnpm channel:conformance <channel-name>` writes JSON and Markdown reports under `artifacts/channel-conformance/<channel-name>/`.
14. Settings > Developer exposes an in-app Agent Dev Workbench panel backed by `hostApi.agentDev.workbenchEvidence()`, `traceTimeline()`, `costReport()`, `skillSandboxReport()`, `selectorContract()`, and `recordScenario()`.
15. `pnpm agent-dev:workbench` generates a static Agent Dev control plane at `artifacts/agent-dev-workbench/index.html` plus `evidence.json`.
16. `pnpm agent-dev:promote-scenario <artifact.scenario.json> <name>` promotes a reviewed, redacted recording into a fixture, shared registry seed, harness scenario, and snapshot-backed E2E.
17. `pnpm agent-dev:evaluate` writes a quantified tooling benefit report under `artifacts/agent-dev-benefit-eval/`.
18. `pnpm agent-dev:audit` scores Agent Dev maturity from existing scripts, docs, tests, Workbench evidence, deep-test evidence, quality evidence, and timing history.
19. `pnpm agent-dev:deep-test` runs the real Agent Dev gate chain, separates build time from Playwright runtime, writes quantified results under `artifacts/agent-dev-deep-test/`, and refreshes quality evidence under `artifacts/agent-dev-quality/`. Daily diagnostics use `pnpm agent-dev:deep-test:reuse` for build reuse, cached typecheck, and Workbench smoke E2E; `pnpm agent-dev:deep-test:reuse:full` keeps full Agent Dev E2E while still reusing the build. Reports label these modes separately from full gates.
20. `pnpm contract:check`, `pnpm i18n:lint`, and `pnpm agent-dev:validate` provide the P0 local guardrails for host-api drift, locale coverage, and the combined Agent Dev validation gate.

## Workbench Product Route

The Agent Dev Workbench has two aligned entries: a generated static artifact for offline audit (`pnpm agent-dev:workbench`) and a compact in-app Settings > Developer panel for daily diagnosis. Both must read real sources only: `shared/agent-dev/scenarios.ts`, `shared/host-api/contract.ts`, `src/lib/host-api.ts`, `electron/services/agent-dev-api.ts`, package scripts, trace/cost/sandbox contracts, host-api reports, and generated report directories.

The renderer Workbench must keep using `src/lib/host-api.ts` / `src/lib/host-api-client.ts` as its only backend entry, and all visible text must use four-locale `react-i18next` coverage.

## Scenario Recording Promotion

`hostApi.agentDev.recordScenario()` writes a redacted recording artifact under `artifacts/agent-dev-scenarios/`. A recording is not source truth until a developer reviews it, confirms redaction, and promotes it into one or more durable entries:

- `shared/agent-dev/scenarios.ts` seed metadata.
- `harness/specs/scenarios/<scenario>.md` scenario spec.
- `tests/e2e/<scenario>.spec.ts` snapshot-backed E2E.
- A stable fixture only when replay data is intentionally reusable.

Promotion must run `pnpm contract:check`, `pnpm i18n:lint`, `pnpm agent-dev:workbench`, and the targeted E2E. Recorder redaction covers token/api key/secret/password/authorization keys, Bearer/Basic credentials and common API key prefixes in string values, and local home directory paths.

Use `pnpm agent-dev:promote-scenario <artifact.scenario.json> <name>` only after human review. The tool refuses existing target files, rejects obvious unredacted credentials/home paths, writes a stable fixture, and registers the scenario last so failed preflight does not leave a dangling registry entry.

## Layered Gates

| Command | Loop | Coverage | PR evidence | Release evidence |
|---|---|---|---|---|
| `pnpm agent-dev:fast` | daily / fast PR | Contract, i18n, static Workbench, and fast Agent Dev unit coverage. | Yes, as fast PR feedback. | No, pair with full gates. |
| `pnpm agent-dev:unit:node` | daily unit | Node-only Agent Dev logic tests. | Partial only. | No. |
| `pnpm agent-dev:unit:fast` | daily unit | Alias for the optimized full Agent Dev unit loop. | Yes. | Yes, same focused coverage as `pnpm agent-dev:unit`. |
| `pnpm agent-dev:unit` | full unit | Node-environment Main API/scaffold/scenario/contract/i18n tests plus jsdom host-api facade coverage. | Yes. | Yes. |
| `pnpm run typecheck:agent-dev` | diagnostic typecheck | Generates the extension bridge once, then runs node and web TypeScript project checks in parallel. | Yes, as equivalent project coverage with different scheduling. | Yes, same project coverage as `pnpm run typecheck`. |
| `pnpm run typecheck:cached` | daily typecheck | Generates the extension bridge, fingerprints TypeScript inputs, and reuses a previous successful node/web project check only when inputs are unchanged. | Yes, for repeated local diagnosis. | No, report must list `pnpm run typecheck` as a required full gate. |
| `pnpm run typecheck:force` | cache refresh | Forces a fresh node/web project check and refreshes the local cache report. | Yes, as a local cache warmup. | No, use `pnpm run typecheck` for release evidence. |
| `pnpm run typecheck` | full typecheck | Default uncached full typecheck wrapper; uses the parallel node/web project checks and emits phase timing. | Yes. | Yes. |
| `pnpm run test:e2e:agent-dev-quality:smoke` | daily E2E | Settings > Developer Workbench visibility, contract gaps, and record button path. | Partial only. | No. |
| `pnpm run test:e2e:agent-dev-quality:run` | local E2E | Full Agent Dev quality spec against an existing fresh build, scoped to two workers. | Yes after a known-fresh build. | Yes after a known-fresh build. |
| `pnpm test:e2e:agent-dev-quality` | full E2E | Fresh build plus full Agent Dev quality Playwright spec, scoped to two workers. | Yes. | Yes. |
| `pnpm agent-dev:deep-test` | full diagnostic | Full gate chain with fresh build, timing, bottlenecks, quality report, and Workbench refresh. | Yes. | Yes. |
| `pnpm agent-dev:deep-test:reuse` | daily diagnostic | Reuses fresh build artifacts, uses `typecheck:cached`, and runs the Workbench smoke E2E only. | Yes, for repeated local diagnosis. | No, rerun fresh full diagnostic, full typecheck, and full E2E for release evidence. |
| `pnpm agent-dev:deep-test:reuse:full` | local diagnostic | Reuses fresh build artifacts and `typecheck:cached`, but runs the full Agent Dev Playwright spec. | Yes, when full E2E evidence is needed without rebuilding. | No, rerun fresh full diagnostic and full typecheck for release evidence. |
| `pnpm agent-dev:deep-test --reuse-build --fast-unit --fast-typecheck --smoke-e2e` | daily diagnostic | Reused build, fast unit, parallel typecheck, and smoke E2E. | Partial only. | No. |
| `pnpm agent-dev:audit` | maturity audit | Scores gate integrity, evidence completeness, coverage breadth, performance discipline, docs/runbook, and maintainability from existing evidence. Fails the process on hard-veto findings. | Yes, as an audit summary. | Yes, but failing disqualifiers must be fixed or explicitly waived. |
| `pnpm agent-dev:audit:report` | maturity audit | Same scoring as `agent-dev:audit`, but uses `--no-fail` so humans can generate reports without interrupting a workflow. | Yes, for diagnosis only. | No, use strict `pnpm agent-dev:audit`. |
| `pnpm agent-dev:full-local` | full local | Fast PR gate, task spec validation, and full built Agent Dev E2E. | Yes. | Yes for Agent Dev changes; broader release gates may still apply. |
| `pnpm agent-dev:validate` | full validation | Contract, i18n, harness CI, and full built Agent Dev E2E. | Yes. | Yes for Agent Dev control-plane review. |

Deep diagnostics write `artifacts/agent-dev-deep-test/report.json` plus `report.md`, and refresh `artifacts/agent-dev-quality/report.json` for Workbench indexing. The JSON report includes:

- `decision.status`: `daily-loop-ok`, `needs-full-gate`, or `blocked`.
- `decision.requiredFullGates`: commands that must still run before PR/release confidence when a fast path was used.
- `buildReuse`, `unitMode`, `typecheckMode`, and `e2eMode`: the selected execution modes.
- `results[].skipped`: step-level skip evidence, especially for reused builds.
- `history`: the latest rolling trend summary from `artifacts/agent-dev-deep-test/history.json`.
- `diagnostics`: parsed details for typecheck phases, largest Vite build assets and warnings, and Playwright per-test durations.

`pnpm agent-dev:audit` writes `artifacts/agent-dev-audit/report.json` and `report.md`. Its scorecard is intentionally hard-veto aware: a total grade can still be `B` while the audit status is `fail` when any disqualifying finding exists, such as a latest deep-test `decision.status = "blocked"` or a performance hard-limit breach.

The audit report includes:

- `policy`: pass/warn thresholds, freshness window, and hard-veto semantics.
- `maturityLevel`: `release-grade`, `review-ready`, `daily-loop-ready`, `developing`, `immature`, or `blocked`.
- `confidence`: whether the score is backed by fresh, parseable evidence.
- `scoreBreakdown`: per-dimension deductions and the finding ids that explain the score.
- `evidenceInventory`: every source used by the audit, with existence, parseability, timestamp, age, and whether relevant Agent Dev source files are newer than generated evidence.

Source-newer comparison uses git commit time for clean tracked files and working-tree mtime only for dirty or untracked files, so evidence committed in the same change set stays valid in clean checkouts (acceptance worktrees, CI) while the daily loop still hard-fails on unrefreshed evidence after source edits.
- `prioritizedFindings`: sorted `P0` / `P1` / `P2` findings so the first row is the next repair target.

The generated static Workbench also indexes the latest deep-test bottlenecks, recent history entries, and audit score breakdown. Treat it as a fast status board; automation should read the JSON artifacts directly.

`channel:conformance` owns channel adapter evidence, `contract:check` owns host-api drift, `i18n:lint` owns locale/key coverage, Workbench indexes evidence, and Agent Dev E2E proves registry-to-renderer behavior. These gates should not grow parallel scenario lists or duplicate each other's source of truth.

## Generated Catalog Discipline (R6-4)

`docs/generated/catalogs/` holds the first generated catalogs: `tools.md` (core tool catalog) and `prod-flags.md` (DCS production opt-in flags). They are **generated, never hand-edited** — the single sources of truth are `openclaw_runtime/src/agents/tool-catalog.ts` and `shared/dcs/prod-flags-catalog.ts`, and `scripts/generate-catalogs.mjs` imports the same module exports (same-source generation, so the files cannot drift structurally).

Rules every future generated catalog must follow:

1. One source of truth; the generator imports it — never copies a list.
2. Generated files are committed in the same change set as source edits.
3. `pnpm catalogs:check` fails closed (exit 1) on stale, hand-edited, or missing output; it never writes disk. It is mounted in `harness:ci` before `agent-dev:audit`.
4. Nothing at runtime may import a generated file as a fact source — generated output is documentation surface only.

```bash
pnpm catalogs:gen     # regenerate after source edits
pnpm catalogs:check   # fail-closed freshness gate
```

## P0 Guardrails

Agent Dev scenario metadata lives in `shared/agent-dev/scenarios.ts`; renderer/Main/workbench code must consume that registry instead of maintaining local scenario id lists. Composition logic lives in `shared/agent-dev/scenario-composer.ts` and supports `+` separated ids with later seed values overriding earlier ones. Query parameters other than `devScenario` are exposed as override metadata and invalid scenario ids are ignored rather than crashing the app.

`pnpm agent-dev:make scenario <name>` registers the new scenario id in `shared/agent-dev/scenarios.ts` and generates an E2E spec that checks `window.__CLAWX_TEST__.getSnapshot()` for that scenario id. This keeps scaffolded scenarios connected to the same registry used by the renderer, Main process, and Workbench.

`pnpm agent-dev:make e2e <name>` is only valid for an existing shared scenario id. Use `pnpm agent-dev:make scenario <name>` when creating a new scenario so the registry, harness scenario, and snapshot-backed E2E stay connected.

`pnpm agent-dev:make page <name>` wires the generated page into `src/App.tsx` with a real route and four locale namespaces. `pnpm agent-dev:make host-route <name>` wires a pingable typed host-api module through `shared/host-api/contract.ts`, `src/lib/host-api.ts`, `electron/main/ipc-handlers.ts`, and `electron/services/<name>-api.ts`.

Run the P0 validation entry points when changing the Agent Dev control plane:

```bash
pnpm contract:check
pnpm i18n:lint
pnpm channel:conformance <channel-name>
pnpm agent-dev:validate
```

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

On Windows, Playwright global setup defaults Electron homes and process ledgers to the ignored `.tmp/e2e-runs` directory inside the checkout. This avoids the low-integrity `D:\tmp` ACL mismatch that can stop Electron before `BrowserWindow` creation. Set `CLAWX_E2E_RUN_ROOT_BASE` or `CLAWX_E2E_RUN_ROOT` only when an isolated run root is intentionally required.

If the installed Electron executable itself carries a Low mandatory integrity label, `CLAWX_E2E_EXECUTABLE_PATH` selects a staged test-runtime copy for source E2E launches. Keep that copy byte-identical to the installed Electron runtime, record its SHA-256, and place it under an isolated writable directory. Explicit packaged-test executables take precedence over this staging override. Product startup and packaged defaults do not read this environment variable.

See also [`docs/agent-dev-tooling-evaluation.md`](agent-dev-tooling-evaluation.md) for the current external-tool adoption plan and measured benefit report.
