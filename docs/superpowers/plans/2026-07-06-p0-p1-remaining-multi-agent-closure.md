# P0/P1 Remaining Multi-Agent Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining `P0-12`, `P0-13`, `P1-02`, `P1-03`, and `P1-04` application-layer closure work on `knowledge-ux-polish`.

**Architecture:** Keep the five product-semantic gaps as separate implementation slices with explicit handoff points. Add small adapters and testable helpers around existing systems rather than replacing Workspace permissions, Role permissions, Task Ledger, Workboard, or ordinary orchestration.

**Tech Stack:** Electron Main host services, React 19, Vite, TypeScript, Vitest, Playwright Electron E2E, pnpm, OpenClaw runtime TypeScript.

## Global Constraints

- Work only in `C:\Users\27933\Desktop\clawx\ClawX-knowledge-ux-polish` on branch `knowledge-ux-polish`.
- Do not use or modify the old `codex/sekb-runtime-knowledge` branch.
- Renderer backend calls must go through `src/lib/host-api.ts` and existing host-api surfaces.
- New user-facing UI text must use `react-i18next` with `en`, `zh`, `ja`, and `ru` locale entries.
- UI changes require Electron E2E coverage in the same implementation series.
- Do not claim full DAG editing, default active Routing Memo learning, automatic Task Loop repair, or unified audit beyond wired producers.
- Use `apply_patch` for manual edits.
- Run final claim gate before marking the report matrix `DONE`.

---

## Scope Check

This is an umbrella plan for five related product-semantics closure items. Each task below is independently testable and reviewable, so subagent-driven execution should dispatch one fresh implementation agent per task and run Agent R review after each task.

## File Structure

- `tests/e2e/chat-plan-mode-write-challenge.spec.ts`: Electron evidence for Plan mode write/edit/exec challenge.
- `electron/services/permission-decision-audit.ts`: Main-side normalization helpers for Workspace permission decisions.
- `electron/services/permissions-api.ts`: bounded storage and host API for normalized decision events.
- `electron/services/gateway-api.ts`: Workspace Gateway decision producer.
- `electron/services/files-api.ts`: Workspace file-write decision producer.
- `electron/services/terminal-api.ts`: Workspace command decision producer.
- `openclaw_runtime/src/agents/role-permission-audit.ts`: runtime-side Role permission decision payload builder.
- `openclaw_runtime/src/agents/role-spawn.ts`: attaches Role permission decision payloads to role spawn context.
- `shared/types/task-ledger-reference.ts`: canonical one-way `TaskLedgerReference` contract.
- `shared/product-semantics.ts`: imports/re-exports product semantic helpers and status updates.
- `openclaw_runtime/extensions/workboard/src/types.ts`: uses the canonical Workboard-to-Task-Ledger reference shape.
- `src/lib/orchestration-plan-edit-draft.ts`: lightweight Chat Plan edit draft model and Task Ledger event builder.
- `src/components/agents/OrchestrationPlanView.tsx`: renders lightweight edit controls.
- `src/components/agents/RolesOrchestrationPanel.tsx`: owns edit draft state and saves edits through `hostApi.taskLedger.appendEvents`.
- `openclaw_runtime/src/agents/orchestration-quality-scorecard.ts`: ordinary orchestration quality producer.
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts`: returns ordinary quality evidence from observed runs.
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`: includes quality output in tool details.
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`: includes quality output in Gateway payload.
- `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md`: final evidence matrix.
- `docs/clawx-product-semantics.md`: product boundary docs.

---

### Task 1: P0-12 Plan Mode Real Write Challenge E2E

**Files:**
- Create: `tests/e2e/chat-plan-mode-write-challenge.spec.ts`
- Verify existing: `electron/services/workspace-permissions.ts`
- Verify existing: `electron/services/gateway-api.ts`
- Verify existing: `electron/services/files-api.ts`
- Verify existing: `electron/services/terminal-api.ts`

**Interfaces:**
- Consumes: `host:invoke` Main handler with modules `workspaces`, `terminal`, `files`, and `gateway`.
- Produces: Electron E2E evidence that Plan mode blocks command execution, file writing, and mutating Gateway RPC before side effects occur.

- [ ] **Step 1: Write the Electron E2E spec**

Create `tests/e2e/chat-plan-mode-write-challenge.spec.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const handler = handlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    return await handler({}, {
      id: `p0-12-${Date.now()}`,
      module: request.module,
      action: request.action,
      payload: request.payload,
    });
  }, { module, action, payload }) as HostResponse<T>;

  if (!response.ok) {
    throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  }
  return response.data as T;
}

test.describe('Plan mode real write challenge', () => {
  test('blocks terminal, file write, and mutating Gateway RPC without side effects', async ({ launchElectronApp }) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-plan-mode-challenge-'));
    const protectedFile = join(workspaceDir, 'protected.txt');
    await writeFile(protectedFile, 'original', 'utf8');
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await hostInvoke(app, 'workspaces', 'create', {
        name: 'Plan Mode Challenge',
        rootPath: workspaceDir,
        permissionMode: 'plan',
      });

      const terminalResult = await hostInvoke<{
        success: boolean;
        blocked?: boolean;
        approvalRequired?: boolean;
        reason?: string;
        stdout?: string;
        stderr?: string;
      }>(app, 'terminal', 'run', {
        command: 'node -e "require(\\"fs\\").writeFileSync(\\"p0-12-terminal.txt\\", \\"bad\\")"',
      });
      expect(terminalResult).toMatchObject({ success: false, blocked: true });
      expect(terminalResult.approvalRequired).not.toBe(true);
      expect(`${terminalResult.reason ?? ''} ${terminalResult.stderr ?? ''}`).toMatch(/计划模式|Plan/i);

      const fileResult = await hostInvoke<{
        ok: boolean;
        error?: string;
        approvalRequired?: boolean;
      }>(app, 'files', 'writeText', {
        path: protectedFile,
        content: 'mutated',
      });
      expect(fileResult).toMatchObject({ ok: false, error: 'permissionDenied' });
      expect(fileResult.approvalRequired).not.toBe(true);
      await expect(readFile(protectedFile, 'utf8')).resolves.toBe('original');

      const gatewayResult = await hostInvoke<{
        success: boolean;
        blocked?: boolean;
        approvalRequired?: boolean;
        error?: string;
      }>(app, 'gateway', 'rpc', {
        method: 'tools.exec',
        params: { command: 'git clean -fd' },
      });
      expect(gatewayResult).toMatchObject({ success: false, blocked: true });
      expect(gatewayResult.approvalRequired).not.toBe(true);
      expect(gatewayResult.error ?? '').toMatch(/计划模式|Plan/i);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build Electron bundles for E2E**

Run:

```powershell
pnpm run build:vite
```

Expected: command exits `0`. Existing dynamic import or chunk size warnings are acceptable.

- [ ] **Step 3: Run the new E2E**

Run:

```powershell
pnpm run test:e2e tests/e2e/chat-plan-mode-write-challenge.spec.ts
```

Expected: one Playwright test passes. If it fails because the host invoke payload shape differs, fix only the test harness call shape. If it fails because any side effect occurs in Plan mode, stop and inspect the relevant Main permission path before changing assertions.

- [ ] **Step 4: Run focused permission unit tests**

Run:

```powershell
pnpm exec vitest run tests/unit/workspace-permissions.test.ts tests/unit/terminal-api.test.ts tests/unit/files-permissions-api.test.ts tests/unit/gateway-permissions-api.test.ts --reporter=verbose
```

Expected: all selected unit tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add tests/e2e/chat-plan-mode-write-challenge.spec.ts
git commit -m "test: add plan mode write challenge e2e"
```

Agent R review checks:

- The test uses real Main host service handlers.
- The test verifies no file mutation.
- The test does not claim exhaustive coverage beyond terminal/file/Gateway challenge paths.

---

### Task 2: P0-13 Unified Permission Audit Event

**Files:**
- Create: `electron/services/permission-decision-audit.ts`
- Create: `openclaw_runtime/src/agents/role-permission-audit.ts`
- Modify: `electron/services/permissions-api.ts`
- Modify: `electron/services/gateway-api.ts`
- Modify: `electron/services/files-api.ts`
- Modify: `electron/services/terminal-api.ts`
- Modify: `openclaw_runtime/src/agents/role-spawn.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Test: `tests/unit/product-semantics.test.ts`
- Test: `tests/unit/workspace-permissions.test.ts`
- Test: `tests/unit/role-spawn.test.ts`
- Test: create `tests/unit/permission-decision-audit.test.ts`

**Interfaces:**
- Consumes: `createPermissionDecisionEvent(input)` from `@shared/product-semantics`.
- Produces:
  - `recordPermissionDecisionEvent(event: PermissionDecisionEvent): Promise<PermissionDecisionEvent>`
  - `listPermissionDecisionEvents(limit?: number): Promise<PermissionDecisionEvent[]>`
  - host API `permissions.decisionEvents(payload?: { limit?: number })`
  - runtime helper `buildRolePermissionDecisionEvents(input)`

- [ ] **Step 1: Write failing tests for Workspace event storage and Role event payloads**

Create `tests/unit/permission-decision-audit.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (!Array.isArray(storeState.approvals) || storeState.approvals.length === 0) {
        storeState.approvals = options?.defaults?.approvals ?? [];
      }
      if (!Array.isArray(storeState.decisionEvents) || storeState.decisionEvents.length === 0) {
        storeState.decisionEvents = options?.defaults?.decisionEvents ?? [];
      }
    }
    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }
    set(key: string, value: unknown) {
      if (key === 'approvals') storeState.approvals = Array.isArray(value) ? value : [];
      if (key === 'decisionEvents') storeState.decisionEvents = Array.isArray(value) ? value : [];
    }
  }
  return { default: MockStore };
});

describe('permission decision audit', () => {
  beforeEach(() => {
    storeState.approvals = [];
    storeState.decisionEvents = [];
    vi.resetModules();
  });

  it('stores normalized Workspace decisions through permissions-api', async () => {
    const { createWorkspacePermissionDecisionEvent } = await import('@electron/services/permission-decision-audit');
    const { recordPermissionDecisionEvent, listPermissionDecisionEvents } = await import('@electron/services/permissions-api');

    const event = createWorkspacePermissionDecisionEvent({
      workspaceMode: 'plan',
      tool: 'tools.exec',
      boundary: 'gateway-rpc',
      requestId: 'req-1',
      decision: { allowed: false, risk: 'destructive', reason: 'Plan mode blocks Gateway mutation' },
    });
    await recordPermissionDecisionEvent(event);

    await expect(listPermissionDecisionEvents(10)).resolves.toEqual([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        tool: 'tools.exec',
        boundary: 'gateway-rpc',
        decision: 'deny',
        requestId: 'req-1',
      }),
    ]);
  });

  it('builds Role permission decision payloads without importing Electron services', async () => {
    const { buildRolePermissionDecisionEvents } = await import('../../openclaw_runtime/src/agents/role-permission-audit');

    const events = buildRolePermissionDecisionEvents({
      roleName: 'architect',
      deniedTools: ['write', 'exec'],
      requestId: 'role-spawn-1',
      reason: 'filesystem=read denies write and shell tools',
    });

    expect(events).toEqual([
      expect.objectContaining({ role: 'architect', tool: 'write', boundary: 'role-tool', decision: 'deny' }),
      expect.objectContaining({ role: 'architect', tool: 'exec', boundary: 'role-tool', decision: 'deny' }),
    ]);
  });

  it('exposes decision events through the permissions host API', async () => {
    const { createPermissionsApi, recordPermissionDecisionEvent } = await import('@electron/services/permissions-api');
    await recordPermissionDecisionEvent({
      kind: 'permission-decision',
      workspaceMode: 'plan',
      role: null,
      tool: 'terminal.run',
      boundary: 'workspace-command',
      decision: 'deny',
      reason: 'Plan mode blocks command execution',
      requestId: 'terminal-1',
    });

    const api = createPermissionsApi();
    await expect(api.decisionEvents({ limit: 1 })).resolves.toMatchObject({
      success: true,
      events: [expect.objectContaining({ tool: 'terminal.run', decision: 'deny' })],
    });
  });
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/permission-decision-audit.test.ts --reporter=verbose
```

Expected: FAIL because the new modules and API method do not exist.

- [ ] **Step 2: Add Main-side Workspace audit helper**

Create `electron/services/permission-decision-audit.ts`:

```ts
import {
  createPermissionDecisionEvent,
  type PermissionDecisionBoundary,
  type PermissionDecisionEvent,
} from '@shared/product-semantics';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import type { WorkspacePermissionDecision } from './workspace-permissions';

export function decisionLabel(decision: WorkspacePermissionDecision): PermissionDecisionEvent['decision'] {
  if (decision.allowed) return 'allow';
  if (decision.requiresApproval) return 'approval_required';
  return 'deny';
}

export function createWorkspacePermissionDecisionEvent(input: {
  workspaceMode: WorkspacePermissionMode;
  tool: string;
  boundary: PermissionDecisionBoundary;
  requestId?: string | null;
  decision: WorkspacePermissionDecision;
}): PermissionDecisionEvent {
  return createPermissionDecisionEvent({
    workspaceMode: input.workspaceMode,
    role: null,
    tool: input.tool,
    boundary: input.boundary,
    decision: decisionLabel(input.decision),
    reason: input.decision.reason ?? `risk:${input.decision.risk}`,
    requestId: input.requestId,
  });
}
```

- [ ] **Step 3: Add bounded decision event storage and host API**

Modify `electron/services/permissions-api.ts`:

```ts
import type { PermissionDecisionEvent } from '@shared/product-semantics';
```

Change the store document type:

```ts
type PermissionStoreDocument = {
  approvals: PermissionApprovalEvent[];
  decisionEvents: PermissionDecisionEvent[];
};
```

Change defaults:

```ts
defaults: {
  approvals: [],
  decisionEvents: [],
},
```

Add constants and functions near approval storage helpers:

```ts
const MAX_PERMISSION_DECISION_EVENTS = 2000;

async function readPermissionDecisionEvents(): Promise<PermissionDecisionEvent[]> {
  const store = await getPermissionStore();
  const events = store.get('decisionEvents');
  return Array.isArray(events) ? events as PermissionDecisionEvent[] : [];
}

async function writePermissionDecisionEvents(events: PermissionDecisionEvent[]): Promise<void> {
  const store = await getPermissionStore();
  store.set('decisionEvents', events.slice(0, MAX_PERMISSION_DECISION_EVENTS));
}

export async function recordPermissionDecisionEvent(event: PermissionDecisionEvent): Promise<PermissionDecisionEvent> {
  const events = await readPermissionDecisionEvents();
  await writePermissionDecisionEvents([event, ...events]);
  return event;
}

export async function listPermissionDecisionEvents(limit = DEFAULT_APPROVAL_LIMIT): Promise<PermissionDecisionEvent[]> {
  const normalizedLimit = Math.max(1, Math.min(MAX_APPROVAL_LIMIT, Math.floor(limit)));
  return (await readPermissionDecisionEvents()).slice(0, normalizedLimit);
}
```

Add a host API method inside `createPermissionsApi()`:

```ts
decisionEvents: async (payload) => {
  const body = isRecord(payload) ? payload as { limit?: unknown } : {};
  const limit = normalizeLimit(body.limit);
  return {
    success: true,
    events: await listPermissionDecisionEvents(limit),
  };
},
```

- [ ] **Step 4: Update host contract and renderer facade**

Modify `shared/host-api/contract.ts` imports:

```ts
import type { PermissionDecisionEvent } from '../product-semantics';
```

Add result/payload types near permission approval types:

```ts
export type PermissionDecisionEventListPayload = {
  limit?: number;
};

export type PermissionDecisionEventListResult = HostSuccess & {
  events: PermissionDecisionEvent[];
};
```

Add method to `CompleteHostServiceRegistry['permissions']`:

```ts
decisionEvents: (payload?: PermissionDecisionEventListPayload) => PermissionDecisionEventListResult;
```

Modify `src/lib/host-api.ts` imports and `permissions` facade:

```ts
decisionEvents: (input?: PermissionDecisionEventListPayload) =>
  invokeHost('permissions', 'decisionEvents', input),
```

- [ ] **Step 5: Wire Workspace producers**

In `electron/services/gateway-api.ts`, import:

```ts
import { createWorkspacePermissionDecisionEvent } from './permission-decision-audit';
import { recordPermissionDecisionEvent } from './permissions-api';
```

After `const decision = decideGatewayRpc(...)`, add:

```ts
void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
  workspaceMode: workspace.permissionMode,
  tool: method,
  boundary: 'gateway-rpc',
  requestId: approvalId ?? buildGatewayRequestHash(method, body.params),
  decision,
}));
```

In `electron/services/files-api.ts`, import the same helpers and record after `decideWorkspaceFileWrite`:

```ts
void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
  workspaceMode: workspace.permissionMode,
  tool: 'files.writeText',
  boundary: 'user-file',
  requestId: approvalId ?? buildFileWriteRequestHash(requestedPath, body.content),
  decision,
}));
```

In `electron/services/terminal-api.ts`, import the same helpers and record after `decideWorkspaceCommand`:

```ts
void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
  workspaceMode: workspace.permissionMode,
  tool: 'terminal.run',
  boundary: 'workspace-command',
  requestId: approvalId ?? buildTerminalRequestHash(command, workspace.rootPath),
  decision,
}));
```

- [ ] **Step 6: Add Role-side payload builder without Electron dependency**

Create `openclaw_runtime/src/agents/role-permission-audit.ts`:

```ts
import {
  createPermissionDecisionEvent,
  type PermissionDecisionEvent,
} from "../../../shared/product-semantics";

export function buildRolePermissionDecisionEvents(input: {
  roleName: string;
  deniedTools: readonly string[];
  requestId?: string | null;
  reason: string;
}): PermissionDecisionEvent[] {
  return input.deniedTools.map((tool) => createPermissionDecisionEvent({
    workspaceMode: 'unknown',
    role: input.roleName,
    tool,
    boundary: 'role-tool',
    decision: 'deny',
    reason: input.reason,
    requestId: input.requestId,
  }));
}
```

Modify `openclaw_runtime/src/agents/role-spawn.ts`:

```ts
import type { PermissionDecisionEvent } from "../../../shared/product-semantics";
import { buildRolePermissionDecisionEvents } from "./role-permission-audit.js";
```

Extend `RoleSpawnContext`:

```ts
permissionDecisionEvents?: PermissionDecisionEvent[];
```

Inside `buildRoleSpawnContext`, after `permissionPatches`:

```ts
const permissionDecisionEvents = permissionPatches.inheritedToolDenylist?.length
  ? buildRolePermissionDecisionEvents({
    roleName: role.name,
    deniedTools: permissionPatches.inheritedToolDenylist,
    requestId: ctx.agentSessionKey,
    reason: `role permissions for ${role.name}`,
  })
  : undefined;
```

Return it:

```ts
...(permissionDecisionEvents ? { permissionDecisionEvents } : {}),
```

- [ ] **Step 7: Extend role-spawn test**

Modify `tests/unit/role-spawn.test.ts` in the existing role spawn context test:

```ts
expect(roleCtx.permissionDecisionEvents).toEqual(expect.arrayContaining([
  expect.objectContaining({
    kind: 'permission-decision',
    role: 'architect',
    tool: 'write',
    boundary: 'role-tool',
    decision: 'deny',
  }),
]));
```

- [ ] **Step 8: Run focused tests**

Run:

```powershell
pnpm exec vitest run tests/unit/permission-decision-audit.test.ts tests/unit/product-semantics.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-spawn.test.ts --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit Task 2**

```powershell
git add electron/services/permission-decision-audit.ts electron/services/permissions-api.ts electron/services/gateway-api.ts electron/services/files-api.ts electron/services/terminal-api.ts openclaw_runtime/src/agents/role-permission-audit.ts openclaw_runtime/src/agents/role-spawn.ts shared/host-api/contract.ts src/lib/host-api.ts tests/unit/permission-decision-audit.test.ts tests/unit/role-spawn.test.ts
git commit -m "feat: add unified permission decision audit events"
```

Agent R review checks:

- Runtime Role code does not import Electron services.
- Workspace and Role events share `PermissionDecisionEvent`.
- The consumer surface is bounded and does not claim exhaustive enterprise audit coverage.

---

### Task 3: P1-03 Canonical Task Ledger / Workboard Reference

**Files:**
- Create: `shared/types/task-ledger-reference.ts`
- Modify: `shared/product-semantics.ts`
- Modify: `openclaw_runtime/extensions/workboard/src/types.ts`
- Test: `tests/unit/product-semantics.test.ts`
- Test: create `tests/unit/task-ledger-reference.test.ts`

**Interfaces:**
- Produces:
  - `TaskLedgerReference`
  - `createTaskLedgerReference(input)`
  - `isTaskLedgerReference(value)`
- Consumes: Workboard metadata field `taskLedgerReference`.

- [ ] **Step 1: Write failing contract tests**

Create `tests/unit/task-ledger-reference.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createTaskLedgerReference,
  isTaskLedgerReference,
} from '@shared/types/task-ledger-reference';

describe('TaskLedgerReference contract', () => {
  it('creates a one-way Workboard to Task Ledger reference', () => {
    const reference = createTaskLedgerReference({
      taskLedgerNodeId: ' ledger-node-1 ',
      workboardCardId: ' card-1 ',
      source: 'workboard',
    });

    expect(reference).toEqual({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      workboardCardId: 'card-1',
      source: 'workboard',
    });
    expect(reference).not.toHaveProperty('sync');
    expect(reference).not.toHaveProperty('taskLedgerMirror');
  });

  it('rejects empty Task Ledger node ids', () => {
    expect(() => createTaskLedgerReference({ taskLedgerNodeId: '   ' }))
      .toThrow(/taskLedgerNodeId/);
  });

  it('recognizes only the canonical one-way shape', () => {
    expect(isTaskLedgerReference({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
    })).toBe(true);
    expect(isTaskLedgerReference({
      direction: 'task-ledger-to-workboard',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
    })).toBe(false);
    expect(isTaskLedgerReference({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
      sync: true,
    })).toBe(false);
  });
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/task-ledger-reference.test.ts --reporter=verbose
```

Expected: FAIL because `@shared/types/task-ledger-reference` does not exist.

- [ ] **Step 2: Add shared canonical type**

Create `shared/types/task-ledger-reference.ts`:

```ts
export type TaskLedgerReference = {
  direction: 'workboard-to-task-ledger';
  taskLedgerNodeId: string;
  workboardCardId?: string;
  source: 'workboard' | 'plugin' | 'runtime';
};

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createTaskLedgerReference(input: {
  taskLedgerNodeId: string;
  workboardCardId?: string | null;
  source?: TaskLedgerReference['source'];
}): TaskLedgerReference {
  const taskLedgerNodeId = input.taskLedgerNodeId.trim();
  if (!taskLedgerNodeId) {
    throw new Error('TaskLedgerReference requires a taskLedgerNodeId');
  }
  const workboardCardId = normalizeOptionalText(input.workboardCardId);
  return {
    direction: 'workboard-to-task-ledger',
    taskLedgerNodeId,
    ...(workboardCardId ? { workboardCardId } : {}),
    source: input.source ?? 'runtime',
  };
}

export function isTaskLedgerReference(value: unknown): value is TaskLedgerReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowed = ['direction', 'source', 'taskLedgerNodeId', 'workboardCardId'].sort();
  if (keys.some((key) => !allowed.includes(key))) return false;
  return record.direction === 'workboard-to-task-ledger'
    && typeof record.taskLedgerNodeId === 'string'
    && record.taskLedgerNodeId.trim().length > 0
    && (record.workboardCardId === undefined || typeof record.workboardCardId === 'string')
    && (record.source === 'workboard' || record.source === 'plugin' || record.source === 'runtime');
}
```

- [ ] **Step 3: Re-export from product semantics**

Modify `shared/product-semantics.ts`:

```ts
import {
  createTaskLedgerReference as createCanonicalTaskLedgerReference,
  type TaskLedgerReference,
} from './types/task-ledger-reference';
export type { TaskLedgerReference } from './types/task-ledger-reference';
```

Replace the existing local `TaskLedgerReference` type and `createTaskLedgerReference` implementation with:

```ts
export function createTaskLedgerReference(input: {
  taskLedgerNodeId: string;
  workboardCardId?: string | null;
  source?: TaskLedgerReference['source'];
}): TaskLedgerReference {
  return createCanonicalTaskLedgerReference(input);
}
```

- [ ] **Step 4: Use the shared type in Workboard**

Modify `openclaw_runtime/extensions/workboard/src/types.ts`:

```ts
import type { TaskLedgerReference } from "../../../../shared/types/task-ledger-reference";
```

Replace `WorkboardTaskLedgerReference`:

```ts
export type WorkboardTaskLedgerReference = TaskLedgerReference;
```

Keep `WorkboardMetadata.taskLedgerReference?: WorkboardTaskLedgerReference;`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm exec vitest run tests/unit/task-ledger-reference.test.ts tests/unit/product-semantics.test.ts --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add shared/types/task-ledger-reference.ts shared/product-semantics.ts openclaw_runtime/extensions/workboard/src/types.ts tests/unit/task-ledger-reference.test.ts tests/unit/product-semantics.test.ts
git commit -m "feat: canonicalize task ledger workboard references"
```

Agent R review checks:

- Direction remains only `workboard-to-task-ledger`.
- Workboard does not own Task Ledger facts.
- No two-way sync field is accepted by the guard.

---

### Task 4: P1-02 Lightweight Plan Edit Draft Model

**Files:**
- Create: `src/lib/orchestration-plan-edit-draft.ts`
- Modify: `src/lib/task-ledger-plan-projection.ts`
- Test: `tests/unit/orchestration-plan-ledger-projection.test.ts`
- Test: create `tests/unit/orchestration-plan-edit-draft.test.ts`

**Interfaces:**
- Produces:
  - `PlanEditDraft`
  - `PlanEditOperation`
  - `createPlanEditDraft(input)`
  - `applyPlanEditOperation(draft, operation)`
  - `buildPlanEditLedgerEvents(input)`
- Consumes: `TaskLedgerEventInput` and `TaskLedgerNode` from `@shared/types/task-ledger`.

- [ ] **Step 1: Write failing draft model tests**

Create `tests/unit/orchestration-plan-edit-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyPlanEditOperation,
  buildPlanEditLedgerEvents,
  createPlanEditDraft,
} from '@/lib/orchestration-plan-edit-draft';

const timestamp = '2026-07-06T10:00:00.000Z';

const nodes = [
  { id: 'goal-1', title: 'Plan: ship feature', parentId: null, metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
  { id: 'task-a', title: 'planner: plan', parentId: 'goal-1', metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
  { id: 'task-b', title: 'tester: test', parentId: 'goal-1', metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
];

describe('orchestration plan edit draft', () => {
  it('applies reorder, disable, and note operations without editing the source projection', () => {
    const draft = createPlanEditDraft({ baseProjectionId: 'goal-1', nodes });
    const reordered = applyPlanEditOperation(draft, { type: 'reorder_node', nodeId: 'task-b', beforeNodeId: 'task-a' });
    const disabled = applyPlanEditOperation(reordered, { type: 'disable_node', nodeId: 'task-a' });
    const noted = applyPlanEditOperation(disabled, { type: 'note_node', nodeId: 'task-b', note: 'Run smoke first' });

    expect(noted.order).toEqual(['goal-1', 'task-b', 'task-a']);
    expect(noted.disabledNodeIds).toEqual(['task-a']);
    expect(noted.notesByNodeId).toEqual({ 'task-b': 'Run smoke first' });
    expect(nodes[1].metadata).toEqual({ readonlyProjection: true, source: 'orchestrator.plan' });
  });

  it('builds Task Ledger events with projectionEdit metadata', () => {
    const draft = applyPlanEditOperation(
      createPlanEditDraft({ baseProjectionId: 'goal-1', nodes }),
      { type: 'disable_node', nodeId: 'task-a' },
    );
    const events = buildPlanEditLedgerEvents({
      draft,
      workspaceId: 'workspace-1',
      sessionKey: 'agent:main:main',
      timestamp,
      auditReason: 'User disabled planner slice',
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node_updated',
        taskId: 'task-a',
        payload: expect.objectContaining({
          patch: expect.objectContaining({
            metadata: expect.objectContaining({
              readonlyProjection: true,
              projectionEdit: expect.objectContaining({
                baseProjectionId: 'goal-1',
                operations: [expect.objectContaining({ type: 'disable_node', nodeId: 'task-a' })],
                auditReason: 'User disabled planner slice',
              }),
            }),
          }),
        }),
      }),
    ]));
  });
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-plan-edit-draft.test.ts --reporter=verbose
```

Expected: FAIL because the draft model does not exist.

- [ ] **Step 2: Implement draft model**

Create `src/lib/orchestration-plan-edit-draft.ts`:

```ts
import type { TaskLedgerEventInput } from '@shared/types/task-ledger';

type PlanNodeLike = {
  id: string;
  title: string;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
};

export type PlanEditOperation =
  | { type: 'reorder_node'; nodeId: string; beforeNodeId: string | null }
  | { type: 'disable_node'; nodeId: string }
  | { type: 'enable_node'; nodeId: string }
  | { type: 'note_node'; nodeId: string; note: string };

export type PlanEditDraft = {
  baseProjectionId: string;
  operations: PlanEditOperation[];
  order: string[];
  disabledNodeIds: string[];
  notesByNodeId: Record<string, string>;
  nodesById: Record<string, PlanNodeLike>;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function moveBefore(order: string[], nodeId: string, beforeNodeId: string | null): string[] {
  const without = order.filter((id) => id !== nodeId);
  if (!beforeNodeId) return [...without, nodeId];
  const index = without.indexOf(beforeNodeId);
  if (index < 0) return [...without, nodeId];
  return [...without.slice(0, index), nodeId, ...without.slice(index)];
}

export function createPlanEditDraft(input: {
  baseProjectionId: string;
  nodes: PlanNodeLike[];
}): PlanEditDraft {
  return {
    baseProjectionId: input.baseProjectionId,
    operations: [],
    order: input.nodes.map((node) => node.id),
    disabledNodeIds: [],
    notesByNodeId: {},
    nodesById: Object.fromEntries(input.nodes.map((node) => [node.id, { ...node }])),
  };
}

export function applyPlanEditOperation(draft: PlanEditDraft, operation: PlanEditOperation): PlanEditDraft {
  if (!draft.nodesById[operation.nodeId]) return draft;
  if (operation.type === 'reorder_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      order: moveBefore(draft.order, operation.nodeId, operation.beforeNodeId),
    };
  }
  if (operation.type === 'disable_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      disabledNodeIds: unique([...draft.disabledNodeIds, operation.nodeId]),
    };
  }
  if (operation.type === 'enable_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      disabledNodeIds: draft.disabledNodeIds.filter((id) => id !== operation.nodeId),
    };
  }
  const note = operation.note.trim();
  return {
    ...draft,
    operations: [...draft.operations, { ...operation, note }],
    notesByNodeId: note
      ? { ...draft.notesByNodeId, [operation.nodeId]: note }
      : Object.fromEntries(Object.entries(draft.notesByNodeId).filter(([id]) => id !== operation.nodeId)),
  };
}

export function buildPlanEditLedgerEvents(input: {
  draft: PlanEditDraft;
  workspaceId?: string | null;
  sessionKey?: string | null;
  timestamp?: string;
  auditReason: string;
}): TaskLedgerEventInput[] {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const changedNodeIds = unique([
    ...input.draft.disabledNodeIds,
    ...Object.keys(input.draft.notesByNodeId),
    ...input.draft.operations.flatMap((operation) => operation.type === 'reorder_node' ? [operation.nodeId] : []),
  ]);
  return changedNodeIds.map((nodeId) => {
    const node = input.draft.nodesById[nodeId];
    return {
      id: `${input.draft.baseProjectionId}:plan-edit:${nodeId}:${timestamp}`,
      type: 'node_updated',
      actor: 'user',
      taskId: nodeId,
      sessionId: input.sessionKey ?? null,
      idempotencyKey: `plan-edit:${input.draft.baseProjectionId}:${timestamp}`,
      createdAt: timestamp,
      payload: {
        patch: {
          metadata: {
            ...(node.metadata ?? {}),
            readonlyProjection: true,
            projectionEdit: {
              baseProjectionId: input.draft.baseProjectionId,
              disabled: input.draft.disabledNodeIds.includes(nodeId),
              order: input.draft.order,
              note: input.draft.notesByNodeId[nodeId],
              operations: input.draft.operations,
              auditReason: input.auditReason,
              workspaceId: input.workspaceId ?? null,
            },
          },
        },
      },
    } satisfies TaskLedgerEventInput;
  });
}
```

- [ ] **Step 3: Run draft tests**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-plan-edit-draft.test.ts tests/unit/orchestration-plan-ledger-projection.test.ts --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 4: Commit Task 4**

```powershell
git add src/lib/orchestration-plan-edit-draft.ts tests/unit/orchestration-plan-edit-draft.test.ts tests/unit/orchestration-plan-ledger-projection.test.ts
git commit -m "feat: add lightweight orchestration plan edit draft"
```

Agent R review checks:

- The draft helper never mutates source projection nodes.
- Saved metadata keeps `readonlyProjection=true`.
- No arbitrary edge add/remove operation exists.

---

### Task 5: P1-02 Plan Edit UI and E2E

**Files:**
- Modify: `src/components/agents/OrchestrationPlanView.tsx`
- Modify: `src/components/agents/RolesOrchestrationPanel.tsx`
- Modify: `shared/i18n/locales/en/agents.json`
- Modify: `shared/i18n/locales/zh/agents.json`
- Modify: `shared/i18n/locales/ja/agents.json`
- Modify: `shared/i18n/locales/ru/agents.json`
- Test: `tests/unit/roles-orchestration-panel.test.tsx`
- Test: create `tests/e2e/role-orchestration-plan-editing.spec.ts`

**Interfaces:**
- Consumes:
  - `createPlanEditDraft`
  - `applyPlanEditOperation`
  - `buildPlanEditLedgerEvents`
  - `hostApi.taskLedger.appendEvents(input)`
- Produces: visible lightweight edit controls and Task Ledger save event.

- [ ] **Step 1: Add failing component test**

Modify `tests/unit/roles-orchestration-panel.test.tsx` with a new test:

```tsx
it('saves lightweight plan edits to Task Ledger without creating a DAG editor', async () => {
  renderPanel();

  fireEvent.click(screen.getByTestId('role-orchestration-toggle'));
  fireEvent.change(screen.getByTestId('role-orchestration-task-input'), {
    target: { value: 'Stabilize smoke tests' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Plan/ }));

  await screen.findByTestId('orchestration-plan-edit-toggle');
  fireEvent.click(screen.getByTestId('orchestration-plan-edit-toggle'));
  fireEvent.click(screen.getByTestId('orchestration-plan-disable-planner-1'));
  fireEvent.change(screen.getByTestId('orchestration-plan-note-planner-1'), {
    target: { value: 'Skip planner slice for this run' },
  });
  fireEvent.click(screen.getByTestId('orchestration-plan-save-edits'));

  await waitFor(() => {
    expect(appendEventsMock).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'node_updated',
          payload: expect.objectContaining({
            patch: expect.objectContaining({
              metadata: expect.objectContaining({
                projectionEdit: expect.objectContaining({
                  auditReason: expect.stringMatching(/plan edit/i),
                }),
              }),
            }),
          }),
        }),
      ]),
    }));
  });
  expect(screen.queryByTestId('orchestration-plan-edge-editor')).toBeNull();
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/roles-orchestration-panel.test.tsx --reporter=verbose
```

Expected: FAIL because edit controls are missing.

- [ ] **Step 2: Extend `OrchestrationPlanView` props and controls**

Modify `src/components/agents/OrchestrationPlanView.tsx` to accept:

```ts
type PlanEditControl = {
  editing: boolean;
  disabledNodeIds: string[];
  notesByNodeId: Record<string, string>;
  onToggleEditing: () => void;
  onDisableNode: (nodeId: string) => void;
  onEnableNode: (nodeId: string) => void;
  onNoteNode: (nodeId: string, note: string) => void;
  onMoveNode: (nodeId: string, beforeNodeId: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
};
```

Add optional prop:

```ts
editControl?: PlanEditControl;
```

Render compact controls near each plan node:

```tsx
{editControl?.editing && (
  <div className="mt-2 flex flex-wrap items-center gap-2">
    <Button
      type="button"
      size="icon"
      variant="ghost"
      data-testid={`orchestration-plan-disable-${node.taskNodeId}`}
      onClick={() => editControl.disabledNodeIds.includes(node.taskNodeId)
        ? editControl.onEnableNode(node.taskNodeId)
        : editControl.onDisableNode(node.taskNodeId)}
      title={editControl.disabledNodeIds.includes(node.taskNodeId)
        ? t('roles.planEdit.enableNode')
        : t('roles.planEdit.disableNode')}
    >
      <Ban className="h-4 w-4" />
    </Button>
    <Input
      data-testid={`orchestration-plan-note-${node.taskNodeId}`}
      value={editControl.notesByNodeId[node.taskNodeId] ?? ''}
      onChange={(event) => editControl.onNoteNode(node.taskNodeId, event.target.value)}
      placeholder={t('roles.planEdit.notePlaceholder')}
      className="h-8 min-w-40 flex-1"
    />
  </div>
)}
```

Use existing lucide icons if already imported; otherwise import `Ban`, `Save`, `X`, and `RefreshCw` from `lucide-react`.

- [ ] **Step 3: Wire draft state in `RolesOrchestrationPanel`**

Modify `src/components/agents/RolesOrchestrationPanel.tsx` imports:

```ts
import {
  applyPlanEditOperation,
  buildPlanEditLedgerEvents,
  createPlanEditDraft,
  type PlanEditDraft,
} from '@/lib/orchestration-plan-edit-draft';
```

Add state:

```ts
const [planEditDraft, setPlanEditDraft] = useState<PlanEditDraft | null>(null);
const [planEditReason, setPlanEditReason] = useState('');
```

After setting `nextPlan`, create a draft from plan graph nodes:

```ts
const planNodes = nextPlan.taskGraph?.nodes?.map((node) => ({
  id: node.taskNodeId,
  title: `${node.roleName}: ${node.task}`,
  parentId: nextPlan.taskGraph?.graphRunId ?? null,
  metadata: { readonlyProjection: true, source: 'orchestrator.plan' },
})) ?? [];
setPlanEditDraft(planNodes.length > 0
  ? createPlanEditDraft({ baseProjectionId: nextPlan.taskGraph?.graphRunId ?? `plan:${Date.now()}`, nodes: planNodes })
  : null);
```

Define save handler:

```ts
const savePlanEdits = useCallback(async () => {
  if (!planEditDraft) return;
  const events = buildPlanEditLedgerEvents({
    draft: planEditDraft,
    workspaceId: activeWorkspaceId,
    sessionKey: anchorSession || null,
    auditReason: planEditReason.trim() || 'User saved lightweight plan edits',
  });
  if (events.length === 0) return;
  await hostApi.taskLedger.appendEvents({
    workspaceId: activeWorkspaceId,
    events,
    idempotencyKey: events[0].idempotencyKey,
  });
  toast.success(tt('roles.planEdit.saved', 'Plan edits saved'));
}, [activeWorkspaceId, anchorSession, planEditDraft, planEditReason, tt]);
```

Pass `editControl` into `OrchestrationPlanView`.

- [ ] **Step 4: Add locale entries**

Add these keys under `roles.planEdit` in all four `shared/i18n/locales/<lang>/agents.json` files:

```json
{
  "edit": "Edit plan",
  "save": "Save plan edits",
  "cancel": "Cancel plan edits",
  "regenerate": "Regenerate plan",
  "disableNode": "Disable node",
  "enableNode": "Enable node",
  "notePlaceholder": "Add a note",
  "saved": "Plan edits saved"
}
```

Translate meaningfully for `zh`, `ja`, and `ru`.

- [ ] **Step 5: Add E2E coverage**

Create `tests/e2e/role-orchestration-plan-editing.spec.ts` using `installIpcMocks` and `__verseClawE2eHostCalls`:

```ts
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test('saves lightweight orchestration plan edits to Task Ledger', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      gatewayRpc: {
        [stableStringify(['roles.list', null])]: { roles: [{ name: 'planner', displayName: 'Planner', tools: ['read'] }], count: 1 },
        [stableStringify(['orchestrator.plan', { task: 'Stabilize smoke tests' }])]: {
          plan: {
            mode: 'lead-workers',
            leadRole: 'planner',
            workers: [{ roleName: 'planner', task: 'Plan the work' }],
            reasons: ['explicit-workers'],
            taskGraph: {
              graphRunId: 'plan-edit-e2e',
              status: 'planned',
              nodes: [{ taskNodeId: 'planner-1', roleName: 'planner', task: 'Plan the work', phase: 'planning', dependsOn: [] }],
              edges: [],
            },
          },
        },
      },
      hostApi: {
        [stableStringify(['workspaces', 'list', null])]: {
          profiles: [{ id: 'default', name: 'Default', rootPath: process.cwd(), agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {} }],
          activeWorkspaceId: 'default',
          activeWorkspace: { id: 'default', name: 'Default', rootPath: process.cwd(), agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {} },
        },
        [stableStringify(['taskLedger', 'appendEvents', null])]: { success: true, snapshot: { nodes: [], edges: [], eventsCount: 0 } },
      },
    });
    const page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill('Stabilize smoke tests');
    await page.getByRole('button', { name: /Plan/ }).click();
    await page.getByTestId('orchestration-plan-edit-toggle').click();
    await page.getByTestId('orchestration-plan-disable-planner-1').click();
    await page.getByTestId('orchestration-plan-save-edits').click();

    const appendPayload = await app.evaluate(() => {
      const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? [];
      return calls.findLast((call) => call.module === 'taskLedger' && call.action === 'appendEvents')?.payload ?? null;
    });
    expect(appendPayload).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'node_updated' }),
      ]),
    });
    await expect(page.getByTestId('orchestration-plan-edge-editor')).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});
```

- [ ] **Step 6: Run UI tests and i18n**

Run:

```powershell
pnpm exec vitest run tests/unit/roles-orchestration-panel.test.tsx tests/unit/orchestration-plan-edit-draft.test.ts --reporter=verbose
pnpm run i18n:lint
pnpm run build:vite
pnpm run test:e2e tests/e2e/role-orchestration-plan-editing.spec.ts
```

Expected: all selected commands pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add src/components/agents/OrchestrationPlanView.tsx src/components/agents/RolesOrchestrationPanel.tsx shared/i18n/locales/en/agents.json shared/i18n/locales/zh/agents.json shared/i18n/locales/ja/agents.json shared/i18n/locales/ru/agents.json tests/unit/roles-orchestration-panel.test.tsx tests/e2e/role-orchestration-plan-editing.spec.ts
git commit -m "feat: add lightweight orchestration plan editing"
```

Agent R review checks:

- UI has no arbitrary edge editor.
- All text is localized.
- Save uses `hostApi.taskLedger.appendEvents`.

---

### Task 6: P1-04 Ordinary Orchestration Quality Scorecard

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-quality-scorecard.ts`
- Modify: `openclaw_runtime/src/agents/orchestration-protocol.ts`
- Modify: `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
- Modify: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Modify: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- Test: `tests/unit/role-orchestration-methods.test.ts`
- Test: `tests/integration/p1-orchestration-boundary.integration.test.ts`
- Test: `tests/e2e/role-orchestration-diagnostics.spec.ts` if UI payload assertions change.

**Interfaces:**
- Produces:
  - `OrdinaryOrchestrationQualityScorecard`
  - `buildOrdinaryOrchestrationQualityScorecard(input)`
  - `qualityState: null | 'shadow' | 'active'`
  - `qualityScorecard` payload with `overall`, `worst`, `reason`, `evidenceRefs`, `workerScores`, and `scorecardBacked`

- [ ] **Step 1: Write failing quality tests**

Modify `tests/unit/role-orchestration-methods.test.ts` in `team_orchestrate tool` tests:

```ts
expect(details.qualityState).toBe('shadow');
expect(details.quality).toEqual(expect.arrayContaining([
  expect.objectContaining({
    roleName: expect.any(String),
    overall: expect.stringMatching(/good|needs_attention|poor_attempt/),
  }),
]));
expect(details.qualityScorecard).toMatchObject({
  overall: expect.stringMatching(/good|needs_attention|poor_attempt/),
  worst: expect.any(String),
  reason: expect.any(String),
  scorecardBacked: true,
  evidenceRefs: expect.arrayContaining([expect.stringMatching(/trace:|run_|orch_/)]),
});
```

Modify the partial failure test:

```ts
expect(details.qualityState).toBe('shadow');
expect(details.qualityScorecard).toMatchObject({
  overall: 'needs_attention',
  worst: 'poor_attempt',
  scorecardBacked: true,
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts --reporter=verbose
```

Expected: FAIL because ordinary orchestration still returns `quality: []` and `qualityState: null`.

- [ ] **Step 2: Add quality scorecard helper**

Create `openclaw_runtime/src/agents/orchestration-quality-scorecard.ts`:

```ts
import type { ObservabilityScorecard } from "../observability/types.js";
import {
  scoreWorkerQuality,
  summarizeQuality,
  type WorkerQualityScore,
} from "./orchestration-protocol.js";

export type OrdinaryOrchestrationQualityState = null | "shadow" | "active";

export type OrdinaryOrchestrationQualityScorecard = {
  state: OrdinaryOrchestrationQualityState;
  overall: WorkerQualityScore["overall"];
  worst: WorkerQualityScore["overall"];
  reason: string;
  evidenceRefs: string[];
  workerScores: WorkerQualityScore[];
  scorecardBacked: boolean;
  observabilityScore?: {
    traceId: string;
    grade: ObservabilityScorecard["grade"];
    score: number;
  };
  summary: ReturnType<typeof summarizeQuality>;
};

const rank: Record<WorkerQualityScore["overall"], number> = {
  good: 0,
  needs_attention: 1,
  poor_attempt: 2,
};

function worstScore(scores: WorkerQualityScore[]): WorkerQualityScore["overall"] {
  return scores.reduce<WorkerQualityScore["overall"]>((worst, score) => (
    rank[score.overall] > rank[worst] ? score.overall : worst
  ), "good");
}

function overallFromScores(scores: WorkerQualityScore[]): WorkerQualityScore["overall"] {
  if (scores.some((score) => score.overall === "poor_attempt")) return "needs_attention";
  if (scores.some((score) => score.overall === "needs_attention")) return "needs_attention";
  return "good";
}

export function buildOrdinaryOrchestrationQualityScorecard(input: {
  orchestrationRunId: string;
  attempts: readonly {
    roleName: string;
    taskId?: string;
    childRunId?: string;
    childSessionKey?: string;
    status?: string;
    error?: string;
    resultText?: string;
    verifierVerdict?: WorkerQualityScore["verifierVerdict"];
  }[];
  observabilityScorecard?: ObservabilityScorecard;
  allowActive?: boolean;
}): OrdinaryOrchestrationQualityScorecard | null {
  if (input.attempts.length === 0 && !input.observabilityScorecard) return null;

  const workerScores = input.attempts.map((attempt, index) => scoreWorkerQuality({
    roleName: attempt.roleName,
    childRunId: attempt.childRunId ?? attempt.taskId ?? `${input.orchestrationRunId}:attempt:${index + 1}`,
    childSessionKey: attempt.childSessionKey,
    resultText: attempt.resultText,
    outcomeStatus: attempt.status,
    outcomeError: attempt.error,
    verifierOutcomeStatus: attempt.verifierVerdict === "accepted" ? "ok" : attempt.verifierVerdict === "refuted" ? "error" : undefined,
  }));

  const overall = workerScores.length > 0 ? overallFromScores(workerScores) : "needs_attention";
  const worst = workerScores.length > 0 ? worstScore(workerScores) : "needs_attention";
  const evidenceRefs = [
    `orchestration:${input.orchestrationRunId}`,
    ...(input.observabilityScorecard ? [`trace:${input.observabilityScorecard.traceId}`] : []),
    ...workerScores.map((score) => `run:${score.childRunId}`),
  ];
  const scorecardBacked = Boolean(input.observabilityScorecard);

  return {
    state: scorecardBacked ? (input.allowActive ? "active" : "shadow") : null,
    overall,
    worst,
    reason: scorecardBacked
      ? `Ordinary orchestration scored from ${workerScores.length} worker attempt(s) and observability trace ${input.observabilityScorecard?.traceId}.`
      : "Ordinary orchestration has worker evidence but no observability scorecard.",
    evidenceRefs,
    workerScores,
    scorecardBacked,
    observabilityScore: input.observabilityScorecard
      ? {
        traceId: input.observabilityScorecard.traceId,
        grade: input.observabilityScorecard.grade,
        score: input.observabilityScorecard.score,
      }
      : undefined,
    summary: summarizeQuality(workerScores),
  };
}
```

- [ ] **Step 3: Return scorecard from observed runner**

Modify `openclaw_runtime/src/agents/orchestrator-run-observed.ts` imports:

```ts
import { buildOrdinaryOrchestrationQualityScorecard, type OrdinaryOrchestrationQualityScorecard } from "./orchestration-quality-scorecard.js";
```

Extend the observed run result type:

```ts
qualityScorecard?: OrdinaryOrchestrationQualityScorecard | null;
```

After `const { trace, scorecard } = completeObservedRun(...)`, add:

```ts
const qualityScorecard = buildOrdinaryOrchestrationQualityScorecard({
  orchestrationRunId: request.orchestrationRunId ?? trace.runId ?? trace.id,
  attempts: attempts.map((attempt) => ({
    roleName: attempt.roleName,
    taskId: attempt.taskId,
    childRunId: attempt.childRunId,
    childSessionKey: attempt.childSessionKey,
    status: attempt.status,
    error: attempt.error,
    resultText: attempt.resultText,
    verifierVerdict: attempt.verifierVerdict,
  })),
  observabilityScorecard: scorecard,
  allowActive: false,
});
```

Include it in the return object:

```ts
qualityScorecard,
```

- [ ] **Step 4: Wire `team_orchestrate` tool output**

Modify `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`:

```ts
const qualityScorecard = result.qualityScorecard ?? null;
const quality = qualityScorecard?.workerScores ?? [];
```

Replace existing `quality`, `qualityState`, and `qualitySummary` values:

```ts
quality,
qualityState: qualityScorecard?.state ?? null,
qualityStateReason: qualityScorecard?.reason ?? TEAM_ORCHESTRATE_QUALITY_STATE_REASON,
qualityScorecard,
qualitySummary: qualityScorecard?.summary ?? summarizeQuality([]),
```

- [ ] **Step 5: Wire Gateway `orchestrator.run` output**

Modify `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`:

```ts
const qualityScorecard = result.qualityScorecard ?? null;
const quality = qualityScorecard?.workerScores ?? [];
```

Return:

```ts
quality,
qualityState: qualityScorecard?.state ?? null,
qualityStateReason: qualityScorecard?.reason ?? ORCHESTRATOR_RUN_QUALITY_STATE_REASON,
qualityScorecard,
qualitySummary: qualityScorecard?.summary ?? summarizeQuality([]),
```

- [ ] **Step 6: Preserve Routing Memo active gate**

Modify `tests/integration/p1-orchestration-boundary.integration.test.ts` with an assertion that ordinary orchestration scorecards stay shadow in default runs:

```ts
expect((runPayload as { qualityState?: unknown }).qualityState).not.toBe('active');
```

Do not pass ordinary quality scorecards into `resolveRoutingMemoAuthority` as active unless `scorecardBacked === true` and the existing active gate explicitly allows it.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose
```

Expected: all selected tests pass.

- [ ] **Step 8: Run E2E if UI payload changes**

Run:

```powershell
pnpm run build:vite
pnpm run test:e2e tests/e2e/role-orchestration-diagnostics.spec.ts
```

Expected: E2E passes and ordinary orchestration diagnostics still do not show Task Loop repair, checkpoint, or blocked semantics.

- [ ] **Step 9: Commit Task 6**

```powershell
git add openclaw_runtime/src/agents/orchestration-quality-scorecard.ts openclaw_runtime/src/agents/orchestration-protocol.ts openclaw_runtime/src/agents/orchestrator-run-observed.ts openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts tests/unit/role-orchestration-methods.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts tests/e2e/role-orchestration-diagnostics.spec.ts
git commit -m "feat: add ordinary orchestration quality scorecard"
```

Agent R review checks:

- `quality` is no longer an empty placeholder when evidence exists.
- `qualityState` remains `null` if no evidence exists and `shadow` for ordinary scorecard evidence.
- Routing Memo active authority remains gated by scorecard-backed active rules.

---

### Task 7: Product Semantics, Matrix, Docs, and Final Gates

**Files:**
- Modify: `shared/product-semantics.ts`
- Modify: `docs/clawx-product-semantics.md`
- Modify: `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md`
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Test: `tests/unit/product-semantics.test.ts`

**Interfaces:**
- Consumes: all evidence from Tasks 1 through 6.
- Produces: final truthful status updates for `P0-12`, `P0-13`, `P1-02`, `P1-03`, and `P1-04`.

- [ ] **Step 1: Update semantic statuses only after evidence exists**

Modify `shared/product-semantics.ts`:

```ts
// P0-12
implementationStatus: 'done',
safeClaim: 'Plan mode has unit policy coverage and an Electron write/edit/exec challenge for terminal, file write, and mutating Gateway RPC paths.',

// P0-13
implementationStatus: 'done',
safeClaim: 'Workspace and Role permission decisions produce normalized PermissionDecisionEvent records for wired producers.',

// P1-02
implementationStatus: 'done',
safeClaim: 'Chat Plan supports lightweight reorder, disable, note, regenerate, save, and cancel controls without becoming a full DAG editor.',

// P1-03
implementationStatus: 'done',
safeClaim: 'Workboard references Task Ledger nodes through a one-way TaskLedgerReference protocol.',

// P1-04
implementationStatus: 'done',
safeClaim: 'Ordinary orchestration reports a real shadow quality scorecard when evidence exists and keeps active routing gated.',
```

Keep forbidden claims unchanged or stricter.

- [ ] **Step 2: Update product semantics docs**

Modify `docs/clawx-product-semantics.md`:

```md
| Permission boundary | P0-11, P0-12, P0-13 | Plan mode gates user-file writes and now has a real Electron write/edit/exec challenge for terminal, file write, and mutating Gateway RPC paths. Unified permission audit means wired Workspace and Role producers emit normalized `PermissionDecisionEvent` records; it is not an exhaustive enterprise audit system. |
| Chat Plan | P1-01, P1-02 | Chat Plan supports lightweight edit drafts for reorder, disable, note, regenerate, save, and cancel. It is not a full DAG editor. |
| Task Ledger / Workboard | P1-03 | Task Ledger owns user-visible task facts; Workboard owns runtime/plugin scheduling and references ledger nodes one-way through `TaskLedgerReference`. |
| Orchestration quality | P1-04 | Ordinary `team_orchestrate` reports `qualityState=null` when unevaluated and `shadow` when real scorecard evidence exists; active routing remains gated. |
```

- [ ] **Step 3: Update report matrix rows**

Modify rows `P0-12`, `P0-13`, `P1-02`, `P1-03`, and `P1-04` in `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md`.

Each row must include:

```md
状态变更: previous incomplete/deferred state -> DONE
开发变更文件: ...
核心调用链: ...
测试命令: ...
测试结果: ...
真实边界: ...
剩余不宣称的能力: ...
是否影响 44 项矩阵: 是
```

Do not write that Plan mode has exhaustive challenge coverage. Do not write that unified audit covers every permission surface. Do not write that Chat Plan is a full DAG editor. Do not write that Workboard and Task Ledger two-way sync. Do not write that ordinary orchestration has Task Loop repair semantics.

- [ ] **Step 4: Review README claim changes**

Search:

```powershell
rg -n "DAG|Routing Memo|Task Loop repair|permission audit|Workboard|Task Ledger|quality scorecard|team_orchestrate" README.md README.zh-CN.md README.ja-JP.md
```

If no claim contradicts the new boundaries, leave README files unchanged and mention that in the report row. If a README claim overstates a capability, edit the claim to the same boundary language used in `docs/clawx-product-semantics.md`.

- [ ] **Step 5: Run final verification**

Run:

```powershell
pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-spawn.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/orchestration-plan-edit-draft.test.ts tests/unit/roles-orchestration-panel.test.tsx --reporter=verbose
pnpm exec vitest run tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose
pnpm run i18n:lint
pnpm run build:vite
pnpm run test:e2e tests/e2e/chat-plan-mode-write-challenge.spec.ts tests/e2e/role-orchestration-plan-editing.spec.ts tests/e2e/role-orchestration-diagnostics.spec.ts
pnpm run typecheck
node scripts/check-capability-claims.mjs --fail-on-warning README.md README.zh-CN.md README.ja-JP.md docs/clawx-product-semantics.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md
```

Expected: all commands exit `0`. If an E2E name changes during implementation, update the command and report matrix with the replacement file and the behavior it covers.

- [ ] **Step 6: Commit Task 7**

```powershell
git add shared/product-semantics.ts docs/clawx-product-semantics.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md README.md README.zh-CN.md README.ja-JP.md
git commit -m "docs: close remaining p0 p1 product semantics"
```

Agent R review checks:

- Every `DONE` row has test command evidence.
- Claim gate passes.
- Remaining non-claimed capabilities are stated plainly.

---

## Final Completion Audit

Before marking the goal complete:

- `git status --short` is clean except intentional untracked artifacts that are explicitly excluded.
- `P0-12`, `P0-13`, `P1-02`, `P1-03`, and `P1-04` are `done` in `shared/product-semantics.ts`.
- The report matrix rows for all five items are `DONE`.
- Final verification commands from Task 7 have passing output.
- No implementation touched or relied on the old `codex/sekb-runtime-knowledge` branch.
- The final response names any commands that could not be run.
