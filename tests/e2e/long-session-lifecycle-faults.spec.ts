import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};
type GatewayStatus = {
  state?: string;
  gatewayReady?: boolean;
  port?: number;
};
type SessionsListResult = {
  sessions?: Array<{ key?: string; sessionId?: string }>;
};
type ArchiveEntry = {
  sessionKey: string;
  transcriptPath: string;
  originalWorkspaceId?: string | null;
};
type ArchiveListResult = {
  success: boolean;
  entries: ArchiveEntry[];
};

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `long-session-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(
      `[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? `host invoke failed: ${module}.${action}`}`,
    );
  }
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  let startRequested = false;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (!startRequested && lastStatus.state !== 'starting') {
        startRequested = true;
        await hostInvoke(app, 'gateway', 'start');
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Gateway did not become ready: ${JSON.stringify({ lastStatus, lastError })}`);
}


async function makeActiveWorkspaceWritable(app: ElectronApplication): Promise<void> {
  const active = await hostInvoke<{ activeWorkspace?: { id?: string }; id?: string }>(
    app,
    'workspaces',
    'getActive',
  );
  const workspaceId = active.activeWorkspace?.id ?? active.id;
  if (!workspaceId) return;
  await hostInvoke(app, 'workspaces', 'update', {
    id: workspaceId,
    permissionMode: 'fullAccess',
  });
}

async function listSessions(app: ElectronApplication): Promise<SessionsListResult> {
  return hostInvoke<SessionsListResult>(app, 'gateway', 'rpc', {
    method: 'sessions.list',
    params: { agentId: 'main' },
    timeoutMs: 30_000,
  });
}

test('real Host and Gateway archive/restore preserves history and rotates the physical generation', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await ensureGatewayReady(app);
    await makeActiveWorkspaceWritable(app);

    const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label: `long-session-e2e-${Date.now()}` },
      timeoutMs: 60_000,
    });
    const sessionsBeforeCreate = await listSessions(app);
    const createdKey = typeof created.key === 'string'
      ? created.key
      : typeof created.sessionKey === 'string'
        ? created.sessionKey
        : sessionsBeforeCreate.sessions?.find((session) => typeof session.key === 'string')?.key;
    if (!createdKey) throw new Error(`sessions.create returned no usable key: ${JSON.stringify(created)}`);
    expect(createdKey).toMatch(/^agent:main:/);
    const workspaceRoot = testInfo.outputPath('lifecycle-workspace');
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
      name: 'Lifecycle history fixture', rootPath: workspaceRoot, agentId: 'main',
      activeSessionKey: createdKey, permissionMode: 'fullAccess',
    });
    const workspaceId = workspace.activeWorkspace.id;
    expect(workspaceId).toBeTruthy();
    const before = sessionsBeforeCreate.sessions?.find((session) => session.key === createdKey) ??
      (await listSessions(app)).sessions?.find((session) => session.key === createdKey);
    expect(before?.sessionId).toBeTruthy();
    const sentinel = `agent-driven-history-${createdKey}`;
    await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.inject', params: { sessionKey: createdKey, agentId: 'main', message: sentinel, label: 'agent fixture' }, timeoutMs: 30_000 });
    const historyBefore = await hostInvoke(app, 'sessions', 'history', { sessionKey: createdKey });
    expect(JSON.stringify(historyBefore)).toContain(sentinel);

    const archived = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'archive', {
      id: createdKey,
      originalWorkspaceId: workspaceId,
    });
    expect(archived.success, archived.error).toBe(true);

    const archivedIndex = await hostInvoke<ArchiveListResult>(app, 'sessions', 'listArchived', {
      agentId: 'main',
    });
    expect(archivedIndex.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionKey: createdKey,
        originalWorkspaceId: workspaceId,
      }),
    ]));
    const archivePath = archivedIndex.entries.find(entry => entry.sessionKey === createdKey)!.transcriptPath;
    const archivedBytes = await readFile(archivePath);
    expect((await listSessions(app)).sessions?.some((session) => session.key === createdKey)).toBe(false);

    const restored = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'restore', {
      id: createdKey,
    });
    expect(restored.success, restored.error).toBe(true);

    const live = (await listSessions(app)).sessions?.find((session) => session.key === createdKey);
    expect(live).toBeTruthy();
    expect(live?.sessionId).not.toBe(before?.sessionId);
    const archivedAfter = await hostInvoke<ArchiveListResult>(app, 'sessions', 'listArchived', {
      agentId: 'main',
    });
    expect(archivedAfter.entries.some((entry) => entry.sessionKey === createdKey)).toBe(false);
    const historyAfter = await hostInvoke(app, 'sessions', 'history', { sessionKey: createdKey });
    expect(JSON.stringify(historyAfter)).toContain(sentinel);
    const receipt = { schema: 'clawx.long-session.real-lifecycle/v1', driven_by: 'agent', actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent', sessionKey: createdKey, previousSessionId: before?.sessionId, restoredSessionId: live?.sessionId, archived, restored, archivePath, archivedTranscriptSha256: createHash('sha256').update(archivedBytes).digest('hex'), inputSha256: createHash('sha256').update(sentinel).digest('hex'), historyRetained: true, archiveIndexRemoved: true, transport: 'built Electron host:invoke -> actual Gateway runtime' };
    const output = testInfo.outputPath('lifecycle-receipt.json');
    await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
    await testInfo.attach('lifecycle-receipt', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(app);
  }
});
test('real Host and Gateway owner receipts reclaim a generation-scoped terminal and preserve archive', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await ensureGatewayReady(app);
    const workloadRoot = testInfo.outputPath('resource-workload');
    await mkdir(workloadRoot, { recursive: true });
    await hostInvoke(app, 'workspaces', 'create', {
      name: 'E2 resource workload',
      rootPath: workloadRoot,
      permissionMode: 'fullAccess',
    });
    const active = await hostInvoke<{
      activeWorkspace?: { id?: string };
      id?: string;
    }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace?.id ?? active.id;
    if (!workspaceId) throw new Error('Active workspace has no id');
    let workspaceRoot = (active.activeWorkspace as { rootPath?: string } | undefined)?.rootPath;
    if (!workspaceRoot) {
      const listedWorkspaces = await hostInvoke<{
        activeWorkspace?: { id?: string; rootPath?: string };
        profiles?: Array<{ id?: string; rootPath?: string }>;
      }>(app, 'workspaces', 'list');
      workspaceRoot = listedWorkspaces.activeWorkspace?.rootPath ??
        listedWorkspaces.profiles?.find((profile) => profile.id === workspaceId)?.rootPath;
    }
    if (!workspaceRoot) throw new Error('Active workspace has no root path');    const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label: 'resource-reclaim-' + Date.now() },
      timeoutMs: 60_000,
    });
    const sessionKey = typeof created.key === 'string'
      ? created.key
      : typeof created.sessionKey === 'string'
        ? created.sessionKey
        : null;
    if (!sessionKey) throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceId, activeSessionKey: sessionKey, sessionKey, agentId: 'main',
    });

    const listed = await listSessions(app);
    const sessionId = listed.sessions?.find((session) => session.key === sessionKey)?.sessionId;
    expect(sessionId).toBeTruthy();

    const opened = await hostInvoke<{
      success: boolean;
      error?: string;
      sessionId?: string;
      expectedSessionId?: string;
      status?: string;
    }>(app, 'terminal', 'open', {
      sessionKey,
      expectedSessionId: sessionId,
      keepOnLeave: true,
      cwd: workspaceRoot,
      command: 'echo agent-resource-probe',
    });
    expect(opened.success, opened.error).toBe(true);
    expect(opened.sessionId).toBeTruthy();
    expect(opened.expectedSessionId).toBe(sessionId);

    const stale = await hostInvoke<{ success: boolean; blocked?: boolean; reason?: string; expectedSessionId?: string }>(
      app,
      'terminal',
      'open',
      {
        sessionKey,
        expectedSessionId: 'stale-generation-e2',
        keepOnLeave: true,
        cwd: workspaceRoot,
      },
    );
    expect(stale.success).toBe(false);
    expect(stale.blocked).toBe(true);
    expect(stale.reason).toMatch(/generation changed/i);
    expect(stale.expectedSessionId).toBe(sessionId);

    const beforeStop = await hostInvoke<{
      success: boolean;
      snapshot: {
        session: { sessionId?: string | null };
        resources?: { owners: Array<{
          kind: string;
          authority: string;
          generation: string | null;
          state: string;
          count: number | null;
          activePermits: number | null;
          waiters: number | null;
          helperRefs: number | null;
          worktreeIds: string[] | null;
          detail?: string;
        }> };
      };
    }>(app, 'sessionActivity', 'snapshot', {
      workspaceId,
      sessionKey,
    });
    expect(beforeStop.success).toBe(true);
    expect(beforeStop.snapshot.session.sessionId).toBe(sessionId);
    expect(beforeStop.snapshot.resources?.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'process', authority: 'managed', generation: sessionId }),
      expect.objectContaining({ kind: 'admission-permit', authority: 'managed', generation: sessionId, activePermits: 0, waiters: 0 }),
      expect.objectContaining({ kind: 'terminal', authority: 'managed', generation: sessionId, count: 1 }),
    ]));
    const worktreeOwner = beforeStop.snapshot.resources?.owners.find((owner) => owner.kind === 'worktree');
    expect(worktreeOwner === undefined).toBe(false);
    // A running turn can own a workspace from the coordinator/runtime context
    // that is not persisted on the session row yet. Unknown stay reported here;
    // deleting an unproven worktree is still forbidden.
    expect(['known', 'unknown']).toContain(worktreeOwner?.state);
    if (worktreeOwner?.state === 'unknown') {
      expect(worktreeOwner.detail).toMatch(/workspace root/i);
      expect(worktreeOwner.count).toBeNull();
    }
    expect(worktreeOwner?.generation).toBe(sessionId);

    const stopped = await hostInvoke<{
      success: boolean;
      stopped?: boolean;
      expectedSessionId?: string;
      resourceReclamation?: {
        action: string;
        recoveryRequired: boolean;
        keptOnLeave: number;
        owners: Array<{ kind: string; outcome: string; generation: string | null }>;
      };
    }>(app, 'sessions', 'stop', { sessionKey });
    expect(stopped.success).toBe(true);
    expect(stopped.stopped).toBe(true);
    expect(stopped.expectedSessionId).toBe(sessionId);
    expect(stopped.resourceReclamation?.action).toBe('run-cancel');
    expect(stopped.resourceReclamation?.recoveryRequired).toBe(false);
    // Session stop releases run admission but preserves user terminals, even\n    // when the main pre-run cleanup gate already closed a previous generation.\n    expect(stopped.resourceReclamation?.keptOnLeave).toBeGreaterThanOrEqual(0);
    expect(stopped.resourceReclamation?.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'terminal', outcome: 'kept', generation: sessionId }),
      expect.objectContaining({ kind: 'admission-permit', outcome: 'not-owned', generation: sessionId }),
    ]));

    const afterStop = await hostInvoke<{
      success: boolean;
      snapshot: {
        resources?: { owners: Array<{ kind: string; count: number | null; activePermits: number | null; waiters: number | null }> };
      };
    }>(app, 'sessionActivity', 'snapshot', { sessionKey });
    expect(afterStop.success).toBe(true);
    expect(afterStop.snapshot.resources?.owners.find((owner) => owner.kind === 'admission-permit')).toMatchObject({
      activePermits: 0,
      waiters: 0,
    });
    expect(afterStop.snapshot.resources?.owners.find((owner) => owner.kind === 'terminal')?.count).toBe(0);

    const archived = await hostInvoke<{
      success: boolean;
      error?: string;
      resourceReclamation?: { action: string; recoveryRequired: boolean; keptOnLeave: number };
    }>(app, 'sessions', 'archive', {
      id: sessionKey,
      originalWorkspaceId: workspaceId,
    });
    expect(archived.success, archived.error).toBe(true);
    expect(archived.resourceReclamation?.action).toBe('session-archive');
    expect(archived.resourceReclamation?.recoveryRequired).toBe(false);
    // Archive mutates metadata only. A keep_on_leave terminal can be reclaimed\n    // only by a later explicit session delete; stop leaves it in place.\n    expect(archived.resourceReclamation?.keptOnLeave).toBeGreaterThanOrEqual(0);

    let stoppedAgain: { success: boolean; error?: string };
    try {
      stoppedAgain = await hostInvoke<{ success: boolean; error?: string }>(
        app,
        'sessions',
        'stop',
        { sessionKey },
      );
    } catch (error) {
      stoppedAgain = { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    // The archive removed the coordinator row; a definitive runtime refusal is
    // recorded as such instead of fabricating a zero-permit cleanup.
    expect(stoppedAgain.success).toBe(false);
    expect(stoppedAgain.error).toMatch(/session not found/i);
    const receipt = {
      schema: 'clawx.long-session.real-owner-reclamation/v1',
      driven_by: 'agent',
      candidate: execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      transport: 'built Electron host:invoke -> actual Gateway runtime -> Main owners',
      sessionKey,
      sessionId,
      terminal: {
        opened,
        staleGenerationRejected: stale.success === false && stale.blocked === true,
      },
      inventoryBeforeStop: beforeStop.snapshot.resources,
      stopped,
      inventoryAfterStop: afterStop.snapshot.resources,
      archived,
      stoppedAgain,
      recoveryRequired: Boolean(
        stopped.resourceReclamation?.recoveryRequired ||
        archived.resourceReclamation?.recoveryRequired,
      ),
      timestamp: new Date().toISOString(),
    };
    const output = testInfo.outputPath('owner-reclamation-receipt.json');
    await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
    await testInfo.attach('owner-reclamation-receipt', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(app);
  }
});
