import type { ElectronApplication } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    const before = sessionsBeforeCreate.sessions?.find((session) => session.key === createdKey) ??
      (await listSessions(app)).sessions?.find((session) => session.key === createdKey);
    expect(before?.sessionId).toBeTruthy();
    const sentinel = `agent-driven-history-${createdKey}`;
    await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.inject', params: { sessionKey: createdKey, agentId: 'main', message: sentinel, label: 'agent fixture' }, timeoutMs: 30_000 });
    const historyBefore = await hostInvoke(app, 'sessions', 'history', { sessionKey: createdKey });
    expect(JSON.stringify(historyBefore)).toContain(sentinel);

    const archived = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'archive', {
      id: createdKey,
      originalWorkspaceId: 'workspace-e2e',
    });
    expect(archived.success, archived.error).toBe(true);

    const archivedIndex = await hostInvoke<ArchiveListResult>(app, 'sessions', 'listArchived', {
      agentId: 'main',
    });
    expect(archivedIndex.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionKey: createdKey,
        originalWorkspaceId: 'workspace-e2e',
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
