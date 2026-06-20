# MCP, Custom Agent, And CDP Remote Control Plan

> Scope: MCP integration, custom agent profiles, workspace-agent decoupling, and CDP-based remote control.
> Basis: CodeGraph index and source review on 2026-06-08.
> Related plan: `docs/workspace-and-permission-control-plan.md`.

## 1. Planning Goals

This document extends the workspace and permission-control plan with two additional capability groups:

1. MCP and custom agent ecosystem:
   - MCP server configuration and lifecycle.
   - Custom agent profiles with `SOUL.md`, bootstrap files, skill selection, and MCP bindings.
   - Support different agents per workspace while keeping workspace and agent identities decoupled.
2. CDP remote control:
   - Settings-managed CDP service configuration.
   - Expose Electron remote-debugging port capability.
   - Provide a safe remote-control surface for automation, inspection, and external orchestration.

The key architectural rule is that workspace profiles are the user's project/work context, while agent profiles are execution/personality/tooling identities. A workspace may select an agent, and an agent may be reused by multiple workspaces.

## 2. Current Evidence From CodeGraph

CodeGraph and source review identified these relevant entry points:

- Agent and workspace bootstrap:
  - `electron/utils/agent-config.ts`
  - `electron/utils/openclaw-workspace.ts`
  - `src/stores/agents.ts`
  - `src/pages/Agents/index.tsx`
  - `shared/types/agent.ts`
- Skill lifecycle:
  - `electron/services/skills-api.ts`
  - `electron/services/skills/local-skill-service.ts`
  - `electron/utils/skill-config.ts`
  - `electron/utils/skill-quick-access.ts`
  - `src/stores/skills.ts`
  - `src/pages/Skills/index.tsx`
  - `shared/types/skill.ts`
  - `resources/skills/preinstalled-manifest.json`
- Gateway and Control UI:
  - `electron/services/gateway-api.ts`
  - `electron/utils/openclaw-control-ui.ts`
  - `electron/utils/control-ui-device-pairing.ts`
  - `electron/gateway/manager.ts`
  - `electron/gateway/config-sync.ts`
  - `electron/gateway/process-launcher.ts`
  - `shared/host-api/contract.ts`
  - `src/lib/host-api.ts`
- Settings and remote debugging:
  - `src/pages/Settings/index.tsx`
  - `src/stores/settings.ts`
  - `electron/services/settings-api.ts`
  - `electron/main/index.ts`

Observed current behavior:

- `agent-config.ts` already provisions agent filesystem directories and copies bootstrap files including `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, `IDENTITY.md`, `HEARTBEAT.md`, and `BOOT.md`.
- Skills are discovered from OpenClaw, workspace paths, `.agents/skills`, personal `.agents`, bundled resources, and local ClawHub-style registries.
- `SkillQuickAccessPayload` already accepts `workspace`, which is a useful hook for workspace-specific skill discovery.
- The architecture document previously noted that direct MCP integration is not currently visible in ClawX source, though OpenClaw may provide runtime support.
- Settings already contains developer-mode surfaces for Gateway token, Control UI, Doctor, and CLI command.
- `electron/main/index.ts` already reads `CLAWX_REMOTE_DEBUGGING_PORT` and appends Electron's `remote-debugging-port` switch when present.
- `gateway-api.ts` already exposes `gateway.controlUi`, builds a Control UI URL, returns port/token, and schedules device auto-approval.

## 3. Architectural Principles

### 3.1 Workspace And Agent Decoupling

Workspace profiles and agent profiles must be separate concepts.

- Workspace profile:
  - project root,
  - active session,
  - permission mode,
  - UI recovery state,
  - selected agent id,
  - workspace-local MCP/skill overrides.
- Agent profile:
  - name and identity,
  - model defaults,
  - `agentDir`,
  - bootstrap files,
  - default skills,
  - default MCP servers,
  - optional default workspace template.

The relationship should be many-to-many over time:

- One workspace can switch between agents.
- One agent can be used across many workspaces.
- A workspace can override agent defaults without mutating the agent profile.

### 3.2 Runtime Ownership

ClawX should own UX, configuration, validation, and audit. OpenClaw should remain the runtime executor where possible.

If OpenClaw supports MCP and agent customization natively, ClawX should write validated config into OpenClaw's config format. If not, ClawX should keep its own config and expose it through Gateway environment variables or runtime bridge APIs.

### 3.3 Remote Control Safety

CDP remote control must be developer-mode gated by default.

Remote debugging can expose significant app internals. The setting must be explicit, visible, and auditable, with clear local-only defaults.

## 4. Proposed Data Model

### 4.1 Agent Profile

```ts
export type CustomAgentProfile = {
  id: string;
  name: string;
  description?: string;
  agentDir: string;
  defaultModelRef?: string | null;
  defaultPermissionMode?: WorkspacePermissionMode;
  bootstrap: AgentBootstrapFiles;
  skills: AgentSkillBinding[];
  mcpServers: AgentMcpBinding[];
  createdAt: number;
  updatedAt: number;
};

export type AgentBootstrapFiles = {
  agentsMd?: string;
  soulMd?: string;
  toolsMd?: string;
  userMd?: string;
  identityMd?: string;
  heartbeatMd?: string;
  bootMd?: string;
};

export type AgentSkillBinding = {
  skillKey: string;
  enabled: boolean;
  source?: 'openclaw' | 'workspace' | 'agents' | 'clawhub' | 'bundled' | 'custom';
  config?: Record<string, unknown>;
};

export type AgentMcpBinding = {
  serverId: string;
  enabled: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
};
```

### 4.2 Workspace Agent Binding

Extend the workspace profile from the previous plan:

```ts
export type WorkspaceAgentBinding = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  skillOverrides?: AgentSkillBinding[];
  mcpOverrides?: AgentMcpBinding[];
  bootstrapOverrides?: Partial<AgentBootstrapFiles>;
};
```

Rules:

- A workspace's selected `agentId` is a binding, not ownership.
- Workspace-level skill/MCP overrides apply at runtime without changing the base agent profile.
- If a workspace has no selected agent, use the app default agent.

### 4.3 MCP Server Config

```ts
export type McpServerConfig = {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http' | 'websocket';
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  scope: 'global' | 'agent' | 'workspace';
  ownerId?: string;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  permissionMode?: WorkspacePermissionMode;
  createdAt: number;
  updatedAt: number;
};
```

### 4.4 CDP Service Config

```ts
export type CdpRemoteControlConfig = {
  enabled: boolean;
  port: number | null;
  host: '127.0.0.1' | '0.0.0.0';
  exposeElectronRemoteDebugging: boolean;
  requireToken: boolean;
  token?: string;
  allowOrigins: string[];
  launchMode: 'nextRestart' | 'currentIfAvailable';
  lastStartedAt?: number;
  lastKnownUrl?: string;
};
```

## 5. MCP Integration Plan

### 5.1 Host API

Add MCP contract entries:

```ts
mcp: {
  listServers: () => McpServerListResult;
  createServer: (payload: McpServerCreatePayload) => McpServerListResult;
  updateServer: (payload: McpServerUpdatePayload) => McpServerListResult;
  deleteServer: (payload: McpServerDeletePayload) => McpServerListResult;
  testServer: (payload: McpServerTestPayload) => McpServerTestResult;
  listTools: (payload: McpServerToolsPayload) => McpServerToolsResult;
}
```

Main service:

- Add `electron/services/mcp-api.ts`.
- Store config in ClawX settings/store first.
- Sync to OpenClaw config or Gateway runtime only after validation.

Renderer:

- Add `src/stores/mcp.ts`.
- Add Settings > Developer or Settings > Integrations > MCP section.
- Reuse existing input, switch, select, badge, dialog, and tabs components.

### 5.2 Config Sync Strategy

MCP sync must support three scopes:

- Global: available to all agents/workspaces.
- Agent: available when a specific agent is active.
- Workspace: available only for a specific workspace profile.

Runtime resolution:

1. Start with global MCP servers.
2. Merge selected agent MCP bindings.
3. Merge active workspace overrides.
4. Apply permission profile.
5. Pass resolved MCP config to Gateway/OpenClaw.

Potential sync locations:

- `electron/gateway/config-sync.ts` before Gateway launch.
- `electron/gateway/process-launcher.ts` for environment metadata.
- `electron/services/gateway-api.ts` for live refresh if supported.

### 5.3 MCP Security Rules

MCP tools must participate in the same permission-control model from the workspace plan.

Rules:

- `readOnly`: allow only read/classification tools.
- `acceptEdits`: allow write tools inside workspace; high-risk tools require approval.
- `plan`: allow discovery tools; block mutation until plan approval.
- `fullAccess`: allow configured tools, still audit high-risk calls.

Each MCP server should expose:

- status,
- tool list,
- last error,
- scope,
- effective permission mode,
- environment redaction status.

## 6. Custom Agent Plan

### 6.1 Agent Template Management

Add custom agent templates on top of existing `agent-config.ts`.

Required UI:

- Agent list.
- Create from blank/template/current agent.
- Edit agent name and model.
- Edit `SOUL.md`, `AGENTS.md`, `TOOLS.md`, and other bootstrap files.
- Select default skills.
- Select default MCP servers.
- Preview effective runtime profile for a selected workspace.

Implementation notes:

- Keep existing OpenClaw agent config as the runtime backing store.
- Add ClawX-owned metadata for richer UI state if OpenClaw config cannot represent all fields.
- Continue using filesystem provisioning for `agentDir`.
- Use the existing bootstrap file list in `agent-config.ts` as the canonical initial file set.

### 6.2 Bootstrap File Handling

The agent editor should manage these files:

- `AGENTS.md`: general behavior and project instructions.
- `SOUL.md`: personality/identity layer.
- `TOOLS.md`: tool usage guidance.
- `USER.md`: user preferences.
- `IDENTITY.md`: UI identity seed.
- `HEARTBEAT.md`: background/heartbeat behavior.
- `BOOT.md`: startup instructions where supported.

Rules:

- Edits are saved through Main APIs.
- Workspace overrides should be stored separately until explicitly promoted to agent default.
- Existing `ensureClawXIdentityFile` behavior should remain backward compatible.

### 6.3 Skill Binding

Skill binding should use existing skill infrastructure:

- `skills-api.ts` for status/update/config.
- `skill-config.ts` for OpenClaw config entries.
- `skill-quick-access.ts` for workspace-aware quick access.
- `local-skill-service.ts` for multi-source scanning.

New behavior:

- Agent default skills.
- Workspace overrides for enabled/disabled skills.
- Effective skill resolver:

```ts
effectiveSkills = merge(
  globalSkillConfig,
  agentProfile.skills,
  workspaceBinding.skillOverrides,
);
```

### 6.4 Workspace-Agent Binding

Workspace switching should not mutate Agent config by default.

When active workspace changes:

1. Load workspace profile.
2. Resolve selected agent binding.
3. Resolve effective bootstrap/skills/MCP config.
4. Set current chat session from workspace state.
5. Sync runtime context.

Acceptance:

- Workspace A can use Agent X.
- Workspace B can use Agent Y.
- Workspace C can also use Agent X with different MCP/skill overrides.
- Editing Agent X defaults does not erase workspace overrides.

## 7. CDP Remote Control Plan

### 7.1 Existing Baseline

Current baseline:

- `electron/main/index.ts` supports `CLAWX_REMOTE_DEBUGGING_PORT` at process startup.
- Settings already has a developer section.
- Gateway Control UI already exposes URL, token, and port through `gateway.controlUi`.

Gap:

- No Settings-managed CDP service config.
- No UI to enable/disable Electron remote debugging.
- No clear restart requirement display.
- No remote-control token/origin policy in ClawX settings.
- No consolidated "remote control" status panel.

### 7.2 Settings UI

Add Settings > Advanced > Developer > Remote Control.

Controls:

- Enable CDP remote control.
- Electron remote debugging port.
- Host binding: `127.0.0.1` default, `0.0.0.0` only with warning.
- Require token.
- Rotate token.
- Copy CDP URL.
- Copy Gateway Control UI URL.
- Show Gateway port and token.
- Restart app button or "takes effect after restart" badge for Electron remote-debugging switch.

### 7.3 Main Service

Add `electron/services/remote-control-api.ts`.

Host API:

```ts
remoteControl: {
  getConfig: () => RemoteControlConfigResult;
  saveConfig: (payload: RemoteControlSavePayload) => RemoteControlConfigResult;
  status: () => RemoteControlStatusResult;
  rotateToken: () => RemoteControlConfigResult;
  getUrls: () => RemoteControlUrlsResult;
}
```

Status should include:

- configured port,
- whether Electron remote debugging was enabled for this process,
- whether restart is required,
- Gateway Control UI URL,
- CDP browser endpoint URL where available,
- last error.

### 7.4 Electron Port Exposure

Electron's `remote-debugging-port` must be set before app ready and before windows are created.

Implementation strategy:

- Store setting persistently.
- At startup, read the stored setting before window creation.
- Append `remote-debugging-port` when enabled.
- Continue supporting `CLAWX_REMOTE_DEBUGGING_PORT` as an environment override for tests and advanced users.
- If a user changes the setting during runtime, mark restart required.

Important safety defaults:

- Default disabled.
- Default host local-only.
- Port must be in a safe numeric range.
- Do not expose tokens in logs.
- Any non-local host binding requires explicit warning and confirmation.

### 7.5 CDP Service Boundary

There are two possible meanings of "CDP service":

1. Expose Electron/Chromium's native DevTools Protocol endpoint.
2. Provide a ClawX-controlled remote automation gateway that can broker a subset of safe actions.

Plan recommendation:

- Phase 1: expose Electron native CDP endpoint with settings and warnings.
- Phase 2: add ClawX remote-control broker for safe app-level actions.
- Phase 3: support remote clients through MCP/CDP bridge if useful.

Broker actions may include:

- inspect app status,
- get active workspace,
- list sessions,
- open Control UI,
- trigger Gateway health check,
- request screenshot with explicit permission,
- navigate app pages by route.

## 8. Integration With Workspace And Permission Plan

The previous workspace plan introduced:

- Workspace profiles.
- Permission profiles.
- Workspace-local active session state.
- Permission enforcement and approval events.

This plan depends on that model as follows:

- MCP servers can be scoped to global, agent, or workspace.
- Custom agents can be selected per workspace.
- Workspace permission mode constrains MCP tools and CDP remote actions.
- CDP remote actions must record approval/audit events when they can affect workspace state.
- Agent bootstrap files can have workspace-local overrides without changing the agent profile.

Recommended merge order:

1. Build workspace profile model.
2. Add workspace-agent binding.
3. Add custom agent profile editor.
4. Add MCP server registry and effective resolver.
5. Add permission enforcement for MCP tools.
6. Add CDP remote-control settings.

## 9. Implementation Phases

### Phase 0: Specs And Contracts

Files:

- `docs/mcp-custom-agent-and-cdp-remote-control-plan.md`
- `harness/specs/tasks/mcp-custom-agent-cdp-remote-control.md`
- `shared/host-api/contract.ts`

Deliverables:

- Finalized host contracts.
- Data model review.
- Security review notes.

Acceptance criteria:

- MCP, custom agent, and CDP work can be traced to this document.
- The plan explicitly references workspace/permission profile dependencies.

### Phase 1: Workspace-Agent Binding

Files:

- `electron/services/workspaces-api.ts`
- `electron/services/agents-api.ts`
- `electron/utils/agent-config.ts`
- `src/stores/workspaces.ts`
- `src/stores/agents.ts`
- `src/pages/Agents/index.tsx`

Deliverables:

- Workspace selects an agent without mutating the agent profile.
- Workspace keeps its own session and overrides.

Acceptance criteria:

- Different workspaces can use different agents.
- Changing selected agent updates effective runtime context.
- Agent deletion handles workspace bindings safely.

### Phase 2: Custom Agent Editor

Files:

- `electron/services/agents-api.ts`
- `electron/utils/agent-config.ts`
- `src/pages/Agents/index.tsx`
- `src/components/file-preview/MonacoViewer.tsx` or a dedicated editor
- locale files under `shared/i18n/locales/<lang>/agents.json`

Deliverables:

- Edit bootstrap files.
- Manage default skills.
- Manage default MCP bindings once MCP registry exists.

Acceptance criteria:

- New agent can be created from template.
- `SOUL.md` and other bootstrap files are visible/editable.
- Saving updates agent filesystem through Main APIs.
- Workspace overrides are not overwritten.

### Phase 3: MCP Registry

Files:

- `electron/services/mcp-api.ts`
- `electron/gateway/config-sync.ts`
- `electron/gateway/process-launcher.ts`
- `src/stores/mcp.ts`
- `src/pages/Settings/index.tsx`
- `shared/host-api/contract.ts`

Deliverables:

- MCP server CRUD.
- MCP server test action.
- Effective MCP resolution by global/agent/workspace.

Acceptance criteria:

- User can add a stdio MCP server.
- User can add an HTTP/SSE MCP server.
- User can test connectivity.
- Effective MCP list changes when workspace or agent changes.

### Phase 4: MCP Skill And Permission Integration

Files:

- `electron/services/skills-api.ts`
- `electron/utils/skill-config.ts`
- `electron/utils/skill-quick-access.ts`
- `electron/services/permissions-api.ts`
- `src/stores/skills.ts`
- `src/pages/Skills/index.tsx`

Deliverables:

- Agent skill defaults.
- Workspace skill overrides.
- MCP tools classified under permission model.

Acceptance criteria:

- Workspace-specific skills appear in quick access.
- Agent default skill config applies when workspace has no override.
- Read-only mode prevents mutating MCP tools.

### Phase 5: CDP Remote Control Settings

Files:

- `electron/main/index.ts`
- `electron/services/settings-api.ts`
- `electron/services/remote-control-api.ts`
- `src/stores/settings.ts`
- `src/pages/Settings/index.tsx`
- `shared/host-api/contract.ts`
- locale files under `shared/i18n/locales/<lang>/settings.json`

Deliverables:

- Remote-control settings UI.
- Electron remote-debugging port persisted.
- Restart-required status.
- Copyable local CDP URL.

Acceptance criteria:

- Remote debugging is disabled by default.
- Enabling it persists setting and marks restart required.
- After restart, app exposes the requested port.
- Invalid ports are rejected.
- Environment variable override still works.

### Phase 6: Remote-Control Broker

Files:

- `electron/services/remote-control-api.ts`
- optional `electron/remote-control/server.ts`
- `src/pages/Settings/index.tsx`
- `tests/unit/remote-control-api.test.ts`

Deliverables:

- Local token-protected ClawX remote-control broker.
- Status and health endpoints.
- Optional safe app actions.

Acceptance criteria:

- Broker is local-only by default.
- Token is required by default.
- Actions are audited.
- Permission mode constrains mutating actions.

### Phase 7: Tests And Documentation

Files:

- `tests/unit/mcp-config.test.ts`
- `tests/unit/agent-config.test.ts`
- `tests/unit/remote-control-api.test.ts`
- `tests/e2e/settings-remote-control.spec.ts`
- `tests/e2e/workspace-agent-binding.spec.ts`
- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`

Deliverables:

- Unit and E2E coverage.
- User-facing docs.

Acceptance criteria:

- E2E verifies workspace A uses Agent X while workspace B uses Agent Y.
- E2E verifies custom agent bootstrap editing.
- E2E verifies remote-control setting shows restart-required state.
- Documentation explains security implications.

## 10. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MCP support differs between OpenClaw versions | Runtime sync may fail or behave inconsistently | Start with ClawX-owned registry and feature-detect Gateway capabilities |
| Agent and workspace concepts become confusing | Users may not understand which layer controls behavior | UI copy and layout must show "workspace selects agent" rather than "agent owns workspace" |
| Bootstrap file edits break agent behavior | Agent may become unusable | Provide templates, diff preview, reset to default, and validation |
| Skill overrides conflict with global skill config | Effective skill list may be surprising | Add an effective profile preview |
| CDP exposes sensitive app internals | Security risk | Default disabled, local-only, explicit warnings, restart-required badge, token controls |
| Remote debugging port conflicts | App startup or CDP endpoint fails | Validate port and show status/last error |
| Remote broker overlaps with Gateway Control UI | Duplicate control surfaces | Clearly separate Electron/CDP control from OpenClaw Gateway Control UI |

## 11. Traceability Matrix

| Requirement | Phase | Primary Files | Tests |
| --- | --- | --- | --- |
| Workspace selects agent | Phase 1 | `workspaces-api.ts`, `agents-api.ts`, `workspaces.ts` | `workspace-agent-binding.spec.ts` |
| Agent bootstrap editor | Phase 2 | `Agents/index.tsx`, `agent-config.ts` | `agent-config.test.ts` |
| `SOUL.md` support | Phase 2 | `agent-config.ts`, agent editor UI | `agent-config.test.ts` |
| Agent default skills | Phase 4 | `skill-config.ts`, `skills-api.ts` | `mcp-config.test.ts` |
| Workspace skill overrides | Phase 4 | `skill-quick-access.ts`, `skills.ts` | `workspace-agent-binding.spec.ts` |
| MCP server registry | Phase 3 | `mcp-api.ts`, `contract.ts` | `mcp-config.test.ts` |
| MCP permission integration | Phase 4 | `permissions-api.ts`, `mcp-api.ts` | `permission-profile.test.ts` |
| CDP setting | Phase 5 | `Settings/index.tsx`, `remote-control-api.ts` | `settings-remote-control.spec.ts` |
| Electron remote-debugging port | Phase 5 | `main/index.ts`, `settings-api.ts` | `remote-control-api.test.ts` |
| Remote-control broker | Phase 6 | `remote-control-api.ts`, `remote-control/server.ts` | `remote-control-api.test.ts` |

## 12. Open Questions

1. Should MCP configuration be surfaced under Settings > Developer, Settings > Skills, or a new Integrations page?
2. Should workspace-local MCP servers be stored inside the workspace root, ClawX app storage, or both?
3. Should agent bootstrap edits be plain text editors only, or should ClawX provide templates and structured forms?
4. Should `SOUL.md` be treated as required for every custom agent, or optional when `IDENTITY.md` is present?
5. Should Electron CDP support only local loopback, or allow LAN exposure with explicit warning?
6. Should the remote-control broker be implemented before or after native CDP exposure?

## 13. Recommended First Slice

The safest first slice is:

1. Extend workspace profile with selected `agentId` and workspace-local overrides.
2. Add an effective profile resolver for agent + workspace.
3. Add custom agent bootstrap file viewing/editing for `SOUL.md`, `AGENTS.md`, and `TOOLS.md`.
4. Add MCP registry data model and Settings UI stub without runtime execution.
5. Add remote-control Settings UI that reads current env-based CDP state and stores desired port for next restart.

This slice keeps execution behavior mostly unchanged while making the new concepts visible, testable, and compatible with the workspace/permission-control foundation.
