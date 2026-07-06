# CodeGraph: Role / Agent / Memory / Knowledge Architecture Map

> Purpose: Token-efficient orientation map for the role-driven architecture design task. This file is **descriptive (what exists)**, not **prescriptive (what to build)**. Design decisions belong to the architect, not this map.
> Verification: Every path below was confirmed by direct file inspection on 2026-07-02. Line numbers are accurate at time of inspection.
> Coverage: 5 areas — (A) Role/Agent identity, (B) Chat-page role switching, (C) Multi-agent role routing, (D) Role memory, (E) Knowledge-base role player.

---

## 0. Project Identity (must be quoted verbatim in any downstream prompt)

- **Project name**: Verse Claw (GUI) + OpenClaw Runtime (AI engine)
- **Project type**: Personal educational software development project. Single-developer desktop application for learning agent-runtime architecture design. NOT a commercial product, SaaS, or multi-tenant system. Processes NO third-party user data. All work happens on the developer's local machine.
- **Stack**: Electron + React 19 + Vite + TypeScript. pnpm@10.33.4 (pinned via `packageManager`).
- **Three-layer split** (hard client/server boundary, no shared in-process state):
  ```
  Renderer (src/, React 19)  --IPC-->  Main Process (electron/)  --WS/HTTP-->  OpenClaw Runtime (openclaw_runtime/, port 18789)
  ```
- **Shared type contracts** live in `shared/` (`shared/host-api/contract.ts` ~110KB, `shared/types/*.ts`).
- **No database**: app uses `electron-store` (JSON files) + OS keychain + SQLite (only inside runtime for state/memory persistence).

---

## 1. Three-Layer Architecture (reference for all 5 areas)

```
Renderer (src/)
  ├─ pages/                 HashRouter pages (Chat, Agents, Knowledge, Skills, Models, ...)
  ├─ stores/                zustand stores (chat, agents, settings, workspaces, ...)
  ├─ lib/host-api.ts        SINGLE entry for backend calls (rule: no direct ipcRenderer.invoke)
  └─ components/agents/     RoleCard, RoleProfileEditor, RolesOrchestrationPanel

Main Process (electron/)
  ├─ services/*-api.ts      35 host-api service modules (agents-api, chat-api, knowledge-api, ...)
  ├─ gateway/               runtime child-process manager (WS → HTTP → IPC fallback, Main-owned)
  └─ utils/agent-config.ts  Agent CRUD + SOUL.md compile/parse

OpenClaw Runtime (openclaw_runtime/)
  ├─ agents/                role-router, role-contract, role-registry, role-spawn, orchestrator*
  ├─ memory/                role-memory.sqlite (long-term persona memory)
  ├─ runtime-core/          runtime-memory (session-scoped), hybrid retrieval, user profile
  ├─ context-engine/        pluggable context providers (memory, symbol, trace, agent-map)
  └─ gateway/server-methods/role-orchestration-methods.ts  RPC: roles.list/get, orchestrator.plan/run, memory.*
```

**Transport policy (hard rule, Main-owned)**: `WS → HTTP → IPC fallback`. Renderer must NOT implement protocol switching UI/business logic.

**Renderer/Main boundary (hard rule)**: Renderer must use `src/lib/host-api.ts` and `src/lib/api-client.ts` as the single entry for backend calls. Do NOT add new direct `window.electron.ipcRenderer.invoke(...)` calls. Do NOT call Gateway HTTP endpoints directly from renderer.

---

## 2. Area A — Role / Agent Identity

### 2.1 Three distinct concepts (do not conflate)

| Concept | Type | Purpose | Persistence |
|---------|------|---------|-------------|
| **Agent** | `AgentSummary` | Persistent user-facing helper identity (a chat profile) | OpenClaw config JSON + disk dirs |
| **AgentRoleProfile** | `AgentRoleProfile` | Single Agent's persona/character definition (compiled to SOUL.md) | `<workspace>/SOUL.md` |
| **RoleContract** | `RoleContract` | Reusable role definition for multi-agent orchestration | Built-in constant + `cfg.agents.roles[]` |

### 2.2 Agent — persistent helper identity

**Type**: `shared/types/agent.ts:3-16`
```typescript
interface AgentSummary {
  id: string; name: string; isDefault: boolean;
  modelDisplay: string; modelRef?: string|null; overrideModelRef?: string|null;
  inheritedModel: boolean; reasoningEffort?: AgentReasoningEffort;
  workspace: string; agentDir: string; mainSessionKey: string; channelTypes: string[];
}
```
Mirror: `electron/utils/agent-config.ts:93-106`. Internal storage form `AgentListEntry`: `electron/utils/agent-config.ts:51-65`.

**Persistence**:
1. OpenClaw config JSON via `readOpenClawConfig()` / `writeOpenClawConfig()` (path: `~/.openclaw/`):
   - `config.agents.list[]` — agent entries (`AgentsConfig`, `agent-config.ts:62-65`)
   - `config.bindings[]` — agent↔channel bindings (`BindingConfig`, `agent-config.ts:72-75`)
2. Disk dirs:
   - `~/.openclaw/agents/<agentId>/agent/` — runtime files (`auth-profiles.json`, `models.json`)
   - `~/.openclaw/agents/<agentId>/sessions/` — session records
   - `~/.openclaw/workspace-<agentId>/` (or `~/.openclaw/workspace` for main) — workspace incl. SOUL.md
3. electron-store `agent-bootstrap` JSON: per-agent `defaultSkillIds` + `defaultMcpServerIds` (`agent-config.ts:122-140`)

**Built-in Agent**: a `main` agent always implicitly exists (`id='main'`, `name='Main Agent'`, `default=true`). Cannot be deleted (`agent-config.ts:1020-1022`). `createImplicitMainEntry` synthesizes it when no agents configured (`agent-config.ts:242-250`).

**CRUD endpoints**:
- Renderer entry: `src/lib/host-api.ts:691-714` — `agents` namespace: `list / create / update / updateModel / updateReasoningEffort / getBootstrap / updateBootstrap / delete / assignChannel / removeChannel`
- Main impl: `electron/services/agents-api.ts:95-269` (`createAgentsApi`)
- Business fns (`electron/utils/agent-config.ts`):
  - `createAgent(name, options)` — `:873-914`
  - `updateAgentName(agentId, name)` — `:916-940`
  - `updateAgentModel(agentId, modelRef)` — `:953-984`
  - `updateAgentReasoningEffort(agentId, effort)` — `:986-1016`
  - `deleteAgentConfig(agentId)` — `:1018-1072`
  - `assignChannelToAgent` / `assignChannelAccountToAgent` — `:1074-1110`
  - `listAgentsSnapshot()` — `:612-615`

### 2.3 AgentRoleProfile — user-facing persona

**Type**: `shared/types/agent.ts:28-39`
```typescript
interface AgentRoleProfile {
  displayName: string;
  role: string;                    // 通用助手|代码助手|写作伙伴|DevOps|代码审查|架构设计|数据分析|自定义
  customRole?: string;
  verbosity: 'concise'|'balanced'|'detailed';
  tone: 'formal'|'casual'|'friendly'|'direct';
  language: string; customStyle?: string;
  expertise: string[]; limitations: string[]; backstory: string;
}
```
Default: `DEFAULT_ROLE_PROFILE` at `shared/types/agent.ts:98-107` (role='通用助手').

**Persistence mechanism (important)**: NOT stored as structured data. Compiled via `compileRoleProfileToMarkdown` to Chinese Markdown, written to `<workspace>/SOUL.md`. Read back via `parseRoleProfileFromMarkdown`. Both at `electron/utils/agent-config.ts:706-822`.

Compiled SOUL.md format (`agent-config.ts:706-738`):
```
{displayName} 是一个 {role}。

## 回复风格
- 详细程度: 简洁|适中|详细
- 语气: 正式|口语化|友好|直接
- 语言偏好: {language}

## 擅长
- ...

## 不擅长
- ...

## 背景
{backstory}
```

Read/write fns:
- `readAgentRoleProfile(agentId)` — `:806-814`
- `writeAgentRoleProfile(agentId, profile)` — `:816-822`
- Backed by `readAgentSoul` / `writeAgentSoul` — `:636-656`

**CRUD exposure**: carried via `agents.getBootstrap` / `agents.updateBootstrap` IPC (carries `roleProfile` field). See `electron/services/agents-api.ts:136-226`. `getBootstrap` returns BOTH raw SOUL.md AND parsed `roleProfile` struct.

**UI editor**: `src/components/agents/RoleProfileEditor.tsx` (form: displayName / role dropdown / verbosity / tone / language / expertise tag input / limitations tag input / backstory). Used in `src/pages/Agents/index.tsx`.

### 2.4 RoleContract — orchestration-time role contract

**Type**: `shared/types/agent.ts:72-86` AND `openclaw_runtime/src/agents/role-contract.ts:33-50`
```typescript
type RoleContract = {
  name: string;                    // kebab-case id
  displayName: string; description?: string;
  rolePrompt: string;              // core prompt
  tools: string[];                 // tool whitelist
  capabilities?: string[]; toolRequirements?: string[];
  riskProfile?: 'low'|'medium'|'high'|'critical';
  canModifyScope?: boolean;
  permissions: RolePermissions;    // filesystem/network/commands/readPaths/writePaths
  model: RoleModelBinding;         // default/fallback/provider
  effort: RoleContractEffort;      // auto|minimal|low|medium|high|xhigh|max
  outputSchema: RoleOutputSchema;  // format: markdown|json|text + sections + jsonSchema
  handoff: RoleHandoffRules;       // to[]/from[]/requiresReview
  version?: string; tags?: string[];
  profile?: Partial<AgentRoleProfile>;  // optional link to persona
};
```
Aux types at `role-contract.ts:3-31` and `shared/types/agent.ts:41-69`:
- `RolePermissionAccess = 'none'|'read'|'write'|'admin'`
- `RoleNetworkAccess = 'none'|'limited'|'full'`
- `RoleContractEffort = AgentReasoningEffort | 'max'`
- `RolePermissions = { filesystem, network, commands[], readPaths?, writePaths? }`
- `RoleModelBinding = { default?, fallback?, provider? }`
- `RoleOutputSchema = { format, sections?, jsonSchema? }`
- `RoleHandoffRules = { to[], from[], requiresReview? }`

**Registry**: `openclaw_runtime/src/agents/role-registry.ts`. Resolution order (later overrides earlier, lines 4-7):
1. `BUILT_IN_ROLE_CONTRACTS` (hardcoded constant)
2. `cfg.agents.roles[]` (config-defined, snake_case or camelCase both accepted, normalized by `normalizeRoleContract`)

Config type: `openclaw_runtime/src/config/types.agents.ts:208-222`
```typescript
type AgentsConfig = {
  defaults?: AgentDefaultsConfig;
  list?: AgentConfig[];               // Agent entries
  roles?: AgentRoleContractConfig[];  // RoleContract overrides/extensions
  teams?: unknown;                    // Team templates
};
```
Core fns in `role-registry.ts`:
- `buildRoleRegistry(cfg)` — `:51-85` (merges built-in + config, validates, skips invalid with `issues`)
- `listRoleContracts(cfg)` — `:88-90`
- `resolveRoleContract(name, cfg)` — `:93-101`

**8 built-in roles**: `openclaw_runtime/src/agents/role-contract.ts:230-359` (`BUILT_IN_ROLE_CONTRACTS`):

| name | displayName | core tools | effort | handoff.to |
|------|-------------|-----------|--------|------------|
| `planner` | Planner | read/glob/grep | high | architect, implementer |
| `architect` | Architect | read/glob/grep | high | implementer, reviewer |
| `implementer` | Implementer | read/write/edit/bash | medium | tester, reviewer |
| `tester` | Tester | read/bash | medium | reviewer, skeptic |
| `reviewer` | Reviewer | read/glob/grep | high | implementer, skeptic |
| `security-reviewer` | Security Reviewer | read/glob/grep | xhigh | skeptic, implementer (requiresReview) |
| `docs-writer` | Docs Writer | read/write/edit | medium | reviewer |
| `skeptic` | Skeptic | read/glob/grep/bash | high | implementer, reviewer (requiresReview) |

Lookup: `getBuiltInRoleContract(name)` — `:361-363`.

**Gateway methods**: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:224-1005`:

| Method | Line | Purpose |
|--------|------|---------|
| `roles.list` | 225-229 | List all RoleContracts (built-in + config) |
| `roles.get` | 231-248 | Get single RoleContract + compiled SOUL |
| `teams.list` | 250-253 | List team templates |
| `orchestrator.plan` | 255-295 | Plan multi-role orchestration (no execution) |
| `orchestrator.run` | 297-428 | Execute multi-role orchestration, spawn role-driven subagents |
| `task_loop.run` / `task_loop.status` | 431-514 | Task loop orchestration |
| `observability.reportTrace` / `observability.traces` | 516-532 | Observability |
| `memory.*` | 535-1004 | Role memory subsystem (bound to `RoleContract.name`) |

**Role→subagent spawn**: `openclaw_runtime/src/agents/role-spawn.ts`. `spawnRoleSubagent` (`:224-241`) maps RoleContract to real subagent:
- `compileRoleContractToSoul(role)` → `params.roleSystemPrompt`
- `role.tools` → `ctx.inheritedToolAllowlist` (HARD whitelist; unlisted tools rejected)
- `role.model.default` → `params.model`
- `role.effort` → `params.thinking` (via `roleEffortToThinking`)
- `role.permissions.*` → `ctx.inheritedToolDenylist` (HARD deny via `buildRolePermissionDenyPatches`)
- Role memory cards (`getMemoryCards({ roleName: role.name })`) injected between SOUL and extra prompt (`:116-159`, `buildRoleSystemPrompt`)

`compileRoleContractToSoul` defined at `role-contract.ts:207-226`.

**Visual mapping**: `src/lib/role-visuals.ts`. `roleTone(roleName)` (`:21-41`) assigns fixed hues to built-in roles (planner=blue, architect=sky, implementer=emerald, tester=amber, reviewer=violet, security-reviewer=red, docs-writer=cyan, skeptic=rose). Config-defined roles use hash-derived stable hue.

### 2.5 Relationship summary

- **Agent = persistent identity container**. Each Agent has own workspace, model binding, channel bindings, SOUL.md. User creates/deletes Agents in Settings.
- **AgentRoleProfile = Agent's persona attribute**. Each Agent has EXACTLY ONE AgentRoleProfile, stored as its workspace SOUL.md. This is the "角色" the user edits in `RoleProfileEditor`.
- **RoleContract = reusable orchestration role definition**. Many-to-many with Agents — one Agent can spawn multiple RoleContract subagents during orchestration; same RoleContract usable by any Agent's orchestration. Does NOT belong to any specific Agent.

**Bridges**:
- `RoleContract.profile?: Partial<AgentRoleProfile>` (`shared/types/agent.ts:85`) — a RoleContract may optionally carry a persona fragment
- `compileRoleContractToSoul(role)` (`role-contract.ts:207-226`) — compiles RoleContract to SOUL text, injected into subagent
- `spawnRoleSubagent` (`role-spawn.ts`) — maps RoleContract to subagent's prompt/tools/model/permissions

### 2.6 Other "role"-named concepts (avoid confusion)

- `GatewayRole` (`openclaw_runtime/src/gateway/role-policy.ts:5-8`): `"operator" | "node"` — RPC authorization only, unrelated to agent persona.
- Discord roles (`openclaw_runtime/src/config/types.discord.ts:64,95,110`): Discord server role IDs for channel perms, unrelated to agent roles.

---

## 3. Area B — Chat Page Role/Model Switching

### 3.1 Main chat page

**File**: `src/pages/Chat/index.tsx`. Main `Chat` component exported at `:655`. Submodules same dir: `ChatInput.tsx`, `ChatToolbar.tsx`, `ChatMessage.tsx`, `ExecutionGraphCard.tsx`, `TeamOrchestrationCard.tsx`, `RollbackPlanPanel.tsx`, `session-continuity.ts`, `rollback-plan.ts`, `execution-projection.ts`.

State sources: `useChatStore` (`@/stores/chat`), `useAgentsStore`, `useProviderStore`, `useWorkspacesStore`, `useArtifactPanel`.

Chat component pulls `currentSessionKey / currentAgentId / sessions / sending / streamingMessage` etc. at `index.tsx:661-679`.

### 3.2 Two role/agent switching entry points (both in `src/pages/Chat/ChatInput.tsx`)

**Entry A — Workspace Actions menu, persistent agent switch** (`ChatInput.tsx:2525-2554`):
- Trigger: `onSwitchAgent` from parent → `handleSwitchAgent` (`index.tsx:2465`)
- Each agent row displays `agent.name` + `agent.modelDisplay` together — this is the perceptual source of "switching role, not model"
- `data-testid="chat-composer-switch-agent-{agentId}"`

**Entry B — `@` Agent Picker, single-message target** (`ChatInput.tsx:2560-2604`):
- Trigger: `setTargetAgentId(agent.id)` (local state, no workspace switch)
- `mentionableAgents = agents.filter(a => a.id !== currentAgentId)` (`ChatInput.tsx:707-710`)
- `targetAgentId` passed to `onSend(..., targetAgentId, ...)` at `ChatInput.tsx:1934-1937`
- `data-testid="chat-composer-agent"`

### 3.3 What happens on role switch — `handleSwitchAgent`

**File**: `src/pages/Chat/index.tsx:872-911`
1. Persist current session state (draft, KB scope, artifact panel) via `persistCurrentWorkspaceSessionState`.
2. Derive target sessionKey via `getWorkspaceAgentSessionKey(workspace, agentId)`. Format: `agent:<agentId>:<sessionId>`.
3. `hostApi.workspaces.update(workspaceId, { agentId, activeSessionKey: nextSessionKey, sessionKey: nextSessionKey, state: target.isFresh ? { activeTopicId: null } : undefined })`.
4. `fetchWorkspaces()`.
5. `resetSessionView(nextSessionKey)` — reset chat store view state.
6. If fresh session: clear composer draft, graph expand records, knowledge scope.

**Important**: `setCurrentAgentId(...)` is NOT called directly. `currentAgentId` is derived from `currentSessionKey` via `getAgentIdFromSessionKey(key)` — see `src/stores/chat/session-actions.ts:199,288,356,388,512` and `runtime-send-actions.ts:96`. Session-key parser at `src/components/layout/Sidebar.tsx:377-380` and `src/components/layout/session-buckets.ts:5-7`.

**Switching role = switching sessionKey = switching to that role's bound session history.** Each agent has independent session history.

### 3.4 How selected role reaches OpenClaw Runtime

**File**: `src/stores/chat/runtime-send-actions.ts`

`sendMessage` signature (`:71-80`):
```typescript
sendMessage: async (text, attachments?, targetAgentId?, knowledgeScope?, knowledgeMode?,
                    inputMode?, knowledgeReferences?, activeTaskNodeId?) => { ... }
```
Flow:
- `:85` — `targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey`. `resolveMainSessionKeyForAgent` (`:35-38`) converts agentId to `agent:<agentId>:main`.
- `:91-118` — if `targetSessionKey !== currentSessionKey`: set `currentSessionKey / currentAgentId / messages: []`, then `loadHistory(true)` to reload that agent's history.
- `:238-270` — RPC call:
```typescript
result = await hostApi.chat.sendWithMedia({
  sessionKey: currentSessionKey,         // ← agent id encoded in sessionKey
  workspaceId,
  message: trimmed,
  deliver: false,
  idempotencyKey,
  knowledgeScope, knowledgeMode,
  inputMode?, knowledgeReferences?, activeTaskNodeId?,
  media?,  // only when attachments
});
```

**Key finding**: Role/Agent identity is NOT passed as an independent field. It is encoded in `sessionKey` (`agent:<agentId>:<sessionId>`). OpenClaw backend routes by sessionKey to the corresponding agent dir + config. `workspaceId` comes from `useWorkspacesStore.getState().activeWorkspaceId` (`:219`).

### 3.5 Is "model selection" missing? — Not missing, but bound to agent

Model picker EXISTS at `ChatInput.tsx:2888-2943`. Display condition: `showModelPicker = modelOptions.length > 1` (`:728`). `data-testid="chat-model-picker-button"` and `chat-model-picker-option-{label}`.

`effectiveModelRef` (`ChatInput.tsx:705`):
```typescript
const effectiveModelRef = optimisticModelRef
  || currentAgent?.modelRef
  || defaultModelRef
  || modelOptions[0]?.modelRef
  || null;
```

`handleSelectModel` (`ChatInput.tsx:1333-1355`):
```typescript
const handleSelectModel = useCallback(async (modelRef: string) => {
  if (!currentAgent || switchingModelRef) return;
  if (modelRef === effectiveModelRef) { setModelPickerOpen(false); return; }
  const desiredOverride = modelRef === (defaultModelRef || '').trim() ? null : modelRef;
  setSwitchingModelRef(modelRef); setOptimisticModelRef(modelRef); setModelPickerOpen(false);
  try {
    await updateAgentModel(currentAgent.id, desiredOverride);   // ← writes to agent
  } catch (error) {
    setOptimisticModelRef(previousModelRef);
    toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
  } finally { setSwitchingModelRef(null); }
}, [...]);
```

`updateAgentModel` is a `useAgentsStore` action (`src/stores/agents.ts:85-89`) that calls `hostApi.agents.updateModel(agentId, modelRef)` (persistent).

**Root cause of "switching role, not model" perception**:
1. Model is an Agent attribute, not a message/session attribute. `Agent.modelRef` persists per-agent config.
2. Model picker's handler calls `updateAgentModel(currentAgent.id, ...)` — writes to current agent, NOT "send this message with model X".
3. Role switch (`handleSwitchAgent` `index.tsx:872`) switches sessionKey (`agent:<agentId>:<sessionId>`), equivalent to switching to another session history + another agent config (incl. model).
4. UI "Workspace Actions menu" shows each role row with `agent.name` + `agent.modelDisplay` together (`ChatInput.tsx:2546-2547`), reinforcing "select role = select a config bundle including model".
5. No entry point for "temporarily change model for current session without changing agent" — `handleSelectModel` only accepts model changes for current agent.
6. `sendMessage` signature has NO `modelRef` parameter. `hostApi.chat.sendWithMedia` input has NO `modelRef` field. To support per-message or per-session model override, both would need extension.

### 3.6 Sidebar grouping — by workspace or time, NOT by role/model

**File**: `src/components/layout/Sidebar.tsx`
- View switch: `sessionView: 'project' | 'time'` (`:484`), via `sidebar-session-view-{view}` testid (`:805`).
- Project grouping: `buildSidebarWorkspaceSessionGroups(...)` (`:610-615`), impl in `src/components/layout/session-buckets.ts:107-145`. Keys come from `workspace.sessionStates`, `workspace.activeSessionKey`, `workspace.agentBindings`.
- Time grouping: `buildSidebarTimeSessions(...)` (`:603-608`).
- NO grouping by `agentId` or `modelRef`.
- Each session row shows agent name as secondary label (`Sidebar.tsx:340` `{agentName}`), sourced from `agentNameById[getAgentIdFromSessionKey(s.key)]` (`:689`). Same role across different workspaces scatters into different workspace groups, NOT aggregated into "all sessions of role X".

### 3.7 Chat input / send flow / role context injection

`ChatInput` receives these callbacks from `Chat` (`index.tsx:2452-2485`):
- `onSend = handleSendMessage` (`index.tsx:1113-1124`)
- `onSwitchAgent = handleSwitchAgent` (`index.tsx:2465`)
- `onNewSession`, `onForkSession`, `onHandoffSession`, `onPickWorkspaceFolder`, `onPermissionModeChange`, `onKnowledgeScopeChange`, `onKnowledgeModeChange`, `onManualCompact`, etc.

`handleSend` flow (`ChatInput.tsx:1846`):
1. Slash command interception (`:1847-1855`).
2. Prepare `textToSend / attachmentsToSend / knowledgeReferencesToSend / sendKnowledgeScope`.
3. Capability pre-check `resolveChatCapabilityActions(textToSend)` (`:1871-1900`), may enter `pendingCapabilitySend`.
4. `rendererExtensionRegistry.runChatBeforeSend(...)` hook (`:1902-1913`).
5. Call `onSend(textToSend, attachmentsToSend, targetAgentId, sendKnowledgeScope, knowledgeMode, knowledgeReferencesToSend, activeTaskNodeId, inputMode)` (`:1934`).

`handleSendMessage` (`index.tsx:1113-1124`) → `sendMessage(text, attachments, targetAgentId, scope, mode ?? knowledgeMode, inputMode, knowledgeReferences, activeTaskNodeId)`.

Role context injection does NOT go through message fields. Instead:
- `sessionKey` shape `agent:<agentId>:<sessionId>` — backend routes by this.
- `workspaceId` — workspace context.
- Per-Agent fields (`workspace`, `agentDir`, `modelRef`, `modelDisplay`) injected at backend config layer, not in frontend message.

### 3.8 Selector inventory (no separate `RoleSelector.tsx` / `AgentSelector.tsx` / `ModelSelector.tsx` files exist)

All selectors inlined in `ChatInput.tsx`:

| Selector | Location | data-testid | Trigger |
|----------|----------|-------------|---------|
| Workspace Agent switch (persistent) | `:2525-2554` | `chat-composer-switch-agent-{agentId}` | `onSwitchAgent(agent.id)` → `handleSwitchAgent` |
| @ Agent Picker (single target) | `:2560-2604` | `chat-composer-agent` | `setTargetAgentId(agent.id)` |
| Skill Picker | `:2606-2689` | `chat-composer-skill` | Insert skill token into input |
| Knowledge Scope Picker | `:2713-2877` | `chat-knowledge-scope-button` / `chat-knowledge-scope-{scope}` | `onKnowledgeScopeChange(scope)` |
| Model Picker | `:2888-2943` | `chat-model-picker-button` / `chat-model-picker-option-{label}` | `handleSelectModel(modelRef)` → `updateAgentModel(agent.id, ref)` |
| Agent Effort Popover | `src/components/chat/ChatAgentEffortPopover.tsx` (referenced `:2879-2886`) | — | Adjust reasoning effort |

Role management UI (NOT on chat page, on Agents page):
- `src/components/agents/RolesOrchestrationPanel.tsx`
- `src/components/agents/RoleCard.tsx`
- `src/components/agents/RoleProfileEditor.tsx`
- `src/pages/Agents/index.tsx`

---

## 4. Area C — Multi-Agent Role Routing

### 4.1 Orchestration modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Role router | `openclaw_runtime/src/agents/role-router.ts` | Keyword + file hints + important flag driven routing |
| Plan creator | `openclaw_runtime/src/agents/orchestrator.ts` | `createOrchestratorPlan`: explicit workers → team template → role-router |
| Execution | `openclaw_runtime/src/agents/orchestrator-run-observed.ts` | `runOrchestrationObserved`: parallel spawn by executionWaves |
| Role contract | `openclaw_runtime/src/agents/role-contract.ts` | 8 built-in roles |
| Role spawn | `openclaw_runtime/src/agents/role-spawn.ts` | `spawnRoleSubagent`: tool whitelist + perm deny |
| Subagent spawn | `openclaw_runtime/src/agents/subagent-spawn.ts` | `spawnSubagentDirect`: 1789-line spawn impl |
| Team templates | `openclaw_runtime/src/agents/team-template.ts` | 3 built-in: quick-development / security-audit / refactor |
| Model tool entry | `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts` | `team_orchestrate` tool: model can self-invoke |
| Gateway RPC | `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts` | `orchestrator.plan` / `orchestrator.run` / `teams.list` |

### 4.2 Three orchestration modes

`role-router.ts`:
```typescript
type RoleRouteMode = "router" | "lead-workers" | "adversarial-review";
```
`resolveMode` decision:
- Explicit `mode` → use directly
- `important=true` OR task contains `security/安全/auth/credential/secret/权限/release/发布` → `adversarial-review`
- `fileHints.length >= 3` OR task contains `refactor/重构/module/模块/multi-file/跨` → `lead-workers`
- Otherwise → `router`

### 4.3 Single-agent call chain

```
Renderer (src/lib/host-api.ts)
  → IPC invokeHost('chat', 'sendWithMedia')
  → Main: electron/services/chat-api.ts → chat.sendWithMedia
  → gatewayManager.rpc('chat.send', rpcParams, 120000)
  → Runtime: gateway server-methods/agent.ts → agent method
  → Single model call
```

### 4.4 Multi-agent collaboration paths

**Path A — Lead agent self-invokes `team_orchestrate` tool**:
- Lead receives task in single-agent call, model decides whether to call `team_orchestrate`
- Tool def: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:125-281`
- Tool internally calls `runOrchestrationObserved` (spawn + wait)

**Path B — Operator UI triggers via Gateway RPC**:
- Renderer: `gateway.rpc('orchestrator.run', ...)`
- Gateway handler: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:297-352`
- NOT in `SAFE_GATEWAY_METHODS` whitelist — requires approval

| Dimension | Single agent | Multi-agent |
|-----------|--------------|-------------|
| RPC entry | `chat.send` | `orchestrator.run` OR `team_orchestrate` tool |
| Session | Shared main session | Each subagent independent `agent:{agentId}:subagent:{uuid}` |
| Permission | SAFE list | `orchestrator.run` requires approval |
| Execution | Single model call | Task Graph + Execution Waves parallel |
| Result | Direct return | Lead synthesizes via Team Result Bundle |

### 4.5 Lead→subagent delegation chain (lead-workers mode)

```
Lead Agent (chat.send entry)
  ↓ model decides to call team_orchestrate tool
team-orchestrate-tool.ts: createTeamOrchestrateTool.execute (line 162-279)
  ↓ createOrchestratorPlan(request)  // line 200
orchestrator.ts: createOrchestratorPlan
  ↓ Priority: explicit workers → team template → role-router
  ↓ routeRole() selects lead role + worker roles
  ↓ Build Task Graph + Execution Waves
  ↓
orchestrator-run-observed.ts: runOrchestrationObserved (line ~50)
  ↓ Create recorder + plan span (orchestrator kind)
  ↓ Parallel spawn per executionWaves (Promise.allSettled per wave)
  ↓ Each worker:
  ↓   spawnRoleSubagent (role-spawn.ts)
  ↓     → Apply tool whitelist + perm deny
  ↓     → buildRoleSystemPrompt (inject SOUL.md + Memory Context)
  ↓   spawnSubagentDirect (subagent-spawn.ts)
  ↓     → Validate agentId / spawnDepth / maxChildrenPerAgent
  ↓     → Generate childSessionKey = agent:{agentId}:subagent:{uuid}
  ↓     → callSubagentGateway({ method: "agent", lane: AGENT_LANE_SUBAGENT })
  ↓     → registerSubagentRun (record controllerSessionKey for completion routing)
  ↓     → hookRunner.runSubagentSpawned
  ↓     → emitSessionLifecycleEvent
  ↓ patchExpectedWorkerRunIds (completion-aware closure)
  ↓ buildRepairNodes + buildRerouteRecommendations (failure repair)
  ↓ storeRuntimeTrace saved to trace buffer
```

**Constraints**:
- Single worker timeout: `ORCHESTRATION_WORKER_TIMEOUT_MS = 120_000` (2 min)
- `adversarial-review` mode stays sequential (verifier must see worker results first)
- Lead must use `sessions_yield` push-wait, NOT polling
- Depth limit: `DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH`
- Per-session child limit: `DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT`

### 4.6 OpenClaw Runtime integration (3 layers)

```
Renderer (React 19)
  → src/lib/host-api.ts (single entry)
  → IPC invokeHost(service, method, payload)
Main (Electron)
  → electron/services/*-api.ts
  → GatewayManager.rpc(method, params, timeoutMs)
OpenClaw Runtime (Node.js, port 18789)
  → gateway server-methods/*.ts
  → agent.ts / role-orchestration-methods.ts
```

Main-process services:

| Service file | Path | Responsibility |
|--------------|------|----------------|
| agents-api | `electron/services/agents-api.ts` | Agent CRUD + SOUL.md write (incl. roleProfile compile) |
| chat-api | `electron/services/chat-api.ts` | `chat.sendWithMedia` single-agent entry |
| gateway-api | `electron/services/gateway-api.ts` | Generic RPC proxy + permission gateway + Knowledge capture |
| sessions-api | `electron/services/sessions-api.ts` | Session lifecycle (1880 lines) |
| openclaw-api | `electron/services/openclaw-api.ts` | CLI state exposure |
| workspace-permissions | `electron/services/workspace-permissions.ts` | Gateway RPC method whitelist |

Subagent actual spawn in `subagent-spawn.ts`: `callSubagentGateway({ method: "agent", params: { ...extraSystemPrompt: childSystemPrompt, lane: AGENT_LANE_SUBAGENT } })` invokes runtime's `agent` gateway method.

### 4.7 Result merging — `bounded_a2a` defined but force-disabled

`team-orchestrate-tool.ts:177-178`:
```typescript
const requestedWorkerCommunication = normalizeWorkerCommunication(params.workerCommunication);
const workerCommunication =
  requestedWorkerCommunication === "bounded_a2a" ? "none" : requestedWorkerCommunication;
```
And in resultPolicy (`:271`):
```typescript
boundedA2aEnabled: false,  // always false
```
Same downgrade in `role-orchestration-methods.ts:181-184` `readWorkerCommunication`.

**Result merge mechanism** (since workers can't communicate directly, all merging concentrated in Lead):
1. Worker results route back to Lead via `controllerSessionKey` / `requesterSessionKey` registered by `registerSubagentRun`.
2. Lead waits via `sessions_yield` push (NOT polling).
3. Team Result Bundle: Lead synthesizes final result based on this structured event.
4. Verifier delay: `verifier: "deferred_until_workers_terminal"` (adversarial-review mode).

Doc confirmation: `docs/clawx-design-overview.md` (line 1260-1366) explicitly states "No automatic worker chat: v4 does not enable worker-to-worker `sessions_send`; all worker results return to the lead for synthesis. `workerCommunication="bounded_a2a"` is recorded as requested but remains disabled by default". `team/fable5-architecture-prompt.md` confirms `bounded_a2a` is Planned/Future Work.

### 4.8 host-api routes for agent/session/runtime

Renderer entry `src/lib/host-api.ts`:

**agents namespace** (10 methods):
- `list / create / update / updateModel / updateReasoningEffort`
- `getBootstrap / updateBootstrap` (incl. roleProfile → SOUL.md compile)
- `delete / assignChannel / removeChannel`

**IMPORTANT**: NO direct host-api entry for `orchestrator.run` / `team_orchestrate`. Renderer does NOT directly trigger multi-agent collab; either via `gateway.rpc('orchestrator.run', ...)` or lead agent self-invokes `team_orchestrate` in runtime.

Type contract: `shared/host-api/contract.ts:2944` lists all 10 agent methods, NO direct orchestration/subagent routes — these go through `gateway.rpc`.

**Easy-to-confuse point**: `src/lib/capability-orchestrator.ts` is **Skill/MCP capability orchestration** (executes `skill.enable / mcp.register / mcp.reload / mcp.heartbeat / mcp.listTools`), NOT multi-agent collaboration.

**sessions namespace** (`sessions-api.ts`): full lifecycle: `delete / rename / summaries / history / patchThinking / compactionStatus / compactionHistory / compressionArtifact / recoveryContext / longTaskControlStatus / longTaskControlHistory / resumeCheckpoints / queueDrain / compact / prepareHandoff / fork / truncate / archive / restore / permanentDelete / listArchived / emptyArchive`.

### 4.9 Renderer↔Runtime gateway/proxy

Permission gateway: `electron/services/gateway-api.ts`:
```typescript
rpc: async (payload) => {
  const method = ...;
  const workspace = await getActiveWorkspaceProfile();
  if (workspace) {
    const decision = decideGatewayRpc(method, workspace.permissionMode, body.params);
    if (!decision.allowed) {
      if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
        // create approval, await user authorization
      }
      return { success: false, blocked: true, error: decision.reason };
    }
  }
  return runRpcAndCaptureKnowledge(method, body.params, timeoutMs);
}
```

Whitelist classification (`workspace-permissions.ts`):

**SAFE_GATEWAY_METHODS** (`:60-113`, read-only, no approval):
- `chat.send` / `chat.abort` / `chat.history`
- `sessions.list` / `sessions.labels`
- `roles.list` / `roles.get` / `teams.list` / `orchestrator.plan`  ← orchestration read methods
- `clawgraph.*` / `memory.*` (read) / `observability.traces` / `security.health` etc.

**`orchestrator.run` intentionally NOT in SAFE list** (`:73-74` comment explicit):
> "orchestrator.run is intentionally NOT here: it spawns subagents and is gated as a mutating request so it requires approval outside fullAccess mode"

**MUTATING_GATEWAY_PATTERNS** (`:117-122`): matches `exec/shell/command/terminal/run`, `write/patch/edit/apply/delete/remove/rename/move/create/mkdir`, `tool.call/run/execute`, `files.write/delete/move/rename/patch`.

Knowledge side-effect capture: `gateway-api.ts` captures `MissionMemoryCandidate` from `mission.run` / `mission.tick` results → converts to Knowledge Hub inbox item.

Transport: Main-owned, fixed `WS → HTTP → IPC fallback`.

### 4.10 Session management — per role independent session

Subagent gets independent `childSessionKey = agent:{agentId}:subagent:{uuid}`, NOT shared main session.

Session key format:
- Main: `agent:{agentId}:{suffix}`
- Sub: `agent:{agentId}:subagent:{uuid}`

Parser `parseSessionKey` in `electron/services/sessions-api.ts`:
```typescript
function parseSessionKey(sessionKey: string): { agentId: string; suffix: string } | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1] || '';
  const suffix = parts.slice(2).join(':');
  if (!SAFE_SESSION_SEGMENT.test(agentId) || !suffix) return null;
  return { agentId, suffix };
}
```

Isolation (`subagent-spawn.ts`):
1. Generate `childSessionKey = agent:{targetAgentId}:subagent:${crypto.randomUUID()}`
2. `patchChildSession`: write `spawnDepth` / `subagentRole` / `inheritedToolDeny`
3. `prepareSubagentSessionContext`: isolated / fork modes
4. `persistInitialChildSessionRuntimeModel`
5. Optional `bindThreadForSubagentSpawn`

Cross-session transfer: `prepareHandoff` passes checkpoint + recovery context for long-task recovery.

Completion routing: `registerSubagentRun` maintains `controllerSessionKey` / `requesterSessionKey`; worker completion events route back to Lead session.

### 4.11 Routing strategy details

Routing decision (`role-router.ts`):
- Keyword match: +2 score
- Tag match: +1 score
- File hint bonus
- `implementer` has default +1 (fallback)
- Highest-scoring role becomes lead

Routing mode decision (`resolveMode`):
```typescript
if (request.mode) return request.mode;  // explicit priority
if (request.important || /security|安全|auth|credential|secret|权限|release|发布/.test(task)) {
  return "adversarial-review";
}
if ((request.fileHints?.length ?? 0) >= 3 || /refactor|重构|module|模块|multi-file|跨/.test(task)) {
  return "lead-workers";
}
return "router";
```

### 4.12 Already-planned parts (user perception "not well planned" is partly inaccurate)

Code-level planning that EXISTS:
1. 3 orchestration modes + 8 built-in roles + 3 team templates
2. Keyword + file hints + important flag driven routing (`role-router.ts` `ROLE_KEYWORDS` + scoring)
3. Task Graph + Execution Waves for parallelism
4. Role Contract hard execution: tool hard whitelist + perm hard deny (`role-spawn.ts`)
5. Failure repair: `buildRepairNodes` + `buildRerouteRecommendations`
6. Observability: `runOrchestrationObserved` wraps trace span (orchestrator / role-router / subagent / verifier)
7. Lifecycle event broadcast: `subagent-lifecycle` broadcast lets renderer show real-time progress

### 4.13 Real shortcomings (objective basis for user pain point)

| Shortcoming | Location | Impact |
|-------------|----------|--------|
| `bounded_a2a` force-disabled | `team-orchestrate-tool.ts:178` | Workers can't communicate directly; all collab must transit Lead |
| `boundedA2aEnabled: false` always | `team-orchestrate-tool.ts:271` | resultPolicy always reports a2a disabled |
| Lead synthesis relies on LLM self-judgment | `orchestrator-run-observed.ts` | Based on Team Result Bundle events, no structured synthesis strategy |
| Routing only by keyword match | `role-router.ts` `ROLE_KEYWORDS` | No ML/embedding routing; +2 score heuristic |
| No cross-run routing reuse | `orchestrator.ts` | Re-routes every time, no learning/cache |
| `orchestrator.run` requires approval | `workspace-permissions.ts:73-74` | Operator UI trigger limited |
| Keywords only cover CN/EN | `role-router.ts` | Other-language tasks may fallback to implementer default +1 |

---

## 5. Area D — Role Memory System

### 5.1 Two independent memory systems (must distinguish)

| Dimension | Role Memory | Runtime Memory |
|-----------|-------------|----------------|
| Purpose | Long-term role persona / playbook / project facts | Intra-session temporal facts / episodes / relation graph |
| Control plane | `openclaw_runtime/src/memory/` | `openclaw_runtime/src/runtime-core/memory-*.ts` |
| Persistence | `role-memory.sqlite` (dedicated DB) | `openclaw.sqlite` state DB `runtime-memory` table |
| Binding granularity | scope + roleTags + ownerRole + applicableRoles + allowedMutators | sessionId / taskId / agentId implicit |
| Evaluation system | None (no L1-L9 eval) | Has L1-L9 + CV1-CV5 + external benchmark |
| UI entry | Settings > Role Memory + Roles Orchestration Panel | Background shadow only, no UI |

### 5.2 Role Memory — long-term persona memory

**Type**: `shared/types/memory.ts:13` defines `MemoryCardScope`:
```
'global' | 'project' | 'workspace' | 'agent' | 'team' | 'role' | 'session' | 'task' | 'user'
```
`memory.ts:47-76` `MemoryCard` includes `roleTags`, `ownerRole`, `sourceRole`, `applicableRoles`, `allowedMutators`, `scopeKey`, `phaseTags`, `supersedes`/`supersededBy` — typical multi-role binding model.

**SQLite storage + schema**: `openclaw_runtime/src/memory/memory-store.ts:54` `DEFAULT_DB_FILENAME = "role-memory.sqlite"`.

Schema (`memory-store.ts:238-267`):
- Main table `role_memory_cards`: columns include `scope_kind`, `scope_key`, `role_tags_json`, `owner_role`, `source_role`, `applicable_roles_json`, `allowed_mutators_json`
- Index: `idx_role_memory_cards_scope ON role_memory_cards(scope_kind, scope_key)` — i.e., retrieve by scope + scopeKey
- Other tables: `role_memory_proposals` / `role_memory_injections` / `role_memory_feedback` / `role_memory_versions` / `role_memory_conflicts` / `role_memory_audit`
- Late ALTER (`memory-store.ts:399-402`): added `owner_role`, `source_role`, `applicable_roles_json`, `allowed_mutators_json`

**Role-binding query**: `memory-store.ts:713` `getMemoryCards` accepts `roleName` param, `roleAppliesToCard(c, params.roleName)` filters; `:1124` `listMemoryProposals` also filters by `roleName` roleTags; `:1772` injection records write `roleName` + `sessionKey`.

**Context injection (Context Pack)**: `memory-store.ts:1604-1630` `simulateMemoryInjection` → calls `buildContextPack({ memories, roleName, phase, taskState, openConflicts, budget })`, assembles candidate cards into `ContextPack` by budget buckets (`hardConstraints / rolePlaybook / projectFacts / teamHandoffs / recentEpisodes / openConflicts / taskState`). Type at `shared/types/memory.ts:88-110`.

**Governance policy**: `openclaw_runtime/src/memory/memory-policy.ts:20-21`:
```
MEMORY_GOVERNANCE_POLICY_VERSION = "role-memory-governance-v4"
MEMORY_CONTEXT_POLICY_VERSION = "role-memory-context-v3"
```
- `SCOPE_IMPACT` (`:51-61`): global/user=5, workspace=4, project=3, agent/team=2, role=1, session/task=0
- `RETENTION_TYPE_WEIGHT` (`:63-73`): constraint=1, decision=0.95, risk=0.8, procedure=0.75, preference=0.65, fact=0.6, handoff=0.45, artifact_ref=0.4, episode=0.3
- Role inference: `inferOwnerRole` (`:107`), `inferSourceRole` (`:111`)

**UI entry (renderer side)**:
- Settings toggle: `src/stores/settings.ts:25` `roleMemoryEnabled: boolean` (default `true`, `:80`), persisted via `hostApi.settings.set('roleMemoryEnabled', ...)`
- Settings page: `src/pages/Settings/index.tsx:136-137`, `:1610` `data-testid="settings-role-memory-section"`, `:1616-1626` `roleMemory.title / description / disableEffect` i18n copy
- Role Orchestration Panel (operate Role Memory cards): `src/components/agents/RolesOrchestrationPanel.tsx`
  - Types: `:135` `MemoryCardView`, `:156` `MemoryProposalView`, `:175` `MemoryDraftState`, `:251` `MemoryRetentionView`, `:274` `MemorySimulationView`, `:285` `MemoryHealthView`, `:290` `MemoryUtilityReportView`
  - RPC calls: `:613-627` via `hostApi.gateway.rpc('memory.list' / 'memory.proposals' / 'memory.conflicts' / 'memory.explainInjection' / 'memory.stats' / 'memory.retentionCandidates' / 'memory.health' / 'memory.utilityReport', ...)`; writes at `:741` `memory.previewProposal`, `:770-773` `memory.update / memory.supersede / memory.propose`

**host-api contract**: `shared/host-api/contract.ts:215-216` only has `roleMemoryEnabled` / `memoryEmbeddingEnabled` two boolean fields — **note: all memory.* RPC goes through `hostApi.gateway.rpc` generic proxy, no dedicated host-api method**.

### 5.3 Runtime Memory — intra-session temporal facts + evaluation

**Core modules** (all in `openclaw_runtime/src/runtime-core/`):
- `memory-context.ts:19-62`: defines `RuntimeMemoryEpisodeKind`, `RuntimeMemoryFactSource`, `RuntimeMemoryVerificationStatus` (candidate / verified / human_approved / deterministic_rule / rejected / invalidated)
- `memory-store.ts:31-57`: `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS = 512`, `EVICTION_WEIGHTS_BY_TYPE` distinguishes semantic / episodic / procedural eviction weights
- `memory-persistence.ts:55` `RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS = 5000`; `:57-60` `RUNTIME_MEMORY_PERSISTENCE_OWNER = "openclaw_runtime.runtime-core.memory-persistence"`, `SCHEMA_VERSION = 1`, `META_KEY = "runtime-memory"` — stored in OpenClaw state DB
- `memory-runtime-integration.ts:55-75` `createRuntimeMemoryRuntimeIntegration` is the entry factory

**Retrieval / injection trio**:
- **HybridSearchIndex**: `memory-hybrid-retrieval.ts:1-26` comment: BM25 (field-weighted subject×3, predicate×2, objectSummary×1) + char 3-gram TF-IDF vector + RRF fusion (k=60). Production can swap to real ONNX embedding.
- **UserProfile layer**: `memory-user-profile.ts:1-33`, `UserProfile` has 5 dimensions: `occupation / preferences / relationships / locations / timeline`, each with `valid_at` and `sourceFactIds`. Comment: "Inspired by Memobase's profile approach"
- **Profile-augmented retrieval**: `memory-profile-retrieval.ts:27-73` `openDomainRetrieval` two-step: (1) `selectProfileDimensions` O(1) structured query, (2) `index.searchWithEmbedding` topK detail facts
- **Chained retrieval**: `memory-chained-retrieval.ts` (multi_hop use)
- **Temporal detection**: `memory-temporal-detector.ts`; **Entity extraction**: `memory-entity-extraction.ts`; **Extraction prompt**: `memory-extraction-prompt.ts`; **Write curation**: `memory-write-curation.ts`; **Background consolidation**: `memory-background-consolidation.ts`; **Self-edit tools**: `memory-self-edit-tools.ts`; **Read Hydration Shadow**: `memory-read-hydration-shadow.ts` + `memory-read-hydration-consumer.ts`

**Session injection entry**: `openclaw_runtime/src/context-engine/memory-context-provider.ts:31` `RUNTIME_MEMORY_CONTEXT_PROVIDER_ID = "runtime-memory"` — registered RuntimeContextProvider ID. `:67-69` `DEFAULT_TOKEN_BUDGET = 256`, `DEFAULT_LIMIT = 24`.

**Task Loop integration (currently Shadow mode)**: `openclaw_runtime/src/agents/task-loop-controller.ts:2001` `runtimeMemoryShadowPersistenceEnabled(cfg)` via `resolveRuntimeMemoryFeatureFlags`; `:2006-2019` `recordTaskLoopRuntimeMemoryEpisode` only calls `writer.appendEpisode` when shadow enabled; `:3019-3026` `runtimeMemoryReadHydrationShadowOnly` triggers `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics`.

**Critical fact**: Runtime Memory on production path is **default-off + shadow-only** (see harness/specs/tasks/phase-31 ~ phase-36 "readonly / shadow / controlled / limited-production-opt-in" naming). Does NOT actually inject memory facts into LLM context in production — this is the code-level embodiment of user's "memory system not complete".

**Evaluation system (L1-L9 + CV1-CV5)**:
- Entry script: `openclaw_runtime/scripts/run-runtime-memory-eval.mjs`
- 16-layer eval architecture: L1-L9 base + L11 externalBenchmark + CV1-CV5 cross-validation
- Maturity score helper: `tests/unit/helpers/runtime-memory-maturity-score.ts` — 8 dimensions (correctness 0.25 / statisticalRigor 0.15 / antiOverfitting 0.20 / antiHallucination 0.20 / coverage 0.10 / crossValidation 0.10 / externalBenchmark 0.10), 4 disqualifiers, threshold ≥0.7 = mature
- 50+ eval test files in `tests/unit/runtime-memory-*.test.ts`
- 36 phase plan docs: `harness/specs/tasks/phase-{9..36}-runtime-memory-*.md`

**Current performance limits** (from project memory):
- J Score ~39.8% (previously miscalculated as 45-47%), 18-24pp gap to 58-64% target
- Fact extraction density low: 0.3 facts/turn
- Embedding Recall@5 = 44.8%
- UserProfile v1 (replace retrieval) dropped open_domain from 53.54% to 47.24%; v2 (augment retrieval) dropped to 51.18% — UserProfile layer NOT in production
- LLM Judge strictness too high (DeepSeek temp=0)
- Chained retrieval failure: multi_hop Recall@5 = 17.32%

### 5.4 Binding granularity comparison

| Binding dimension | Role Memory impl | Runtime Memory impl |
|-------------------|-------------------|---------------------|
| Global | `scope: 'global'` + scopeKey=null | No explicit global, default cross-session |
| Role binding | `roleTags[]` + `ownerRole` + `applicableRoles[]` + `allowedMutators[]`, filter by `roleAppliesToCard` | No role field |
| Session binding | `scope: 'session'` + scopeKey=sessionKey, injection table writes `session_key` | Implicit via `RuntimeMemoryEpisodeRecord` sessionId/taskId |
| Task binding | `scope: 'task'` + `phaseTags[]` | `taskId` field |
| User binding | `scope: 'user'` (same impact=5 as global) | `UserProfile.userId` (eval layer only) |

### 5.5 User-perceivable "incomplete" points

1. **Production path not actually wired**: Runtime Memory default-off + shadow-only (`task-loop-controller.ts:2001`, phase-31~36 spec naming) — role conversations do NOT actually inject memory facts into LLM context. Eval system is complete; production wiring is not.
2. **UserProfile layer not in production**: `memory-user-profile.ts` / `memory-profile-retrieval.ts` only used in eval tests; v1/v2 experiments both lowered open_domain score.
3. **Embedding default off**: `src/stores/settings.ts:81` `memoryEmbeddingEnabled: false` (default false).
4. **host-api lacks dedicated methods**: `shared/host-api/contract.ts:215-216` only exposes two boolean toggles; all memory.* ops go through generic gateway RPC, no type safety.
5. **role-memory and runtime-memory systems split**: role-memory has complete SQLite + UI but no eval; runtime-memory has complete eval but no production wiring; the two do NOT share retrieval/injection pipeline.
6. **Multi-hop retrieval failure**: multi_hop Recall@5 = 17.32%, chained retrieval score decays too fast (`memory-chained-retrieval.ts`).
7. **Low extraction density**: 0.3 facts/turn (target 1.0+), `memory-extraction-prompt.ts` single few-shot, no schema constraint, no negative examples, chunk_size=100 too large.

### 5.6 Related planning docs

- `harness/specs/tasks/role-first-memory-control-plane.md`
- `harness/specs/tasks/role-first-memory-settings-toggle.md`
- `harness/specs/tasks/role-first-memory-governance-v3.md` / `v4.md` / `v6.md`
- `harness/specs/tasks/role-first-memory-ux-v5.md`
- `harness/specs/tasks/role-first-memory-v2-governance.md`
- `harness/specs/tasks/role-first-team-orchestrate-tool.md`
- `harness/specs/tasks/role-first-end-to-end.md`

---

## 6. Area E — Knowledge Base Role Player

### 6.1 KB / wiki implementation

KB is called "Knowledge Hub" / "memory-wiki" — a wiki-style KB built on OpenClaw Runtime's memory-wiki plugin (NOT traditional vector RAG; it's compile-style wiki + provenance tracking).

Main entry:
- `electron/services/knowledge-api.ts` (2353 lines, Electron main-side host-api impl; full wiki/drafts/inbox/proposals/governance/OKF/watched-directories RPC)
- `shared/host-api/contract.ts:3060` — `knowledge:` namespace defines all KB host-api interfaces
- `src/lib/host-api.ts` exposes `hostApi.knowledge.*` to renderer

Underlying storage/retrieval by OpenClaw Runtime's memory-wiki plugin via Gateway RPC:
- `wiki.status` / `wiki.init` / `wiki.ingest` / `wiki.search` / `wiki.get` / `wiki.apply` / `wiki.compile` / `wiki.lint`
- See `knowledge-api.ts:1429`, `1437`, `1646`, `1663`, `1677`, `1685`, `2001`, `2068`

**Note**: Project has NO "embedding / vector / corpus RAG" implementation. "corpus" here is only a retrieval scope label from `wiki | memory | all` (`contract.ts:1968`, `knowledge-api.ts:1649`). Runtime does have embedding adapter but belongs to memory system, not KB: `openclaw_runtime/src/context-engine/runtime-embedding-adapter.ts`, `openclaw_runtime/src/runtime-core/memory-embedding-provider.ts`.

### 6.2 KB UI

- Top page: `src/pages/Knowledge/index.tsx` (1685 lines), mounted via `src/App.tsx` router
- 5 workbench tabs (`index.tsx:47`): `library / inbox / drafts / review / governance`
- Top command bar: import file/folder, validate OKF Bundle, import OKF, Compile, Lint, open Vault (`:724-752`)
- NO standalone "Settings > KB" section; KB config via Knowledge page top `Configure` button (calls `hostApi.knowledge.configure()`, writes memory-wiki plugin config)
- Chat-side KB entry: `src/pages/Chat/ChatInput.tsx:138-150`, slash commands `/wiki`, `/memory`, `/all`, `/knowledge-mode`, `/save`, `/steward`, `/steward-audit`
- KB reference chip: `src/components/assistant-render/KnowledgeDirectiveChip.tsx`

### 6.3 "Role player" concept — bound to KB?

**6.3a KB's own "Knowledge Steward" role** (closest to user's "knowledge base role player"):

`knowledge-api.ts:191-208` defines a fixed steward config:
```typescript
const DEFAULT_STEWARD_CONFIG: KnowledgeStewardConfig = {
  enabled: true,
  roleId: 'knowledge-steward',
  capabilities: {
    canSearch: true, canRead: true, canProposeDraft: true,
    canClassify: true, canSuggestMerge: true, canSuggestArchive: true,
    canApplyDirectly: false,   // never write directly
  },
  scope: { workspace: true, agent: false, global: false },
};
```
Type: `shared/host-api/contract.ts:2290-2307` (`KnowledgeStewardConfig`).

Steward duties: `knowledge-api.ts:638-658` `stewardReviewDraft` and `:2021-2045` `stewardReview` host route: classify drafts (decision/architecture/command/...), add tags, produce warnings and "suggest merge/archive" opinions, but **cannot write to wiki directly** — all writes require user approval (`applyReviewedChange` route, `:1983`).

UI entries: `ChatInput.tsx:149` `/steward` and `/steward-audit` slash commands; `src/pages/Knowledge/index.tsx:633-658` "Ask Steward" button.

**6.3b Generic Role Contract system** (no direct KB binding):

`openclaw_runtime/src/agents/role-contract.ts:230-359` `BUILT_IN_ROLE_CONTRACTS` lists 8 built-in roles. **`knowledge-steward` is NOT among them** — it's a KB-module-custom role, not registered in the generic role registry.

Generic role subagent spawn flow:
- `openclaw_runtime/src/agents/role-spawn.ts` (role-driven subagent spawn, compiles role contract to SOUL system prompt and spawns subagent)
- `openclaw_runtime/src/agents/role-router.ts` (route by task keyword)
- `openclaw_runtime/src/agents/role-registry.ts`

### 6.4 KB↔role connection — loose coupling, non-binding

- KB does NOT bind to any generic role. The 8 roles in `BUILT_IN_ROLE_CONTRACTS` have NO KB field.
- KB has only one fixed role — `knowledge-steward` (`knowledge-api.ts:193`); its `scope` declares only `workspace: true`, meaning workspace-scoped, not bound to a specific role id.
- KB data entries (draft / inbox / provenance) have `workspaceId` and `agentId` fields (`knowledge-api.ts:534-535`, `568-569`, `1234`, `1244`; types at `contract.ts:2308-2319`) for workspace/agent filtering — this is scope filtering, not "role binding".
- Generic role system has separate "Role Memory" mechanism (independent of KB): `openclaw_runtime/src/memory/memory-store.ts:697-713` `getMemoryCards({ roleName })`, `role-spawn.ts:161-177` `resolveRoleMemoryCards` — injects role-name-tagged memory cards. UI copy at `shared/i18n/locales/en/agents.json:151-218` ("Role Memory"). This is a separate "role ↔ knowledge" channel, NOT via KB.

### 6.5 KB persistence — where are docs/chunks/embeddings?

Two-layer storage:

**A. Electron main-side (metadata + governance artifacts)** — `knowledge-api.ts:223-282`:
```
<OpenClaw config dir>/knowledge/
  ├── drafts/<kd_*.json>            # drafts
  ├── inbox/<ki_*.json>             # inbox entries
  ├── proposals/<kp_*.json>         # change proposals
  ├── provenance/<kpv_*.json>       # provenance records
  ├── okf/bundles/<okf_*.json>      # OKF bundle import map
  ├── watched-directories.json      # watched dirs config
  ├── watched-events/<wdId>.jsonl   # watch event log
  └── audit.jsonl                   # audit trail
```
`getOpenClawConfigDir()` from `electron/utils/paths.ts`. No DB, no vector index — all JSON/JSONL files (consistent with `AGENTS.md` "No database" statement).

**B. OpenClaw Runtime side (actual wiki content pages)**: via Gateway RPC `wiki.ingest` / `wiki.apply` writes to memory-wiki plugin's vault (Obsidian-style markdown files). Vault path returned via `wiki.status` (`knowledge-api.ts:1723`). Vault mode can be `isolated` or `obsidian` (`knowledge-api.ts:694-720` `buildMemoryWikiPatch`).

### 6.6 KB content injection into prompt at conversation time

Full chain in `electron/services/chat-api.ts:17-220`:

1. **Metadata block injection** (`applyKnowledgeMetadata`, `chat-api.ts:128-160`): serializes `knowledgeScope` (none/memory/wiki/all), `knowledgeMode` (manual/suggest/auto-read), `selectedKnowledgeReferences` into JSON, attaches instruction "Read compiled wiki knowledge when ... This scope is read-only ... do not save, modify, merge, archive, delete, or apply knowledge..." as untrusted metadata block prepended to user message.
2. **Auto-read reference body** (`readSelectedKnowledgeReferences`, `chat-api.ts:178-207`): only when `knowledgeMode === 'auto-read'` AND references selected, calls `wiki.get` RPC for each ref (max 5), truncates to 600 chars as citation.
3. **Reference body injection** (`applyKnowledgeReadCitations`, `chat-api.ts:209-220`): wraps read results as `clawxKnowledgeReads` JSON block, marked "Treat them as citations/provenance hints, cite them when used, and do not modify knowledge", prepended to user message.

Auto-routing (no manual selection required):
- `knowledge-api.ts:1133` defines `KNOWLEDGE_INTENT_PATTERN` (matches "之前/历史/项目里/规范/架构/为什么/决策/约定/排障/故障/知识库/wiki/memory/...").
- `shouldRouteKnowledge` (`:1143`) decides whether to route; `routeContext` host route (`:2047-2107`) calls `wiki.search` returning `KnowledgeRouteCandidate`, decision is `skip | suggest | auto_attach`.
- Renderer at `src/stores/chat/runtime-send-actions.ts:246-269` sends `knowledgeScope/mode/references` via `hostApi.chat.sendWithMedia`.

UI for KB refs: `src/pages/Chat/ChatInput.tsx:945-966` (`runKnowledgeSearch` calls `hostApi.knowledge.search`).

### 6.7 Are skill files "role knowledge"?

**NO.** Skills, KB, and Role are three independent systems:

- Skills management: `src/pages/Skills/index.tsx`, `src/types/skill.ts`, `electron/gateway/skill-catalog.ts`, `electron/gateway/skill-installer.ts`
- Skill definition (`skill-catalog.ts:32`): "skill extends AI capability with specialized knowledge, workflows, or tool integrations" — skill can carry knowledge, but does NOT bind to role, does NOT bind to KB; it's a parallel capability extension mechanism.
- Project memory's "skill files in attachments" refers to local Agent's memory/skill file folder layout, not directly related to this project code.

Closest to "role knowledge" is **Role Memory** (not skill): `openclaw_runtime/src/memory/memory-store.ts:697` `getMemoryCards({ roleName })`, injected into role subagent's SOUL prompt at `role-spawn.ts:161-177` via `resolveRoleMemoryCards`. These memory cards are a separate storage from KB wiki.

### 6.8 Optimization entry points for "KB role player"

1. **`knowledge-api.ts:191-208` `DEFAULT_STEWARD_CONFIG`** — currently hardcoded constant; roleId fixed `knowledge-steward`, capabilities/scope not configurable. Could become config-driven, support multiple steward roles.
2. **`knowledge-api.ts:615-658` `classifyDraft` + `stewardReviewDraft`** — currently regex keyword classification (CN/EN hardcoded), no model involvement; could integrate LLM for semantic classification and conflict detection.
3. **`knowledge-steward` not registered in `role-contract.ts:230` `BUILT_IN_ROLE_CONTRACTS`** — means it can't access role-spawn's tool whitelist, model binding, effort, permissions, etc. To make steward a true spawnable subagent, add `knowledge-steward` contract to `BUILT_IN_ROLE_CONTRACTS`.
4. **`chat-api.ts:128-220` KB injection path** only injects "reference body + metadata"; does not bring steward's review conclusions/warnings into conversation context. To let steward "speak" in conversation, extend `applyKnowledgeMetadata` to carry steward notes.
5. **KB data entry `agentId` field** (`contract.ts:2308-2319`) currently only used for scope filtering, not linked to `BUILT_IN_ROLE_CONTRACTS` role name. To "bind each role to independent KB", could establish role↔KB binding here.

---

## 7. Maturity Markers (project-wide convention)

The codebase uses consistent markers to indicate maturity:

1. **Production code**: no special markers. Normal module structure.
2. **Shadow** (advisory-only, default-off, no behavioral change): files ending in `-shadow.ts`, feature flags defaulting `false`, constants like `ADVISORY_ONLY = true`. System records data but doesn't act.
3. **Pilot** (controlled experiment with explicit gates): files ending in `-pilot.ts`, contains decision fns like `use_legacy_checkpoints` vs `ready_for_explicit_pilot`, explicit required-boundaries arrays.
4. **Planned / Future Work**: types defined but described as "reserved", "future", "planned", or disabled by default with no pilot code. Examples: `ssh-strong` sandbox provider, `workerCommunication="bounded_a2a"`, Mission Control scheduled ticks.
5. **Non-goals**: explicitly documented in `docs/clawx-design-overview.md` section 1.2. When the design doc says "X is not a Y", that boundary should be respected.

---

## 8. Hard Constraints (must respect in any design)

- **Renderer/Main boundary**: Renderer must use `src/lib/host-api.ts` and `src/lib/api-client.ts` as single entry. NO direct `window.electron.ipcRenderer.invoke(...)`. NO direct Gateway HTTP calls from renderer.
- **Transport policy**: Main-owned, fixed `WS → HTTP → IPC fallback`. Renderer must NOT implement protocol switching.
- **No database**: App uses `electron-store` (JSON) + OS keychain + SQLite (only inside runtime for state/memory).
- **`orchestrator.run` requires approval**: intentionally NOT in `SAFE_GATEWAY_METHODS` (`workspace-permissions.ts:73-74`). Spawns subagents → gated as mutating request.
- **`bounded_a2a` force-disabled**: workers cannot communicate directly; all merging transits Lead (`team-orchestrate-tool.ts:178`).
- **Task Ledger is NOT an executor** and NOT a replacement for memory/sessions/transcripts/observability traces.
- **Local Control Plane is observe-only**: default-off; any move to active behavior requires separate feature flag, flag-off parity proof, rollback plan.
- **Pilot promotion pattern**: fresh spec, explicit operator gate, default-off start, disable-only rollback, no schema change, rollback plan.
- **Knowledge Hub is NOT a new Verse Claw-native knowledge graph, Obsidian clone, or autonomous agent writer**. Does not replace role memory, Task Ledger, transcripts, or runtime memory governance.
- **i18n rule**: new user-facing features must route all text through `react-i18next` with full locale coverage (en / zh / ja / ru under `shared/i18n/locales/<lang>/<ns>.json`) — never hardcode display strings.
- **Styling rule**: use design tokens and substitution rules in `src/styles/globals.css` (surfaces `bg-surface-modal` / `bg-surface-input`, selected state `bg-black/5 dark:bg-white/10`, status colors `text-X-700 dark:text-X-400`, page H1/H2 `font-serif font-normal tracking-tight`, etc.).
- **UI change validation**: any user-visible UI change should include or update an Electron E2E spec in the same PR so the interaction is covered by Playwright.
- **Comms-change checklist**: if change touches communication paths (gateway events, runtime send/receive, delivery, fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.
- **Spec-driven harness rule**: AI Coding tasks that touch backend communication must start from a task spec under `harness/specs/tasks/` and reference `gateway-backend-communication` when the change involves renderer/Main/host-api/api-client/Gateway/OpenClaw runtime paths. Run `pnpm harness validate --spec <task-spec>` before implementation review.

---

## 9. Standard Dev Commands (reference)

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| Comms replay metrics | `pnpm run comms:replay` |
| Comms baseline refresh | `pnpm run comms:baseline` |
| Comms regression compare | `pnpm run comms:compare` |
| E2E tests (Playwright) | `pnpm run test:e2e` |
| Build frontend only | `pnpm run build:vite` |

---

## 10. CodeGraph Tool Reference (for fable5)

The runtime ships a CodeGraph semantic code index with 15 registered tools. Index: 10,026 files, 158,358 nodes, 470,892 edges. Freshness modes: `fast` (skip sync), `balanced` (throttled 5s TTL), `strict` (sync-before-read).

Tools:
- `codegraph_decide` — first call always; tells whether CodeGraph navigation will help and what freshness mode to use
- `codegraph_context_plan` — builds prioritized reading list with priority scores (≥80 must-read, 60-80 useful, <60 deferrable)
- `codegraph_search` — find specific symbols
- `codegraph_find_flow` — understand how data moves through a pipeline
- `codegraph_callers` / `codegraph_callees` / `codegraph_impact` — call graph navigation
- `codegraph_minimal_context` — minimal context for a symbol
- `codegraph_entrypoints` — find entry points
- `codegraph_status` / `codegraph_sync` / `codegraph_init` / `codegraph_freshness` / `codegraph_git_stats`

**Recommended workflow for the role-driven architecture task**:
1. This CodeGraph map (the file you are reading) is the **pre-computed orientation**. Start here, NOT with raw codegraph calls.
2. Only invoke `codegraph_*` tools when you need to go deeper than this map covers — e.g., to verify a specific function signature or trace a specific data flow.
3. When you do invoke, use `codegraph_decide` first with `operationType="locate"`, `riskLevel="medium"`, then `codegraph_context_plan` with the specific sub-topic.
4. Read files selectively: type definitions (usually first 50-100 lines), public API surface (class declarations, exported functions), integration points (imports). Skip implementation bodies unless interface is unclear.
5. Files >500 lines: read first 100 lines + type/interface definitions only.

---

End of CodeGraph map. The architect (fable5) should treat this as ground truth for what exists; design proposals extend this, never replace it.
