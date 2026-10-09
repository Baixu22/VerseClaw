<p align="center">
  <img src="src/assets/logo.png" width="96" height="96" alt="Verse Claw logo" />
</p>

# Verse Claw

**Chat, code, knowledge and agent execution in one desktop workspace.**

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja-JP.md) · [Русский](README.ru-RU.md)

[Screenshots](#screenshots) · [Features](#features) · [Workflows](#workflows) · [Getting started](#getting-started) · [Configuration](#configuration) · [Architecture](#architecture) · [Development](#development) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation)

Verse Claw is an Electron desktop application built on OpenClaw. Start work in a conversation, inspect files, terminals, browser previews, code changes and generated artifacts in the same workspace, then turn useful material into reviewable project knowledge. The app also provides model and agent configuration, messaging channels, scheduled tasks and runtime diagnostics.

The desktop uses React, TypeScript and Vite. Editable OpenClaw runtime and plugin sources are included in this repository. See [package.json](package.json) for the current version and dependencies. Some source, configuration and historical documents retain the ClawX name.

> **Current status:** this is an alpha project. Controlled Windows x64 workflows are the primary local acceptance target. macOS and Linux have build targets, with validation coverage specific to each platform and capability. Experimental features retain the activation conditions described below, in the [product semantics](docs/clawx-product-semantics.md) and in the [capability matrix](shared/capability-claims.ts).

Chat provides checkpoint restore from the session menu, repository controls beside the composer, and per-message, per-session or persistent model selection. Advanced UI mode exposes compression evidence and recovery actions. Local token usage history remains available while the Gateway is stopped.

<a id="screenshots"></a>

## Inside the app

The header uses the B2 identity selected on 2026-10-06; the dated screenshots below retain the previous appearance.

Captured directly from the Windows Electron source build on 2026-10-05, operated by an agent with isolated profiles and a real local Gateway. The Knowledge capture explicitly enables `memory-wiki`. No model account or model request is used: the empty conversation, ledger and library are real states. Click an image for full size.

| **Chat and task entry**<br>[![Chat and task entry](resources/readme/2026-10-05/en/chat.png)](resources/readme/2026-10-05/en/chat.png) | **Knowledge library and review entry**<br>[![Knowledge library and review entry](resources/readme/2026-10-05/en/knowledge.png)](resources/readme/2026-10-05/en/knowledge.png) |
| --- | --- |
| **Task Ledger**<br>[![Task Ledger](resources/readme/2026-10-05/en/tasks.png)](resources/readme/2026-10-05/en/tasks.png) | **Models and provider settings**<br>[![Models and provider settings](resources/readme/2026-10-05/en/settings.png)](resources/readme/2026-10-05/en/settings.png) |

See [visual provenance](resources/readme/2026-10-05/README.md) for capture conditions, illustration prompts and file hashes. The storage warning reflects the capture machine’s actual disk state.

<a id="features"></a>

## Features

| Area | What you can do | Entry |
| --- | --- | --- |
| Chat and sessions | Stream responses, attach files and knowledge references, inspect tool results; search, pin, group, archive and restore conversations | Main view and session sidebar |
| Project workspaces | Switch projects, browse and preview files, use terminals, browsers, Git changes and code review beside the conversation | Workspace panel in the chat toolbar |
| Models and providers | Manage provider accounts, default models and fallback settings; inspect token usage history | Settings → Models & Providers |
| Agents and tasks | Configure agents and roles, inspect subagent activity; record tasks in Task Ledger and start explicit Task Loop or ClawGraph workflows | Settings → Agents; sidebar's more menu |
| Knowledge | Search the library, manage sources and references, review Inbox items, drafts and proposals | Sidebar → Knowledge |
| Inbox | Handle permission requests, remote tasks and browser tasks that need attention; inspect their history | Sidebar → Inbox |
| Schedules and channels | Manage scheduled jobs and run history; configure channel accounts, connection status and agent bindings | Sidebar → Scheduled; Settings → Channels |
| Skills and MCP | Inspect and enable skills, manage skill packs, marketplace installation and MCP server configuration | Settings → Skills |
| Structured documents | Manage research tables, slide outlines, revisions and exports with the VerseConf plugin | Agent tools and artifact panel after plugin activation |
| Diagnostics and recovery | Inspect session activity, processes, traces, runtime status, storage usage and recovery actions | Workspace panel, Observability and Settings |

The interface supports English, Chinese, Japanese and Russian, with light, dark and system themes. Basic / Advanced in General settings controls diagnostic detail. Image generation and Dreams pages are also available after unlocking developer mode.

<a id="workflows"></a>

## Common workflows

### Complete a coding task in a project

Choose a workspace and model → describe the task and attach relevant files → inspect the plan and permission requests → follow tool execution → review changes and run validation in the workspace panel.

![AI-generated concept illustration using the project’s flame logo: task → workspace tools → review and verification. It is not an app screenshot or a promise that verification passes automatically.](resources/readme/2026-10-05/workflow.webp)

*AI-generated concept illustration using the project’s flame logo: task → workspace tools → review and verification. It is not an app screenshot or a promise that verification passes automatically.*

The panel supports file, terminal, browser, review, artifact and activity tabs. Terminals can sit beside or below the conversation. The browser opens local previews or web pages, while the review surface brings together Git changes and related actions. Session activity shows run and command status.

The permission selector includes Read-only, Plan, Accept edits and Full access. Plan mode restricts user-file changes, while runtime metadata may still be written. See [workspace permission semantics](docs/clawx-product-semantics.md) for the precise boundary.

### Turn conversations and source material into knowledge

Choose a knowledge scope and references in Chat → search sources in Library → inspect Inbox items, drafts and proposals in Review Queue → check their evidence and changes → apply through the governed review path.

![AI-generated concept illustration: sources → drafts → review → project knowledge. Reading knowledge and applying changes require different authority.](resources/readme/2026-10-05/knowledge.webp)

*AI-generated concept illustration: sources → drafts → review → project knowledge. Reading knowledge and applying changes require different authority.*

Wiki operations require the loaded `memory-wiki` extension. The page is accessible without it, but status, search and apply operations require the plugin and vault to be ready. See [knowledge and plugin boundaries](docs/architecture-overview.md#knowledge-plugins-and-data).

Knowledge read scope and write permission are managed separately. Selecting Memory, Wiki or a reference does not authorize automatic writeback. The review surface keeps the relationship between sources, drafts, proposals and application results visible.

### Move from collaboration to task execution

Ordinary Chat handles immediate collaboration. Task Ledger stores goals, task nodes, checkpoints and evidence facts. Task Loop is an explicitly started, constrained execution flow. Chat can suggest an upgrade without automatically becoming a Task Loop.

ClawGraph loads workspace YAML workflows and displays compilation diagnostics, node state, events and review items. Runtime Workboard owns scheduling separately from the user-facing Task Ledger. See [agent orchestration](docs/multi-agent-orchestration/README.md) and [concept boundaries](docs/clawx-product-semantics.md).

### Manage structured artifacts

The optional `verseconf-artifacts` plugin provides creation, inspection, revision, record ordering, history restoration and export tools. Research tables export to CSV / XLSX, slide outlines to PPTX, and content to Markdown. The artifact panel shows managed revisions, history and outputs.

The plugin is **disabled by default** and requires explicit configuration. PPTX currently uses a three-slide template: outlines with more than three records are rejected, with Markdown available to preserve the full outline. Arbitrary slide counts and long-text layout are not covered. See the [VerseConf integration notes](docs/dev/verseconf-clawx-implementation-20261001.md) for configuration, delivery and validation details.

### Experimental feature boundaries

Context management (DCS), token budgeting (VToken), experience knowledge (SEKB), Runtime Memory and browser automation have separate configuration, approval or rollout gates. Diagnostic or shadow data does not mean a feature affects model context, automatic writeback or routing. Installing the application does not activate every enhancement.

Consult the [capability matrix](shared/capability-claims.ts), [default configuration matrix](docs/dev/default-config-matrix.md) and feature-specific validation records. Scripted or agent-executed acceptance simulations must be labeled as agent-driven. Focused test success does not establish release acceptance for the entire product or every platform.

<a id="getting-started"></a>

## Getting started

### Run from source

Prerequisites:

- **Node.js 24.16.0 or later in the 24.x line** and Git. Earlier Windows Node 24 releases can crash in TCP connections ([upstream fix](https://github.com/nodejs/node/issues/63620)).
- **pnpm 11.2.2**, pinned in [package.json](package.json); Corepack can activate it.
- Repository access and network access for dependencies, Electron, uv and agent-browser.
- Authentication for online model providers, or a running compatible service for local models.

Run from the repository root:

```sh
git clone https://github.com/Baixu22/VerseClaw.git
cd VerseClaw
corepack enable
corepack prepare pnpm@11.2.2 --activate
pnpm run init
pnpm --dir openclaw_runtime install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm dev
```

If your Node.js installation does not include Corepack, install pnpm 11.2.2 separately and continue from `pnpm run init`.

`init` installs desktop workspace dependencies and downloads uv and agent-browser. The OpenClaw runtime has a separate dependency workspace and needs its own installation. Electron's binary installation is explicit because the dependency script policy disables its automatic install script.

`pnpm dev` generates the extension bridge, builds the runtime and prepares bundled skills before starting Vite and Electron. The first launch includes that build work; Gateway also needs time to become ready after the app opens. A Vite web page alone does not provide the full Electron host services.

### First session

1. Complete the setup wizard, then configure an account and model in Settings → Models & Providers and check connectivity.
2. Choose a project folder and confirm the workspace and permission mode.
3. Start a conversation with a scoped task, attaching files or knowledge references as needed.
4. Open the workspace panel from the chat toolbar to inspect files, terminal output, browser previews and changes.
5. Handle pending requests in Inbox; use Knowledge when you want to retain project material.
6. Configure Skills / MCP, channels and scheduled tasks as needed.

App navigation and many local tests do not require paid model calls. Remote models, services and channels have their own authentication, network and billing requirements.

### Packages and platforms

Available distributions are the versions actually published in [this repository's Releases](https://github.com/Baixu22/VerseClaw/releases). The source configures these packaging targets:

| Platform | Configured artifacts | Current scope |
| --- | --- | --- |
| Windows x64 | NSIS installer | Primary local controlled-workflow acceptance platform |
| macOS x64 / arm64 | DMG, ZIP | Build targets exist; capabilities require platform-specific validation |
| Linux x64 / arm64 | AppImage, DEB; RPM for x64 | Build targets exist; desktop execution needs a graphical environment |

A build target does not guarantee a downloadable package for a particular version. Source development builds do not check for packaged updates; packaged updates depend on the configured release feed. Native VerseShell components and complete packaging have additional [source and toolchain requirements](resources/verseshell/SOURCE.md).

<a id="configuration"></a>

## Configuration and local data

| Settings area | Contents |
| --- | --- |
| Models & Providers / Agents | Accounts, models, fallback rules, roles and channel bindings |
| Skills / Channels / Browser | Skills, MCP, channel accounts, browser profiles and credentials |
| General | Theme, language, startup options and interface detail |
| System & Runtime / Developer | Gateway, runtime, proxy, CLI, Doctor and Agent Dev Workbench |
| Billing | Local token history, estimated costs and activity |
| Storage & Memory / Archived / Sessions & Recovery | Storage scanning and cleanup, archive restoration, session state and recovery settings |

No separate database server is required. App settings use local storage; runtime subsystems use configuration files, JSONL transcripts and SQLite state databases.

- OpenClaw's default configuration directory is `~/.openclaw` (`.openclaw` under the Windows user home), with `openclaw.json` as its main configuration. Desktop path resolution supports the `OPENCLAW_CONFIG_DIR` override.
- Desktop data lives in Electron's `userData` directory, with app logs under `logs/`. See [electron/utils/paths.ts](electron/utils/paths.ts).
- Token history aggregates structured usage records from local sessions. Costs are estimates. Permanently deleting a conversation removes its contribution to history; archive it when you want to retain that history.
- Local storage does not imply offline execution: content submitted to online models or external tools reaches those services. Keep credentials, private transcripts and raw logs out of commits and public issue reports.

<a id="architecture"></a>

## Architecture and repository layout

![Desktop, Host and runtime architecture](resources/readme/2026-10-05/architecture.svg)

[Mermaid source](resources/readme/2026-10-05/architecture.mmd) · [Chat sequence](resources/readme/2026-10-05/chat-sequence.svg)

The current request path is **React → typed host facade → preload IPC → Electron Main**. Runtime-bound services then call Gateway through the Main-owned WebSocket RPC connection. Local file and terminal services need not traverse Gateway. Events return through Main/preload and `host-events.ts` to update UI stores.

Renderer requests enter through `src/lib/host-api.ts` and `src/lib/host-api-client.ts`. These boundaries are not one universal “WS → HTTP → IPC fallback”. The [architecture guide](docs/architecture-overview.md) maps the source, traces a chat turn and explains task, knowledge, plugin and local-data ownership.

| Path | Purpose |
| --- | --- |
| `src/` | React pages, components, state and renderer API facade |
| `electron/` | Desktop lifecycle, host services, Gateway and process supervision |
| `shared/` | Typed contracts, four-language locales, scenario registry and capabilities |
| `openclaw_runtime/` | Runtime and plugin sources in a separate dependency workspace |
| `harness/` | Specification CLI, scenarios, rules, tasks and layer conventions |
| `tests/` | Desktop unit, integration and Electron E2E tests |
| `scripts/` | Build, resource synchronization, validation and evidence scripts |
| `resources/` | Bundled skills, binaries and third-party source notices |
| `docs/` | Product semantics, designs, development guides and runbooks |
| `artifacts/` | Curated evidence and locally generated reports; retention rules determine what is tracked |

<a id="development"></a>

## Development and validation

### Common commands

Run these from the repository root. [package.json](package.json) contains their complete definitions.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Prepare runtime/resources and start the development app |
| `pnpm run build:vite` | Build renderer and Electron bundles; does not rebuild OpenClaw |
| `pnpm run build:runtime` | Build the embedded runtime and run the Gateway startup smoke check |
| `pnpm run typecheck` | Full node, web and test type checks; all three must pass |
| `pnpm run lint:check` | Run lint without automatic fixes; `pnpm run lint` modifies files |
| `pnpm exec vitest run tests/unit/rc10-evidence.test.ts` | Run a specific desktop test file |
| `pnpm test` | Desktop tests, selected DCS/runtime regressions and maturity registry checks |
| `pnpm run test:integration` | Run the configured integration test group |
| `pnpm run test:e2e` | Build the app and run Electron E2E |
| `pnpm run test:e2e:run` | Run Electron E2E against an existing app build; the runtime must still be fresh |
| `pnpm contract:check` / `pnpm i18n:lint` | Check host API contracts and four-language coverage |
| `pnpm run harness:ci` | Run the repository's Harness CI baseline |
| `pnpm repo:artifacts:check` | Check source, curated evidence and local archive boundaries |
| `pnpm run package:win` / `pnpm run package:mac` / `pnpm run package:linux` | Prepare target-platform resources and produce packages without publishing |

Root `pnpm test` does not run every OpenClaw test. For runtime changes, select the relevant tests and type gates from its [package.json](openclaw_runtime/package.json) and the task specification. Windows Electron E2E must run under Windows Node.

**LoCoMo developer evaluation:** `pnpm eval:runtime-memory:locomo:full500` explicitly runs 500 questions and fails when model/embedding credentials or verified output are missing. It is separate from the default unit gate; historical aggregate fixtures are not accepted memory baselines. See the [measurement and evidence boundary](docs/dev/p0-memory-evaluation-integrity.md).

### Select validation for the change

- **Task specifications:** run `pnpm harness context --spec <task-spec>` first, then `pnpm harness validate --spec <task-spec>` after implementation. Inspect the selected flow with `pnpm harness run --spec <task-spec> --dry-run`.
- **UI:** update the relevant Electron E2E. Cover en / zh / ja / ru strings and follow [globals.css](src/styles/globals.css) for styling.
- **Communication:** changes to renderer, Main, Gateway, send/receive or fallback paths also require `pnpm run comms:replay` and `pnpm run comms:compare`.
- **Builds and packaging:** satisfy runtime freshness and native resource contracts before checking platform artifacts. Record build success and installation acceptance separately.

### Agent Dev tooling

Agent Dev Workbench in Settings → Developer provides scenario recording, contract and diagnostic entry points. Generate its offline report with `pnpm agent-dev:workbench`.

| Command | Scope |
| --- | --- |
| `pnpm agent-dev:make <page\|e2e\|host-route\|skill\|channel\|plugin\|scenario> <name>` | Scaffold artifacts using existing development conventions |
| `pnpm agent-dev:fast` | Contracts, i18n, prompt quality, Workbench and focused unit tests |
| `pnpm agent-dev:deep-test:reuse` | Reuse a fresh build with cached typechecking and Workbench smoke E2E |
| `pnpm agent-dev:deep-test` | Full Agent Dev diagnostics and timing with a fresh build |
| `pnpm agent-dev:audit` | Strict maturity audit of the available evidence |

Daily reports list outstanding full gates under `decision.requiredFullGates`. Agent Dev results cover that toolchain. Sandbox, effect-log and cost-correlation reports do not replace validation of actual runtime effects. See the [Agent Dev control plane](docs/agent-dev-control-plane.md).

<a id="troubleshooting"></a>

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Knowledge shows `unknown method: wiki.status` | Check that `memory-wiki` is enabled and loaded, then initialize the vault. Gateway readiness alone is insufficient |
| Wrong pnpm version or failed dependency installation | Check Node.js 24, pinned pnpm and dependencies in both workspaces; retain lockfiles |
| Missing Electron executable | Run `node node_modules/electron/install.js` from the root and check download connectivity |
| Gateway stays unavailable | Inspect Settings → System & Runtime and logs; run Doctor in Developer settings before considering Doctor Fix |
| Provider or channel unavailable | Check authentication, model, enabled plugins, channel accounts and proxy; saving configuration does not prove request or delivery success |
| Tools cannot write or an operation is blocked | Check the workspace, permission mode and approval requests in Inbox |
| E2E reports a stale runtime | Run `pnpm run build:runtime`; rebuild `build:vite` if app sources changed too; retain freshness checks |
| Electron fails on headless Linux | Provide a display server, for example `xvfb-run -a pnpm run test:e2e` |
| VerseConf tools or export unavailable | Check plugin activation/configuration; use Markdown for outlines with more than three records |

<a id="documentation"></a>

## Documentation

| Topic | Entry points |
| --- | --- |
| Current architecture and documentation checks | [Architecture guide](docs/architecture-overview.md) · [Visual provenance](resources/readme/2026-10-05/README.md) |
| Product behavior, concepts and capability scope | [Product semantics](docs/clawx-product-semantics.md) · [Capability matrix](shared/capability-claims.ts) · [Default configuration](docs/dev/default-config-matrix.md) |
| Knowledge, memory and context | [Knowledge system](docs/enhancements/knowledge-persistence/README.md) · [Context Runtime Kit](docs/context-runtime-kit/README.md) |
| Agents and workflows | [Orchestration](docs/multi-agent-orchestration/README.md) · [Role packs](docs/role-packs.md) |
| Structured documents | [VerseConf integration](docs/dev/verseconf-clawx-implementation-20261001.md) |
| Engineering rules and continuity | [AGENTS.md](AGENTS.md) · [Development playbook](docs/dev/Sustained-Development-Playbook.md) · [Agent Dev](docs/agent-dev-control-plane.md) |
| Runtime and acceptance | [Runtime convergence](docs/dev/unified-agent-system/runtime-convergence/README.md) · [RC-09/RC-10 evidence boundaries](docs/dev/windows-alpha-closeout-20261008.md) |
| Resources, archival and source recovery | [Retention policy](docs/dev/repository-artifact-retention.md) · [VerseShell source contract](resources/verseshell/SOURCE.md) |

Design plans and older acceptance snapshots have their own scope and dates. Current entry points are established by source and corresponding fresh evidence. Local Task Forest history, session handoffs and temporary logs are not prerequisites for a fresh checkout.

## Contributing and license

Keep changes scoped, provide relevant validation and update all four READMEs when behavior changes. Follow [AGENTS.md](AGENTS.md) for API, i18n, specifications and evidence requirements. Track source, reusable fixtures and curated final evidence together; retain private task history and raw generated logs locally.

Verse Claw builds on [OpenClaw](https://github.com/openclaw/openclaw) and the ClawX work by the ValueCell team. The repository uses the [MIT license](LICENSE). Bundled components retain their own licenses and source obligations, including the [VerseShell notices](resources/verseshell/SOURCE.md).

### Coding diagnostic logs

With runtime `diagnostics.enabled` explicitly set to `true`, the existing diagnostic logger reports sustained high approval-required **classification** rates and their recovery. These are tool-tier classifications, not counts of actual dialogs or human approvals; missing/expired windows are unavailable. The monitor is off when the setting is omitted or false and never changes approval or tool execution policy.
