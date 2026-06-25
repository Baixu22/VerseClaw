# Verse Claw 脳 openclaw_runtime Design Overview

> Scope: A complete walk-through of the Verse Claw desktop app and the OpenClaw runtime it ships with, as of 2026-06-25.
> Sandbox update: section 7.1 documents the Verse Claw lightweight layered sandbox control model implemented on 2026-06-17.
> Basis: codegraph index (10,026 files / 158,358 nodes / 470,892 edges) + source review of `electron/`, `src/`, `shared/`, `openclaw_runtime/src/`, and `openclaw_runtime/extensions/`. Updated with role-first runtime architecture (section 11), Lightweight Subagent Runner (sections 11.2 / 11.13), ClawGraph Runtime v1 (section 11.15), the long-task stability stack (section 8.5.3), Human Intervention / Resume Control (section 8.5.4), Mission Control / Mission Loop MVP+ (section 8.5.5), Knowledge Hub role-first governance (section 8.6), Chat slimming and legacy Work Mode compatibility (section 8.7), Work Provider v1 Office/Search orchestration (section 8.7), Task Ledger chat projection + explicit `/loop` root contract (section 8.5.0 - 2026-06-24), and runtime-level Agent Browser automation for Cron-driven web tasks (section 6.6 - 2026-06-25).

---

## 1. Goals and Non-Goals

### 1.1 What the project is

Verse Claw is a **cross-platform Electron desktop app** (React 19 + Vite + TypeScript) that provides a GUI for the **OpenClaw AI agent runtime**. The two layers are co-located in one repository but follow a hard client / server split:

- **Verse Claw** owns the desktop shell, OS integration, UI, settings, theming, and per-machine engineering concerns.
- **openclaw_runtime** is a headless Node gateway that owns AI business logic: agents, channels, model providers, memory, skills, cron, observability, and a 136-extension plugin ecosystem.
- **Agent Browser** is a runtime-level, agent-facing browser execution environment. It exposes a controlled `agent_browser` tool and Main-owned managed browser/profile/authState bridge so isolated agent turns can perform web check-in, page monitoring, draft publishing, and error inspection without turning Verse Claw into a human browser product.
- The runtime also owns the bounded **task loop** control layer: `task_loop.run/status`, role subagent orchestration, self-check review, scoped repair rounds, `LoopContextPack` recovery context, lifecycle broadcasts, observability trace evidence, and Task Ledger root-bound persistence for explicit `/loop` runs.
- **Engineering Control Signals** are the internal long-conversation constraint contract shared by ResumeCheckpoint, Task Loop, Mission Loop, and Task Ledger metadata. They make `evidence_gap`, `validation_missing`, `scope_drift`, `unverified_claim`, and `replan_required` explicit without adding a new prompt system, rule directory, or parallel progress source.
- **Lightweight Subagent Runner** is a Verse Claw UI wrapper over role-first orchestration for common no-YAML workflows. It lets users launch Explorer, Reviewer, Tester, and Compare 3 approaches presets from Agents -> Roles & Orchestration, using explicit role workers through the existing Gateway permission path, then displays goal, roles, live status, failures, summary, and Observability trace evidence.
- **Verse Claw Mission Control / Mission Loop** is the MVP+ outer long-goal control layer above the bounded task loop. It binds user goals to persisted Mission state, Task Ledger evidence, ResumeCheckpoint continuation, Context Pack budgets, reviewer decisions, lifecycle events, observability traces, and governed memory proposals. Manual Missions start from the Agents panel, `mission.*` Gateway RPCs, or the lead-only `mission_loop` tool; scheduled ticks are explicit opt-in triggers, not completion truth.
- **ClawGraph Runtime** is the workspace YAML orchestration layer for long tasks that should not live inside one giant chat transcript. It compiles `.clawx/clawgraph/*.yaml` workflow specs into an IR, schedules stateless role workers as DAG nodes, requires structured handoffs, audits evidence, and freezes uncertain results for review.
- **Task Ledger** is a Verse Claw-owned, workspace-scoped control layer for long-running work state. It records goals, subtasks, dependencies, blockers, review nodes, decisions, deviations, and session links without replacing runtime memory, observability traces, or chat transcripts.
- **Knowledge Hub** is a Verse Claw-owned product layer over OpenClaw `memory-wiki` / `memory-core`. It gives users an inspectable, role-governed wiki workflow for source-backed local knowledge and local-folder OKF import compatibility without introducing a separate RAG stack, vector database, Google service dependency, or Obsidian dependency; agents read by scope, while writes pass through user-reviewed drafts/proposals.
- **Chat intensity and legacy Work Mode compatibility** replace the old user-facing Chat Work Mode layer. Current Chat uses explicit reasoning/effort, context/response intensity, Knowledge Scope, and optional task-node context as per-send preferences. Legacy Work Mode types, locale keys, and tests may remain for migration/internal compatibility only; they must not drive permissions, tool access, Task Ledger state, Knowledge writes, `/loop`, Mission, ClawGraph, or runtime policy. Work Provider v1 remains a Main-owned `workProviders` host API for lightweight Office/Search execution and validation, independent of legacy Work Mode.
- **A2A adaptation** is tracked as a future interoperability edge for agent-to-agent collaboration, complementary to MCP and bounded by role-first governance, Task Ledger evidence, ClawGraph review gates, and Knowledge Hub confirmation. See `docs/a2a-adaptation-plan.md`.

### 1.2 Non-goals

- Verse Claw is **not** an AI engine. It does not call model APIs directly; it goes through the runtime.
- openclaw_runtime is **not** a UI. It only ships a control-plane Web view (mostly for onboarding) and exposes JSON-RPC for any client.
- Agent Browser is **not** a general-purpose browser, Chrome replacement, visual RPA builder, DevTools UI, download manager, bookmark/history surface, or profile-management product. Its UI contract is task intent, login-state reference, run result, and failure evidence only.
- The two layers share no in-process state; they are independent processes that happen to live in one repo.
- ClawGraph is **not** a drag-and-drop workflow editor, a container orchestrator, or a replacement for role contracts, workspace permissions, sandbox policy, Task Ledger, or observability traces.
- Knowledge Hub is **not** a new Verse Claw-native knowledge graph, an Obsidian clone, or an autonomous agent writer. It does not replace role memory, Task Ledger, transcripts, or runtime memory governance.
- Legacy Work Mode data is **not** a current Chat control, permission mode, tool allow/deny rule, runtime policy switch, `/loop` trigger, Task Ledger source of truth, or Knowledge write path.

---

## 2. Repository Layout

```
.
鈹溾攢鈹€ electron/                 # Verse Claw main process + services + native bridge
鈹?  鈹溾攢鈹€ main/                 # window, menu, tray, updater, traffic-light, ipc-handlers
鈹?  鈹溾攢鈹€ preload/              # contextBridge surface exposed as window.electronAPI
鈹?  鈹溾攢鈹€ services/             # 34 host-api service modules (gateway-api, agents-api, knowledge-api, task-ledger-api, clawgraph-api, 鈥?
鈹?  鈹溾攢鈹€ gateway/              # 29 files: runtime child-process manager (WS/HTTP/IPC fallback)
鈹?  鈹溾攢鈹€ extensions/           # Main-process extension registry
鈹?  鈹溾攢鈹€ utils/                # store, logger, telemetry, secure-storage, token-usage, 鈥?
鈹?  鈹斺攢鈹€ utils/                # native bindings (keychain, browser, etc.)
鈹?
鈹溾攢鈹€ src/                      # Verse Claw renderer (React 19 + Vite)
鈹?  鈹溾攢鈹€ pages/                # /chat, /knowledge, /agents, /channels, /skills, /cron, /models, /task-ledger, /dreams, /observability, /image-generation, /settings, /setup
鈹?  鈹溾攢鈹€ components/           # layout, file-preview, agents, channels, settings, topics, ui, update
鈹?  鈹溾攢鈹€ stores/               # zustand stores (chat, agents, gateway, mcp, providers, skills, 鈥?
鈹?  鈹溾攢鈹€ lib/                  # host-api.ts (renderer entry), api-client, host-events, helpers
鈹?  鈹溾攢鈹€ extensions/           # Renderer-side extension framework
鈹?  鈹溾攢鈹€ styles/globals.css    # design tokens + component conventions
鈹?  鈹溾攢鈹€ i18n/                 # react-i18next bootstrap
鈹?  鈹斺攢鈹€ App.tsx / main.tsx    # HashRouter root
鈹?
鈹溾攢鈹€ shared/                   # Type contracts shared between main and renderer
鈹?  鈹溾攢鈹€ host-api/             # host-api contract (modules + actions)
鈹?  鈹溾攢鈹€ host-events/          # push-event contract
鈹?  鈹溾攢鈹€ types/                # Agent, Channel, Cron, Gateway, MCP, Sandbox, Skill, Workspace, Team, Memory, Knowledge, Observability, TaskLedger
鈹?  鈹溾攢鈹€ chat/                 # RawMessage
鈹?  鈹溾攢鈹€ i18n/locales/         # en, zh, ja, ru
鈹?  鈹斺攢鈹€ 鈥?
鈹?
鈹溾攢鈹€ openclaw_runtime/         # The AI gateway
鈹?  鈹溾攢鈹€ src/                  # 4,333 files, 60+ sub-domains
鈹?  鈹溾攢鈹€ extensions/           # 136 bundled extensions (channels, providers, TTS, image, search, 鈥?
鈹?  鈹溾攢鈹€ docs/                 # template bundles
鈹?  鈹斺攢鈹€ package.json
鈹?
鈹溾攢鈹€ scripts/                  # bundled-uv download, build helpers
鈹溾攢鈹€ harness/                  # task spec validation (pnpm harness 鈥?
鈹溾攢鈹€ docs/                     # design / plan documents (this file lives here)
鈹溾攢鈹€ package.json              # pnpm@10.33.4, scripts: dev, build:vite, lint, typecheck, test, test:e2e, comms:*
鈹斺攢鈹€ AGENTS.md                 # workspace rules (this is also a hard contract)
```

---

## 3. Layered Architecture

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? Verse Claw Renderer (React 19, HashRouter)                               鈹?
鈹? 鈹€ pages, components, zustand stores, host-api-client                鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                鈹? hostApi.<module>.<action>(payload)                  鈹?
                鈻?
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? Preload (contextBridge)                                             鈹?
鈹? 鈹€ window.electronAPI.ipcRenderer.invoke('hostapi:invoke', 鈥?        鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                鈹? IPC (typed channels only)
                鈻?
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? Main Process (electron/main)                                        鈹?
鈹? 鈹€ ipc-handlers 鈫?host-service-registry 鈫?service modules            鈹?
鈹? 鈹€ services/* (34 host-api services) + extensions/registry           鈹?
鈹? 鈹€ gateway/manager (WS client + reconnect + capability monitor)     鈹?
鈹? 鈹€ utils/store (electron-store), secure-storage, telemetry           鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                鈹? child_process.spawn  +  WS / HTTP / IPC fallback
                鈻?
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? openclaw_runtime (Node, port 18789)                                 鈹?
鈹? 鈹€ gateway/server.ts (WS + HTTP + JSON-RPC dispatcher)               鈹?
鈹? 鈹€ 60+ sub-domains: agents, channels, mcp, skills, memory, talk, 鈥?  鈹?
鈹? 鈹€ plugin-sdk + plugins/ loader                                      鈹?
鈹? 鈹€ 136 bundled extensions                                            鈹?
鈹? 鈹€ SQLite via state/ + per-agent openclaw-agent.sqlite               鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

### 3.1 Hard rules (enforced by AGENTS.md)

- Renderer must go through `src/lib/host-api.ts` or `src/lib/api-client.ts`. **No direct** `window.electron.ipcRenderer.invoke(...)` in pages or components.
- Renderer must not call `http://127.0.0.1:18789/...` directly. Use the main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`).
- Transport policy is main-owned and fixed at **WS 鈫?HTTP 鈫?IPC fallback**. Renderer must not implement protocol switching.
- All user-facing strings go through `react-i18next` with full coverage in `en` / `zh` / `ja` / `ru`.
- Any user-visible UI change must include or update a Playwright E2E spec in the same PR.

---

## 4. Verse Claw Layer in Detail

### 4.1 Main-process responsibilities

| Concern | Files | Notes |
|---|---|---|
| App entry / lifecycle | `electron/main/index.ts` | single-instance, app events, signal-based exit |
| Window / title bar | `electron/main/window.ts`, `electron/main/traffic-light-layout.ts` | custom title bar, macOS traffic light positioning sync |
| Menu / shortcuts | `electron/main/menu.ts` | global accelerators, view, dev |
| Tray | `electron/main/tray.ts` | quick actions, status badge |
| Auto-update | `electron/main/updater.ts` | `electron-updater`, multi-channel (`alpha` / `beta` / `stable`), deferred-install policy |
| Proxy sync | `electron/main/proxy.ts` | configures main + runtime HTTP/HTTPS/SOCKS |
| IPC dispatch | `electron/main/ipc-handlers.ts` | single dispatcher registered via `ipcMain.handle` |
| Telemetry | `electron/utils/telemetry.ts` | PostHog node SDK, opt-in, scrub secrets |
| Logging | `electron/utils/logger.ts` | structured, dual sink (file + console) |
| Persistence | `electron/utils/store.ts` | `electron-store`, schema-validated |
| Secrets | `electron/utils/secure-storage.ts` | OS keychain, fallback encrypted file |
| Device identity | `electron/utils/device-identity.ts` | `loadOrCreateDeviceIdentity` signs the WS `connect.challenge` |
| Built-in downloads | `scripts/download-bundled-uv.mjs` etc. | uv, agent-browser, win node |
| ClawHub | `electron/gateway/clawhub.ts` | search / install / uninstall / open |

### 4.2 Service registry (35 modules)

The 35 host-api modules under `electron/services/` implement every host-api action declared in `shared/host-api/contract.ts`. They are loaded by `electron/main/ipc-handlers.ts` into a typed `HostServiceRegistry` whose shape is `Record<Module, Record<Action, Function>>`. Each module keeps its boundary narrow and can call runtime JSON-RPC, local persistence, OS APIs, or Verse Claw-owned helpers as needed:

| Module group | Modules |
|---|---|
| Desktop / OS | `app`, `shell`, `dialog`, `window`, `updates`, `uv` |
| Persistence / config | `settings`, `workspaces`, `files`, `git`, `projectRules` |
| Runtime control | `gateway`, `openclaw`, `logs`, `diagnostics`, `clawGraph` |
| Communication | `channels`, `agents`, `chat`, `sessions`, `topics`, `media`, `cron`, `mcp` |
| AI integration | `providers`, `skills`, `usage`, `observability`, `permissions`, `knowledge` |
| Workspace UX | `terminal`, `webPreview`, `sandbox`, `remoteControl` |

### 4.3 Gateway manager (the runtime child process)

Located under `electron/gateway/`, this is a full-featured process supervisor:

- `manager.ts` 鈥?top-level `GatewayManager` (singleton), `EventEmitter` for state changes.
- `process-launcher.ts` 鈥?`spawn` openclaw child process, environment, `OPENCLAW_*` flags.
- `supervisor.ts` 鈥?find existing process, doctor repair, port-free wait, launchctl cleanup, Python sidecar warmup.
- `ws-client.ts` 鈥?connect WS, exponential backoff, frame codec.
- `request-store.ts` 鈥?pending request id 鈫?resolver, with timeout and reject-on-disconnect.
- `event-dispatch.ts` 鈥?maps `GATEWAY_EVENTS` to renderer push channels.
- `state.ts` / `lifecycle-controller.ts` / `restart-controller.ts` / `restart-governor.ts` 鈥?state machine and restart policy.
- `connection-monitor.ts` 鈥?heartbeat, last-RPC-success, channel-status freshness.
- `capability-monitor.ts` 鈥?runtime capability snapshot (which gateway methods are available right now).
- `startup-stderr.ts` 鈥?classify stderr lines for actionable error messages.
- `startup-orchestrator.ts` 鈥?composes the whole startup sequence.
- `reload-policy.ts` / `process-policy.ts` 鈥?reload and reconnect policies.
- `config-sync.ts` 鈥?writes Verse Claw-managed config keys into runtime config dir.
- `ws-trace.ts` 鈥?optional frame tracing for debugging.

The transport is **fixed** at `WS 鈫?HTTP 鈫?IPC fallback`. Renderer does not select.

### 4.4 Preload bridge

`electron/preload/index.ts` whitelists a strict set of IPC channels and re-exposes them as `window.electronAPI.ipcRenderer.invoke/on`. Any unknown channel throws. This is the *only* renderer-visible native surface.

### 4.5 Renderer (React 19)

- **Routing**: `HashRouter` (Electron file:// friendly), pages in `src/pages/`.
- **State**: per-domain zustand stores under `src/stores/`. `src/stores/chat` is split into 20 sub-modules (`runtime-actions`, `history-transcript-merge`, `session-actions`, etc.) to keep the main chat slice manageable.
- **Layout**: `src/components/layout/MainLayout.tsx` with sidebar, top-bar, content; `TitleBar.tsx` integrates with custom title bar; `use-new-chat-action.ts` for global hotkey.
- **File preview**: `src/components/file-preview/*` supports Markdown, Monaco editor/diff, image, PDF, Sheet, HTML preview, and a "workspace browser" body that ties terminal + web preview + file tree together.
- **Settings**: page-driven, with a dedicated `ProvidersSettings`, `ImageGenerationSettings`, `UpdateSettings`; System & Runtime includes Project Rules Center for inspecting active-workspace `AGENTS.md`, `.clawx/rules/*.md`, deterministic rule lint, and conservative missing-template creation through `hostApi.projectRules` without adding a new source of truth.
- **Agents / Channels / Cron / Skills / Models / Knowledge / TaskLedger / ClawGraph / Dreams / Observability / ImageGeneration**: each is a first-class page backed by a zustand store or typed host-api snapshot.
- **Knowledge**: `/knowledge` wraps `hostApi.knowledge.*` for wiki status, initialization, bounded file/folder import, OKF validation/import, search, inspect, compile, lint, vault open, and governed draft/proposal review. In Chat, users get wiki context through a Codex-style Context Palette (triggered by a `/` button or typing `/` at a blank composer): `/wiki <query>` searches wiki pages and attaches explicit references as visible chips, while `/memory`, `/all`, `/none`, and `/scope` adjust read-only knowledge scope. Selected references are sent as read-only `knowledgeReferences` in the chat payload; no write or apply capability is granted through these commands.
- **ClawGraph**: `/clawgraph` wraps `hostApi.clawGraph.*` for workspace workflow listing, compile diagnostics, run/status/events, abort, and review decisions. Renderer code never reads `.clawx/clawgraph/*.yaml` directly.
- **Topics**: `TopicManager` + `TopicSelector` for per-session topic memory.
- **Task Ledger summary**: `src/components/task-ledger/TaskLedgerSummaryPanel.tsx` shows current goal, active work, blockers, review queue, and recent decisions beside Chat when the workspace has tracked long-running tasks.
- **UI primitives**: `src/components/ui/*` (button, card, dialog, sheet, tabs, tooltip, 鈥? styled to the design tokens in `src/styles/globals.css`.
- **i18n**: `src/i18n/index.ts` boots `react-i18next` against `shared/i18n/locales/{en,zh,ja,ru}/*`.

### 4.6 Design system

`src/styles/globals.css` defines the design tokens and the substitution table:

- Surfaces: `bg-surface-modal`, `bg-surface-input`
- Selected state: `bg-black/5 dark:bg-white/10`
- Status colors: `text-X-700 dark:text-X-400`
- Page H1/H2: `font-serif font-normal tracking-tight`
- See the *Component conventions* block in the file for the full substitution table.

### 4.7 Renderer extension framework

`src/extensions/` provides a lightweight host-api extension framework on the renderer side, mirroring the main-side one. A renderer extension can:

- Register additional host-api modules / actions (compiled via `_ext-bridge.generated.ts`).
- Subscribe to host events.
- Inject React components / routes via a host-api contract.

### 4.8 Verse Claw extension framework (main side)

`electron/extensions/registry.ts` plus `electron/extensions/types.ts` define three extension kinds:

- `MarketplaceProviderExtension` 鈥?search / install skills (ClawHub-compatible).
- `HostApiProviderExtension` 鈥?contributes host-api modules / actions to the registry.
- `AuthProviderExtension` 鈥?provider-level auth flow (status, startup hook).

Extensions are loaded on app boot and may register/unregister contributions at runtime.

### 4.9 Token usage history

The dashboard chart does **not** parse console logs. It reads OpenClaw session transcript `.jsonl` files under the local OpenClaw config directory:

- Scans both configured agents and any runtime agent directories found on disk.
- Treats normal, `<id>.deleted.jsonl`, and `<id>.jsonl.reset.*` transcripts as valid history sources.
- Extracts assistant/tool usage records with `message.usage` and aggregates `input` / `output` / `cache` / `total` tokens and cost.

Hard-delete behavior: `Delete conversation` unlinks `<id>.jsonl`, `<id>.deleted.jsonl`, `<id>.jsonl.reset.*`, **and** the trajectory artifacts (`<id>.trajectory.jsonl` flight recorder + `<id>.trajectory-path.json` pointer). If the trajectory pointer references a runtime file outside `sessions/` (the `OPENCLAW_TRAJECTORY_DIR` override), that off-disk file is unlinked too.

---

## 5. openclaw_runtime Layer in Detail

### 5.1 Process and entry

- CLI: `openclaw_runtime/src/entry.ts` 鈥?`startGatewayServer(port, { bind, auth, deferStartupSidecars })`. Default `127.0.0.1:18789`, supports `loopback` / `LAN` binds.
- Library: `openclaw_runtime/src/library.ts` exports embedding helpers (`getReplyFromConfig`, `runExec`, `runCommandWithTimeout`, `monitorWebChannel`, `ensureBinary`, `loadConfig`, `applyTemplate`, session helpers, 鈥?. Verse Claw itself embeds the runtime both as a subprocess and as a library.
- Legacy surface: `openclaw/extension-api` (deprecated, redirects to `openclaw/plugin-sdk/*`).

### 5.2 Sub-domains (`openclaw_runtime/src/*`)

60+ top-level modules. Highlights:

| Module | Purpose |
|---|---|
| `gateway/` | JSON-RPC dispatcher, WS + HTTP transports, auth scopes, control-plane write throttling, OpenResponses + MCP-over-HTTP + OpenAI-compatible endpoints, control UI, OpenAPI surface |
| `agents/` | Multi-agent lifecycle, embedded runner, ACP control-plane, agent directory, boot, auth discovery, bundled MCP runtime, ACP overlay, session spawn |
| `channels/` | Core channel message/route/binding/status/reconciliation. Built-in channel plugins in `src/channels/plugins/*` |
| `mcp/` | MCP server sidecar + registry |
| `memory/` + `memory-host-sdk/` | Long/short-term memory, multimodal, embeddings, QMD engine, state |
| `skills/` | Skills runtime types |
| `tools/` | Tool call contracts + `AnyAgentTool` registration, including `agent-browser-tool.ts` and Agent Browser automation telemetry |
| `cron/` | Cron scheduler (store / service / run-log / stagger) plus browser automation run-result summarization |
| `tts/`, `image-generation/`, `media-generation/`, `media-understanding/`, `music-generation/`, `video-generation/` | Multimodal provider families |
| `talk/`, `realtime-transcription/`, `transcripts/` | Realtime voice + transcription provider families |
| `model-catalog/`, `provider-runtime/` | Model catalog + provider auth/catalog/transport decoration (stream wrappers, replay policy, tool schema compat) |
| `acp/` | Agent Client Protocol server + translator |
| `pairing/` | Node / device pairing + approval |
| `web/`, `web-fetch/`, `web-search/` | Built-in HTTP proxy, content fetch, search abstraction |
| `config/`, `secrets/`, `security/` | Config I/O, secret application, security audit finding types |
| `state/` | Global SQLite (`openclaw.sqlite`) + per-agent `agents/<id>/agent/openclaw-agent.sqlite` |
| `observability/` | Observability 鈥?trace writer/reader, dashboard data |
| `tasks/`, `commitments/`, `routing/`, `bindings/` | Tasks / commitments / routing / bindings |
| `bootstrap/`, `daemon/`, `hooks/` | Startup / daemon / hook loader |
| `proxy-capture/`, `node-host/`, `plugin-sdk/`, `plugins/`, `plugin-state/` | Plugin and host plumbing |
| `infra/`, `process/`, `llm/`, `logging/`, `utils/`, `shared/`, `types/`, `compat/`, `status/`, `interactive/`, `context-engine/`, `link-understanding/`, `cli/` | Common base |

### 5.3 Gateway JSON-RPC surface

Methods live in `openclaw_runtime/src/gateway/methods/core-descriptors.ts` + `server-aux-methods.ts` + each channel plugin's `gatewayMethods`. The full advertised set spans ~150+ core methods across:

- Health / diagnostics (`health`, `status`, `diagnostics.stability`, `logs.tail`, `last-heartbeat`, `set-heartbeats`)
- Memory doctor (`doctor.memory.*`)
- TTS (`tts.*`)
- Config (`config.get/set/apply/patch/schema/schema.lookup/openFile`)
- Approvals (`exec.approvals.*`, `exec.approval.*`, `plugin.approval.*`)
- Plugins (`plugins.uiDescriptors`, `plugins.sessionAction`)
- Wizard (`wizard.start/next/cancel/status`)
- Real-time voice (`talk.*`)
- Models (`models.list/authStatus/authLogout`)
- Tools (`tools.catalog/effective/invoke`)
- Tasks (`tasks.list/get/cancel`)
- Environments (`environments.list/status`)
- Agents (`agents.list/create/update/delete`, `agents.files.list/get/set`)
- Roles / teams / orchestrator (`roles.list/get`, `teams.list`, `orchestrator.plan/run`)
- Observability (`observability.reportTrace/traces`)
- Role memory governance (`memory.list/propose/update/archive/supersede/store/conflicts/resolveConflict/explainInjection/proposals/review/merge/versions/audit/stats`)
- Wiki knowledge (`wiki.status/init/ingest/search/get/compile/lint/apply`)
- Artifacts (`artifacts.list/get/download`)
- Skills (`skills.status/search/detail/securityVerdicts/skillCard`, `skills.bins`, `skills.upload.*`, `skills.install/update`, `skills.proposals.*`)
- Self-update (`update.status/run`)
- Voice-wake (`voicewake.*`)
- Secrets (`secrets.reload/resolve`)
- Sessions (`sessions.list/subscribe/unsubscribe`, `sessions.messages.subscribe/unsubscribe`, `sessions.preview/describe`, `sessions.compaction.*`, `sessions.create/send/abort/patch/pluginPatch/cleanup/reset/delete/compact/get/resolve/usage*`, `sessions.steer`)
- ClawGraph (`clawgraph.listWorkflows/compile/run/status/events/abort/review`)
- Heartbeat / wake (`wake`)
- Node / device pairing (`node.pair.*`, `device.pair.*`, `device.token.*`, `node.rename/list/describe`, `node.pluginSurface.refresh`, `node.pending.*`, `node.invoke/result/event`)
- Cron (`cron.*`)
- Channel control (`channels.status/start/stop/logout`)
- Gateway self (`gateway.identity.get`, `gateway.restart.preflight/request`, `system-presence`, `system-event`)
- Messaging (`message.action`, `send`, `agent`, `agent.identity.get`, `agent.wait`, `chat.*`)
- Push (`push.test`, `push.web.*`)
- Hidden / internal (`poll`, `sessions.steer`, `connect`, `nativeHook.invoke`, `web.login.start/wait`)

Events broadcast in-process (consumed by Verse Claw and any other client): `connect.challenge`, `agent`, `chat`, `session.message`, `session.operation`, `session.tool`, `sessions.changed`, `presence`, `tick`, `talk.mode`, `talk.event`, `shutdown`, `health`, `heartbeat`, `cron`, `clawgraph-lifecycle`, `node.pair.*`, `device.pair.*`, `voicewake.*`, `exec.approval.*`, `plugin.approval.*`, `update.available`, 鈥?

### 5.4 Plugin SDK

`openclaw_runtime/src/plugin-sdk/` is the public contract for plugin authors. Stable exports cover:

- Channels (`ChannelPlugin`, channel message action adapters, capabilities, account snapshot, status issues).
- Providers (`ProviderPlugin`, `UnifiedModelCatalogProviderPlugin`, `ProviderAuthContext/Result/PreparedRuntimeAuth`).
- Voice / transcription / talk (`SpeechProviderPlugin`, `RealtimeTranscriptionProviderPlugin`, `RealtimeVoiceBridge`).
- Multimodal (`MediaUnderstandingProviderPlugin`, `ImageGenerationProvider`, `MusicGenerationProvider`).
- Agent harness + CLI backend (`AgentHarness`, `CliBackendPlugin`).
- Diagnostic + security events (`DiagnosticEventPayload`/`Metadata`, `SecurityAuditFinding`).
- UI / session actions (`OpenClawControlUiDescriptor`, `PluginControlUiDescriptor`, `PluginSessionActionRegistration`).
- Services + commands + scheduler + heartbeat prompt + agent turn prepare + session extension registrations.
- Runtime interfaces (`OpenClawPluginApi`, `PluginLogger`, `RuntimeEnv`, model catalog types).

A new subpath barrel exists for narrow consumers (`openclaw/plugin-sdk/core`, `openclaw/plugin-sdk/<family>`) so plugins do not pull the whole barrel.

### 5.5 Bundled extensions (136)

By family (representative):

- **Channels (30+)**: `whatsapp`, `telegram`, `discord`, `feishu`, `slack`, `line`, `msteams`, `googlechat`, `google-meet`, `imessage`, `irc`, `matrix`, `mattermost`, `nextcloud-talk`, `signal`, `synology-chat`, `tlon`, `twitch`, `wechat`, `wecom`, `zalo`, `zalouser`, `qqbot`, `nostr`, `sms`, `voice-call`, `phone-control`, `webhooks`.
- **LLM / model providers (50+)**: `openai`, `anthropic`, `google`, `google-vertex`, `amazon-bedrock`, `azure-*`, `deepseek`, `qwen`, `moonshot`, `kimi-coding`, `mistral`, `ollama`, `litellm`, `lmstudio`, `openrouter`, `xai`, `groq`, `cerebras`, `chutes`, `byteplus`, `volcengine`, `alibaba`, `stepfun`, `gmi`, `huggingface`, `fireworks`, `fal`, `kilocode`, `arcee`, `sglang`, `vllm`, `novita`, `nvidia`, `opencode(-go)`, `copilot(-proxy)`, `github-copilot`, `codex(-supervisor)`, `minimax`, `venice`, `vercel-ai-gateway`, `cloudflare-ai-gateway`, `perplexity`, `voyage`, `xiaomi`, `zai`, `tencent`, `qianfan`, `clickclack`, `lobster`, `parallel`, `voyage`, 鈥?
- **Speech / TTS / ASR**: `elevenlabs`, `azure-speech`, `deepgram`, `gradium`, `inworld`, `senseaudio`, `talk-voice`, `tts-local-cli`, `microsoft(-foundry)`.
- **Image / video / music generation**: `image-generation-core`, `comfy`, `runway`, `fal`, `pixverse`, `video-generation-core`, music subsystems.
- **Search / fetch**: `brave`, `duckduckgo`, `exa`, `firecrawl`, `searxng`, `tavily`, `web-readability`, `document-extract`.
- **Memory**: `memory-core`, `memory-lancedb`, `memory-wiki`, `active-memory`.
- **Agent harness / CLI backend**: `codex`, `copilot`, `opencode(-go)`, `open-prose`, `thread-ownership`, `workboard`, `llm-task`, `acpx`, `oc-path`.
- **Diagnostics / observability**: `diagnostics-otel`, `diagnostics-prometheus`, `diffs`, `diffs-language-pack`.
- **Device / migration**: `device-pair`, `phone-control`, `migrate-claude`, `migrate-hermes`.
- **Misc**: `canvas`, `file-transfer`, `admin-http-rpc`, `bonjour`, `browser`, `qa-*`, `synthetic`, `tokenjuice`, `vydra`, `webhooks`, `policy`, `openshell`.

### 5.6 Persistence

- **SQLite only** (no raw SQL strings from app code, Kysely helpers, DDL/migration/low-level bootstrap are the only exceptions).
- Shared: `state/openclaw.sqlite`.
- Per-agent: `agents/<id>/agent/openclaw-agent.sqlite`.
- Session transcripts: `<id>.jsonl` (+ `<id>.deleted.jsonl`, `<id>.jsonl.reset.*`, `<id>.trajectory.jsonl`, `<id>.trajectory-path.json`).

### 5.7 Doctor / self-repair

`openclaw doctor --json` and `openclaw doctor --fix --yes --non-interactive` are exposed to the renderer through `app.openClawDoctor` (Verse Claw Settings 鈫?Advanced 鈫?Developer). The renderer never spawns the CLI directly.

---

## 6. Inter-layer Communication

### 6.1 host-api: invoke

```
Renderer
  hostApi.gateway.rpc('sessions.list', { 鈥?}, 10_000)
        鈹?
        鈻?
src/lib/host-api.ts 鈫?src/lib/api-client.ts
        鈹? window.electronAPI.ipcRenderer.invoke('hostapi:invoke', { id, module: 'gateway', action: 'rpc', payload })
        鈻?
electron/preload/index.ts (whitelisted channel)
        鈹? ipcMain.handle('hostapi:invoke', 鈥?
        鈻?
electron/main/ipc-handlers.ts 鈫?host-service-registry
        鈹? services/gateway-api.ts
        鈻?
electron/gateway/manager.ts (WS send)
        鈹? JSON-RPC over WS
        鈻?
openclaw_runtime gateway/server.ts dispatcher
```

### 6.2 host-events: push

Runtime broadcast events 鈫?`dispatchJsonRpcNotification` / `dispatchProtocolEvent` in `electron/gateway/event-dispatch.ts` 鈫?`ipcMain.emit` 鈫?preload whitelisted `on(...)` 鈫?`window.electronAPI.ipcRenderer.on('host-event:<name>', 鈥?` 鈫?`src/lib/host-events.ts` 鈫?zustand stores.

### 6.3 HTTP proxy

Some runtime endpoints are HTTP-only (MCP-over-HTTP, OpenAI-compat, OpenResponses, file downloads). Verse Claw exposes `hostapi:fetch` and `gateway:httpProxy` so the renderer never sees a cross-origin URL.

### 6.4 Knowledge Hub flow

Knowledge Hub follows the same renderer/Main/runtime boundary as the rest of Verse Claw:

```
/knowledge page or Chat draft action
  hostApi.knowledge.<action>(payload)
        鈹?
        鈻?
electron/services/knowledge-api.ts
        鈹? gatewayManager.rpc('wiki.*', ...)
        鈻?
openclaw_runtime memory-wiki / memory-core
```

- `knowledge.configure` patches the runtime config to enable `plugins.entries.memory-wiki.enabled = true` with Verse Claw defaults: `vaultMode: "isolated"`, `renderMode: "native"`, `search.backend: "shared"`, and `search.corpus: "wiki"`.
- File and folder import stays Main-owned: Verse Claw enumerates bounded text-like files, enforces size/count limits, and calls `wiki.ingest` once per accepted file. The default flow does **not** switch the runtime to `unsafe-local`.
- Chat sends may include `knowledgeScope` (`none`, `memory`, `wiki`, `all`). `electron/services/chat-api.ts` converts non-`none` scopes into hidden metadata/instructions for runtime tool use; renderer message cleanup keeps that metadata out of visible chat history.
- Session-derived knowledge uses an editable draft. Applying the draft calls `wiki.apply` only after explicit user confirmation.

### 6.5 Chat intensity and legacy Work Mode boundary

Chat no longer has a user-facing Work Mode selector or a Work Mode-driven send path. The current Chat surface stays lightweight and sends only explicit per-turn choices:

```
Chat Input explicit controls
  knowledge scope + selected knowledge refs
  thinking/effort and context/response intensity
  optional inputMode and activeTaskNodeId
        |
        v
src/stores/chat.ts / runtime-send-actions.ts
        |
        v
hostApi.chat.sendWithMedia(...)
        |
        v
electron/services/chat-api.ts
        |
        v
Gateway chat.send with current explicit metadata only
```

- Settings no longer exposes Work Mode controls. Chat does not mount the old Work Mode selector or `WorkModeSummaryPanel`.
- `shared/types/work-mode.ts`, old locale keys, old settings keys, and `WorkModeSummaryPanel` remain deprecated/internal compatibility only for migrations and tests. They must not be treated as an active behavior preset layer.
- Renderer send actions do not use Work Mode to choose permissions, tools, context sources, Task Ledger state, Knowledge writes, `/loop`, Mission, or ClawGraph behavior.
- Ordinary Chat can attach `knowledgeScope`, selected Knowledge refs, reasoning/effort/intensity preferences, and optional `activeTaskNodeId`. Those fields are explicit per-send choices; they are not long-term task truth.
- `activeTaskNodeId` may inject existing Task Ledger context for a turn, but it does not create a `/loop` Task Ledger root or enter checkpoint/intervention state.
- `inputMode` is a long-task intervention control only when an active `/loop` root exists. Gateway rejects attempts to enter checkpoint/intervention state from ordinary Chat without that root.
- `electron/services/work-providers-api.ts` owns Work Provider status, controlled runs, and artifact validation independently of legacy Work Mode. Renderer surfaces call only `hostApi.workProviders.*`; provider runs validate workspace paths in Main, `web.search` does not network without explicit provider config, and optional heavy providers such as LibreOffice, Pandoc, crawler, OCR, and dataframe runtimes remain interfaces until configured.

---

### 6.6 Agent Browser runtime automation flow

Agent Browser is an **agent-facing browser execution environment**, not a human-facing browser product. Its purpose is to let isolated runtime agent turns perform controlled web tasks such as check-in, page monitoring, draft publishing, and page-error inspection without asking the user to manually launch Chrome or install a separate agent browser.

The current flow is:

```text
Cron page browserAutomation config
  -> shared CronBrowserAutomationConfig
  -> electron/services/cron-api.ts
  -> buildCronBrowserAutomationPrompt(...)
  -> Gateway cron.add/update payload.kind="agentTurn"
     payload.toolsAllow=["agent_browser"]
  -> openclaw_runtime isolated cron agent session
  -> agent_browser tool
  -> Electron Main-owned managed browser/profile/authState bridge
  -> AgentBrowserAutomationEvent telemetry
  -> Cron BrowserAutomationRunResult + artifact persistence
  -> Cron Run Details evidence cards
```

Key runtime properties:

- Cron browser tasks are still standard isolated `agentTurn` runs; no new scheduler, workflow engine, or human-operated browser UI is introduced.
- The prompt embeds a JSON marker so Gateway Cron can persist the structured browser config even before Cron has native metadata fields.
- `toolsAllow: ["agent_browser"]` constrains the isolated run to the browser tool surface.
- The browser task config includes URL, objective, optional success/failure conditions, profile/authState references, auth persistence, run mode, allowed domains, sensitive-action policy, conservative retry, and diagnostics choices.
- Managed internal browser is the default. External browser/CDP/local Chrome profile reuse remains gated by explicit `allowExternalBrowser=true`.
- Login state is referenced by profile/authState; task configs do not store plaintext credentials.
- Sensitive actions default to `draft-only`; final send/publish/pay/delete/confirm actions require explicit `auto-submit`.
- Failures automatically collect minimal evidence: screenshot, snapshot, console, page errors, and network request diagnostics. These are summarized into run logs and persisted as artifacts when available.

This deliberately avoids browser-product scope: no address bar, tabs, bookmarks, history, downloads UI, DevTools UI, visual RPA builder, or profile management center. The UI should configure intent and display results/evidence; the browser exists for the agent runtime.

---

## 7. Security Model

| Concern | Approach |
|---|---|
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (renderer) |
| API surface | Whitelisted IPC channels in preload; typed `HostServiceRegistry` |
| Auth | Device identity signs `connect.challenge`; per-method operator scopes (`operator.read` / `operator.write` / `operator.admin` / `operator.approvals` / `operator.pairing`); control-plane write throttle |
| Secrets | OS keychain (secure-storage) for API keys, device identity, channel login tokens |
| Approvals | `exec.approval.*` and `plugin.approval.*` require explicit `approvals` scope; renderer surfaces approval events in the permission panel |
| Sandbox policy | `electron/utils/sandbox-policy-resolver.ts` is the single effective policy resolver for Verse Claw sandbox status, OpenClaw config mapping, runtime sync, and diagnostics |
| File sandbox | `electron/services/files-api.ts` enforces read/write roots; workspace root defines a per-workspace sandbox |
| Command/RPC gate | `electron/services/workspace-permissions.ts` classifies command and Gateway RPC risk as `read` / `write` / `network` / `destructive` / `external-write` |
| Knowledge import | `electron/services/knowledge-api.ts` bounds directory enumeration to text-like files, avoids `unsafe-local` by default, and writes derived knowledge only through confirmed drafts |
| Chat send metadata | Knowledge scope, selected Knowledge refs, reasoning/effort/intensity preferences, optional `activeTaskNodeId`, and valid `/loop` input-mode controls are normalized at UI/Main/runtime boundaries as untrusted request metadata; they cannot grant tools, bypass approvals, create `/loop` roots, install skills automatically, or change workspace permission mode |
| Work providers | `electron/services/work-providers-api.ts` validates workspace paths before Office/PDF/WebRead runs, keeps Search missing-config until explicitly configured, and leaves heavy converters/crawlers/OCR/dataframe providers optional |
| Telemetry | Opt-in, secret-scrubbing |
| Renderer 鈫?runtime | Never direct; always through main |

---

### 7.1 Lightweight layered sandbox control

Verse Claw now uses a **light by default, strong isolation optional** sandbox model. Docker is no longer part of the default Gateway startup path. The default effective provider is `policy-light`, which writes OpenClaw sandbox config as `agents.defaults.sandbox.mode = "off"` and keeps enforcement in the Verse Claw/Main + Gateway + OpenClaw exec approval control plane.

**Decision source**

- `electron/utils/sandbox-policy-resolver.ts` computes the effective sandbox policy from workspace permission mode, requested sandbox profile, platform, and provider availability.
- `electron/services/sandbox-api.ts` exposes the same effective policy through `sandbox.status`, `sandbox.detectProviders`, and `sandbox.explain`.
- `electron/services/workspace-runtime-sync.ts` and startup sanitize write OpenClaw config from the effective provider, not from the raw requested provider. If a strong provider is requested but unavailable, persisted runtime config falls back to the lightweight path.

**Provider layers**

| Provider | Runtime level | Default? | Behavior |
|---|---:|---:|---|
| `policy-light` | `policy` | yes | Main/Gateway policy gates, workspace-root checks, approval/audit, and OpenClaw exec approval. No container or VM claim. |
| `windows-light` | `light` | no | Windows-oriented lightweight process constraints where available, layered on top of policy controls. Not equivalent to Docker/VM isolation. |
| `docker-strong` | `strong` | no | Optional OpenClaw Docker sandbox. Requires Docker CLI, daemon, and `openclaw-sandbox:bookworm-slim`; only this provider writes `backend: "docker"` and `docker.network: "none"`. |
| `ssh-strong` | `strong` | no | Reserved for OpenClaw SSH backend / remote isolation. Exposed as an advanced strong provider once configured. |

Legacy provider ids are normalized for compatibility: `openclaw-native` and `container` map to `docker-strong`; `policy-only` maps to `policy-light`.

**Permission modes**

| Workspace mode | Lightweight behavior |
|---|---|
| `readOnly` | File writes blocked; mutating Gateway RPC blocked; commands limited to read allowlist. |
| `plan` | Reads allowed where safe; writes and command execution blocked until the user confirms a plan and switches execution mode. |
| `acceptEdits` | Workspace-local normal writes allowed; network commands, destructive commands, external writes, and mutating Gateway RPC require approval. |
| `fullAccess` | Allows operations but records high-risk audit events; does not automatically enable Docker. |

**Risk gates**

- Command risk is classified as `read`, `write`, `network`, `destructive`, or `external-write`.
- Network commands such as `curl`, `wget`, `Invoke-WebRequest`, package installs, and package registry operations require approval in `acceptEdits`.
- Gateway RPC gating is fail-closed for unknown mutating methods outside `fullAccess`; safe reads remain allowlisted.
- File, terminal, web preview, Git, and Gateway services all continue to route through Main-owned approval/audit helpers instead of renderer-direct Gateway or IPC calls.

**Degraded behavior**

- Missing Docker is not an error for default operation. It only makes `docker-strong` unavailable.
- If the user requests `docker-strong` and Docker is incomplete, `sandbox.status` reports `degraded: true`, a `degradeReason`, Docker CLI/daemon/image availability, and `effectiveProviderId: "policy-light"`.
- Provider detection is cached with a short TTL so `sandbox.status`, runtime fallback, diagnostics, and Settings do not repeatedly run Docker/SSH probes.
- Settings / Doctor / diagnostics present `requestedProviderId`, `effectiveProviderId`, `runtimeLevel`, `workspaceAccess`, `execPolicy`, `networkPolicy`, Docker CLI/daemon/image state, and degraded reason from the same effective policy object.
- `sandbox.explain` returns both legacy text lines and a structured explanation object so UI/logs can render policy details without reparsing strings.

---

## 8. Observability and Diagnostics

- **Renderer**: `/observability` page reads `hostapi:observability.*` through `src/lib/host-api.ts` (dashboard snapshot, indexed trace query, trace graph, node diagnostics, trace detail, clear traces). The workbench combines a query-driven trace list, issue chips, source freshness, SVG/HTML agent-chain graph, node diagnostics drawer, synchronized timeline, and the legacy waterfall in `src/pages/Observability/TraceWaterfall.tsx`.
- **Gateway**: connection monitor tracks heartbeat, last-RPC success, channel-status freshness, exposes `diagnostics.gatewaySnapshot` to the renderer for one-shot health capture.
- **Runtime**: `observability.reportTrace` / `observability.traces` write/read the runtime trace store; Electron maps runtime spans, chat runtime events, and trajectory JSONL sidecars into `ObservabilityTraceGraph`, issue summaries, correlations, and redacted `traceNodeDiagnostics` payloads without adding a database. A Verse Claw-owned local JSON/JSONL index persists sanitized trace envelopes for recent-history queries and rehydration; `clearTraces()` clears only this observability index/cache, not transcript or trajectory source files.
- **Doctor**: `openclaw doctor` exposed as a button in Settings 鈫?Advanced 鈫?Developer.

---

## 8.5 Task Ledger and Long Task State

Task Ledger is the product-level answer to long-running agent work. It is **not** an executor and does not replace the runtime's memory, sessions, transcripts, or observability traces. It is a structured state ledger that lets users and agents keep stable track of the shape of work across turns, sessions, and agents.

- **Ownership**: Verse Claw owns Task Ledger in the Main process. Renderer code calls `hostApi.taskLedger.*`; pages/components never read or write ledger files directly.
- **Scope**: one ledger per workspace. It can link many agents, sessions, traces, and files, but it is not stored inside a chat transcript and is not scoped to one agent.
- **Model**: `TaskNode` (`goal`, `milestone`, `task`, `check`, `decision`, `risk`, `deviation`, `review`) + `TaskEdge` (`depends_on`, `blocks`, `relates_to`, `derived_from`, `supersedes`, `needs_review`) + append-only `TaskEvent` + projected `TaskSnapshot`.
- **Persistence**: local append-only JSONL under `<openclawConfig>/task-ledgers/workspaces/<workspaceKey>/events.jsonl`, with `snapshot.json` as a materialized read model and `exports/*.html` for offline review.
- **Idempotency**: writes accept `idempotencyKey` so streaming retries or agent replays do not duplicate events.
- **Degraded-read behavior**: damaged JSONL lines are skipped and reported as snapshot warnings instead of making the whole ledger unreadable.
- **UI**: `/task-ledger` provides Tree, DAG, History, and Review tabs; Chat shows a compact summary panel with current goal, active nodes, blockers, review nodes, and recent decisions.
- **Export**: `taskLedger.exportHtml` writes a single offline HTML file with embedded snapshot/event data and local Tree/DAG/History/Review views.
- **Agent alignment**: Claude Code/Codex-style todo or plan updates should map into agent-neutral ledger events. High-risk or uncertain updates should become `review` nodes or `needs_review` edges rather than silently changing task state.
- **Boundary with Memory**: memory stores reusable knowledge; Task Ledger stores current work structure and progress. Memory may cite ledger state as evidence, but ledger events are the source of truth for task state.
- **Boundary with Observability**: observability explains how a run executed; Task Ledger explains what long-running work currently exists, what depends on what, and what requires review. Traces can be linked as evidence through `sessionLinks`/metadata.

### 8.5.0 Task Ledger Chat Projection and Explicit `/loop` Root (2026-06-24)

Task Ledger is still the source of truth for long-running work structure, but ordinary Chat is not automatically promoted into that structure. The current boundary is:

1. **Ordinary Chat remains lightweight.** Its facts come from the transcript, runtime turn events, files changed, approvals, and optional best-effort Task Ledger projection.
2. **Ordinary Chat Task Ledger writes are best-effort evidence only.** They may create check/deviation/session-link events for a turn, but failed writes never fail Chat and never create a `/loop` root.
3. **`/loop` is the explicit long-task entry point.** Starting `/loop` must create one Task Ledger root before recoverable checkpoint/intervention state begins; root creation failure blocks startup with a diagnostic.
4. **Loop recovery uses one context builder.** `LoopContextPack` is the only `/loop` recovery-context generation entry point; Chat, Knowledge, Task Ledger, Mission, and renderer code must not each concatenate their own long-context prompt.

**Ordinary Chat projection:**

| Event | Best-effort action | Boundary |
|-------|--------------------|----------|
| Session created / switched | `linkSession` with `relation: 'related'` | Session relationship only; not a task root |
| Turn completed (`final`) | `appendEvents` with `check` / `session_linked` evidence when extraction succeeds | Fire-and-forget; failure is ignored after the turn is committed |
| Turn errored (`error`) | `appendEvents` with `deviation` evidence when extraction succeeds | Fire-and-forget; does not enter long-task state |
| Composer selects `activeTaskNodeId` | Existing Task Ledger node context is injected into the send | Does not create a `/loop` root or checkpoint/intervention state |

**Explicit `/loop` strategy:**

| Event | Task Ledger action | Boundary |
|-------|--------------------|----------|
| `/loop` startup | Create one root goal/task record before recoverable state begins | Failure rejects startup (`Cannot start /loop without a Task Ledger root...`) |
| Checkpoint / intervention / queue / guide / interrupt | Persist state with the same Task Ledger root id | No detached checkpoint/intervention state |
| Decision / deviation / evidence / review / terminal status | Attach events and evidence to the same root | Completion/blocking status must remain tied to the root |

**Chat Store integration (`ChatState`):**

- `activeTaskNodeId: string \| null` — optional existing Task Ledger node selected by the user via `TaskNodeSelector`; it gives the turn context, not long-task authority.
- `taskLedgerSnapshot: TaskLedgerSnapshot \| null` — cached snapshot for the current workspace, refreshed when the workspace or session changes.
- `refreshTaskLedger()` — internal action that reloads the snapshot from `hostApi.taskLedger.snapshot()`.
- `ensureSessionLinkedToLedger(sessionKey)` — internal helper that can link a session with idempotency key `auto-link:{sessionKey}`.

**Turn projection (`turn-ledger-recorder.ts`):**

- `extractTurnSummary(userMsg, assistantMsgs, error?)` extracts a `TurnLedgerSummary` from each completed turn. Priority: (1) fenced JSON `\`\`\`task-ledger ... \`\`\`` in the assistant reply, (2) heuristic extraction from tool names, file paths, and section headings.
- `buildTurnLedgerEvents(workspaceId, sessionKey, summary, taskNodeId?)` builds `TaskLedgerEventInput[]` with `node_created` (check/deviation) + `session_linked` + optional `review_requested`.
- `handleRuntimeEventState` triggers projection after `final` / `error` turn state is committed. These writes are fire-and-forget and cannot become acceptance criteria by themselves.

**Key files:**

| File | Role |
|------|------|
| `src/stores/chat/turn-ledger-recorder.ts` | Ordinary Chat turn summary extraction and evidence event building |
| `src/stores/chat/runtime-event-handlers.ts` | Fire-and-forget Chat projection trigger in `final` / `error` |
| `src/stores/chat/runtime-send-actions.ts` | `activeTaskNodeId` passthrough only; no Work Mode behavior path |
| `electron/services/chat-api.ts` | Optional existing task-node context injection; ordinary sends do not create `/loop` roots |
| `openclaw_runtime/src/agents/task-loop-controller.ts` | `/loop` root creation and startup rejection on root failure |
| `openclaw_runtime/src/agents/loop-context-pack.ts` | Single bounded `/loop` recovery context builder |
| `openclaw_runtime/src/agents/task-loop-context.ts` | Legacy reviewer headings rendered from `LoopContextPack` sections only |
| `openclaw_runtime/src/agents/mission-control/context.ts` | Mission compatibility context rendered from `LoopContextPack` sections only |

**Boundary clarification:**

| Concern | Source of truth |
|---------|-----------------|
| Long-running task structure | Task Ledger root/event stream for explicit long tasks |
| Ordinary Chat turn evidence | Transcript + runtime events + optional best-effort Task Ledger projection |
| How a specific run executed | Observability traces and runtime events |
| Reusable project knowledge | Knowledge drafts/proposals after user review |
| Session transcript | Runtime session `.jsonl`, not Task Ledger |

---

## 8.5.1 Long Conversation Control and Manual Compaction

Verse Claw treats long-conversation stability as a visible control layer over the runtime's existing compaction pipeline. Session compaction reduces transcript pressure for the **current Chat session**; it is not the source of truth for long-running task state.

- **Runtime boundary**: OpenClaw runtime keeps automatic pre-prompt pressure checks and overflow routing (`truncate_tool_results_only`, `compact_only`, `compact_then_truncate`). Manual compression calls the same transcript lock, timeout, hook, rotation, and thinking-signature repair path with `trigger: "manual"` and `force: true`.
- **Gateway RPCs**: Verse Claw uses formal session RPCs instead of sending `/compact` text: `sessions.compactionStatus`, `sessions.compactionHistory`, and `sessions.compact`.
- **Host API boundary**: Renderer code calls `hostApi.sessions.compactionStatus/history/compact`; Main proxies to Gateway and returns a diagnostic unavailable state when Gateway is down. Renderer never reads transcript files and never calls Gateway directly.
- **User control**: v1 supports manual compression only for the active Chat session. The composer context indicator shows a compact action; clicking it opens a confirmation dialog with token usage, hidden/truncated count, last compaction, expected effect, and optional extra preservation instructions.
- **Run safety**: manual compression is disabled while a session has active streaming/tool execution or compaction in flight. The formal `force:true` path rejects active sessions instead of queueing behind or interrupting a run; legacy slash-command compaction remains available for non-Verse Claw users.
- **State separation**: compaction summaries preserve objective, open tasks, decisions, failed attempts, touched files, constraints, next action, and review-needed items. They may reference Task Ledger or Context Pack evidence, but they must not mutate Task Ledger automatically.
- **Token-dense artifact**: compaction now stores a structured `CompressionArtifact v1` with objective, constraints, current state, done/in-progress/blocked work, decisions, files/tests, failed attempts, deviations, next action, review items, evidence refs, unverified claims, and quality metrics. The old string `summary` is rendered from this artifact for compatibility; recovery paths should prefer artifact projection over re-reading long transcript history.
- **Recovery query surface**: `sessions.compressionArtifact` returns the latest or requested artifact, while `sessions.recoveryContext` returns a shorter token-budgeted projection for the next prompt or handoff. Main exposes these through `hostApi.sessions.compressionArtifact/recoveryContext`; Chat shows quality level, score, evidence coverage, unverified count, and projected recovery tokens near the context controls.

---

## 8.5.2 ClawGraph and Stateless Long-Task Execution

ClawGraph is the execution-side answer to long-task context explosion. Instead of keeping one agent inside a very long conversation, ClawGraph splits work into workflow nodes, runs each worker with a fresh bounded prompt, and moves state forward through validated handoff objects and append-only run events.

- **Workspace DSL**: workflow YAML lives under `<workspaceRoot>/.clawx/clawgraph/*.yaml`. The YAML declares workflow metadata, model refs, roles, nodes, dependencies, control policies, and termination checks. It is a constraint layer, not an imperative script.
- **Compile boundary**: the runtime compiler validates `schemaVersion`, workflow id, role/model references, unique node ids, DAG acyclicity, and sandbox narrowing before producing `ClawGraphIR`.
- **Worker boundary**: agent nodes reuse the role-first subagent runtime (`spawnRoleSubagent` / `spawnSubagentDirect`) instead of adding a second worker transport. Worker prompts include objective, node task, dependency handoff summaries, role contract, allowed tools/permissions, and the handoff schema.
- **Handoff contract**: workers must return one fenced `clawgraph_handoff` JSON object with `nodeId`, `status`, `summary`, `evidenceRefs`, `filesTouched`, `testsRun`, `decisions`, `deviations`, `risks`, `followupTasks`, and `confidence`.
- **Audit boundary**: audit nodes and the verifier never treat LLM prose as truth. They validate handoff shape, trace/subagent evidence, workspace-contained file refs, evidence refs, and consistency. External system or database claims without verifiable evidence become review items.
- **User control**: retry/reroute/freeze/escalate are boss-controlled state transitions. Runtime graph-change proposals do not mutate an active graph directly; they enter review and are applied only through `clawgraph.review`.
- **Task Ledger boundary**: ClawGraph owns run execution state. Task Ledger owns long-term user-facing work state. Main maps key `clawgraph-lifecycle` broadcasts into system-owned ledger evidence and review nodes with idempotency keys, but ClawGraph does not auto-complete long-term goals.

---

## 8.5.3 Long-Task Stability Stack

The product rule is: **long-term truth must not depend on long chat transcripts**. Verse Claw therefore uses a layered stack where each layer owns one kind of state and no layer silently substitutes for another.

| Layer | Owns | Does not own | Primary APIs / files |
|---|---|---|---|
| Chat transcript | User/assistant conversation history for the active session | Long-term task truth, workflow execution truth, reusable knowledge | Runtime session `.jsonl`, `sessions.*` |
| Chat Input Mode | How human intervention enters an active run | Compression, durable task truth, proof of completion | `inputMode`, `shared/types/long-task-control.ts` |
| Chat intensity / legacy Work Mode compatibility | Explicit reasoning/effort and context/response intensity for the next ordinary Chat turn; deprecated Work Mode records only for migration/tests | Permissions, actual tool availability, task truth, skill installation authority, `/loop` state, or runtime policy | `thinkingLevel`, intensity/prompt preferences, `shared/types/work-mode.ts` (deprecated) |
| Mission Control / Mission Loop (planned) | Policy loop for long-goal run/tick/reflect/schedule decisions | Worker execution, durable ledger truth, direct memory writes, approval bypass | `mission.*`, `MissionContextPack`, `mission.lifecycle` |
| Manual compaction | Reducing current-session token pressure while preserving a structured summary | Mutating Task Ledger, proving execution evidence, changing workflow state | `sessions.compactionStatus/history/compact` |
| Token-Dense Recovery Compression | High-density structured recovery artifact and short projection for the next prompt/handoff | Proving task completion, replacing Task Ledger/ClawGraph/observability evidence | `sessions.compressionArtifact`, `sessions.recoveryContext`, `CompressionArtifact v1` |
| Resume Checkpoint | Minimal structured continuation state after compaction, interrupt, abort, audit fail, review, queue drain, guide, or session rotation | Full node snapshotting, arbitrary transcript replay | `ResumeCheckpoint`, `sessions.resumeCheckpoints` |
| Persistent Intervention Queue | User-selected queued follow-up messages that must survive Gateway restart until drained or failed | Active-run steering, task completion truth, transcript compaction | OpenClaw state SQLite `long_task_user_queue`, `sessions.queueDrain` |
| Chat Session Handoff | Preview-first continuation into a fresh session with an editable deterministic draft | Transcript branching, automatic sending, model-generated summaries | `hostApi.sessions.prepareHandoff`, `WorkspaceUiState.draftInput` |
| Chat Session Fork | Runtime-backed child session that inherits the source transcript branch | Git branch/worktree creation, handoff prompt generation, isolated empty fallback | `hostApi.sessions.fork`, Gateway `sessions.fork` |
| LoopContextPack / Context Pack | Token-budgeted injection of relevant memory, task state, team handoffs, procedural notes, and `/loop` recovery context | Durable source of truth or independent prompt concatenation by each subsystem | `buildLoopContextPack`, `buildContextPack`, memory explain logs |
| Workspace Harness | Project specs, task contracts, context-pack recipes, and human-readable Task Ledger bridge docs | Durable task state, execution state, proof of completion | `.clawx/harness/**`, `resources/workspace-harness/**` |
| ClawGraph | DAG execution state, stateless worker prompts, handoffs, audit results, review items | Long-term goal ownership, reusable knowledge, arbitrary external truth | `.clawx/clawgraph/*.yaml`, `clawgraph.*` |
| Task Ledger | Workspace-scoped long-term work structure, dependencies, blockers, decisions, deviations, review queue | Worker execution, trace storage, reusable memory | `taskLedger.*`, append-only ledger JSONL |
| Observability | How a run executed: spans, tools, subagents, scorecards, trace evidence | Whether a long-term goal is complete | `observability.*`, runtime trace buffer |
| Knowledge Hub / Memory | Reusable project knowledge after confirmation and governance | Current task progress or run status | `wiki.*`, `memory.*` |

This split is specifically meant to avoid the failure mode seen in long Claude Code/Codex-style conversations: after enough turns, the transcript becomes expensive, brittle, and less reliable for tool orchestration. Verse Claw keeps chat useful but disposable: compaction can shrink it, ClawGraph can execute fresh bounded nodes, Task Ledger can preserve current work truth, and observability can prove what actually happened.

For `/loop`, `LoopContextPack` is the sole recovery prompt builder. `task-loop-context.ts` and `mission-control/context.ts` may render legacy reviewer headings for compatibility, but those headings are formatted from `LoopContextPack` sections only; they are not independent long-context sources.

Recommended mapping for future agent work:

- Use **ClawGraph** when work needs explicit sequencing, fan-out/fan-in, retries, audit, or stateless handoffs.
- Use **Task Ledger** when work state should survive sessions and remain user-reviewable.
- Use **Workspace Harness** when a project needs portable specs, task contracts, context-pack recipes, or a human-readable Task Ledger bridge; do not use it as the canonical task database.
- Use **manual compaction** when the current Chat session is too large but still worth continuing.
- Use **Chat Session Fork** when the user wants a true conversation branch with the current transcript history immediately visible.
- Use **Chat Session Handoff** when the source transcript is too large, unavailable, or should be replaced by a reviewable continuation prompt.
- Use **Chat effort/intensity controls** when the next ordinary Chat turn should be shorter, deeper, cheaper, or use a specific reasoning effort; do not revive legacy Work Mode as behavior, task, or permission state.
- Use **Mission Control** when one objective should survive multiple turns, scheduled checks, session rotation, evidence reviews, and memory updates. Mission Control is the planned outer policy loop; it should call `task_loop` or ClawGraph rather than replacing them.
- Use **Knowledge Hub / Memory** only for reusable knowledge, not for ephemeral progress.
- Use **Observability** as evidence, not as the state ledger.

---

## 8.5.4 Human Intervention and Resume Control

`interrupt`, `guide`, and `queue` are the Human Intervention Control Layer for long conversations. They do not compress context by themselves; they decide how new human intent enters an active run without confusing the long-term state model.

- **Default strategy**: Guide-first. When a run is active, ordinary user input should become non-disruptive steering unless the UI/user explicitly selects `interrupt` or `queue`, or the classifier detects a strong stop/queue intent.
- **`guide` semantics**: injects guidance through the embedded-agent steering queue (`queueEmbeddedAgentMessageWithOutcomeAsync`) without aborting the active run or changing completion state. It records steering evidence and a checkpoint; high-risk guidance should enter review.
- **`queue` semantics**: stores the message in OpenClaw state SQLite through `user-message-queue.ts` and drains it after `clearActiveEmbeddedRun` or explicit `sessions.queueDrain` when the session is idle. It does not affect the active run; the drained follow-up stays associated with the original session/run evidence and failed drain attempts return to pending with `attempts` / `lastError` rather than disappearing.
- **`interrupt` semantics**: writes checkpoint/deviation evidence before aborting the active run through `abortChatRunsForSessionKeyWithPartials`, keeps partial evidence, and lets the inbound message start a fresh run. For ClawGraph active nodes it requires explicit confirmation and records a deviation/abort checkpoint.
- **ClawGraph alignment**: active nodes default to `guide` or `queue`; interrupt marks the current node/run path as interrupted/deviated and resumes from checkpoint. Audit/review-stage human input is treated as a review decision or review evidence, not as a handoff rewrite.

`ResumeCheckpoint` is the minimum continuation contract. It is intentionally smaller than a full node snapshot and larger than a free-form compaction summary. It preserves the current objective, active node/task, last confirmed handoff, blockers, decisions, deviations, files touched, tests run, next action, review-needed items, evidence refs, and bounded Engineering Control Signals (`controlSignals`, `validationState`, and `acceptanceStatus`). Runtime stores checkpoints, intervention events, and queued follow-ups in the OpenClaw state SQLite tables `long_task_checkpoints`, `long_task_intervention_events`, and `long_task_user_queue`; no JSON/JSONL sidecar is introduced. New runs should reconstruct context from checkpoint + Task Ledger summary + ClawGraph snapshot + Context Pack rather than asking the model to reread the full transcript.

Verse Claw exposes a formal recovery query surface:

- Runtime RPCs: `sessions.longTaskControlStatus`, `sessions.longTaskControlHistory`, `sessions.resumeCheckpoints`, and `sessions.queueDrain`.
- Host API facade: `hostApi.sessions.longTaskControlStatus/history/resumeCheckpoints/queueDrain`; renderer never reads runtime state files or calls Gateway directly.
- Composer diagnostics: Chat shows latest checkpoint, queued follow-up count, latest intervention, and recovery warnings near the context/token indicator. When the session is idle and queue count is non-zero, the user can manually drain queued follow-up now.
- Rollback plan UI: Chat renders a recovery panel that summarizes the active checkpoint, queue, context pressure, terminal risk, Git/file rollback, Task Ledger review, and Memory/Knowledge write risk. It shows safe/review/dangerous action counts plus a signal matrix before exposing typed actions. Destructive paths route to approval-backed Git/file/terminal controls, and memory-affecting recovery facts become Knowledge drafts or proposals instead of silent durable writes.
- Handoff recovery: `prepareHandoff` first asks runtime for token-dense recovery context, then asks for the newest persistent `ResumeCheckpoint`, and still merges Task Ledger, Git status, recent observability, and transcript fallback signals into one deterministic checkpoint rendering context.

Chat session continuity now has two explicit surfaces: **Handoff to new conversation** and **Fork to new conversation**. They share the same safety posture (idle session only, no renderer transcript reads, no renderer-direct Gateway calls, no auto-send), but they intentionally solve different failure modes.

**Handoff** is the preview-first `session_rotation` use of `ResumeCheckpoint`. Main builds a deterministic continuation draft from conservative ecosystem sources: runtime recovery context / compression artifact when available, runtime checkpoint when available, the active workspace Task Ledger snapshot, Git status, recent observability trace/error state, and recent transcript entries only as supplemental/fallback evidence. The draft is a reviewable recovery package with sections for current objective, recently confirmed work, in-progress state, recovery context projection, blockers/risks, evidence sources, and suggested next action. It does not call a model to summarize or polish the result, and it does not write Memory/Knowledge. Renderer only receives the typed `hostApi.sessions.prepareHandoff` result, shows source chips and warnings, lets the user edit the draft, and creates a fresh workspace-scoped session with the edited text as composer `draftInput`. Handoff preparation is read-only; Task Ledger linking happens only after the user confirms creation, with `relation: 'handoff_from'`, `sourceSessionKey`, and child `sessionKey`. The source session is not mutated except for that optional relationship event.

**Fork** is the branch-style counterpart for the cases where the parent transcript is still safe to reuse. Renderer calls `hostApi.sessions.fork`, Main proxies the explicit Gateway RPC `sessions.fork`, and the runtime returns only after it has written the child transcript and registered the child session entry with `parentSessionKey` and `forkedFromParent`. The child inherits the active transcript branch plus runtime selection metadata such as provider/model/thinking/fast-mode settings, while Verse Claw copies only non-running workspace UI state (`draftInput`, model selection, knowledge scope, artifact panel state, and recent files). Fork does not copy Task Ledger nodes, Memory, Knowledge, or workflow truth; it may only append a `session_linked` relationship with `relation: 'forked_from'`. The app immediately switches to the child session, refreshes sessions/history, leaves the parent unchanged, and never generates or sends a prompt. If the runtime reports an active run, an unavailable transcript, or a parent context that exceeds the fork limit, the operation fails instead of creating an empty isolated replacement.

The UI keeps the entry points restrained. A local continuity preflight combines run state, Gateway availability, context pressure, truncation, compaction warnings, recovery-context signals, and long-task checkpoint status into one availability/recommendation/health result (`healthy`, `risky`, or `blocked`); it is a UI safety and guidance model, not a task truth source. The composer context area shows only the locally recommended continuity action: Fork by default, or Handoff when Gateway is unavailable, context pressure is high, transcript history is already truncated, compaction state carries warnings, runtime recovery context is already available, or a recent recovery checkpoint exists for compaction/interruption/abort/review/session rotation. Its tooltip gives a short health cue plus the reason for the recommendation instead of adding another visible control. The session dropdown remains the full choice surface and shows both Fork and Handoff with a light Recommended marker on the suggested action; forked sessions can also show lightweight `forkedFromParent` lineage from `sessions.list`. Handoff opens an editable preview dialog first. Fork creates and switches immediately. Both actions are disabled while the current session is sending, streaming, waiting for a final response, queue-draining, or known to have an active Gateway run; Main/Gateway perform the same safety rejection so UI state cannot be the only guard. If Fork fails because Gateway is unavailable, the parent is too large, or the transcript is unavailable, Verse Claw offers a Prepare handoff toast action that explicitly uses ResumeCheckpoint + Task Ledger + evidence instead of automatically falling back or creating an empty session. If Handoff preparation fails while Gateway is available, Verse Claw can offer Try fork. Fork and Handoff may both append Task Ledger `session_linked` events using relation metadata (`forked_from` / `handoff_from`) so long-running work can explain how sessions relate without treating either transcript as the durable task source of truth.

Checkpoint triggers:

- `compaction` and `session_rotation`: preserve continuity before transcript pressure changes.
- `interrupt` and `run_abort`: preserve partial work and deviation evidence before restarting.
- `clawgraph_node_handoff`: preserve the last confirmed cross-node transfer.
- `audit_fail` and `manual_review`: preserve why the run froze and what must be reviewed.
- `queue_drain` and `guide`: preserve human intervention evidence without changing completion state.

---

### 8.5.5 Mission Control / Mission Loop (MVP+)

**Verse Claw Mission Control** is the product umbrella for long-goal autonomy. The runtime primitive is **Mission Loop**. It sits above the bounded `task_loop` and uses the existing execution surfaces instead of becoming a second agent runtime.

Mission Control is meant for objectives that should survive long conversations, session handoff, scheduled checks, review pauses, and memory evolution. A Mission is not "run forever"; it is a governed goal controller that wakes, rebuilds bounded context, runs one controlled execution pulse when useful, reflects on evidence, writes a checkpoint, proposes memory, and either schedules the next tick or reaches a terminal state. The MVP+ defaults to manual Missions, at most 8 ticks, at most 3 repair ticks, and one bounded inner `task_loop` per execution pulse.

Startup and trigger surfaces:

- UI: Agents -> Roles & Orchestration -> Mission Control starts `mission.run`, then displays phase, tick, reviewer decision, next wake, blocked reason, and trace id.
- Gateway RPC: `mission.create`, `mission.run`, `mission.tick`, `mission.status`, `mission.pause`, `mission.resume`, and `mission.cancel`.
- Model tool: lead/main agents can call `mission_loop(action="run"|"tick"|"status")`; leaf subagents do not receive `mission_loop`, `task_loop`, or `team_orchestrate` by default.
- Scheduler: Mission reviewer `nextTick` is recorded as controlled Mission state; automatic periodic wakeups require an explicit user-created schedule and do not create free-form chat messages.

Ownership boundaries:

| Owner | Mission Control use |
|---|---|
| `task_loop` | Inner bounded execution pulse with self-check and scoped repair |
| ClawGraph | Structured DAG execution for long tasks with handoffs and audit gates |
| Task Ledger | Durable user-facing goal, task, blocker, review, decision, and session-link truth |
| Resume Checkpoint | Minimal continuation state after pressure, interrupt, abort, review, or session rotation |
| Context Pack | Token-budgeted input assembled for each mission tick, reviewer, or worker |
| Cron / wake / heartbeat | Tick trigger only; never the source of completion truth |
| Observability | Trace evidence for what actually ran |
| Role Memory / Knowledge Hub | Governed reusable knowledge through proposals or drafts, never silent direct writes |

Mission lifecycle:

```text
mission.created
  -> mission.planning
  -> mission.running
  -> mission.checkpointing
  -> mission.reflecting
  -> mission.memory_proposing
  -> mission.scheduling
  -> mission.sleeping | mission.continuing | mission.repairing
  -> mission.asking_user | mission.completed | mission.blocked | mission.cancelled
```

Each `mission.tick` should follow a fixed control path:

1. Load Mission state, Task Ledger snapshot, latest Resume Checkpoint, selected memory context, recent trace evidence, and pending review/blocker state.
2. Build a `MissionContextPack` from bounded trusted state plus untrusted evidence blocks; do not replay the full transcript.
3. Decide whether this tick should execute, sleep, ask for input, or stop before spending model/tool budget.
4. Run `task_loop`, ClawGraph, or role-first orchestration only when the reviewer/policy says useful execution is possible.
5. Collect evidence, failures, verifier output, files touched, tests run, decisions, deviations, and memory candidates.
6. Run `MissionReviewer` to decide `continue`, `repair`, `sleep`, `ask_user`, `complete`, or `blocked`.
7. Mirror high-value evidence into Task Ledger, create or update review/blocker/check nodes, and write a Resume Checkpoint.
8. Create role-memory proposals and Knowledge Hub drafts/inbox items for reusable knowledge. Knowledge Hub changes never become formal wiki content until user-reviewed apply; role-memory candidates follow the gatekeeper/proposal policy.
9. Schedule the next tick through existing cron/wake infrastructure only if the Mission is still active and policy allows it.

`MissionContextPack` should be smaller and more structured than a transcript:

- objective and acceptance criteria
- current Task Ledger goal/task/check/review summary
- latest Resume Checkpoint summary
- previous reviewer checkpoint summary
- selected role-memory cards and injection explain refs
- recent trace/test/tool evidence summaries
- open blockers, approvals, review items, risks, and deviations
- repair brief or next tick reason
- bounded control-signal, validation, acceptance, and scope-summary sections

`MissionReviewer` returns only structured JSON:

```ts
{
  decision: "continue" | "repair" | "sleep" | "ask_user" | "complete" | "blocked";
  confidence: number;
  reason: string;
  missingEvidence: string[];
  verificationGaps: string[];
  repairBrief?: string;
  nextTick?: { afterMs?: number; reason?: string };
  risks: string[];
  controlSignals: Array<{
    kind: "evidence_gap" | "validation_missing" | "scope_drift" | "unverified_claim" | "replan_required" | "permission_wait" | "blocked_dependency" | "risk" | "recovery_gap";
    severity: "info" | "warning" | "blocking";
    message: string;
    suggestedAction?: "continue" | "repair" | "replan" | "ask_user" | "block" | "sleep" | "verify";
  }>;
  validationState: { status: "unknown" | "not_run" | "passed" | "failed" | "partial" | "missing"; checks: string[]; evidenceRefs: unknown[] };
  acceptanceStatus: { status: "unknown" | "satisfied" | "partial" | "missing" | "changed"; criteria: string[]; gaps: string[] };
  quality: Array<{ dimension: "scope" | "evidence" | "validation" | "risk" | "recovery" | "security"; status: "pass" | "gap" | "fail" | "unknown" }>;
  memoryCandidates: Array<{ kind: "role_memory" | "knowledge_draft"; summary: string; evidenceRefs: string[] }>;
  checkpointSummary: string;
}
```

Completion requires evidence, not model confidence alone. A Mission can become `completed` only when acceptance criteria are satisfied, required Task Ledger checks are done, no blocking review nodes remain, verifier/reviewer evidence supports the result, no blocking Engineering Control Signal remains, and the final checkpoint explains the outcome. Missing evidence, validation gaps, scope drift, unverified completion claims, repeated no-progress hashes, exhausted tick/repair budgets, permission waits, unsafe requests, or unresolved external truth claims become `repair`, `blocked`, or `ask_user`; an inner `task_loop` complete state or Observability trace can never upgrade a long-term goal by itself.

Trigger modes:

- **Manual start**: Chat, Agents, or Task Ledger creates and runs a Mission.
- **Model-suggested start**: the assistant can recommend Mission Control for long-lived goals, but user-facing entry remains explicit.
- **Scheduled tick**: existing cron/wake infrastructure calls `mission.tick` for delayed checks or periodic monitoring.
- **Event-driven tick**: approvals, user replies, subagent completion, ClawGraph review decisions, or relevant workspace events can wake a Mission.
- **Session handoff/fork**: a Mission continues from Task Ledger + Resume Checkpoint rather than from full transcript replay.

Initial config shape:

```ts
agents.defaults.missionLoop?: {
  enabled?: boolean; // default false until MVP UI/runtime are complete
  maxTicks?: number; // default 8
  maxRepairTicks?: number; // default 3
  innerLoop?: {
    maxIterations?: number;
    maxRepairIterations?: number;
  };
  tickPolicy?: {
    mode?: "manual" | "scheduled" | "event";
    minIntervalMs?: number;
    quietHours?: string[];
  };
  completion?: {
    minConfidence?: number;
    requireEvidence?: boolean;
    requireLedgerClear?: boolean;
  };
  memory?: {
    proposeAfterTick?: boolean;
    autoApplyLowRisk?: boolean; // compatibility field; Mission currently proposes candidates rather than applying Knowledge directly
  };
  reviewer?: { model?: AgentModelConfig; timeoutMs?: number };
}
```

Implementation should start from `harness/specs/tasks/mission-control-loop-mvp.md`. The MVP should keep Mission Control off by default until unit, harness, comms, and E2E coverage prove the lifecycle, HostEvents path, scheduled tick behavior, reviewer decisions, and memory proposal boundaries.

---

## 8.6 Knowledge Hub and Personal Wiki State

Knowledge Hub is the product-level answer to reusable project knowledge. It is intentionally built around the existing OpenClaw `memory-wiki` / `memory-core` runtime path instead of adding a Verse Claw-native RAG stack. The goal is a usable, inspectable MVP: users can initialize a vault, import bounded local sources, search and inspect source-backed wiki results, run compile/lint, and apply curated syntheses.

- **Ownership**: Verse Claw owns the UI, host-api facade, local file selection/import boundaries, and confirmation UX. The runtime owns wiki storage, search, compile, lint, and apply semantics through `wiki.*` JSON-RPC methods.
- **Default mode**: `knowledge.configure` enables `memory-wiki` with `vaultMode: "isolated"` and `renderMode: "native"`. The default vault is Verse Claw-managed and works without Obsidian.
- **Import model**: users explicitly import files or folders. Directory import enumerates bounded text-like files in Main and calls `wiki.ingest` per file, preserving provenance without granting broad local-vault access.
- **OKF compatibility**: `knowledge.validateOkfBundle` and `knowledge.importOkfBundle` support Open Knowledge Format v0.1 local folders as a thin adapter. The MVP validates Markdown files with YAML frontmatter, treats `index.md` and `log.md` as reserved, preserves unknown frontmatter fields, warns on unknown types or broken internal links, and imports selected valid concepts through `wiki.ingest`. It does not support zip/tar, Git URLs, export, Google Cloud services, or a separate graph/vector store.
- **Search and inspection**: `/knowledge` calls `wiki.search` and `wiki.get`, showing page/source/provenance so results remain auditable instead of becoming opaque chat context.
- **Role-first governance**: Knowledge Hub introduces a configurable `Knowledge Steward` role slot (`知识管理员`) for classification, tagging, duplicate/conflict/staleness checks, and change proposals. It is not a superuser: its default `canApplyDirectly` capability is always false.
- **Knowledge Inbox and provenance**: Verse Claw Main owns a lightweight inbox/provenance layer for candidate knowledge and usage metadata. Chat/session/task/file/OKF/ClawGraph candidates enter the inbox/draft/proposal review path before formal wiki mutation; provenance records source refs and read/reference events without mutating formal wiki pages.
- **Draft/proposal/audit state**: Verse Claw Main owns UI review state under `<openclawConfig>/knowledge/drafts`, `<openclawConfig>/knowledge/proposals`, and `<openclawConfig>/knowledge/audit.jsonl`. Formal knowledge still lives in `memory-wiki`; local draft/proposal state is the confirmation buffer.
- **Draft governance**: AI-generated, steward-generated, or session-derived knowledge is never written directly. Chat's `Save to Knowledge` action and the Knowledge page draft inbox create editable drafts/proposals; `wiki.apply` is reached only through an approved draft plus explicit user apply.
- **Change boundaries**: create/update/merge/archive/delete all travel as proposals. Updates and merges must show a diff; archive/delete must show targets and reason; users remain the only final confirmer.
- **Chat integration**: ChatInput exposes knowledge through a Codex-style Context Palette instead of making the composer a permanent knowledge workspace. Typing `/wiki <query>` searches source-backed wiki pages, lets the user attach explicit references as visible chips, and sends those references as read-only `knowledgeReferences`; `/memory`, `/all`, `/none`, and `/scope` adjust `knowledgeScope` without granting write authority. Main injects hidden runtime metadata for tool use while renderer cleanup keeps those instructions invisible in chat transcripts. `knowledgeScope=wiki/all` and selected references are read-only and only permit knowledge search/get; they never grant write, update, archive, delete, merge, or apply authority.
- **Agent routing mode**: `WorkspaceUiState.knowledgeMode` controls how knowledge is invoked independently from `knowledgeScope`. The default is `suggest`: Main may run a bounded `knowledge.routeContext` search and return chips, but the references are not attached unless the user clicks Attach. `manual` disables background routing and relies on `/wiki` or explicit references. `auto-read` is opt-in and may attach at most three fresh, non-contradicted, high-confidence read-only references before send. `knowledgeScope=none` always prevents routing/search.
- **Obsidian boundary**: Obsidian is optional. Verse Claw may expose `renderMode: "obsidian"` and open/search helpers when a user configures a vault or CLI is detected, but setup, ingestion, search, and draft apply do not depend on Obsidian.
- **Boundary with Role Memory**: role-first memory remains the structured, gatekeeper-governed memory card system for agent roles. Knowledge Hub is a wiki workbench for source-backed notes and syntheses; the two can reference each other but neither silently mutates the other.
- **Boundary with Task Ledger**: Task Ledger tracks current work shape and review state. Knowledge Hub stores reusable knowledge and decisions after user confirmation.

### 8.6.1 Governance Contract

Knowledge Hub uses Markdown/wiki as the inspectable storage format, but the primary interaction model is governed draft review, not free-form vault editing. The product contract is "read when the user asks to read; write only when the user confirms a write."

| Action | Ordinary agent | Knowledge Steward role | User |
|---|---:|---:|---:|
| Search knowledge | Allowed by `knowledgeScope` | Allowed | Allowed |
| View document/page | Allowed by `knowledgeScope` | Allowed | Allowed |
| Generate knowledge draft | Only when explicitly requested | Allowed | Allowed |
| Classify/tag/suggest taxonomy | Not default | Allowed | Allowed |
| Duplicate/conflict/staleness check | Not default | Allowed | Allowed |
| Propose create/update/merge/archive/delete | Not default | Allowed as proposal/diff | Allowed |
| Apply/write/modify/delete formal wiki content | Never directly | Never directly | Only confirmer |

Hard boundaries:

- `knowledgeScope=wiki` and `knowledgeScope=all` grant read intent only. They map to search/get behavior and must not be interpreted as write authority.
- Reading a useful fact does not create permission to update the wiki.
- Agents may say that something is worth saving, but the save path starts as a pending draft/proposal.
- Update and merge proposals must display a diff. Archive and delete proposals must display target page ids and reason.
- Runtime tools exposed to ordinary agents should never include direct `apply`, `archive`, or `delete` tools. UI-confirmed Main calls are the write gate.

### 8.6.2 Host API and Persistence Shape

The `knowledge` host API is a typed facade around two layers:

- **Runtime-backed wiki operations**: `status`, `init`, `configure`, `ingestFiles`, `search`, `get`, `compile`, `lint`, `openVault`, OKF validation/import over `wiki.ingest`, and the final `wiki.apply` call used by reviewed create proposals.
- **Verse Claw-owned governance operations**: `routeContext`, `createDraft`, `listDrafts`, `getDraft`, `updateDraft`, `reviewDraft`, `proposeChange`, `listProposals`, `previewChange`, `applyReviewedChange`, `stewardReview`, `governanceAudit`, watched directory configuration/events, and provenance recording.

Drafts and proposals are intentionally Main-owned because they are UI review state rather than formal knowledge. They live under:

- `<openclawConfig>/knowledge/inbox/*.json`
- `<openclawConfig>/knowledge/drafts/*.json`
- `<openclawConfig>/knowledge/proposals/*.json`
- `<openclawConfig>/knowledge/okf/bundles/*.json`
- `<openclawConfig>/knowledge/provenance/*.json`
- `<openclawConfig>/knowledge/watched-directories.json`
- `<openclawConfig>/knowledge/watched-events/*.jsonl`
- `<openclawConfig>/knowledge/audit.jsonl`

`KnowledgeDraft` records title/body/type/source refs/tags/workspace/agent/creator/status/warnings/steward notes. `KnowledgeChangeProposal` records operation, target page ids, optional draft id, diff/reason/sources, and always carries `requiresUserConfirmation: true`. `KnowledgeStewardConfig` is role/capability shaped and defaults to `canApplyDirectly: false`.
`KnowledgeInboxItem` records pending candidate knowledge from chat sessions, Task Ledger, ClawGraph, files, OKF imports, manual notes, or wiki results. Promoting an inbox item creates a normal editable draft and create proposal; dismissing it only updates inbox state. `KnowledgeProvenanceRecord` stores source refs and recent reference events so the UI can show where a knowledge item came from and when it was used.

### 8.6.3 Data Flow

Approved flow:

1. User imports sources, validates/imports an OKF local folder, or asks Chat to use knowledge.
2. Chat sends `knowledgeScope`, `knowledgeMode`, and any explicit `knowledgeReferences` as hidden read-only metadata; Main describes allowed search/get and denied apply/update/delete/archive/merge behavior.
3. `knowledge.routeContext` may search for candidates only when mode/scope allow it. Suggest-mode candidates remain UI chips until attached by the user; Auto-read candidates become read-only references only after confidence/freshness/conflict filtering.
4. Agent or Knowledge Steward reads/searches knowledge only within the selected scope and selected/auto references.
5. When the user asks to save or organize knowledge, Verse Claw either creates an editable `KnowledgeDraft` directly or places a candidate into Knowledge Inbox for review.
6. Optional Knowledge Steward review adds type, tags, notes, warnings, duplicate/conflict hints, or proposal suggestions without writing wiki content.
7. User promotes inbox candidates, edits drafts, and approves the draft/proposal.
8. `applyReviewedChange` verifies approved draft + approved proposal and only then calls `wiki.apply`.
9. Main records an audit event, then future chat turns can retrieve the saved knowledge through search/get.

OKF import follows a shorter explicit-write path: the user selects a local folder, Main validates it, the UI shows concepts/warnings/errors and selected concept checkboxes, then user confirmation calls `wiki.ingest` for selected concept Markdown files. OKF import never calls `wiki.apply`, never grants runtime agents write authority, and stores only adapter metadata under `knowledge/okf/bundles`.

Provenance follows a metadata-only path: when a user opens or attaches a wiki result, Main may append a `knowledge_referenced` audit event and update a provenance JSON record. This is not a knowledge write, does not modify the wiki page, and must not be used as permission to update or apply knowledge.

Forbidden flow:

- Chat send automatically triggering `wiki.apply`.
- Runtime agent directly calling write/delete/archive tools because `knowledgeScope` is enabled.
- Folder import switching the default vault to unsafe local access.
- Obsidian being required for setup, import, search, draft review, or apply.
- Knowledge Steward bypassing the user or acting as a hidden superuser.

### 8.6.4 UI Model

The `/knowledge` page is organized as a workbench rather than an Obsidian clone:

- **Library** browses reusable knowledge types such as decisions, architecture, commands, troubleshooting notes, glossary entries, sources, syntheses, and procedures.
- **Knowledge Inbox** shows pending candidates from chat/session/task/file/OKF/ClawGraph/manual sources. Users can inspect source refs and warnings, promote a candidate into the normal draft/review flow, or dismiss it.
- **Draft Inbox** collects user, agent, and steward-created drafts. Users can edit title, body, type, tags, and sources before review.
- **Review / Diff** shows new content, diffs, merge participants, or archive/delete targets before confirmation.
- **Governance** shows the Knowledge Steward role slot, default read-only agent boundary, and warning surfaces for missing sources, low confidence, conflicts, duplicates, or stale material.

Chat uses the `/` Context Palette as the primary knowledge entry point: `/wiki` searches and attaches wiki pages as visible chips, while `/memory`, `/all`, `/none`, and `/scope` change only read scope. Legacy quick controls may remain as compatibility affordances, but the intended UX keeps the composer clean until the user explicitly summons context. Session-level "Save to Knowledge" creates a review draft and proposal; it does not write directly. When wiki context is used in an answer, the intended UX is to surface page/source references so the user can inspect what influenced the response.

The composer knowledge menu also exposes `Manual / Suggest / Auto-read`. Suggest is the default because it gives the user a lightweight "found relevant knowledge" affordance without polluting the prompt. Auto-read is an explicit power-user mode: it adds only a tiny bounded set of read-only references and should show a Used Knowledge surface after send. `/knowledge mode manual|suggest|auto` changes this invocation mode without sending a prompt. `/steward audit` is also a command, but it is not a chat message: it runs `knowledge.governanceAudit`, opens the Knowledge Governance tab, and never creates proposals or applies wiki changes by itself.

### 8.6.5 OKF Compatibility

OKF support is a compatibility layer, not a second knowledge backend. The Main process owns validation and metadata persistence, while formal searchable knowledge still enters OpenClaw through `memory-wiki`.

- MVP input is a local folder only. Archive files, Git URLs, cloud catalogs, OKF export, and Google-specific services are intentionally out of scope.
- Non-reserved `.md` files are concepts. `index.md` and `log.md` are reserved and never imported as concepts; root `index.md` may declare `okf_version: "0.1"`.
- Concept files need parseable YAML frontmatter and a non-empty `type`. Unknown fields and unknown type values are preserved and surfaced as warnings, not destructive schema normalization.
- Validation warnings include missing optional fields, missing root index, broken internal links, unknown fields, and unknown types. Hard errors block import until the user fixes or excludes invalid content.
- Import is a user-confirmed action that calls `wiki.ingest` per selected concept file, writes bundle mapping metadata under `knowledge/okf/bundles`, and appends audit events. It never calls `wiki.apply`.

### 8.6.6 Extension Path

Future breadth should extend the same governance contract instead of adding a parallel knowledge stack:

- Add richer Steward capability profiles through role/capability configuration, not hardcoded UI permissions.
- Add better diff previews for update/merge/archive/delete once runtime wiki operations support them beyond create-synthesis MVP.
- Add citation/recent-use tracking so chat answers can show which pages were used.
- Add optional Obsidian open/render helpers only when configured or detected; the core workbench must remain fully usable without Obsidian.
- Add import connectors only through bounded, explicit user actions with provenance, never through ambient filesystem access.
### 8.6.7 Governance Dashboard

Knowledge Hub surfaces governance health through an on-demand dashboard in the `/knowledge` page's Governance tab. The dashboard does not poll or scan automatically; every check is triggered by the user.

**Health Checks**: Three explicit action buttons let the user run targeted diagnostics:
- **Run Health Check** performs a full `governanceAudit`, calling both `wiki.compile` and `wiki.lint`, and produces a complete issue set.
- **Run Lint** calls `wiki.lint` only, surfacing format/style/convention warnings without the heavier compile step.
- **Run Compile** calls `wiki.compile` only, detecting broken references, missing pages, and synthesis integrity gaps.

**Health Summary Cards**: After each check, the top of the Governance panel displays summary cards:
- **Contradictions** — conflicting or inconsistent knowledge entries (severity: error, red).
- **Stale** — pages not referenced or updated beyond a configurable threshold (severity: warning, amber).
- **Dangling** — pages with broken internal links, orphaned references, or missing source anchors (severity: info or warning depending on count, blue or amber).

Each card shows a count and a severity-colored border. Tapping a card scrolls to the filtered issue list.

**Action List**: Below the summary cards, a scrollable list displays individual `KnowledgeGovernanceIssue` records sorted by severity (error → warning → info). Each issue shows:
- Title, severity badge, and affected page IDs.
- A code-context snippet or diff when applicable.
- A dismiss button with undo support. Dismissed issues are hidden from the current view but recorded in `audit.jsonl` so they are not raised again on the next identical check result.

**Steward Suggestions**: When the Knowledge Steward role is configured, the dashboard appends a suggestion section with recommended actions (e.g., "Review 3 contradicting architecture decisions", "5 pages have not been updated in 90 days"). These suggestions are advisory only and never auto-apply.

**Last Check**: A timestamp row shows when the last `governanceAudit` was run, and a mini-history list shows the last 5 check results with issue-count deltas.

**Implementation note**: All governance checks route through `hostApi.knowledge.governanceAudit(...)`, which Main forwards to `wiki.compile` + `wiki.lint`. Results are aggregated into `KnowledgeGovernanceIssue[]` and returned to the renderer. No check runs on a timer or on page mount without user action.

### 8.6.8 Watched Directories (Review-Gated Auto-Capture)

The Knowledge Hub supports review-gated automatic capture from user-configured watch directories. This feature lets project documentation surface as pending knowledge candidates without silently mutating formal wiki pages.

**Configuration**: Users add watch directories via Settings → Knowledge → Watched Directories. Each entry records:
- `path` — absolute directory path.
- `patterns` — optional glob array (defaults to `["**/*.md", "**/*.txt", "**/*.yaml", "**/*.yml", "**/*.rst"]`).
- `excludes` — optional glob array (e.g., `["node_modules/**", ".git/**"]`).
- `requiresReview` — compatibility boolean normalized to `true`; automatic capture is review-gated and new files land in the Knowledge Inbox rather than being ingested directly to `sources/`.
- `enabled` — per-directory on/off switch.

A hard cap of 10 watch directories prevents resource exhaustion.

**Auto-Capture Behavior**:
- **File creation and modification** trigger review-gated capture: Main reads the changed file, creates a Knowledge Inbox item with source type `watched-file`, source refs, warnings, and provenance metadata, and does not call `wiki.ingest` directly.
- **New files** always enter the Knowledge Inbox. Legacy `requiresReview=false` input is accepted only as compatibility data and records a warning that direct wiki ingest is disabled for the automatic path.
- **File deletion** is detected and logged as a provenance event (`watched-file-deleted`) but never triggers automatic wiki deletion. The user must review and decide whether to archive the corresponding wiki page.
- **Rename/move** is treated as a delete (old path) + create (new path). Main logs the mapping so provenance records link the old and new paths.

**Debounce and Throttle**: File system events are debounced at 5 seconds per path. Rapid successive writes (e.g., during an editor save sequence) are coalesced into a single capture event. Throttling ensures at most one active capture per watch directory at a time.

**Persistence and Restore**: Watch directory configuration is stored in `<openclawConfig>/knowledge/watched-directories.json`, with events under `<openclawConfig>/knowledge/watched-events/*.jsonl`. On app startup, Main reads this file and re-establishes watchers for every enabled directory. The watcher lifecycle is tied to the Main process, not the renderer — closing the `/knowledge` page does not stop watching.

**Error Handling**: Permission errors, deleted directories, and unreadable files are surfaced as non-blocking UI notifications. A failed watch on one directory does not affect other directories. The settings UI shows a directory-level status indicator (watching / error / disabled).

### 8.6.9 Governance Data Flow

The governance subsystem operates entirely through the host API boundary, keeping knowledge mutation gated behind the same draft/proposal flow as the rest of Knowledge Hub.

**Audit Pipeline**:
1. User clicks **Run Health Check** (or Run Lint / Run Compile) in the Governance tab.
2. Renderer calls `hostApi.knowledge.governanceAudit()` for the full health check, or the existing `compile` / `lint` host methods for focused runs.
3. Main maps the scope:
   - `"full"` → `wiki.compile()` then `wiki.lint()`, merging results.
   - `"lint"` → `wiki.lint()` only.
   - `"compile"` → `wiki.compile()` only.
4. Runtime executes the requested operations against the configured wiki vault and returns structured results.
5. Main aggregates raw results into `KnowledgeGovernanceIssue[]`, assigning each issue:
   - `severity`: `"error"` (contradictions, broken references), `"warning"` (stale, low-confidence), `"info"` (dangling orphans, minor style issues).
   - `affectedPages`: page IDs involved.
   - `suggestion`: optional steward-provided or rule-derived action text.
6. Results are sorted severity-first (error → warning → info) and returned to the renderer.

**Dismissal Flow**:
- User dismisses an issue via the UI. Renderer calls `hostApi.knowledge.dismissGovernanceIssue({ issueId, reason? })`.
- Main appends an `audit.jsonl` entry with `type: "governance-dismissal"`, the issue fingerprint, and an optional reason.
- On the next audit, Main compares new issues against the dismissal log. Issues whose fingerprint matches a prior dismissal are suppressed unless the underlying pages have been modified since dismissal.

**Governance → Draft/Proposal Gateway**:
- Governance issues may include a "Create Fix Proposal" action that pre-populates a `KnowledgeChangeProposal` targeting the affected pages.
- This proposal enters the standard draft/proposal flow (see 8.6.3) — it must be reviewed and confirmed by the user before `wiki.apply` is called.
- Governance checks are **diagnostic only**. The governance flow never calls `wiki.apply`, `wiki.archive`, or `wiki.delete` directly. Every resulting change travels the same user-confirmed create/update/merge/archive/delete proposal path as any other knowledge mutation.


---

## 8.7 Chat Intensity and Legacy Work Mode Compatibility

Chat Work Modes are retired as a user-facing Chat control. The active Chat UX uses explicit reasoning/thinking effort, context/response intensity, Knowledge Scope, selected Knowledge refs, and optional existing Task Ledger node context. These are per-send preferences, not behavior presets, permission modes, or long-term state.

Current contract:

| Surface | Current rule |
|---------|--------------|
| Chat UI | No Plan/Build/Review/Docs/Data selector and no active `WorkModeSummaryPanel` in the Chat page |
| Settings UI | No Work Mode settings section or per-mode Work Kit toggles |
| Send path | `workMode` must not drive `hostApi.chat.sendWithMedia`, hidden prompt metadata, permissions, tools, Task Ledger state, Knowledge writes, `/loop`, Mission, or ClawGraph behavior |
| Legacy compatibility | `shared/types/work-mode.ts`, `WorkspaceUiState.workMode`, old settings keys, old locale keys, and `WorkModeSummaryPanel` may remain only for migrations/internal compatibility tests |
| `/loop` boundary | Legacy Work Mode and intensity controls must not create a Task Ledger root or enter checkpoint/intervention state |

Work Provider v1 remains the Main-owned capability layer for Office/Search style operations. `shared/types/work-provider.ts` defines provider kinds (`officeDocument`, `officeSheet`, `officeSlide`, `pdf`, `webSearch`, `webRead`, `formatConversion`, `crawler`, `ocr`, `dataFrame`), install modes, status values, and legacy Work Kit-to-capability mapping. `electron/services/work-providers-api.ts` exposes `status`, `run`, and `validateArtifact` through typed host API only. The light core uses project-available JS libraries where present (`mammoth`, `xlsx`, `pdfjs-dist`, `@mozilla/readability`, `jsdom`) and reports missing dependencies for absent generators/converters instead of installing silently. Search is an explicit-provider interface: Tavily, Brave, Bing, SearXNG, or Custom HTTP can be configured later, but no search request is sent while config is missing. Heavy LibreOffice/Pandoc/OCR/crawler/dataframe stacks are status/interfaces only until configured.

Future artifact workflows should be modeled as explicit provider/tool/artifact actions or dedicated UI surfaces, not by resurrecting Work Mode as a Chat behavior switch.

---

## 9. i18n, UX, and Theming

- Locales: `en`, `zh`, `ja`, `ru` under `shared/i18n/locales/`. All new user-facing strings must add to all four.
- Legacy Work Mode strings may remain under `composer.workMode*` and `workModePanel.*` for compatibility; new active Chat controls should use explicit effort/intensity/knowledge-scope locale keys with full locale coverage.
- No hardcoded display strings in components (rule enforced by workspace guidelines).
- Design tokens in `src/styles/globals.css` (surfaces, selected state, status colors, page headings).

---

## 10. Build, Dev, Test, and Validation

| Task | Command | Notes |
|---|---|---|
| Install + uv | `pnpm run init` | pnpm 10.33.4 pinned in `packageManager`; corepack enable first |
| Dev | `pnpm dev` | Vite + Electron + Gateway (port 18789, ~10-30s to ready) |
| Lint | `pnpm run lint` | Re-run if `uv:download` recently ran (temp-dir race) |
| Typecheck | `pnpm run typecheck` | |
| Unit | `pnpm test` | Vitest |
| E2E | `pnpm run test:e2e` | Playwright; required for user-visible UI changes |
| Build (frontend) | `pnpm run build:vite` | |
| Harness validate | `pnpm harness validate --spec <task-spec>` | Required before review for backend comms changes |
| Harness run | `pnpm harness run --spec <task-spec>` or `--dry-run` | For flow validation |
| Harness CI | `pnpm run harness:ci` | Mirrors GitHub Actions baseline |
| Comms replay / baseline / compare | `pnpm run comms:replay` / `baseline` / `compare` | Required for any communication-path change |

### 10.1 Spec-driven harness rule

Any AI Coding task that touches backend communication must start from a task spec under `harness/specs/tasks/` and reference `gateway-backend-communication` when the change involves renderer/Main/host-api/api-client/Gateway/OpenClaw runtime paths. Validate with `pnpm harness validate --spec <task-spec>` before implementation review, and run `pnpm harness run --spec <task-spec>` or `--dry-run` when checking the selected validation flow.

### 10.2 Doc sync rule

After any functional or architecture change, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; update in the same PR when flows, behaviors, or interfaces change.

---

## 11. Role-First Runtime Architecture

Verse Claw implements a **role-first agent runtime** 鈥?users don't just "pick a model," they compose and orchestrate a team of role-driven agents. This section documents the complete architecture as implemented.

### 11.1 Role Contracts

**8 built-in roles** defined in `openclaw_runtime/src/agents/role-contract.ts`:

| Role | Effort | Purpose |
|---|---|---|
| `planner` | high | Decompose tasks, identify risks |
| `architect` | high | Module boundaries, long-term maintainability |
| `implementer` | medium | Write code within a defined scope |
| `tester` | medium | Write tests, verify behavior |
| `reviewer` | high | Code review, quality gates |
| `security-reviewer` | xhigh | Security audit, threat modeling |
| `docs-writer` | medium | Documentation generation |
| `skeptic` | high | Adversarial challenge, false-positive elimination |

Each role is a **task contract**, not a persona 鈥?the `rolePrompt` defines responsibilities, boundaries, and output format, not "you are a top expert with 20 years of experience."

**Role contract fields**: `name`, `displayName`, `rolePrompt`, `tools[]`, `capabilities[]`, `toolRequirements[]`, `riskProfile`, `canModifyScope`, `permissions{filesystem,network,commands}`, `effort`, `model{default,fallback,provider}`, `outputSchema{format,sections}`, `handoff{to,from,requiresReview}`, `version`, `tags`.

**Custom roles** via config: `cfg.agents.roles[]` 鈥?snake_case or camelCase, validated by `validateRoleContract`, merged over built-ins by name (config wins on collision).

### 11.2 Three Orchestration Modes

| Mode | Trigger | Behavior |
|---|---|---|
| **Router** | Simple tasks (no "important" flag, 鈮? file hints) | Main agent picks one role; single worker |
| **Lead + Workers** | Complex tasks (multiple file hints, "important") | Lead decomposes; workers spawn **in parallel** (`Promise.allSettled`); lead synthesizes |
| **Adversarial Review** | Security/audit tasks | Workers run under security/review roles; verifier is gated until worker results are terminal; skeptic challenges evidence |

Mode selection is keyword + file-hint driven (`role-router.ts`). `preferredLeadRole` override lets the caller pin a specific lead.

`team_orchestrate` is the model-callable runtime entrypoint for these modes. A lead-capable main session calls it with `task` plus optional `templateId`/`teamTemplateId`, `fileHints`, `important`, `leadRole`, `includeVerifier`, `maxWorkers`, `qualityPolicy`, `repairPolicy`, `workerCommunication`, and `allowFollowupPlanning`. The tool returns a stable `orchestrationRunId`, the computed plan, child handles, attempts, failures, route diagnostics, and `nextAction`. `nextAction` is either `yield_for_results` or `synthesize_now`; leads must use push-based completion (`sessions_yield` when available) instead of polling `subagents` or `sessions_list`.

Operator UI wrappers can also call `orchestrator.plan` / `orchestrator.run` with an explicit `workers[]` array: `{ roleName, task, label?, modelRef? }[]`. The gateway validates each role against the role registry, accepts duplicate roles as separate worker instances, builds a `lead-workers` task graph without requiring ClawGraph YAML, and still launches through `runOrchestrationObserved` / `spawnSubagentDirect` so permission mode, lifecycle events, audit logging, and trace recording stay on the existing communication path.

Each spawned role prompt includes the original task, role responsibility, allowed scope/tools, expected output shape, a blocking/non-blocking marker, acceptance criteria, and explicit `Follow-up Candidates` / `Memory Candidates` sections. Workers may propose follow-up work or memory candidates, but leaf workers do not automatically spawn more agents or directly write long-term memory.

Completion-aware closure (v2): each child record carries orchestration metadata (`orchestrationRunId`, `templateId`, `roleName`, `phase`, `leadRole`, `expectedWorkerRunIds`, and verifier state). When verifier is enabled, initial orchestration spawns workers only; the runtime starts the verifier after expected workers reach terminal state. Lead sessions receive a single structured Team Result Bundle keyed by `orchestrationRunId` instead of unrelated worker completions.

Quality-closure protocol (v3): each worker is a role instance, not a cloned role. The runtime records a task ledger entry (`taskId`, `roleInstanceId`, `attempt`, `phase`, `scope`, `requiredCapabilities`, and status) on child metadata. The same role can therefore handle multiple slices of a task in the same run while preserving separate evidence, quality, and repair state.

Task-graph orchestration (v4): plans now include a first-class `taskGraph` and `executionWaves`. Nodes carry `taskNodeId`, role, phase, dependencies, scope, required capabilities, and bounded attempt policy; edges represent dependency, handoff, verification, repair, and follow-up relationships. `maxWorkers` caps each execution wave instead of deleting later graph nodes, and deferred verifier nodes stay in the graph while still launching through the existing completion-aware gate.

Team Result Bundle is the runtime event Lead agents synthesize from. Its stable fields are `orchestrationRunId`, `status`, `plan`, `taskGraph`, `graphStatus`, `executionWaves`, `workers[]`, `verifier`, `failures[]`, `attempts[]`, `quality[]`, `routeDiagnostics`, `pendingGraphNodes[]`, `repairNodes[]`, `rerouteRecommendations[]`, `followupCandidates[]`, `memoryCandidates[]`, and `synthesisInstructions`. Status values are `completed`, `partial`, `failed`, `verified`, or `refuted`.

### 11.3 Team Templates

**3 built-in** + **config-defined custom teams**:

| Template | Mode | Composition |
|---|---|---|
| `quick-development` | lead-workers | planner 鈫?implementer + tester 鈫?reviewer |
| `security-audit` | adversarial-review | security-reviewer + threat-modeler 鈫?skeptic |
| `refactor` | lead-workers | architect 鈫?refactorer + regression-tester 鈫?code-reviewer |

Custom teams via `cfg.agents.teams[]` 鈥?config overrides built-ins by id. `normalizeTeamTemplate` accepts both snake_case and camelCase.

When `templateId`/`teamTemplateId` is provided, orchestration strictly uses that template's `roles`, `defaultLeadRole`, `verifierRole`, and role-level `modelRef`. Unknown template ids fail as invalid input. When no template is provided, the existing role router remains the source of truth for mode and role selection.

### 11.4 Hard Tool Enforcement

Role permissions are **hard-enforced** (tools filtered before the model sees them, not advisory):

| Permission | Enforcement |
|---|---|
| `filesystem: "none"` | Deny all FS + shell tools |
| `filesystem: "read"` | Deny write/edit/apply_patch + shell |
| `network: "none"` | Deny all network tools (web_search, web_fetch, x_search, code_execution, browser) |
| `network: "limited"` | Deny high-risk (code_execution, browser, x_search); allow read-only retrieval (web_search, web_fetch) |
| `commands: []` + read-only fs | Deny shell |
| `commands: ["npm"]` + read-only fs | Deny shell (tool-level; command-argument filtering is future) |

The `role.tools[]` list is a **true allowlist** 鈥?any tool not listed is denied, even if the deny list doesn't explicitly include it.

### 11.5 Effort Levels

7-level effort 鈫?thinking mapping: `auto鈫抋daptive`, `minimal鈫抦inimal`, `low鈫抣ow`, `medium鈫抦edium`, `high鈫抙igh`, `xhigh鈫抶high`, `max鈫抦ax`.

### 11.6 Role-First Memory System

Verse Claw treats role memory as a **control plane** layered above the native OpenClaw memory stack. It does not replace or mutate `memory-core`, `MEMORY.md`, QMD, dreaming, or `memorySearch`. Native memory remains responsible for source material, search, dreams, and root memory files; role memory owns structured role-first governance, review, injection, and explainability.

**Storage boundary**: role memory uses a dedicated SQLite database at `<stateDir>/role-memory.sqlite`. It never writes the native memory-search index and never edits `MEMORY.md` or `memory/*.md`. The old `<stateDir>/memory-cards.json` MVP file is intentionally not migrated, read, or deleted.

**Runtime enablement boundary**: Settings -> System exposes a Role Memory switch that defaults on. The main process passes it to the Gateway as `OPENCLAW_ROLE_MEMORY_ENABLED`; when disabled, role-spawn does not resolve or inject Role Memory cards, no injection explain record is written, mutating `memory.*` RPCs return an explicit disabled error, and read RPCs return empty/disabled state. Existing `role-memory.sqlite` data remains on disk, and native OpenClaw memory (`MEMORY.md`, QMD, dreaming, `memorySearch`) is not modified.

**Boundary with Knowledge Hub**: Knowledge Hub uses runtime `memory-wiki` as an inspectable wiki workbench. Role memory remains the gatekeeper-governed card system for role behavior and context injection; Knowledge Hub drafts never bypass role-memory proposal/review rules.

**Core tables**:

| Table | Purpose |
|---|---|
| `role_memory_cards` | Canonical structured role-memory cards with scope, role/phase tags, evidence refs, sensitivity, durability, source, lifecycle state, and version-chain metadata |
| `role_memory_proposals` | Proposal-first write queue for create/update/archive/supersede/tombstone operations |
| `role_memory_versions` | Immutable snapshots for every applied card mutation |
| `role_memory_conflicts` | Duplicate, contradiction, scope, stale, role, permission, and sensitive-review conflicts |
| `role_memory_audit_events` | Proposal, apply, review, archive, supersede, merge, resolve, and injection audit history |
| `role_memory_injections` | Per role-spawn injection explain logs, including policy version, candidate scores, selected/skipped reasons, and truncation |

**Memory Card structure**: role-first memory cards now include the original MVP fields plus `scopeKey`, `phaseTags`, `evidenceRefs`, `sensitivity`, `durability`, `source`, `updatedAt`, and version-chain metadata. The card is a structured control-plane record, not a replacement for `MEMORY.md`, QMD, dreaming, or `memorySearch`.

**Four memory states**: `active` (injectable), `cold` (not auto-injected), `archived` (historical only), `tombstone` (logical delete).

**Gatekeeper pipeline**: `propose 鈫?normalize 鈫?classify 鈫?evidence check 鈫?conflict detect 鈫?decision 鈫?commit/review`. Decisions are fixed as `accept`, `reject`, `merge`, `supersede`, or `needs_review`; agents cannot write long-term memory directly.

**Persistence**: SQLite at `<stateDir>/role-memory.sqlite` with tables for cards, versions, conflicts, audit events, and injection explain records. The old `<stateDir>/memory-cards.json` MVP file is not migrated, read, or deleted.

**V2 proposal governance**: All role-memory mutations create a `role_memory_proposals` record before any card is applied. Low-risk proposals are applied automatically and retained as applied proposals; conflicts, sensitive content, scope escalation, high-importance low-evidence changes, and role-authored high-scope writes remain in review until `memory.review` approves or rejects them.

**Role-aware injection**: At spawn time, `resolveRoleMemoryCards` filters active injectable cards by role, builds a conflict-aware `Context Pack`, renders a structured `## Memory Context` section, and records a `memory.explainInjection` entry.

**Context Pack** (`buildContextPack`): Token-budgeted context injection with 7 buckets: hard constraints, role playbook, project facts, team handoffs, recent episodes, open conflicts, and task state 鈥?total budget ~3000 tokens, overflow truncated.

**Context Pack v2 scoring**: `selectMemoryForContextPack` scores candidates by scope precedence, role/phase/task match, importance, confidence, recency, access frequency, and sensitivity/conflict/staleness penalties. Injection explain records include `role-memory-context-v2`, selected/skipped candidate scores, bucket placement, and truncation reasons.

**Proposal immutability and review safety**: `applied` and `rejected` proposals are terminal. Review actions cannot silently replay an already-applied proposal, and `supersede` review requires an explicit target card. This keeps proposal, audit, and version chains idempotent under repeated UI or RPC calls.

**Conflict governance**: `memory.resolveConflict` only changes conflict state; it does not rewrite card content. Content-changing resolutions must go through proposal/review or `memory.merge`, preserving audit and version history.

**Deterministic extraction**: `memory-extractor` produces `MemoryProposalDraft` objects from explicit remember-like user text, trace summaries, session summaries, orchestration handoffs, and read-only `memorySearch` evidence candidates. It does not apply cards directly, and LLM-assisted extraction remains off by default.

**UI surface**: the Roles panel exposes a lightweight governance view, not a full knowledge-base workbench. Tabs are `Active`, `Review`, `Conflicts`, and `Injections`; users can create role memory, archive cards, approve/reject/apply-as-cold proposals, inspect conflict groups, and view recent injection logs through `hostApi.gateway.rpc`.

**Governance v3 ownership**: cards and proposals now distinguish related role tags from governance ownership. `ownerRole` identifies the role responsible for a memory, `sourceRole` records who discovered it, `applicableRoles` controls which roles may receive it at runtime, and `allowedMutators` describes who may propose changes. Missing v3 fields fall back to legacy `roleTags`.

**Semantic memory types**: v3 expands memory type semantics to `fact`, `constraint`, `preference`, `procedure`, `risk`, `decision`, `episode`, `handoff`, and `artifact_ref`. Legacy `project_fact`, `role_experience`, `episodic`, and `procedural` remain accepted and normalize into the new type policy.

**Policy engine**: scope and mutation governance is centralized in `memory-policy.ts`. The gatekeeper records `permissionDecision`, `permissionReason`, `riskLevel`, `impactScope`, `suggestedAction`, and `reasonSummary` on proposals and decisions. Role-authored workspace/user constraints are rejected or reviewed by policy rather than hidden if-else branches.

**Native evidence bridge**: native OpenClaw memory remains a one-way evidence/source layer. Role memory can reference `memory_search`, `memory_md`, `qmd`, `dream`, `trace`, `session`, `file`, and `manual` evidence refs, including short excerpts, but it does not write native indexes or memory files.

**Injection classes**: Context Pack v3 classifies candidates as `must`, `should`, `may`, or `never` before scoring. Explain logs now include `injectionClass` and optional `whatWouldSelect`, so skipped cards can explain what would make them relevant in a future run.

**Retention suggestions**: v3 adds read-only lifecycle suggestions (`keep`, `cold`, `archive`, `tombstone`, `review`) based on importance, confidence, evidence, access frequency, recency, type weight, staleness, and sensitivity. Suggestions do not mutate cards until a user turns them into a proposal.

**Detail drawer**: the Role Memory UI now includes a governance detail drawer that aggregates overview, ownership, policy, evidence, conflicts, versions, audit events, and recent runtime injection impact for a selected card/proposal/conflict/injection.

**V4 trustworthy governance closure**: role memory now closes the loop from suggestion to auditable action. `memory.retentionCandidates` remains read-only, while `memory.retentionPropose` converts a lifecycle suggestion into a proposal that must still be reviewed. `memory.reviewBatch` applies approve/reject/apply-as-cold across multiple proposals with per-item results and batch audit history, so one failed proposal does not hide the outcome of the rest.

**Conflict workbench**: `memory.conflictDetail` expands an open conflict into related cards, proposals, scope precedence, evidence health, and a suggested action. `memory.mergeDraft` creates a draft proposal from cards/proposals without applying it; content-changing resolutions still go through proposal/review or `memory.merge`. `memory.resolveConflict` remains metadata-only and never rewrites card content.

**Evidence health**: `memory.evidenceCheck` evaluates role-memory evidence refs as `verified`, `missing`, `stale`, `weak`, `contradicted`, or `unchecked`. Native memory evidence (`memory_search`, `memory_md`, QMD, dreams, traces, sessions, files) is inspected as a read-only bridge; role memory still does not write native memory stores or indexes.

**Injection simulation and health**: `memory.simulateInjection` dry-runs the same Context Pack selector used by role spawn and returns selected/skipped candidate explanations, classes, scores, penalties, and `whatWouldSelect`. Injection records now carry a selector/policy snapshot for historical explainability. `memory.health` reports local role-memory integrity checks such as schema availability, version coverage, supersede-chain gaps, orphan proposals, and weak evidence.

**V4 UI workflow**: the Roles panel keeps Role Memory in the role-management context, but adds mature workflow controls: retention suggestions can become proposals, review supports batch actions, conflicts can open a comparison/detail flow and generate merge drafts, injections can be simulated for the current task, and the detail drawer offers edit-as-proposal, supersede, restore, retention proposal, and tombstone proposal actions. Renderer code continues to use `hostApi.gateway.rpc` only.

**V5 user-facing governance UX**: the Role Memory UI now treats editing as a structured proposal workflow. Users can edit semantic type, scope, sensitivity, confidence, importance, ownership, applicable roles, allowed mutators, phase tags, expiration, and evidence refs before submitting. `memory.previewProposal` dry-runs the same gatekeeper/policy/evidence/conflict checks and returns a read-only governance preview without writing cards, proposals, audit events, conflicts, or native memory. The Injections tab groups simulation results by `must`, `should`, `may`, and `never`, shows context budget usage, and keeps the detail drawer focused on the runtime impact path from proposal to governance decision to injection/lifecycle state.

**V6 real utility loop**: role memory now records explicit operator feedback through `memory.feedback` and exposes it through `memory.feedbackList`, `memory.utilityReport`, and `memory.evalReport`. Utility reports are computed only from real stored signals: injection explain logs, card/proposal/conflict state, retention candidates, review outcomes, and user/reviewer feedback. Metrics that require missing evidence, such as memory-on/off task success delta, remain `null` and include an `insufficientData` explanation instead of fabricated scores. The Roles panel adds a compact Quality tab and feedback controls on recent injection candidates, so users can see sample size, helpful/harmful rates, token overhead, stale/conflict rates, and per-card utility without leaving the role governance workflow.

### 11.7 Input Control Layer (3 modes)

| Mode | Behavior | Implementation |
|---|---|---|
| **Interrupt** | Abort current run, restart with new message | `abortChatRunsForSessionKeyWithPartials` + fresh dispatch |
| **Guide** | Inject hint without interrupting | `queueEmbeddedAgentMessageWithOutcomeAsync` 鈥?non-disruptive steering into the active run's LLM loop |
| **Queue** | Hold message until run completes, then deliver | `user-message-queue.ts` FIFO + `triggerQueueDrain` on `clearActiveEmbeddedRun` 鈥?auto-delivers as a follow-up run |

All three modes are triggered via the ChatInput input-mode selector (mirrors the permission picker pattern). Explicit `inputMode` from the UI overrides the regex classifier.

**Queue lifecycle**: enqueue 鈫?`chat.queue-status` broadcast (UI shows amber "queued" badge + count) 鈫?run ends 鈫?`clearActiveEmbeddedRun` calls `triggerQueueDrain` 鈫?drain callback combines queued messages 鈫?re-dispatches as a new `chat.send` 鈫?`run.started` event re-arms UI.

### 11.8 Smart Routing

`role-router.ts` scores roles by: bilingual keyword match (EN + 涓枃), file-hint regex (test/docs/security), role tags, and a default implementer bias. `preferredLeadRole` override honored when the role exists in the pool.

V3 routing adds deterministic-first diagnostics on top of the existing router. The planner infers required capabilities from task text, file hints, security/importance markers, and template selection, then emits `routeDiagnostics{difficulty,confidence,reasons,selectedRoles,rejectedRoles,requiredCapabilities,capabilityGaps}`. Model classification can be added later as advisory input, but the current runtime does not depend on a model-only difficulty judgment.

Capability-aware routing preserves role-first semantics: role responsibilities define the boundary, and tools remain hard allowlisted under that boundary. If a selected role lacks a required capability or tool, the runtime records a capability gap instead of silently widening permissions. Leads can then synthesize partial risk, choose a different role/template in a follow-up run, or request explicit permission escalation.

### 11.9 Observability

**Span taxonomy** (12 kinds): `orchestrator`, `role-router`, `team`, `subagent`, `model`, `tool`, `memory`, `context-pack`, `gatekeeper`, `verifier`, `input-mode`, `custom`.

**Trace recording**: `runOrchestrationObserved` wraps plan + initial worker spawn in recorder spans 鈫?`storeRuntimeTrace(trace, scorecard)` 鈫?trace buffer (cap 100, in-memory). Deferred verifier execution is correlated through `orchestrationRunId` and child-run metadata.

**Trace index**: Electron Main maintains a Verse Claw-owned local JSON/JSONL observability index with sanitized trace envelopes, query rows, issue summaries, correlation keys, and update timestamps. Retention defaults to 30 days or 1000 traces; index rehydration can rebuild graph data from persisted summaries plus trajectory sidecars without introducing SQLite or another database.

**Diagnostics**: `buildObservabilityTraceGraph` and `traceNodeDiagnostics` share a redaction pipeline and issue detector. The detector marks root-cause errors, aborted/stalled running traces, slow/token/cost hotspots, retries, approval waits, artifacts, command failures, missing verifier coverage, orphan trajectory events, and missing final output while keeping raw prompt/output/tool args/tool output out of graph, index, query, and diagnostics payloads.

**Scorecards**: `buildTraceScorecard` computes per-trace quality grades (reliability, efficiency, coverage) 鈫?stored alongside traces 鈫?surfaced in the Observability dashboard via `observability.traces` RPC.

**Real-time lifecycle events**: Each worker spawn emits `subagent-lifecycle` broadcast 鈫?`event-dispatch` 鈫?`main/index.ts` relay 鈫?renderer `hostEvents.onSubagentLifecycle` 鈫?RolesOrchestrationPanel progress panel (per-worker status: started/completed/verified/error with role-tone colors).

**Trace status correctness**: `failures.length > 0 鈫?status: "error"` (not always "completed") + error summary passed to `completeObservedRun`.

**Worker quality**: Team Result Bundles include deterministic worker quality signals (`schemaCompliance`, `evidenceCoverage`, `scopeDiscipline`, `actionability`, `verificationSignal`, `verifierVerdict`, `runtimeHealth`). Poor attempts are used as demotion/repair evidence; the runtime does not delete role contracts at run time.

### 11.10 Orchestration Reliability

- **Per-worker timeout** (120s): `Promise.race` wrapper 鈥?hung worker recorded as failure, doesn't block the run
- **Task graph execution**: v4 computes dependency-aware execution waves; ready nodes in the same wave run with `Promise.allSettled`
- **Verifier dependency** (adversarial): verifier is not part of the initial spawn batch; runtime starts it after expected workers are terminal
- **Error recovery**: Worker failure doesn't abort remaining workers (failures collected, not thrown)

- **Worker cap**: `maxWorkers` is capped by the configured subagent child limit and limits each execution wave; spawn-time depth/child policy still applies
- **Two-phase verifier**: verifier spawn is deferred until all expected workers finish; all-worker failure skips verifier and reports a failed bundle
- **Team result bundle**: steering queue aggregates same-run worker/verifier completions into one runtime event for Lead synthesis
- **Task ledger**: same-role repeated work creates separate role instances (`roleName + taskId + attempt`) with stable `roleInstanceId`
- **Repair/redo graph nodes**: timeout/no-output can produce redo nodes, partial/verifier gaps can produce repair nodes, and permission/capability gaps produce reroute recommendations without widening role tools
- **Controlled follow-up expansion**: worker follow-up candidates become `pendingGraphNodes` only when follow-up planning is allowed and bounded by `maxFollowupRuns`; leaf workers still cannot spawn descendants
- **No automatic worker chat**: v4 does not enable worker-to-worker `sessions_send`; all worker results return to the lead for synthesis. `workerCommunication="bounded_a2a"` is recorded as requested but remains disabled by default

### 11.11 Audit Logging

`orchestrator.run` captures actor identity via `resolveControlPlaneActor(client)` and emits structured `[role-audit]` log lines: actor/device/ip + lead role + mode + worker count + failure count + sessionKey. Both success and failure paths are logged. Uses existing `context.logGateway` infrastructure (no new persistence layer).

Each run creates an `orchestrationRunId` and carries it through planning, child spawn, lifecycle broadcast, trace attributes, and the RPC/tool response.

### 11.12 External CLI Integration

Runtime supports `codex`, `claude`, `gemini`, `opencode`, `droid` as ACP harness backends (`acp-spawn.ts:474`) with per-provider bundle adapters, OAuth credential sync, and runtime selection policy.

### 11.13 UI Components

| Component | File | Purpose |
|---|---|---|
| `RolesOrchestrationPanel` | `src/components/agents/RolesOrchestrationPanel.tsx` | Role browsing, plan preview, orchestration launch, approval round-trip, run result feedback, real-time progress panel |
| `SubagentRunnerPanel` | `src/components/agents/SubagentRunnerPanel.tsx` | Preset-based Explorer / Reviewer / Tester / Compare launcher with goal input, per-child lifecycle status, failures, summary, and Observability trace link |
| `RoleCard` | `src/components/agents/RoleCard.tsx` | Role card with effort tone, tool grid, permission trio, SOUL preview |
| `OrchestrationPlanView` | `src/components/agents/OrchestrationPlanView.tsx` | Layered card flow (Lead 鈫?Workers 鈫?Verifier) with connectors |
| `role-visuals.ts` | `src/lib/role-visuals.ts` | Shared role鈫抰one / effort鈫抰one / span-kind鈫抰one mapping |
| `Observability` | `src/pages/Observability/` | Dashboard with metric cards, lead-role column, span-kind waterfall, scorecards |
| `TaskLedger` | `src/pages/TaskLedger/` + `src/components/task-ledger/` | Workspace-scoped long-task ledger with Tree/DAG/History/Review tabs and Chat summary panel |
| `ChatInput` | `src/pages/Chat/ChatInput.tsx` | Input-mode selector (auto/interrupt/guide/queue) + feedback badges + queue count |

### 11.14 Gateway RPC Methods (Role-First)

The model-callable `team_orchestrate` tool is not a separate transport. It reuses the same planner, `runOrchestrationObserved`, `spawnSubagentDirect`, subagent registry, completion announcement, steering queue, and trace buffer as the control-plane RPCs. Leaf subagents do not receive this tool by default, and read-only role policies treat it as a mutating operation.

`team_orchestrate` returns the v1-compatible `children[]`, `failures[]`, and `nextAction`, plus graph/closure fields: `expectedChildren[]`, `pendingVerifier`, `taskGraph`, `graphStatus`, `executionWaves`, `attempts[]`, `routeDiagnostics`, `pendingGraphNodes[]`, `repairNodes[]`, `rerouteRecommendations[]`, `quality[]`, `followupCandidates[]`, `memoryCandidates[]`, and `resultPolicy{completion, verifier, workerCommunication, repairPolicy, qualityPolicy}`. Leads still call `sessions_yield` when `nextAction="yield_for_results"`; the follow-up turn receives the Team Result Bundle when the run is ready to synthesize.

| Method | Scope | Purpose |
|---|---|---|
| `roles.list` | read | List builtin + config roles |
| `roles.get` | read | Get single role contract + compiled SOUL |
| `teams.list` | read | List builtin + config team templates |
| `orchestrator.plan` | read | Preview orchestration plan (no spawn); accepts optional explicit `workers[]`, `templateId`/`teamTemplateId`, `maxWorkers`, `graphMode`, quality/repair/communication policy fields, and returns `taskGraph`, `executionWaves`, `routeDiagnostics`, and capability gaps |
| `orchestrator.run` | write | Execute orchestration (spawns subagents, records trace, emits lifecycle events, logs audit); accepts optional explicit `workers[]`, `templateId`/`teamTemplateId`, `maxWorkers`, `graphMode`, quality/repair/communication policy fields, and returns `orchestrationRunId`, `taskGraph`, `executionWaves`, `expectedChildren`, `pendingVerifier`, `attempts`, `repairNodes`, `rerouteRecommendations`, and `routeDiagnostics` |
| `observability.reportTrace` | write | Store a trace |
| `observability.traces` | read | Get trace buffer + scorecards |
| `memory.list` | read | List role-memory cards by scope, role, status, type, conflict state, and sensitivity |
| `memory.propose` | write | Create a proposal-first memory mutation; low-risk proposals auto-apply, high-risk proposals enter review |
| `memory.update` | write | Propose a controlled update to an existing card through the gatekeeper |
| `memory.archive` | write | Propose archival of a card; no hard delete in v2 |
| `memory.supersede` | write | Propose a replacement card and preserve the version/supersede chain |
| `memory.store` | write | Legacy wrapper over `memory.propose`; retained for older callers |
| `memory.conflicts` | read | List detected duplicate, contradiction, scope, role, stale, permission, and sensitive-review conflicts |
| `memory.resolveConflict` | write | Resolve conflict status without silently rewriting card content |
| `memory.explainInjection` | read | Inspect role spawn injection logs, selected cards, scoring reasons, bucket placement, and truncation |
| `memory.proposals` | read | List proposal queue entries by status, role, scope, operation, or decision |
| `memory.review` | write | Approve, reject, apply-as-cold, supersede, or merge a proposal from the review queue |
| `memory.merge` | write | Merge multiple cards/proposals into a new card while archiving old cards |
| `memory.versions` | read | Read the immutable version chain for a card |
| `memory.audit` | read | Read proposal, apply, review, resolve, and injection audit events |
| `memory.stats` | read | Return active/cold/archived/conflict/proposal counts for UI badges |
| `memory.policy` | read | Return role-memory governance policy, semantic types, and context policy version |
| `memory.retentionCandidates` | read | Return read-only lifecycle suggestions for cold/archive/tombstone/review |
| `memory.retentionPropose` | write | Convert retention suggestions into proposal records without mutating cards |
| `memory.reviewBatch` | write | Apply review actions to multiple proposals with per-item results and audit |
| `memory.conflictDetail` | read | Expand a conflict into related cards/proposals, evidence health, scope precedence, and suggested action |
| `memory.mergeDraft` | write | Build a merge/supersede draft proposal without applying it |
| `memory.evidenceCheck` | read | Check role-memory evidence refs through the read-only native evidence bridge |
| `memory.simulateInjection` | read | Dry-run Context Pack selection for a role/task using the runtime selector |
| `memory.health` | read | Report SQLite/schema/version/supersede/evidence health for role memory |
| `memory.utilityReport` | read | Compute real-data utility metrics from feedback, injections, review, conflict, and retention signals |
| `memory.evalReport` | read | Return utility metrics plus an optional dry-run selector output; task success deltas stay null without paired eval data |
| `memory.feedbackList` | read | List recorded role-memory usefulness feedback |
| `memory.feedback` | write | Record operator feedback for a card/injection without mutating cards or native memory |
| `memory.detail` | read | Aggregate card/proposal/conflict/injection detail, versions, audit events, and runtime impact |
| `memory.previewProposal` | read | Dry-run proposal normalization, gatekeeper, policy, evidence, and conflict checks without mutating role or native memory |
| `memory.restore` | write | Create a restore proposal for archived/tombstone memory without directly reactivating it |

### 11.15 ClawGraph Runtime v1

ClawGraph sits above the role-first runtime as a durable long-task execution layer. It is designed for tasks that need stable decomposition, parallel/fan-in structure, reviewable evidence, and bounded worker context instead of a single ever-growing chat transcript.

| Layer | Files | Responsibility |
|---|---|---|
| Shared types | `shared/types/clawgraph.ts`, `openclaw_runtime/src/agents/clawgraph/types.ts` | `ClawGraphWorkflowSpec`, `ClawGraphIR`, run snapshots/events, handoffs, audit results, review items |
| Compiler | `openclaw_runtime/src/agents/clawgraph/compiler.ts` | YAML parse, schema checks, role/model refs, duplicate node ids, DAG cycle checks, sandbox narrowing |
| Runtime | `openclaw_runtime/src/agents/clawgraph/runtime.ts` | Boss scheduler, in-memory run store, node state projection, stateless worker prompts, handoff extraction, audit/review flow |
| Gateway | `openclaw_runtime/src/gateway/server-methods/clawgraph-methods.ts` | `clawgraph.*` JSON-RPC handlers and `clawgraph-lifecycle` broadcasts |
| Main host-api | `electron/services/clawgraph-api.ts` | Workspace YAML listing, path boundary checks, Gateway proxying, unavailable diagnostics |
| Renderer | `src/pages/ClawGraph/index.tsx` | Workflow list, compile diagnostics, run controls, read-only DAG, event timeline, review actions |

**DSL / IR**: YAML v1 lives at `.clawx/clawgraph/*.yaml`. `models` name model refs, `roles` map to runtime roles and model policies, `nodes` define `agent` or `audit` work with `dependsOn`, `control` defines bounded parallelism and failure policies, and `termination` defines required completion checks. The compiler turns this into `ClawGraphIR`; failed compile returns diagnostics instead of partially running.

**Boss scheduler**: run state is event-driven: `queued -> ready -> running -> handoff_received -> auditing -> done|failed|review|blocked`. Dependency-satisfied nodes run up to `control.maxParallel`. Worker failures can retry within policy. Audit failures freeze for review rather than being silently accepted.

**Stateless worker contract**: each worker receives only the objective, its node task, dependency handoff summaries, role contract, allowed tools/permissions, and the required handoff JSON schema. Workers do not keep an open conversation with each other; the handoff is the only cross-node transfer surface.

**Audit and review**: v1 validates handoff schema, trace/subagent run existence, evidence refs, workspace-contained file refs, and consistency. Claims that require an external truth source without evidence produce `ClawGraphReviewItem`s. `clawgraph.review` applies approve/reject decisions and resumes or freezes the run accordingly.

**Boundaries**: ClawGraph does not replace `team_orchestrate`, Task Ledger, observability, memory, or manual compaction. It reuses the existing subagent runtime and permission model, records execution state separately, broadcasts lifecycle updates, and lets Main mirror high-value evidence into Task Ledger with idempotent system events.

---

## 12. What's Complete and What is Not

### 12.1 Complete (this snapshot)

- Two-layer architecture with hard IPC + transport boundaries
- 34 host-api service modules, every renderer call goes through `src/lib/host-api.ts`
- Full gateway process supervisor (WS / HTTP / IPC fallback, restart governor, capability monitor, connection monitor, startup orchestrator, stderr classifier, reload policy)
- 60+ openclaw_runtime sub-domains, ~150+ advertised gateway methods, 136 bundled extensions
- Plugin SDK (`openclaw/plugin-sdk/*`) with narrow subpath barrels
- Renderer extension framework (host-api contribution + marketplace + auth)
- i18n: 4 locales, all pages covered (including role-first `roles.*`, `observability.*`, Knowledge Hub `knowledge.*`, ClawGraph `clawGraph.*`, `composer.knowledgeScope.*`, `composer.inputMode.*`, `composer.queue*`, and legacy `composer.workMode.*` / `workModePanel.*` compatibility keys)
- Design tokens + component conventions in `globals.css`
- E2E harness (Playwright) + unit harness (Vitest) + comms replay/baseline/compare
- Token usage dashboard reading from runtime `.jsonl` transcripts
- ClawHub integration in Verse Claw (search / install / uninstall / open)
- OpenClaw Doctor button in Verse Claw Settings 鈫?Advanced 鈫?Developer
- Agent Browser browser automation v1: Cron `browserAutomation` tasks compile to isolated `agentTurn` payloads with `toolsAllow: ["agent_browser"]`, managed browser/profile/authState persistence, safety gates, diagnostics, and Run Detail evidence cards
- Auto-update (electron-updater) with multi-channel
- Workspace browser (file tree + terminal + web preview + artifact panel)
- Workspace permission and sandbox control: `policy-light` default, optional `docker-strong` / `ssh-strong`, shared effective sandbox policy resolver, OpenClaw `sandbox.mode=off` lightweight mapping, Docker degraded fallback, and command/RPC risk gates
- Workspace Task Ledger (append-only JSONL task state, Tree/DAG/History/Review UI, Chat summary, offline HTML export)
- ClawGraph Runtime v1 (workspace YAML DSL, YAML-to-IR compiler, boss scheduler, stateless worker handoffs, audit/review flow, `/clawgraph` UI)
- Long-task stability stack: Chat transcript for conversation, Chat Input Mode for human intervention, manual compaction for pressure relief, Resume Checkpoint for continuation, Context Pack for bounded injection, ClawGraph for execution, Task Ledger for durable work truth, Observability for evidence, Knowledge Hub for reusable knowledge
- Knowledge Hub (Verse Claw-managed native wiki by default, bounded local import, search/inspect, compile/lint, draft/proposal review, Knowledge Steward governance, user-confirmed apply, optional Obsidian render mode)
- Chat slimming (Work Mode UI/send behavior retired, explicit effort/intensity preferences retained, legacy Work Mode data kept only for compatibility, Work Provider APIs remain Main-owned for Office/Search operations)
- **Role-first runtime** (see 搂11 for full detail):
  - 8 built-in roles + config-defined custom roles with validation
  - 3 orchestration modes (router / lead-workers / adversarial-review) with parallel worker spawn and deferred verifier gating
  - 3 built-in team templates + config-defined custom teams
  - Model-callable `team_orchestrate` for role-first subagent planning, spawn, push-based completion, and lead synthesis
  - Completion-aware orchestration closure: deferred verifier gating + Team Result Bundle aggregation
  - Hard tool enforcement (filesystem/network/commands 鈫?deny lists, expanded NETWORK_TOOLS)
  - Memory system: role-first SQLite store, ownership/applicable-role governance, semantic memory types, proposal-first policy gatekeeper, review queue, audit/version chains, conflict governance, deterministic extraction drafts, v3 must/should/may/never context injection, retention suggestions, detail drawer, and injection explain logs
  - Input control layer: interrupt 鉁?+ guide 鉁?+ queue 鉁?(all 3 modes complete with UI feedback)
  - Smart routing (bilingual keywords + file hints + preferredLeadRole override)
- Observability: 12 span kinds, trace recording + scorecards, real-time lifecycle events, correct failure status
- Orchestration reliability: per-worker timeout, parallel workers, deferred verifier gating, error recovery
- Audit logging (structured `[role-audit]` via `context.logGateway`)
- External CLI integration (codex/claude/gemini/opencode/droid ACP harness backends)
  - UI: RolesOrchestrationPanel, RoleCard, OrchestrationPlanView, role-visuals, Observability dashboard, Task Ledger, ClawGraph, ChatInput input-mode, knowledge-scope, active task-node, and effort/intensity controls

### 12.2 Known limitations / non-finished

- Workspace + permission control is implemented for Main-owned files, terminal, web preview, Git, Gateway RPC, OpenClaw exec config sync, and sandbox status. Remaining work is broader native OS isolation beyond `policy-light` / Windows-light metadata and fuller UI/E2E coverage for every approval surface.
- `policy-light` is a control-plane sandbox, not a container, VM, or kernel-equivalent isolation boundary. Docker/SSH remain optional strong providers and must be explicitly selected/configured.
- ClawGraph v1 is a running MVP, not a full workflow editor. Run state is currently in-memory, graph edits during a run enter review instead of mutating the active DAG directly, and audit does not prove external database or SaaS truth without explicit evidence.
- Agent Browser browser automation is a runtime agent surface, not a browser product. First-round scope intentionally excludes address-bar/tab/bookmark/history/download/DevTools UI, visual RPA builders, and broad profile-management UX; external browser/CDP/local Chrome profile reuse stays behind explicit advanced gating.
- Custom agent + MCP-CDP remote control is also a plan document (`docs/mcp-custom-agent-and-cdp-remote-control-plan.md`) awaiting implementation.
- `diffs` extension is on the runtime side; the Monaco diff viewer in the renderer is wired but not all runtime methods have UI affordances yet.
- The `device.token.rotate` / `device.token.revoke` and other pairing flows are exposed on the runtime side, but the renderer UI for full device lifecycle is partial.

### 12.3 Codex / Claude Code Parity Roadmap

This roadmap turns the existing long-task, Git, plugin, rules, diff, and evidence foundations into product entry points that feel familiar to Codex and Claude Code users. It is a product/spec alignment layer, not a new architecture layer. Future implementation work must continue to use `harness/specs/**` as the durable source of truth and must not introduce `.trellis` or another parallel agent framework.

#### Codex / Claude Code Parity Matrix

| Capability | Codex / Claude Code expectation | Existing Verse Claw foundation | Product entry gap | vNext slice | Priority |
|---|---|---|---|---|---|
| Code review | Findings-first review, severity ordering, file/line evidence, test gaps, and no accidental edits | Review-style Chat behavior, Observability trace graph, Task Ledger review nodes, role-first verifier/reviewer roles | No unified review inbox that joins code diff, runtime evidence, ledger review items, and actionable findings | Code Review Center | P0 |
| Diff inspection | Fast before/after inspection, staged/unstaged views, generated patch review, and safe apply/reject flow | Workspace Git panel, `shared/types/git.ts`, Monaco diff preview, runtime `diffs` extension | Diff surfaces are split across file preview, Git, runtime diffs, and Knowledge proposal diffs | Diff Workbench | P0 |
| Project rules | Agent behavior should be grounded in visible project rules, task specs, and local instructions | `AGENTS.md`, `harness/specs/**`, Project Rules Center MVP work, renderer/Main boundary rules | No consolidated product view for active rules, selected task context, validation commands, and rule drift | Project Rules Center | P0 |
| Developer commands | Discoverable, repeatable commands for typecheck, test, e2e, harness, doctor, and diagnostics | `package.json` scripts, Doctor buttons, terminal, harness CLI, diagnostics APIs | Commands are discoverable only through docs/terminal, not a typed command palette/status surface | Developer Command Surface | P1 |
| Git / worktree / PR | Structured branch, worktree, staging, commit, and PR workflows with reviewable intent | `git-github-worktree-agent-tools` task spec, Git host-api types/services, workspace permission gates | Git capabilities need a cohesive workspace/agent flow and PR-ready review checkpoints | Git / Worktree / PR Workflow | P1 |
| Hooks / skills / plugins | Install, package, validate, and debug agent capabilities without breaking runtime startup | Plugin SDK, Skills page, ClawHub, hook loader, plugin lifecycle specs, `decouple-skills-page-from-gateway` | Packaging and hook behavior need clearer user-facing lifecycle, diagnostics, and recovery entry points | Hook / Skill / Plugin Packaging | P2 |
| Review evidence | Completion and risk decisions should be backed by trace, diff, test, and ledger evidence | Observability, Task Ledger, ClawGraph review items, Knowledge proposals, Mission reviewer plan | Evidence exists in several surfaces but lacks a single review narrative for coding tasks | Review & Evidence UX | P0 |

#### Priority Matrix

| Priority | Slices | Reason |
|---|---|---|
| P0 | Code Review Center, Diff Workbench, Project Rules Center | These turn existing foundations into daily coding surfaces and close the largest parity gaps. |
| P1 | Developer Command Surface, Git / Worktree / PR Workflow | These make implementation and handoff workflows repeatable once review/diff/rules are visible. |
| P2 | Hook / Skill / Plugin Packaging | The runtime and plugin foundations already exist; vNext should polish packaging, diagnostics, and recovery UX. |

#### Developer Command Surface

- **Goal**: Provide a typed, discoverable developer command surface for project-local commands such as typecheck, tests, E2E, harness context/validate/run, Doctor, diagnostics, and common Git checks.
- **Non-goals**: Do not replace the integrated terminal, invent a new task runner, bypass workspace permission mode, or let renderer code spawn commands directly.
- **Existing foundation**: `package.json` scripts, terminal/web preview workspace shell, `openclaw doctor` host route, diagnostics services, harness CLI, and workspace permission gates.
- **Product entry gaps**: Commands are scattered across docs and terminal history; users cannot see last run status, recommended validation for the selected task spec, or safe command presets in one place.
- **Acceptance criteria**: Commands resolve from project metadata and harness context; runs use Main-owned execution and permission checks; UI shows command intent, cwd, last status, logs, and retry; all user-visible text has full i18n; E2E covers command discovery and a safe read-only command.
- **Testing suggestions**: Unit test command resolution and workspace containment; E2E test the command surface with mocked command results; run `pnpm run typecheck` and relevant harness validation for touched specs.

#### Git / Worktree / PR Workflow

- **Goal**: Make branch, worktree, staged diff, commit, and PR preparation a first-class workspace workflow that agents and users can review before mutation.
- **Non-goals**: Do not replace the terminal, bundle Git/GitHub CLI, auto-merge PRs, or let renderer call shell/Gateway endpoints directly.
- **Existing foundation**: `git-github-worktree-agent-tools` task spec, Git host-api contracts, workspace Git panel work, permission approvals, and Task Ledger session links.
- **Product entry gaps**: Git actions need one cohesive workflow that connects intent, diff review, test evidence, commit metadata, branch/worktree state, and PR creation readiness.
- **Acceptance criteria**: Git actions are host-api backed; write operations are reviewable and permission gated; worktree paths stay workspace-contained; PR creation is blocked until required review/test evidence is visible or explicitly waived.
- **Testing suggestions**: Unit test Git service argument-array execution and path checks; E2E test status/diff/stage/commit/PR readiness with fixtures; run comms replay/compare if host-api or Gateway paths change.

#### Hook / Skill / Plugin Packaging

- **Goal**: Give developers a clear lifecycle for packaging, validating, installing, updating, disabling, and recovering hooks, skills, and plugins.
- **Non-goals**: Do not add a second marketplace, silently install dependencies, bypass plugin ownership resolution, or let invalid packages enter active runtime config.
- **Existing foundation**: Plugin SDK, bundled extensions, hook loader, Skills page, ClawHub install/search, plugin lifecycle management scenario, validation/recovery specs, and Gateway startup diagnostics.
- **Product entry gaps**: Packaging and hook diagnostics are mostly runtime/developer surfaces; users lack a guided packaging checklist, validation results, startup-impact warnings, and rollback/recovery actions in one product flow.
- **Acceptance criteria**: Packaging UX references existing plugin lifecycle rules; validation blocks unsafe activation; diagnostics identify owner conflicts, missing deps, stale symlinks, and startup impact; recovery preserves user config and leaves actionable messages.
- **Testing suggestions**: Reuse plugin lifecycle unit tests; add E2E for visible install/validation/recovery states when UI is implemented; run plugin lifecycle harness validate for affected specs.

#### Review & Evidence UX

- **Goal**: Present coding-task evidence as one review narrative: changed files, diffs, tests run, trace summaries, ledger review items, risks, and unresolved claims.
- **Non-goals**: Do not treat observability as task truth, do not auto-complete ledger goals, and do not expose raw prompts or sensitive outputs in review summaries.
- **Existing foundation**: Observability trace graph/node diagnostics, Task Ledger review nodes, ClawGraph review items, Knowledge proposal diffs, Chat Review mode, and Mission reviewer plan.
- **Product entry gaps**: Evidence is distributed across Observability, Task Ledger, Chat, Git, and Knowledge; there is no task-scoped review view that tells the user what is proven, missing, risky, or ready to accept.
- **Acceptance criteria**: Review summaries cite evidence refs; missing evidence is explicit; file/test/trace links are navigable; redaction and truncation rules apply; unresolved claims remain review items instead of being treated as completion.
- **Testing suggestions**: Unit test evidence aggregation and redaction; E2E test a mocked review bundle with missing evidence and linked traces; run `pnpm run comms:replay` and `pnpm run comms:compare` for communication-path changes.

#### Code Review Center

- **Goal**: Build a P0 review inbox for code changes that leads with findings, severity, evidence refs, file/line anchors, test gaps, and recommended next actions.
- **Non-goals**: Do not auto-edit code during review, do not merge PRs, and do not replace review-style Chat behavior or Observability.
- **Existing foundation**: Review-style Chat behavior, role-first reviewer/verifier roles, Observability, Task Ledger review queue, Git diff types, and ClawGraph audit/review flow.
- **Product entry gaps**: Review data is not centralized; findings are not normalized across Chat, Git, traces, ledger items, and runtime audit outcomes.
- **MVP path**: `/code-review` exposes a read-only Review Center backed by `hostApi.codeReview`. Main process collects Git diffs for uncommitted changes, base branch comparison, or a selected commit; runs a model-only/no-tool review through the Gateway; normalizes findings to severity/file/line/reason/suggested fix; records a sanitized Observability trace; and can create Task Ledger `review` nodes without touching the working tree.
- **Acceptance criteria**: Users can open the Review Center, choose uncommitted/base-branch/commit targets, add a custom focus, inspect severity-sorted findings with file/line/reason/suggested-fix fields, and create Task Ledger `review` nodes without staging, committing, or editing files.
- **Testing suggestions**: Add `tests/e2e/code-review-center.spec.ts` for visible review flows; unit test review aggregation and redaction; validate `harness/specs/tasks/code-review-center-vnext.md`.

#### Diff Workbench

- **Goal**: Build a P0 diff workbench that unifies Git staged/unstaged diffs, file preview diffs, runtime `diffs` artifacts, and proposal diffs into one inspectable surface.
- **Non-goals**: Do not invent a new VCS layer, do not apply patches without explicit confirmation, and do not move runtime `diffs` storage into renderer state.
- **Existing foundation**: Workspace Git panel, Monaco diff preview, `shared/types/git.ts`, runtime `diffs` extension, Knowledge proposal diff fields, and file preview infrastructure.
- **Product entry gaps**: Diff viewers are fragmented and do not share filtering, evidence links, staged state, or review disposition.
- **Acceptance criteria**: Users can filter by source/status/file, inspect before/after hunks, link diffs to review findings and tests, and apply/reject only through Main-owned confirmed actions when mutation is supported.
- **Testing suggestions**: Add `tests/e2e/diff-workbench.spec.ts`; unit test diff source aggregation and path containment; validate `harness/specs/tasks/diff-workbench-vnext.md`.

#### Project Rules Center

- **Goal**: Build a P0 rules center that shows active project instructions, selected harness task context, required rules, validation commands, and drift/missing-spec warnings.
- **Non-goals**: Do not replace `AGENTS.md`, move durable policy out of `harness/specs/**`, or create another rules directory.
- **Existing foundation**: `AGENTS.md`, `harness/specs/rules/scenarios/tasks/guides/layers`, harness context/validate CLI, Project Rules Center MVP work, and renderer/Main boundary specs.
- **Product entry gaps**: Rules are inspectable only by reading files or CLI output; users cannot see which rules apply to the active task, which validations are required, or whether new lessons belong in rules, guides, layers, or tasks.
- **Acceptance criteria**: Users can select a task spec, see read order and required rules, run or copy validation commands through the Developer Command Surface, and create/update only harness-backed specs without introducing parallel truth.
- **Testing suggestions**: Add `tests/e2e/project-rules-center.spec.ts`; unit test harness context parsing and displayed validation commands; validate `harness/specs/tasks/project-rules-center-vnext.md`.

---

## 13. Appendix A: host-api Module Index

Generated from `src/lib/host-api.ts` (37 modules):

Knowledge module: `knowledge` (`status`, `init`, `configure`, `ingestFiles`, `validateOkfBundle`, `importOkfBundle`, `search`, `get`, `compile`, `lint`, `applyDraft`, `openVault`, `createInboxItem`, `listInboxItems`, `updateInboxItem`, `dismissInboxItem`, `promoteInboxItemToDraft`, `createDraft`, `listDrafts`, `getDraft`, `updateDraft`, `reviewDraft`, `proposeChange`, `listProposals`, `previewChange`, `applyReviewedChange`, `stewardReview`, `recordKnowledgeReference`, `getProvenance`).

Task Ledger module: `taskLedger` (`snapshot`, `appendEvents`, `createNode`, `updateNode`, `addEdge`, `linkSession`, `requestReview`, `clearReview`, `exportHtml`).

ClawGraph module: `clawGraph` (`listWorkflows`, `compile`, `run`, `status`, `events`, `abort`, `review`).

Code Review module: `codeReview` (`run`, `createTaskLedgerNode`).

`app` 路 `openclaw` 路 `shell` 路 `dialog` 路 `window` 路 `updates` 路 `uv` 路 `settings` 路 `workspaces` 路 `terminal` 路 `git` 路 `projectRules` 路 `permissions` 路 `webPreview` 路 `gateway` 路 `remoteControl` 路 `mcp` 路 `sandbox` 路 `logs` 路 `channels` 路 `agents` 路 `diagnostics` 路 `providers` 路 `files` 路 `media` 路 `sessions` 路 `chat` 路 `codeReview` 路 `workProviders` 路 `knowledge` 路 `cron` 路 `taskLedger` 路 `clawGraph` 路 `skills` 路 `usage` 路 `topics` 路 `observability`

## 14. Appendix B: Runtime Top-level Modules

60+ sub-domains, full list (alphabetical): `acp` 路 `agents` 路 `auto-reply` 路 `bindings` 路 `bootstrap` 路 `channels` 路 `chat` 路 `cli` 路 `commitments` 路 `compat` 路 `config` 路 `context-engine` 路 `cron` 路 `daemon` 路 `gateway` 路 `hooks` 路 `image-generation` 路 `infra` 路 `interactive` 路 `link-understanding` 路 `llm` 路 `logging` 路 `mcp` 路 `media` 路 `media-generation` 路 `media-understanding` 路 `memory` 路 `memory-host-sdk` 路 `model-catalog` 路 `music-generation` 路 `node-host` 路 `observability` 路 `pairing` 路 `plugin-sdk` 路 `plugins` 路 `plugin-state` 路 `process` 路 `provider-runtime` 路 `proxy-capture` 路 `realtime-transcription` 路 `routing` 路 `secrets` 路 `security` 路 `sessions` 路 `shared` 路 `skills` 路 `state` 路 `status` 路 `talk` 路 `tasks` 路 `tools` 路 `trajectory` 路 `transcripts` 路 `tts` 路 `types` 路 `utils` 路 `video-generation` 路 `web` 路 `web-fetch` 路 `web-search`

## 15. Appendix C: Glossary

- **Agent Browser / Agent OS Browser**: the runtime-level browser automation environment exposed to agents through `agent_browser`. Verse Claw owns managed browser windows, profile/authState references, security gates, and evidence display; the runtime owns tool invocation and telemetry, while Cron can schedule it as isolated `agentTurn` work.
- **Cron browserAutomation task**: a Cron job kind that stores browser task intent (`url`, objective, login-state reference, safety policy, diagnostics, and success/failure conditions) and compiles it into a normal agent turn with `toolsAllow: ["agent_browser"]`.
- **Memory Proposal**: a proposal-first memory mutation record used for create, update, archive, supersede, and tombstone operations before any card content changes.
- **Injection Explain Log**: a persisted role-spawn trace describing selected and skipped memory candidates, scores, buckets, penalties, budget, and truncation reasons.
- **Knowledge Hub**: the Verse Claw UI and host-api layer over OpenClaw `memory-wiki`, used for source-backed wiki knowledge, bounded import, search/inspect, compile/lint, governed draft/proposal review, and user-confirmed synthesis apply.
- **Knowledge Steward**: a role-first governance slot for classifying, tagging, checking sources/conflicts/duplicates/staleness, and proposing knowledge changes. It cannot apply changes directly by default.
- **Knowledge Draft**: editable pending knowledge content created by the user, an agent, or the Knowledge Steward; it remains outside the formal wiki until user review.
- **Knowledge Inbox Item**: a candidate knowledge unit from chat, Task Ledger, ClawGraph, files, OKF, wiki search, or manual input. It can be promoted into a draft/proposal or dismissed, but it is never formal wiki content by itself.
- **Knowledge Change Proposal**: a create/update/merge/archive/delete proposal that carries targets, sources, reason, and diff or preview details before any formal wiki mutation.
- **Knowledge Scope**: the per-message Chat setting (`none`, `memory`, `wiki`, `all`) that tells the runtime which memory/wiki corpus may be read for that send. It is read-only intent and never grants write, update, archive, delete, merge, or apply authority.
- **Knowledge Provenance Record**: Main-owned metadata that tracks source refs and read/reference events for a wiki page, draft, inbox item, OKF concept, or manual target without mutating formal knowledge.
- **OKF Bundle**: an Open Knowledge Format local Markdown folder with YAML frontmatter concepts. Verse Claw validates and imports it as a compatibility adapter over `memory-wiki`, preserving metadata while keeping user confirmation and `wiki.ingest` boundaries.
- **Work Mode (legacy)**: the retired per-session Chat setting (`plan`, `build`, `review`, `docsData`). It remains only as deprecated/internal compatibility data and must not drive Chat behavior, permissions, tools, Task Ledger state, Knowledge writes, `/loop`, Mission, ClawGraph, or runtime policy.
- **Work Kit (legacy compatibility)**: an artifact-focused legacy declaration such as `reports`, `sheets`, `slides`, `pdf`, `research`, `website`, `design`, or `ops`. Kits may still help map compatibility data to Work Provider capabilities, but they do not grant tools or define active Chat modes.
- **Work Provider**: a Main-owned Office/Search capability adapter. Providers expose status, source kinds, controlled runs, and artifact validation through `hostApi.workProviders`; they are not model providers and do not bypass workspace sandbox, approval, or runtime tool policy.
- **Work Mode Preset (legacy)**: the deprecated shared compatibility record (`shared/types/work-mode.ts`) containing old label keys, recommended permission hints, default knowledge scope hints, response style, state widgets, legacy tool bundle labels, Work Kits, and runtime intent text for tests/migrations only.
- **Engineering Control Signals**: the internal long-conversation constraint fields (`controlSignals`, `validationState`, `acceptanceStatus`, and quality dimensions) used by ResumeCheckpoint, Task Loop, Mission Loop, and Task Ledger metadata to express evidence gaps, missing validation, scope drift, unverified claims, and replan requirements without creating a second task fact source.
- **Mission Control**: the planned Verse Claw product layer for long-goal autonomy. It binds user objectives to Task Ledger state, wakes on manual/scheduled/event ticks, rebuilds bounded context from checkpoints and evidence, and decides whether a Mission should continue, repair, sleep, ask the user, complete, or block.
- **Mission Loop**: the planned runtime primitive behind Mission Control. It is an outer policy loop above `task_loop`, ClawGraph, cron/wake, observability, and governed memory proposal flows.
- **Wiki Vault**: the `memory-wiki` storage surface. The default vault is Verse Claw-managed and isolated; Obsidian-backed rendering is optional.
- **Task Ledger**: the workspace-scoped, agent-neutral long-task state ledger owned by Verse Claw Main; it records work structure and progress, not reusable knowledge or run telemetry.
- **Task Event**: an append-only ledger event used as the source of truth for task state; snapshots are projections from events.
- **Task Snapshot**: the materialized read model consumed by the UI, containing nodes, edges, current goal, blockers, review queue, recent decisions, session links, and warnings.
- **Review Node**: a task ledger node or dependency state that requires user confirmation before being treated as settled.
- **ClawGraph**: the runtime long-task orchestration layer that compiles workspace YAML into an execution DAG, runs stateless role workers, audits handoffs, and emits lifecycle evidence.
- **ClawGraph Handoff**: the fenced `clawgraph_handoff` JSON object a worker must return so a downstream node can proceed without inheriting the upstream transcript.
- **ClawGraph Review Item**: a frozen audit failure, graph-change proposal, or uncertain completion that requires explicit user approval or rejection through `clawgraph.review`.
- **Resume Checkpoint**: the minimal structured continuation record used after compaction, interrupt, abort, ClawGraph handoff, audit failure, review, or session rotation; it lets a new run resume without replaying the full transcript.
- **Chat Session Fork**: a runtime-backed child conversation that inherits the source session's active transcript branch and non-running UI state without generating a handoff draft, auto-sending, or creating a Git branch/worktree. Fork lineage is session metadata for navigation, not task truth.

- **Workspace** 鈥?a user-managed working path (folder) used to scope terminals, file previews, and web preview.
- **Agent** 鈥?a configured AI persona with its own model, channel bindings, and per-agent SQLite.
- **Channel** 鈥?a messaging platform (WhatsApp / Telegram / Discord / 鈥?.
- **Skill** 鈥?a runtime-loadable capability the agent can invoke.
- **Provider** 鈥?a model or multimodal vendor.
- **Talk** 鈥?realtime voice sessions (provider + bridge).
- **Approval** 鈥?exec / plugin approval events that the Verse Claw permission panel decides on.
- **Capability** 鈥?a method the runtime has advertised as available *right now* (used to gate UI buttons during cold start).
- **Host event** 鈥?a push event from the main process to the renderer (mirrors a runtime broadcast event).
- **Role Contract** 鈥?a task contract defining an agent's responsibilities, tools, permissions, effort, and output schema (not a persona).
- **Orchestration** 鈥?the process of decomposing a task, spawning role-driven subagents, and synthesizing results.
- **Team Template** 鈥?a reusable composition of roles with a lead, workers, and verifier for a specific workflow type.
- **Memory Card** 鈥?a structured, gatekeeper-validated knowledge entry with scope, roleTags, confidence, and lifecycle status.
- **Context Pack** 鈥?a token-budgeted assembly of memory cards, task state, and procedural notes injected into a subagent's SOUL.
- **Input Mode** 鈥?the classification of a user message during an active run: interrupt (abort+restart), guide (non-disruptive steering), or queue (deferred delivery). For long tasks, this is the human intervention control layer rather than a compaction mechanism.
- **Span** 鈥?a unit of observability tracing representing a discrete operation (orchestrator, subagent, tool call, etc.).
- **Scorecard** 鈥?a quality assessment of a completed trace (reliability, efficiency, coverage grades).
