# Role-First Runtime — Implementation Analysis & Blueprint

Status: **in progress** (discovery complete; core runtime wiring landing in stages)
Scope locked with the user (2026-06-13):

1. Role-driven subagent execution + orchestrator bridge (incl. role registry + config loading)
2. Input-mode (interrupt / guide / queue) → steering
3. **Hard** tool-allowlist enforcement (role `tools` → `inheritedToolAllowlist`, others denied; fs/network → policy/sandbox)
4. New Gateway RPC + wire the existing ClawX UI

Out of scope this round: observability-trace unification (runtime trace-recorder ↔ electron adapter) and the memory subsystem (`context-pack`/`gatekeeper`/`memory-card`) injection into the live context engine. Both are designed below under "Deferred" so the next round is unambiguous.

---

## 1. Problem statement — the MVP is three disconnected islands

A previous pass produced a coherent, well-tested "role-first" MVP, but it is **orphaned**: it passes unit tests yet nothing in the real runtime calls it.

| Island | Files | Reality |
| --- | --- | --- |
| Runtime role-first core | `openclaw_runtime/src/agents/{role-contract,role-router,orchestrator,input-classifier,team-template,team-template.types}.ts` | Pure functions. Imported **only** by each other + `tests/unit/role-runtime-mvp.test.ts`. |
| Runtime memory + observability | `openclaw_runtime/src/memory/{memory-card,context-pack,gatekeeper,types}.ts`, `openclaw_runtime/src/observability/{trace-recorder,scorecard,metrics,role-first-observer,types}.ts` | Pure functions. Only consumer is the test + `role-first-observer` (itself orphaned). |
| Input-mode bridge | `openclaw_runtime/src/sessions/input-mode.ts` (`createInputModeAction`) | Imports `input-classifier`, but **has zero consumers**. |
| ClawX UI / contract | `shared/types/agent.ts` (mirrors `RoleContract` + `AgentRoleProfile`), `src/components/agents/RoleProfileEditor.tsx`, `src/pages/Agents/index.tsx`, `electron/services/observability-*.ts` | A *separate*, partly-real surface. Electron observability is driven by live `ChatRuntimeEvent`s and is unrelated to the runtime observability island. |

"真实有效" (real & effective) = bridge the runtime island into the actual agent execution path so role contracts genuinely change agent behavior, the orchestrator genuinely spawns role-driven subagents, input-mode genuinely steers, and the ClawX UI can drive/observe it over real RPC.

The seams are clean: `spawnSubagentDirect()` already accepts `model`, `thinking`, an appended `extraSystemPrompt`, and inherited tool allow/deny lists — a role contract maps onto these almost 1:1.

---

## 2. Build / run reality (read this before editing the runtime)

ClawX launches the gateway as an Electron `utilityProcess.fork` (`electron/gateway/process-launcher.ts:165`). The entry is chosen in `electron/gateway/config-sync.ts:786 prepareGatewayLaunchContext()`:

- Runtime mode is `source` whenever the vendored tree is present (`electron/utils/paths.ts:148 isOpenClawRuntimeEnabled`, env `CLAWX_OPENCLAW_RUNTIME=source|npm`).
- **Critical:** `getOpenClawRuntimeEntryPath()` (`paths.ts:196`) returns `openclaw_runtime/dist/entry.js` **if it exists**, else `src/entry.ts` via tsx. A `dist/` exists, and the comment notes tsx is unreliable on Windows. **Therefore edits to `openclaw_runtime/src/*.ts` only take effect after `pnpm run build:runtime`.**
- `pnpm run build:runtime` → `scripts/build-openclaw-runtime.mjs`: esbuild bundles `src/entry.ts` (+ 3 workers) into `dist/`, following relative + `@openclaw/*`/`openclaw/*` alias imports, keeping `node_modules` external. **Any new module must be reachable from `entry.ts` via imports to be bundled** — satisfied automatically because we wire into RPC handlers and `subagent-spawn`.
- `predev` runs `build-openclaw-runtime.mjs`; `dev` is `vite`.

Verification commands (run when Opus/Bash is available):

```
pnpm run build:runtime          # MUST run after runtime src edits
pnpm run typecheck:node
pnpm run typecheck:web
pnpm exec vitest run tests/unit/role-runtime-mvp.test.ts tests/unit/observability-mvp.test.ts
pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-registry.test.ts   # new
```

> Tooling note for agents working this repo: large parts of the vendored runtime are skipped by ripgrep (the `Grep` tool); pass **no** `glob` param, or fall back to `Read` on known import paths. `Glob` with a full `openclaw_runtime/...` prefix returns empty — use `Grep` without a path filter to enumerate, then `Read`.

---

## 3. Integration seams (mapped, with exact references)

### 3.1 Subagent spawn — the primary behavior seam
`openclaw_runtime/src/agents/subagent-spawn.ts`:

- `spawnSubagentDirect(params: SpawnSubagentParams, ctx: SpawnSubagentContext): Promise<SpawnSubagentResult>` (line ~1075).
- `SpawnSubagentParams` (line 167) already has `model?`, `thinking?`, `label?`, `agentId?`, `mode?`, `cwd?`, etc.
- `SpawnSubagentContext` (line 192) already has `inheritedToolAllowlist?: string[]` and `inheritedToolDenylist?: string[]`.
- System prompt: `childSystemPrompt = buildSubagentSystemPrompt({...})` (line 1431), then it is appended to (`childSystemPrompt = \`${childSystemPrompt}\n\n${materializedAttachments.systemPromptSuffix}\`` at line 1482) and finally passed as `extraSystemPrompt: childSystemPrompt` to the `agent` gateway method (line 1574).
- Model/thinking resolution: `resolveSubagentModelAndThinkingPlan(...)` (line 1292) honors `params.model` / `params.thinking`.

**Seam:** add one optional `params.roleSystemPrompt?: string`; append it to `childSystemPrompt` exactly like the attachment suffix. Everything else (model, thinking, tool allowlist) is already pluggable. Keep the edit additive/backward-compatible.

### 3.2 Tool-allowlist enforcement — hard deny
`openclaw_runtime/src/agents/inherited-tool-deny.ts`:
- `normalizeInheritedToolAllowlist` / `inheritedToolAllowPatch` — the child session persists `inheritedToolAllow`/`inheritedToolDeny` (`subagent-spawn.ts:1337-1338`, `buildDirectChildSessionPatch:334-341`).
- The effective gate is `isToolAllowedByPolicyName(tool, { allow, deny })` (`tool-policy-match.ts`), consumed by `agent-tools.policy.ts` / `agent-tools.before-tool-call.ts`. A non-empty `allow` list is a true allowlist: tools not matched are denied.

**Seam:** set `ctx.inheritedToolAllowlist = role.tools` → hard allowlist. `filesystem`/`network`/`commands` map to sandbox + command policy in a later refinement (documented in §6).

### 3.3 Gateway RPC registration
- Canonical policy table: `openclaw_runtime/src/gateway/methods/core-descriptors.ts` → `CORE_GATEWAY_METHOD_SPECS` (line 21). Each `{ name, scope, advertise?, startup?, controlPlaneWrite? }`. `advertise !== false` ⇒ advertised in the handshake automatically. `createCoreGatewayMethodDescriptors(handlers)` (line 280) maps spec name → handler and **throws if a handler exists without a spec** (a spec without a handler is silently skipped — safe).
- Handler assembly: `openclaw_runtime/src/gateway/server-methods.ts` builds `coreGatewayHandlers` via repeated `createLazyCoreHandlers({ methods: [...], loadHandlers })` blocks (agents.* at line 567 via `loadAgentsHandlers`), then `createRequestGatewayMethodRegistry()` (line 586) calls `createCoreGatewayMethodDescriptors(coreDescriptorHandlers)` (line 601).
- Scopes: `gateway/operator-scopes.ts` (`operator.read|write|admin|...`). Read methods need `operator.read`; spawn (write) needs `operator.write`.
- Handler shape: `GatewayMethodHandler` / `GatewayRequestHandler` from `gateway/server-methods/types` (re-exported through `methods/descriptor.ts`).

**Seam — new methods:**
| Method | Scope | Behavior |
| --- | --- | --- |
| `roles.list` | `operator.read` | merged registry (builtin + config) |
| `roles.get` | `operator.read` | one role contract + compiled SOUL |
| `teams.list` | `operator.read` | `getTeamTemplateSnapshot()` |
| `orchestrator.plan` | `operator.read` | `createOrchestratorPlan(req)` (no spawn) |
| `orchestrator.run` | `operator.write` | plan → spawn role subagents |

Add specs to `CORE_GATEWAY_METHOD_SPECS`, add one `createLazyCoreHandlers({ methods:[...], loadHandlers: loadRoleHandlers })` block, and create the handler module `gateway/role-orchestration-methods.ts`.

### 3.4 Electron proxy + host-api
- `shared/host-api/contract.ts` defines `HostApiContract` modules (e.g. `observability` at line 1319). Add a `roles` + `orchestrator` module mirroring the shape.
- `electron/services/*-api.ts` implement modules; `electron/main/ipc-handlers.ts:186` registers them. A service method calls the gateway via the existing client (`electron/gateway/client.ts` / `ws-client.ts`, same path `agents-api.ts` uses for `agents.list`).
- `electron/gateway/capability-monitor.ts` holds the **required** method list that gates `gatewayReady`. New methods are *additive* and must **not** be added to the required list (so older runtimes still pass).

### 3.5 UI
- `shared/types/agent.ts` already mirrors `RoleContract` + `AgentRoleProfile` (lines 27-118).
- `src/components/agents/RoleProfileEditor.tsx` edits `AgentRoleProfile` (SOUL-based). `src/pages/Agents/index.tsx` is the host page.
- Plan: a "Roles" panel populated from `roles.list`, and an orchestration trigger calling `orchestrator.plan`/`orchestrator.run`, surfaced through the new host-api module.

### 3.6 Input-mode → steering (scope item 2)
- `openclaw_runtime/src/sessions/input-mode.ts createInputModeAction(input, explicitMode)` returns `{interrupt|guide|queue}`.
- The real seam is the inbound `chat.send` / `sessions.send` path while a run is active. The existing `sessions.steer` core method (`core-descriptors.ts:216`) is the injection RPC; abort is `chat.abort`/`sessions.abort`. `agent-steering-queue.ts` is for *subagent-result* delivery, **not** user input — do not conflate.
- Plan: at inbound dispatch, if a run is active for the session, call `createInputModeAction`; `interrupt` → abort + resubmit, `guide` → `sessions.steer`, `queue` → enqueue follow-up. Exact dispatch function lives in the gateway chat path (trace `chat.send` handler in `server-methods.ts` lazy block).

---

## 4. Target architecture

```
                       ┌─────────────────────────── ClawX renderer ───────────────────────────┐
                       │  Agents page · RoleProfileEditor · Roles panel · Orchestration panel  │
                       └───────────────┬───────────────────────────────────┬──────────────────┘
                          window.hostApi.roles / .orchestrator (IPC)
                       ┌───────────────┴───────────────────────────────────┴──────────────────┐
                       │ electron/services/roles-api.ts · orchestrator-api.ts → gateway.call() │
                       └───────────────────────────────────┬──────────────────────────────────┘
                                              gateway RPC (roles.* / orchestrator.*)
   openclaw_runtime ┌───────────────────────────────────────┴───────────────────────────────────┐
                    │ gateway/role-orchestration-methods.ts (loadRoleHandlers)                    │
                    │   roles.list/get → role-registry.ts (builtin + cfg.agents.roles)            │
                    │   teams.list     → team-template.ts                                         │
                    │   orchestrator.plan → orchestrator.ts (createOrchestratorPlan)              │
                    │   orchestrator.run  → orchestrator-run.ts ─┐                                │
                    └────────────────────────────────────────────┼───────────────────────────────┘
                                                                  │ per worker role
                                                  role-spawn.ts: spawnRoleSubagent()
                                                                  │ SOUL + tools + model + effort
                                                  subagent-spawn.ts: spawnSubagentDirect()
```

### Data flow for `orchestrator.run`
1. `createOrchestratorPlan({ task, fileHints, important })` → `{ mode, leadRole, workers[], verifierRole }`.
2. For each worker: resolve role via registry → `spawnRoleSubagent(roleName, workerTask, ctx)`:
   - SOUL = `compileRoleContractToSoul(role)` → `params.roleSystemPrompt`
   - tools → `ctx.inheritedToolAllowlist` (hard allow)
   - `role.model.default` → `params.model`; `role.effort` → `params.thinking` (effort→thinking map)
3. Subagents run via the normal lane; results auto-announce back to the requester (push-based; existing mechanism).
4. `orchestrator.run` returns the plan + spawned `childSessionKey`/`runId` per worker.

---

## 5. New / changed files

New (runtime):
- `openclaw_runtime/src/agents/role-registry.ts` — merge builtin + `cfg.agents.roles`; `listRoleContracts(cfg)`, `resolveRoleContract(cfg, name)`.
- `openclaw_runtime/src/agents/role-spawn.ts` — `spawnRoleSubagent(roleName, task, ctx, opts)`; maps role → spawn params.
- `openclaw_runtime/src/agents/orchestrator-run.ts` — `runOrchestration(request, ctx)`; plan → spawns.
- `openclaw_runtime/src/agents/role-effort.ts` — `roleEffortToThinking(effort)` map.
- `openclaw_runtime/src/gateway/role-orchestration-methods.ts` — `loadRoleHandlers()`.

Changed (runtime):
- `subagent-spawn.ts` — add optional `roleSystemPrompt` param; append to `childSystemPrompt`.
- `config/types.agents.ts` — `AgentsConfig.roles?: RoleContractConfig[]`.
- `gateway/methods/core-descriptors.ts` — 5 new specs.
- `gateway/server-methods.ts` — one `createLazyCoreHandlers` block.

New / changed (ClawX):
- `shared/host-api/contract.ts` — `roles` + `orchestrator` modules.
- `electron/services/roles-api.ts`, `orchestrator-api.ts`; register in `ipc-handlers.ts`.
- `src/pages/Agents/index.tsx` — Roles + Orchestration panels (+ i18n keys).

Tests:
- `tests/unit/role-registry.test.ts`, `tests/unit/role-spawn.test.ts` (deps-injected like `subagent-spawn`'s `__testing`).

---

## 6. Enforcement model (hard allowlist)

- `role.tools` → `ctx.inheritedToolAllowlist`. Non-empty allow ⇒ all other tools denied by `isToolAllowedByPolicyName`.
- `role.permissions.filesystem`: `none` → deny fs tools (`read`/`write`/`edit`/`apply_patch`) via deny list; `read` → allow `read`/`glob`/`grep`, deny mutators; `write`/`admin` → allow mutators.
- `role.permissions.network`: `none` → deny network-capable tools; mapped to sandbox network policy where the sandbox is active.
- `role.permissions.commands`: allowlist for `exec`/`bash`; empty list + fs `read` ⇒ deny shell.
- ACP caveat: `inherited-tool-deny.ts` enforces `ACP_REQUIRED_INHERITED_TOOL_ALLOW`; role allowlists that strip those make `runtime="acp"` unavailable — acceptable (role subagents use `runtime="subagent"`).

---

## 7. Staged plan & status

| Stage | Deliverable | Status |
| --- | --- | --- |
| 0 | Discovery + this blueprint | ✅ |
| 1 | `role-registry.ts` + `role-effort.ts` + `config/types.agents.ts` roles field | ✅ landed, tested, build:green, typecheck:green |
| 2 | `subagent-spawn.ts` `roleSystemPrompt` + `role-spawn.ts` (hard allowlist) | ✅ landed, tested, build:green, typecheck:green |
| 3 | `orchestrator-run.ts` bridge | ✅ landed, tested, build:green, typecheck:green |
| 4 | RPC specs + `server-methods/role-orchestration-methods.ts` + `server-methods.ts` block | ✅ landed, build:green, typecheck:green |
| 5 | host-api access + electron permission classification | ✅ landed (generic `gateway.rpc`; read methods in `SAFE_GATEWAY_METHODS`); typecheck:green |
| 6 | `RolesOrchestrationPanel.tsx` + Agents-page wiring | ✅ landed, typecheck:green |
| 7 | input-mode → steering wired into `chat.send` handler | ✅ landed, build:green, typecheck:green |
| 8 | `build:runtime` + typecheck + vitest green | ✅ ALL GREEN |

**Verification (2026-06-13):**
- `pnpm exec vitest run tests/unit/role-runtime-mvp.test.ts tests/unit/role-spawn.test.ts tests/unit/observability-mvp.test.ts` — **22 tests, 3 suites, all passed**
- `pnpm run build:runtime` — esbuild **1197 files, 1.3s, no errors**
- `pnpm run typecheck:node` — **clean** (no errors)
- `pnpm run typecheck:web` — **clean** (no errors)
| 6 | `RolesOrchestrationPanel.tsx` + Agents-page wiring | ✅ landed |
| 7 | input-mode → steering in chat.send path | ⏳ designed; build-gated (see §9) |
| 8 | `build:runtime` + typecheck + vitest green | **blocked on Bash/Opus** |

All Stage 1–6 code is authored against the real types but **unverified pending `pnpm run build:runtime` + typecheck + vitest** (Opus-down → Bash classifier offline this session).

Decision on the RPC/electron layer: ClawX already exposes a generic `gateway.rpc` host-api proxy (`electron/services/gateway-api.ts:109`, `gatewayManager.rpc(method, params)`), so the UI reaches `roles.*`/`orchestrator.*` without new host-api modules. The only electron change needed was classifying the read methods as safe (`electron/services/workspace-permissions.ts SAFE_GATEWAY_METHODS`); `orchestrator.run` is deliberately left as a mutating request requiring approval.

---

## 9. Stage 7 — input-mode → steering (exact build-gated wire)

`chat.send` (`openclaw_runtime/src/gateway/server-methods/chat.ts:2949`) is ~1500 lines and already has mature active-run, abort, stop-command, and in-flight handling (active-run detection ~3100/3230; stop-command abort ~3142). The input-classifier should *compose with*, not replace, this machinery. Not edited blind this session.

Seam: inside `chat.send`, after `activeRunScopeKey`/active-run detection and before the existing stop-command branch, when an active run exists for the session and the inbound text is not an explicit stop-command:

```ts
import { createInputModeAction } from "../../sessions/input-mode.js";
// ...
const action = createInputModeAction(inboundText);
if (action.mode === "interrupt") {
  // reuse the existing abortChatRunsForSessionKeyWithPartials(... abortOrigin: "stop-command") path,
  // then fall through to submit inboundText as a fresh run
} else if (action.mode === "guide") {
  // inject action.steeringMessages via the existing sessions.steer mechanism for the active run
} else { // queue
  // enqueue action.followUpMessages to deliver after the active run completes
}
```

`createInputModeAction` (`sessions/input-mode.ts:17`) already returns the abort/steer/queue shape. The classifier (`agents/input-classifier.ts`) is unit-tested in `tests/unit/role-runtime-mvp.test.ts`. The remaining work is purely the chat-path branch above, which must be done with a working build/test loop because it touches the core message path.

---

## 8. Risks

- Runtime `src` edits are inert until `pnpm run build:runtime`; forgetting this makes changes look like no-ops.
- `createCoreGatewayMethodDescriptors` throws on a handler without a spec — keep specs and handlers in lockstep.
- Do not add new methods to `capability-monitor`'s required list, or older runtimes fail readiness.
- Hard allowlists can over-restrict; ship sane builtin role `tools` and allow config override.
- This environment currently cannot build/test (Opus-down → Bash classifier offline). All code below this line is authored against the real types but is **pending a verification build**.
