# Workspace And Permission Control Plan

> Scope: Verse Claw workspace switching/state persistence and multi-level permission control.
> Basis: CodeGraph index and source review on 2026-06-08.

## 1. Planning Goals

This document turns the workspace and permission-control ideas into a traceable implementation plan. It is intentionally written before code changes so future implementation, review, tests, and documentation updates can all point back to one source of truth.

The plan covers two modules:

1. Workspace module: project/work path management, switching, and per-workspace state retention.
2. Permission control module: read-only, accept-edits, plan, and full-access modes, including sandbox and approval behavior.

## 2. Current Evidence From CodeGraph

CodeGraph status for the project:

- Indexed files: 531.
- Symbol nodes: 6,674.
- Edges: 15,832.
- Main matches for workspace/session/permission planning:
  - `electron/utils/openclaw-workspace.ts`
  - `electron/utils/agent-config.ts`
  - `electron/services/files-api.ts`
  - `electron/gateway/process-launcher.ts`
  - `electron/gateway/config-sync.ts`
  - `electron/services/sessions-api.ts`
  - `src/stores/chat.ts`
  - `src/stores/agents.ts`
  - `src/components/file-preview/WorkspaceBrowserBody.tsx`
  - `src/lib/workspace-tree.ts`
  - `shared/host-api/contract.ts`
  - `src/lib/host-api.ts`

Observed current behavior:

- Agent config already has a `workspace` field, but it is an agent-owned runtime path, not a user-managed project/workspace layer.
- Chat state is primarily keyed by `sessionKey`, usually in the shape `agent:<agentId>:<session>`.
- Session history is stored under OpenClaw agent session files and loaded through `sessions-api.ts` plus Gateway fallback paths.
- The file preview service has a limited read/write root model, but this protects file preview/write APIs rather than all agent tool execution.
- Gateway startup currently launches the OpenClaw Gateway process from `process-launcher.ts`; no Verse Claw-owned permission profile or sandbox profile is visible at that layer.
- Runtime events already include approval-like rendering paths, but there is no full product-level permission-mode model in Verse Claw UI or Main services.

## 3. Product Requirements

### 3.1 Workspace Module Requirements

The app should support user-selected working paths independent of Agent management.

Required capabilities:

- Create, rename, delete, and switch workspace profiles.
- Bind each workspace profile to:
  - a root filesystem path,
  - an agent,
  - an active chat session,
  - a permission mode,
  - UI recovery state.
- Preserve working state when switching away and back:
  - active session,
  - chat history position where practical,
  - composer draft,
  - active model override if workspace-local,
  - artifact/workspace browser state,
  - terminal panel state,
  - active Web preview target and preview server state,
  - execution graph expansion state,
  - visible context window range,
  - live token usage counters,
  - recently opened files or generated artifacts.
- Show current workspace clearly in the Chat page.
- Make workspace path the default scope for file browsing, generated file previews, and future command sandbox roots.
- Provide a workspace-scoped terminal service, constrained by the active permission profile.
- Provide targeted Web preview for the active workspace, including static file preview, local dev server detection, and explicit preview target selection.
- Show context range and live token usage at the bottom of the Chat page during conversation.

### 3.2 Permission Control Requirements

The app should expose four user-facing permission modes:

- `readOnly`: analysis only. File writes, destructive operations, and shell commands that mutate state are denied.
- `acceptEdits`: allow normal edits inside the active workspace; dangerous operations require approval.
- `plan`: planning first. The assistant produces a plan, affected files, and acceptance criteria before execution. No edits happen until the user confirms.
- `fullAccess`: broad access. Still keep audit logs and emergency stop controls.

Permission behavior must be enforced as close to Main/Gateway execution as possible, not only in the renderer.

## 4. Non-Goals

These are explicitly out of scope for the first implementation pass:

- Replacing OpenClaw's session storage format.
- Rewriting the entire Agent model.
- Building a full operating-system-level containment solution for every platform in the first release.
- Allowing arbitrary workspace deletion from disk. Deleting a workspace profile should not delete the user's project directory.
- Changing provider/model setup behavior unless permission mode requires a visible default.

## 5. Proposed Data Model

### 5.1 Workspace Profile

```ts
export type WorkspacePermissionMode =
  | 'readOnly'
  | 'acceptEdits'
  | 'plan'
  | 'fullAccess';

export type WorkspaceProfile = {
  id: string;
  name: string;
  rootPath: string;
  agentId: string;
  activeSessionKey: string;
  permissionMode: WorkspacePermissionMode;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  state: WorkspaceUiState;
};

export type WorkspaceUiState = {
  draftInput?: string;
  selectedModelRef?: string | null;
  artifactPanel?: {
    open?: boolean;
    activeTab?: string;
    selectedPath?: string | null;
  };
  terminal?: WorkspaceTerminalState;
  webPreview?: WorkspaceWebPreviewState;
  chatFooter?: WorkspaceChatFooterState;
  graphExpanded?: Record<string, boolean>;
  recentFiles?: string[];
};

export type WorkspaceTerminalState = {
  open?: boolean;
  cwd?: string;
  lastCommand?: string;
  scrollbackId?: string;
  activeProcessId?: string | null;
};

export type WorkspaceWebPreviewState = {
  open?: boolean;
  mode?: 'static' | 'devServer' | 'externalUrl';
  targetPath?: string | null;
  url?: string | null;
  port?: number | null;
  lastStartedAt?: number | null;
};

export type WorkspaceChatFooterState = {
  contextRangeVisible?: boolean;
  tokenUsageVisible?: boolean;
};
```

### 5.2 Context Range And Live Token Usage

```ts
export type WorkspaceContextRange = {
  sessionKey: string;
  modelRef?: string | null;
  maxTokens?: number | null;
  usedTokens?: number | null;
  visibleMessageStartIndex?: number | null;
  visibleMessageEndIndex?: number | null;
  retainedMessageCount?: number;
  truncatedMessageCount?: number;
  summarizedMessageCount?: number;
  status: 'exact' | 'bestEffort' | 'unavailable';
};

export type LiveTokenUsage = {
  sessionKey: string;
  runId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'final' | 'unavailable';
};
```

The context range is a user-facing explanation of what the current conversation is carrying forward. If Gateway/OpenClaw exposes exact context-window data, Verse Claw should display exact values. Until then, Verse Claw can display best-effort ranges based on loaded transcript, runtime usage events, and known model context limits.

### 5.3 Permission Profile

```ts
export type PermissionProfile = {
  workspaceId: string;
  mode: WorkspacePermissionMode;
  readRoots: string[];
  writeRoots: string[];
  denyCommands: string[];
  requireApprovalFor: PermissionRiskRule[];
  allowNetwork: boolean;
  allowWorkspaceOutsideWrites: boolean;
};

export type PermissionRiskRule = {
  id: string;
  label: string;
  match: {
    commandNames?: string[];
    pathOutsideWorkspace?: boolean;
    recursiveDelete?: boolean;
    gitHistoryRewrite?: boolean;
    packageInstall?: boolean;
    networkAccess?: boolean;
  };
};
```

### 5.4 Approval Event

```ts
export type PermissionApprovalEvent = {
  id: string;
  workspaceId: string;
  sessionKey: string;
  runId?: string;
  mode: WorkspacePermissionMode;
  requestedAt: number;
  resolvedAt?: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  risk: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  reason?: string;
};
```

## 6. Storage Plan

Use Verse Claw-owned app storage for workspace profiles.

Recommended location:

- Main process service backed by the existing store utilities in `electron/utils/store.ts`.
- Keep OpenClaw config as the runtime-facing config source, but do not make workspace profiles a hard dependency of OpenClaw's own config schema.

Suggested store shape:

```ts
{
  workspaces: {
    activeWorkspaceId: string | null,
    profiles: WorkspaceProfile[]
  },
  permissionAudit: PermissionApprovalEvent[]
}
```

Retention:

- Keep workspace profiles until users remove them.
- Keep audit events capped by count and age, for example latest 2,000 events or latest 90 days.

## 7. Backend Integration Plan

### 7.1 New Host API Surface

Add Host API contract entries in `shared/host-api/contract.ts`:

```ts
workspaces: {
  list: () => WorkspaceProfilesResult;
  getActive: () => WorkspaceActiveResult;
  create: (payload: WorkspaceCreatePayload) => WorkspaceProfilesResult;
  update: (payload: WorkspaceUpdatePayload) => WorkspaceProfilesResult;
  delete: (payload: WorkspaceDeletePayload) => WorkspaceProfilesResult;
  switch: (payload: WorkspaceSwitchPayload) => WorkspaceActiveResult;
  saveState: (payload: WorkspaceSaveStatePayload) => HostSuccess;
}

permissions: {
  profile: (payload?: WorkspaceIdPayload) => PermissionProfileResult;
  setMode: (payload: PermissionSetModePayload) => PermissionProfileResult;
  approvals: () => PermissionApprovalListResult;
  decideApproval: (payload: PermissionApprovalDecisionPayload) => HostSuccess;
}

terminal: {
  open: (payload: WorkspaceTerminalOpenPayload) => WorkspaceTerminalOpenResult;
  write: (payload: WorkspaceTerminalWritePayload) => HostSuccess;
  resize: (payload: WorkspaceTerminalResizePayload) => HostSuccess;
  kill: (payload: WorkspaceTerminalKillPayload) => HostSuccess;
  history: (payload: WorkspaceTerminalHistoryPayload) => WorkspaceTerminalHistoryResult;
}

preview: {
  resolve: (payload: WorkspacePreviewResolvePayload) => WorkspacePreviewResolveResult;
  start: (payload: WorkspacePreviewStartPayload) => WorkspacePreviewStartResult;
  stop: (payload: WorkspacePreviewStopPayload) => HostSuccess;
  status: (payload: WorkspacePreviewStatusPayload) => WorkspacePreviewStatusResult;
}

usage: {
  live: (payload: WorkspaceLiveUsagePayload) => WorkspaceLiveUsageResult;
  contextRange: (payload: WorkspaceContextRangePayload) => WorkspaceContextRangeResult;
}
```

Add renderer facade methods in `src/lib/host-api.ts`.

Add Main service files:

- `electron/services/workspaces-api.ts`
- `electron/services/permissions-api.ts`

Register the services through the existing host service registry and IPC boundary.

### 7.2 Workspace Runtime Sync

When switching workspace:

1. Renderer calls `workspaces.saveState` for the old active workspace.
2. Renderer calls `workspaces.switch`.
3. Main validates and normalizes the path.
4. Main updates active workspace profile.
5. Main asks Gateway to restart or refresh if runtime workspace config must change.
6. Renderer updates chat state to the active workspace's saved `activeSessionKey`.
7. Renderer reloads session history through existing session APIs.

Runtime sync options:

- Preferred: pass workspace and permission metadata to Gateway/OpenClaw using supported config or environment variables if available.
- Fallback: Verse Claw Main applies policy to Gateway RPC calls and file APIs, then logs any unsupported enforcement gap.

### 7.3 Permission Resolver

Add a Main-owned resolver:

```ts
resolvePermissionDecision(input): {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  approvalEvent?: PermissionApprovalEvent;
}
```

Policy examples:

- `readOnly`
  - Reads inside workspace: allow.
  - Reads outside workspace: allow only for explicit file preview paths or deny based on product decision.
  - Writes anywhere: deny.
  - Shell commands: deny if mutating or unknown.
- `acceptEdits`
  - Writes inside workspace: allow.
  - Writes outside workspace: require approval or deny.
  - Recursive delete: require approval.
  - `git reset`, `git clean`, force checkout, history rewrite: require approval.
  - Package installs or network commands: require approval.
- `plan`
  - Reads: allow.
  - Writes and commands: deny until user confirms execution.
  - After confirmation: execute under chosen mode, usually `acceptEdits`.
- `fullAccess`
  - Allow by default.
  - Still record audit events for high-risk operations.

### 7.4 Workspace Terminal Service

Add a Main-owned terminal service instead of spawning terminal commands directly from the renderer.

Responsibilities:

- Start a pseudo-terminal or managed shell process with `cwd` inside the active workspace.
- Stream stdout/stderr to renderer events.
- Accept stdin, resize, and terminate requests.
- Enforce permission profile before process start and before high-risk command execution where command parsing is available.
- Persist bounded scrollback per workspace/session.

Initial implementation options:

- Use a cross-platform PTY dependency if the project accepts the package.
- If avoiding a new dependency in the first slice, provide a limited command-runner service and add full PTY later.

Permission behavior:

- `readOnly`: allow only explicitly read-only commands if classification is reliable; otherwise disable terminal input.
- `acceptEdits`: allow workspace-local commands, require approval for risky commands.
- `plan`: terminal is read-only/disabled until plan approval.
- `fullAccess`: allow, but audit high-risk commands.

### 7.5 Workspace Web Preview Service

Add a workspace-scoped Web preview service distinct from existing file preview.

Capabilities:

- Preview an HTML file from the active workspace.
- Serve a static directory from the active workspace on a local ephemeral port.
- Detect common dev server ports from terminal/process output or user selection.
- Open an external URL inside a sandboxed preview frame where possible.
- Associate preview target with active workspace state.

Security:

- Only serve files inside the active workspace unless approved.
- Local preview server should bind to `127.0.0.1` by default.
- Preview frames should remain sandboxed.
- Permission mode controls whether Verse Claw can start a dev server or only attach to an existing URL.

### 7.6 Context Range And Live Token Usage

Add session-level runtime metrics services:

- `usage.live`: current run and session token counters.
- `usage.contextRange`: current best-effort context range.

Data sources:

- Gateway runtime events when usage deltas are available.
- Transcript usage records after assistant/tool messages are persisted.
- Existing token usage parser in `electron/utils/token-usage.ts` for final reconciliation.
- Model metadata for context-window limits where available.

UI placement:

- The bottom of the Chat page should show a compact footer/status bar.
- It should include current workspace, permission mode, context range, and live token usage.
- During streaming, token counters should update in near real time when data is available.
- If exact data is unavailable, show a clear best-effort or unavailable state instead of silent blanks.

## 8. Frontend Integration Plan

### 8.1 Stores

Add:

- `src/stores/workspaces.ts`
- `src/stores/permissions.ts`
- `src/stores/terminal.ts`
- `src/stores/web-preview.ts`
- `src/stores/live-usage.ts`

Update:

- `src/stores/chat.ts`
- `src/stores/chat/session-actions.ts`
- `src/stores/artifact-panel.ts`
- `src/stores/agents.ts` only where Agent defaults need to bind with workspace creation.

### 8.2 Chat Page UI

Add a workspace switcher in Chat toolbar or sidebar header.

Minimum UI:

- current workspace name,
- current root path in tooltip or secondary text,
- current permission mode indicator,
- switch/create workspace action,
- mode selector with descriptions,
- plan confirmation surface when mode is `plan`.

The existing `WorkspaceBrowserBody` should use active workspace root first. If no active workspace exists, fallback to current agent workspace.

Add a persistent bottom status area on the Chat page:

- left: active workspace and permission mode,
- middle: context range, such as retained messages and used/max context tokens,
- right: live token usage for the current run/session.

This footer should stay visible at the bottom of the Chat page, either below the composer area or integrated into the composer footer without obscuring input.

### 8.3 Workspace Terminal UI

Add a terminal panel bound to the active workspace.

Expected controls:

- open/close terminal,
- current `cwd`,
- command input or PTY surface,
- stop/kill active command,
- clear scrollback,
- permission prompt integration.

The terminal can live as:

- a tab in the artifact/workspace side panel, or
- a bottom drawer inside Chat.

Initial recommendation: bottom drawer, because terminal output is a workspace operation surface rather than a file preview.

### 8.4 Targeted Web Preview UI

Add a Web Preview panel bound to the active workspace.

Expected controls:

- choose preview target file/directory/URL,
- start/stop local static preview,
- attach to detected dev server,
- refresh preview,
- open in external browser,
- show port and binding status.

The existing `HtmlPreview` remains useful for single-file previews. The new Web Preview service covers workspace-level previews and running app previews.

### 8.5 Plan Mode UI

Plan mode should have a structured state machine:

1. `idle`: user has selected plan mode.
2. `planning`: assistant is generating a plan.
3. `reviewing`: plan is visible and editable through follow-up user input.
4. `approved`: user approves execution.
5. `executing`: task runs under chosen execution permission.
6. `completed` or `cancelled`.

Plan output must include:

- goal,
- implementation steps,
- expected modified files,
- tests/verification,
- acceptance criteria,
- known risks.

## 9. Sandbox Strategy

The first pass should implement a practical app-level sandbox and leave room for deeper runtime integration.

Layer 1: renderer/UI guard.

- Disable write or execute controls when current mode does not allow them.
- Show permission mode clearly.

Layer 2: Main service guard.

- Enforce workspace root checks in file APIs.
- Centralize command/path risk classification.
- Store audit events.

Layer 3: Gateway/RPC guard.

- Intercept Gateway RPC calls that carry command, patch, file, or tool execution metadata.
- If OpenClaw exposes approval hooks, map Verse Claw permission decisions into those hooks.
- If not available, start with deny/approval around known RPC methods and document gaps.

Layer 4: runtime environment.

- Pass environment variables to Gateway:
  - `VERSE_CLAW_ACTIVE_WORKSPACE`
  - `VERSE_CLAW_PERMISSION_MODE`
  - `VERSE_CLAW_SANDBOX_READ_ROOTS`
  - `VERSE_CLAW_SANDBOX_WRITE_ROOTS`
- Prefer native OpenClaw sandbox support if upstream provides it.

## 10. Implementation Phases

### Phase 0: Task Spec And Contract

Files:

- `docs/workspace-and-permission-control-plan.md`
- `harness/specs/tasks/workspace-permission-control.md`

Deliverables:

- Finalized data model.
- Acceptance criteria.
- Harness spec stub.

Acceptance criteria:

- Reviewers can trace every implementation change back to this plan or the task spec.

### Phase 1: Workspace Profile Backend

Files:

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `electron/services/workspaces-api.ts`
- host service registry files
- `tests/unit/workspace-profile.test.ts`

Deliverables:

- Workspace profile CRUD.
- Active workspace persistence.
- Path normalization and validation.

Acceptance criteria:

- Creating a workspace stores normalized root path.
- Switching active workspace persists `activeWorkspaceId`.
- Deleting a workspace profile does not delete the filesystem root.
- Invalid paths return structured errors.

### Phase 2: Workspace State Restoration

Files:

- `src/stores/workspaces.ts`
- `src/stores/chat.ts`
- `src/stores/chat/session-actions.ts`
- `src/pages/Chat/ChatToolbar.tsx`
- `src/components/file-preview/WorkspaceBrowserBody.tsx`
- `tests/unit/chat-session-selection.test.ts`
- `tests/unit/workspace-browser-body.test.tsx`

Deliverables:

- Workspace switcher.
- Per-workspace `activeSessionKey`.
- Composer draft and artifact state save/restore.
- Terminal, Web preview, context range visibility, and token footer visibility are included in saved workspace UI state.

Acceptance criteria:

- Switching from workspace A to B and back restores A's active chat session.
- Draft input survives switching.
- Workspace browser points to active workspace root.
- Terminal panel state restores per workspace.
- Web preview target restores per workspace.
- Existing Agent-based flows still work when no workspace profile exists.

### Phase 2.5: Workspace Terminal And Web Preview

Files:

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `electron/services/terminal-api.ts`
- `electron/services/web-preview-api.ts`
- `src/stores/terminal.ts`
- `src/stores/web-preview.ts`
- `src/pages/Chat/index.tsx`
- `src/components/file-preview/ArtifactPanel.tsx`
- `tests/unit/workspace-terminal.test.ts`
- `tests/unit/workspace-web-preview.test.ts`
- `tests/e2e/workspace-web-preview.spec.ts`

Deliverables:

- Workspace-scoped terminal service.
- Workspace-scoped Web preview service.
- Permission-aware start/stop/command behavior.

Acceptance criteria:

- Terminal starts in the active workspace root.
- Terminal refuses or prompts for risky commands according to permission mode.
- Web preview serves only files under active workspace by default.
- User can preview an HTML file and attach to a local dev server URL.
- Switching workspaces restores the correct terminal and preview state.

### Phase 3: Permission Profile Backend

Files:

- `shared/host-api/contract.ts`
- `electron/services/permissions-api.ts`
- `electron/services/files-api.ts`
- `electron/gateway/process-launcher.ts`
- `tests/unit/permission-profile.test.ts`
- `tests/unit/file-preview-client.test.ts`

Deliverables:

- Permission mode persistence.
- Permission profile resolution.
- File API enforcement aligned to active workspace.
- Gateway environment metadata injection.

Acceptance criteria:

- `readOnly` denies writes.
- `acceptEdits` allows workspace writes and rejects or flags outside-root writes.
- `fullAccess` preserves current behavior while logging high-risk operations.
- Gateway launch summary includes permission mode and active workspace without leaking secrets.

### Phase 4: Approval Workflow

Files:

- `src/stores/permissions.ts`
- `src/components/ui/confirm-dialog.tsx` or new permission dialog component
- `src/pages/Chat/ExecutionGraphCard.tsx`
- `src/pages/Chat/task-visualization.ts`
- `electron/services/permissions-api.ts`
- `tests/unit/confirm-dialog.test.tsx`
- `tests/unit/task-visualization.test.ts`

Deliverables:

- Approval event creation.
- User approve/deny action.
- Execution graph/audit rendering.

Acceptance criteria:

- Dangerous command in `acceptEdits` creates a pending approval.
- Denying approval prevents execution.
- Approving approval records the decision.
- Approval events are visible in the execution graph or related run surface.

### Phase 5: Plan Mode

Files:

- `src/stores/permissions.ts`
- `src/pages/Chat/ChatInput.tsx`
- `src/pages/Chat/index.tsx`
- `src/stores/chat.ts`
- locale files under `shared/i18n/locales/<lang>/chat.json`
- `tests/unit/chat-input.test.tsx`
- `tests/e2e/chat-plan-mode.spec.ts`

Deliverables:

- Plan mode state machine.
- Plan review UI.
- Confirm-to-execute transition.

Acceptance criteria:

- Plan mode does not mutate files before approval.
- Plan includes goal, steps, affected files, tests, and acceptance criteria.
- User can refine plan through additional input.
- User confirmation starts execution under a visible permission mode.

### Phase 5.5: Chat Footer Context And Live Token Usage

Files:

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `electron/services/usage-api.ts`
- `electron/utils/token-usage.ts`
- `src/stores/live-usage.ts`
- `src/pages/Chat/index.tsx`
- `src/pages/Chat/ChatInput.tsx`
- `shared/i18n/locales/<lang>/chat.json`
- `tests/unit/token-usage.test.ts`
- `tests/unit/chat-page-context-footer.test.tsx`
- `tests/e2e/token-usage-footer.spec.ts`

Deliverables:

- Bottom Chat footer with context range.
- Live token usage counters during active run.
- Final token usage reconciliation after run completion.

Acceptance criteria:

- Footer is visible at the bottom of Chat.
- During streaming, token usage updates when runtime data is available.
- After completion, footer reconciles with transcript usage.
- Context range shows exact data when available and best-effort/unavailable state otherwise.

### Phase 6: E2E And Docs

Files:

- `tests/e2e/workspace-switching.spec.ts`
- `tests/e2e/permission-modes.spec.ts`
- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`
- optionally `README.ru-RU.md`

Deliverables:

- E2E coverage for main flows.
- User-facing documentation.

Acceptance criteria:

- E2E verifies workspace switching and state restore.
- E2E verifies read-only denial and accept-edits approval.
- Docs explain workspace profiles and permission modes.

## 11. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OpenClaw runtime lacks a native sandbox hook | Some tool execution may be enforceable only at Verse Claw RPC boundary | Start with Main-owned guard, document enforcement gaps, add upstream integration later |
| Session keys are currently agent-centric | Workspace switching may fight existing chat assumptions | Store workspace-to-session mapping without changing transcript format in Phase 1/2 |
| Workspace root may differ from Agent workspace | Confusing UI and runtime context drift | Show active workspace clearly and use active workspace as the primary UI root |
| Overly strict permissions break existing flows | Users cannot complete normal tasks | Keep fallback mode and add detailed denial reasons |
| Approval UX becomes noisy | User fatigue | Use risk classifier and only prompt for meaningful dangerous operations |
| Path normalization differs across OSes | False deny/allow | Centralize path resolution in Main and unit test Windows/macOS/Linux path cases |
| Terminal command classification is incomplete | Risky commands may be overblocked or underblocked | Start conservative, require approval for unknown mutating commands, and improve classifier with telemetry-free local audit |
| Web preview starts unintended project code | Running dev servers can execute workspace scripts | Separate static preview from dev server start; require approval before running scripts |
| Live token usage is unavailable during streaming for some providers | Footer may show stale or partial numbers | Display status clearly and reconcile after transcript usage is written |
| Context range is estimated before runtime exposes exact data | Users may overtrust best-effort context | Label estimated ranges as best-effort and prefer exact Gateway data when available |

## 12. Traceability Matrix

| Requirement | Phase | Primary Files | Tests |
| --- | --- | --- | --- |
| Workspace CRUD | Phase 1 | `workspaces-api.ts`, `contract.ts`, `host-api.ts` | `workspace-profile.test.ts` |
| Active workspace switching | Phase 2 | `workspaces.ts`, `chat.ts`, `ChatToolbar.tsx` | `workspace-switching.spec.ts` |
| Session restore per workspace | Phase 2 | `chat.ts`, `session-actions.ts` | `chat-session-selection.test.ts` |
| Workspace browser uses active root | Phase 2 | `WorkspaceBrowserBody.tsx`, `workspace-tree.ts` | `workspace-browser-body.test.tsx` |
| Workspace terminal | Phase 2.5 | `terminal-api.ts`, `terminal.ts`, `Chat/index.tsx` | `workspace-terminal.test.ts` |
| Targeted Web preview | Phase 2.5 | `web-preview-api.ts`, `web-preview.ts`, `ArtifactPanel.tsx` | `workspace-web-preview.spec.ts` |
| Permission modes | Phase 3 | `permissions-api.ts`, `contract.ts` | `permission-profile.test.ts` |
| Read-only writes denied | Phase 3 | `files-api.ts`, `permissions-api.ts` | `file-preview-client.test.ts` |
| Dangerous command approval | Phase 4 | `permissions-api.ts`, `permissions.ts`, `ExecutionGraphCard.tsx` | `permission-modes.spec.ts` |
| Plan mode confirmation | Phase 5 | `ChatInput.tsx`, `Chat/index.tsx`, `permissions.ts` | `chat-plan-mode.spec.ts` |
| Context range footer | Phase 5.5 | `usage-api.ts`, `live-usage.ts`, `Chat/index.tsx` | `chat-page-context-footer.test.tsx` |
| Live token usage footer | Phase 5.5 | `usage-api.ts`, `token-usage.ts`, `live-usage.ts` | `token-usage-footer.spec.ts` |
| Audit trail | Phase 4 | `permissions-api.ts`, store utilities | `permission-profile.test.ts` |
| Documentation | Phase 6 | README files | doc review |

## 13. Open Questions

1. Should a workspace profile always bind to one Agent, or can users switch agents inside the same workspace?
2. Should `readOnly` allow shell commands that are classified as read-only, such as `git status` and `rg`?
3. Should outside-workspace reads be allowed by default for convenience, or require approval for privacy?
4. Should plan approval execute under `acceptEdits` automatically, or ask the user to choose the execution mode each time?
5. Should permission mode be workspace-local only, or can there be a global default mode for new workspaces?
6. Should the first terminal implementation be a full PTY or a limited command runner?
7. Should Web preview start dev servers itself, or only attach to user-started servers in early versions?
8. Which runtime event is the source of truth for live token deltas when provider streams do not expose usage until completion?

## 14. Recommended First Slice

The first implementation slice should be:

1. Add Workspace Profile backend and Host API.
2. Add active workspace store in renderer.
3. Add Chat toolbar workspace switcher.
4. Save and restore `activeSessionKey` and composer draft per workspace.
5. Add the bottom Chat footer shell for workspace, permission mode, context range, and token usage placeholders.
6. Add tests for workspace CRUD and switching.

This slice delivers the most visible missing capability while keeping permission-control risk low. Permission modes can then attach to a stable workspace identity.
