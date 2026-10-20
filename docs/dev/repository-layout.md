# Repository layout and evidence roots

This page describes the source tree inspected on **2026-10-20**. It groups paths by ownership so a clean checkout does not require guessing from historical ClawX layouts. Source code and tests remain authoritative; generated files, local tool state and retained evidence have narrower rules below.

## Top-level ownership

| Path | Role | Source of truth |
| --- | --- | --- |
| `src/`, `electron/`, `shared/` | Desktop product source and the renderer/Main contract boundary | Code and contract tests |
| `openclaw_runtime/` | Vendored OpenClaw runtime source, runtime packages and its local fork policy | [UPSTREAM](../../openclaw_runtime/UPSTREAM.md) |
| `packages/` | Product components; not every child is a pnpm workspace package | `packages/README.md` and each child README |
| `harness/` | Executable rules, scenarios, task specs, fixtures and validation commands | Harness validation |
| `tests/` | Root unit, integration, fixture and Electron E2E coverage | Test configuration and specs |
| `scripts/` | Build, synchronization, validation, maturity, evidence, packaging and release automation | Scripts and CI |
| `public/`, `resources/` | Shipped runtime assets, preinstalled skills, plugins and packaging inputs | Packaging and asset checks |
| `docs/`, `plans/`, `team/` | Current documentation, maturity decisions and historical design material | This index and policy checks |
| `reports/`, `artifacts/` | Curated long-form reports and machine-readable retained evidence | `docs/dev/repository-artifact-retention.md` |
| `.github/`, `electron-builder.yml`, `pnpm-workspace.yaml`, `patches/` | CI, packaging, workspace membership and dependency patches | Git configuration, workflows and build scripts |

`team/` contains historical design and role-architecture material. It is not a current runtime entry point.

## Product source map

| Path | Current contents |
| --- | --- |
| `src/pages/` | Route-level surfaces for Chat, Knowledge, Inbox, Scheduled, Task Ledger, ClawGraph, Observability, Settings and compatibility workspace routes; Dream and Image Generation are developer-mode surfaces |
| `src/components/` | Layout and sidebar, chat, settings, workspace panels, tool UI, approvals, agent UI and shared primitives |
| `src/stores/` | Client state for chat/session history, Gateway status, workspaces, settings, agents, skills, schedules, observability and related surfaces |
| `src/lib/` | Typed host facade/client, event facade, mock host bridge, i18n bootstrap, theme, Agent Dev and shared renderer utilities |
| `src/extensions/` | Renderer extension registry and generated bridge for installed renderer extensions |
| `src/hooks/` | Renderer-only hooks for bottom pinning, ticking time and WebGL fire effects |
| `src/types/` | Renderer-facing agent, channel, cron, gateway, skill and Electron ambient types |
| `src/assets/` | Provider, channel and community image assets |
| `electron/main/` | Application lifecycle, windows, menu, tray, shortcuts, single-instance handling and the typed IPC dispatcher/security boundary |
| `electron/services/` | Main-owned host services for files, workspaces, chat, knowledge, task ledger, agents, permissions, Git, terminals, browser, MCP, memory, observability, updates and more |
| `electron/gateway/` | Gateway launch, supervision, restart/recovery, WebSocket RPC, request state and runtime event dispatch |
| `electron/preload/` | The renderer-visible Electron bridge |
| `electron/extensions/` | Main-process extension registry, loader and generated external-extension bridge |
| `electron/shared/` | Shared Main/provider registry types and model-cost helpers |
| `electron/types/` | Electron-specific ambient declarations |
| `electron/utils/` | Path, environment, config, logging, auth, process, Gateway, workspace and persistence utilities |
| `shared/host-api/`, `shared/types/` | The Host API contract, deadlines, cross-process types and shared schemas |
| `shared/i18n/` | `en`, `zh`, `ja` and `ru` locale resources and shared translation plumbing |
| `shared/` domain modules | `agent-browser`, `agent-dev`, `channels`, `chat`, `dcs`, `host-events`, `knowledge`, `mcp`, `privacy`, `release-policy`, `remote-forge`, `resources`, `sandbox`, `security`, `verseshell` and `vtoken` contracts and helpers |
| Shared top-level modules | Product semantics, capability claims, reliability boundaries, instruction precedence, handoff depth and workspace-preview policy |
| `openclaw_runtime/src/` | Agent execution, model/provider routing, tools, sessions, transcripts, context, memory, channels, scheduling, Gateway internals, media and runtime services |
| `openclaw_runtime/extensions/` | Provider, channel, tool, browser, memory, media, QA and plugin implementations; presence does not mean an extension is enabled |
| `openclaw_runtime/packages/` | Reusable private runtime packages such as gateway protocol/client, agent core, LLM runtime, plugin SDK and memory host SDK |
| `openclaw_runtime/ui/` | The OpenClaw control UI that belongs to the vendored runtime tree |
| `openclaw_runtime/apps/` | macOS and shared application hosts inside the vendored runtime, not the root Electron desktop entry |
| `openclaw_runtime/experiments/` | Experimental fixtures; not a product runtime entry point |
| `openclaw_runtime/test/`, `openclaw_runtime/scripts/`, `openclaw_runtime/config/` | Runtime-specific tests, tooling and configuration |
| `harness/` | Executable rules, scenarios, task specs, layer conventions, fixtures and workspace definitions |
| `tests/` | Root unit, integration, fixture and Electron Playwright suites |
| `scripts/` | Build, synchronization, validation, maturity, evidence, packaging and release automation |

## Current route surface

`src/App.tsx` is the renderer route registry. CodeGraph resolves these product surfaces:

| Route | Surface |
| --- | --- |
| `/setup/*` | First-run setup |
| `/` | Chat; `?knowledge=ask` selects the Knowledge chat variant |
| `/knowledge` | Knowledge library and review workflows |
| `/inbox` | Approvals, browser tasks and remote-task attention |
| `/cron` | Scheduled jobs and run history |
| `/task-ledger` | User-facing task ledger |
| `/clawgraph` | Explicit graph/workflow surface |
| `/observability` | Runtime and trace diagnostics |
| `/settings/*` | Settings; sections are overview, general, models, agents, channels, skills, browser, system, developer, billing, archived and recovery |

Compatibility routes redirect older entry points into their current owners: `/models`, `/agents`, `/channels`, `/skills` and `/remote-tasks`; `/code-review` and `/browser` open the corresponding workspace panels. `/image-generation` and `/dreams` require developer mode, while `/ui-v2-showcase` is a dedicated UI showcase route. Extra renderer-extension routes are appended from the extension registry.

`electron/services/` contains host-service modules grouped around provider storage/runtime sync, secret storage and skills, plus workspace/file, Git, terminal, browser, chat/session, knowledge/memory, task/agent, MCP, observability, resource, update and release operations. The service registry—not page code—owns these effects.

## Embedded components and shipped resources

| Path | Current role |
| --- | --- |
| `packages/versebrowser/` | Private `@verse-claw/versebrowser` workspace module; builds before root dev/build and is consumed through public exports |
| `packages/vtoken/` | Python/uv token sidecar, deliberately outside the pnpm workspace and copied by the packaging configuration |
| `resources/verseshell-mcp/` | Separate pnpm workspace package implementing the external MCP compatibility adapter for the pinned VerseShell runtime |
| `resources/skills/`, `resources/skill-packs/` | Preinstalled skills and skill-pack inputs bundled into the desktop product |
| `resources/openclaw-plugins/` | ClawX-specific OpenClaw plugin sources bundled with the runtime |
| `resources/bin/`, `resources/workspace-harness/`, `resources/context/`, `resources/icons/` | Native helpers, workspace harness inputs and shipped assets |
| `resources/verseshell/`, `resources/verseshell-mcp/` | Pinned VerseShell runtime/source notices and the external MCP adapter |
| `resources/cli/` | POSIX and Windows OpenClaw CLI launchers and path-update helper |
| `resources/readme/`, `resources/brand-exploration/` | README screenshots, provenance, architecture media and visual identity exploration |

The root pnpm workspace contains the repository root, `harness/`, `packages/versebrowser/` and `resources/verseshell-mcp/`. `openclaw_runtime/` is a real Git tree with its own dependency workspace, not a Git submodule and not the npm `openclaw` package. `packages/vtoken/` is intentionally not a pnpm member.

## Request and ownership boundaries

The ordinary desktop request path is **React renderer → typed host facade → preload IPC → Electron Main**. Runtime-bound services then use the Main-owned Gateway WebSocket RPC connection. Local file, terminal and desktop services can complete in Main without traversing Gateway. Runtime events return through Main/preload and the renderer event facade.

- Renderer code uses `src/lib/host-api.ts` and `src/lib/host-api-client.ts`; it must not open direct Gateway connections or add page-level Electron IPC calls.
- `shared/host-api/contract.ts` is the typed contract shared by renderer, preload and Main services.
- `electron/main/ipc/host-invoke.ts` authorizes and dispatches requests; `electron/gateway/manager.ts` owns Gateway lifecycle and RPC.
- `openclaw_runtime/` is built and installed independently from the root desktop workspace.
- VerseBrowser's contract surface is larger than the capabilities implemented by a particular driver. Check the live capability snapshot and [integration limits](../../packages/README.md#versebrowser-integration-and-invocation) rather than counting methods.
- Optional memory, DCS, VToken, browser and plugin surfaces are policy- and enablement-dependent. Source presence is not a promise that they are active by default.

## Local-only working state

These paths support development but are not prerequisites for a clean checkout to build, test or run the product:

- `.agent-workbench/` and generated Task Forest exports are local project-management state.
- `docs/dev/handoffs/LATEST.md`, when present, is a local session-continuation aid.
- `.codegraph/` is an ignored index for the external CodeGraph CLI used by coding agents. It is not a product runtime feature and is not required by any build or test command.
- `.local/`, `.audit/`, `.ae/`, `.tmp/`, `tmp/`, `test-results/`, `playwright-report/` and similar working directories contain local tool output unless a file is explicitly tracked.
- Raw logs and uncurated run output stay local. Durable evidence is promoted to `artifacts/`; long-form human-readable reports go to `reports/`.

## Evidence roots

New durable evidence must use an existing reviewed root:

- `artifacts/` for machine-readable curated evidence and retained acceptance output.
- `reports/` for long-form human-readable reports derived from retained evidence.
- `docs/` for current product, architecture or operational meaning.
- `plans/` for system-maturity decisions and their approved lifecycle.

Raw logs, temporary run directories, local handoffs and private working data must stay local or under the repository retention policy. Do not create a new top-level evidence directory without updating `scripts/repository-artifacts.json` and this page.

## Root process files

Design notes and process documents belong under `docs/`. The former root-level `send-button-states-design.md` is retained at [`docs/dev/send-button-states-design.md`](send-button-states-design.md).

## Generated asset directories

Some shipped assets are build inputs generated from a pinned dependency rather than vendored into Git. They are ignored, regenerated by a script that `predev` / `prebuild:vite` run, and each one names the dependency, version and licence it came from:

| Directory or file | Generated by | Current source |
| --- | --- | --- |
| `public/lobe-icons/` | `scripts/sync-lobe-icons.mjs` | `@lobehub/assets-fileicon` (MIT), served at `/lobe-icons/<name>.svg` |
| `electron/extensions/_ext-bridge.generated.ts`, `src/extensions/_ext-bridge.generated.ts` | `scripts/generate-ext-bridge.mjs` | Extension manifest resolution and installed package availability in the generator; inspect the generated no-op or import bridge instead of assuming external extensions are linked |
| `dist/`, `dist-electron/` | Vite/Electron build scripts | Build output; never treat these directories as source |

> **Known manifest mismatch (2026-10-20):** `scripts/generate-ext-bridge.mjs` and `vite.config.ts` currently look for `verse-claw-extensions.json`, while the tracked root manifest is `clawx-extensions.json`. Until those paths are reconciled, inspect the generated bridge and do not describe external extensions as wired solely because the generator exists.

Third-party bytes that the running app must serve belong here rather than in a tracked `public/` subdirectory: the generated copy stays byte-identical to the dependency (`node scripts/sync-lobe-icons.mjs --check` fails closed on drift), while the repository records provenance instead of a second copy of the files.

## Python sidecars

`packages/vtoken` is a Python/uv sidecar, not a pnpm dependency. See [`packages/vtoken/README.md`](../../packages/vtoken/README.md). Its location is intentional: it is packaged with the component that launches it, while `pnpm-workspace.yaml` only enumerates JavaScript workspace packages.

## Vendored runtime

`openclaw_runtime/` is a real Git tree, not a submodule. Its upstream version, local fork policy, sync process and tracked build-output rationale are recorded in [`openclaw_runtime/UPSTREAM.md`](../../openclaw_runtime/UPSTREAM.md) and checked by `scripts/check-runtime-source-policy.mjs`.

The CodeGraph OpenClaw extension was retired on 2026-10-17. Only its frozen impact-parity fixture remains. The separately installed CodeGraph CLI and its ignored `.codegraph/` index are development tooling, not a revived product surface.

## Verification

Use `pnpm repo:artifacts:check` and `pnpm repo:local-paths:check` when changing retained evidence, generated assets or tracked path references. The source tree, Harness validation and relevant tests remain the final authority when this navigation page drifts.
