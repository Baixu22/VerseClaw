import type { ElectronApplication } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string; rootPath: string; selectedAgentId?: string; activeSessionKey?: string };
type CronJobShape = {
  id: string;
  name: string;
  enabled: boolean;
  coordinator?: { coordinatorSessionKey: string; expectedSessionId: string } | null;
  coordinatorStatus?: { state: string; reason: string; observedSessionId?: string | null };
  coordinatorSuppressed?: boolean;
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
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: 'e1-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? ('host invoke failed: ' + module + '.' + action));
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let startRequested = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!startRequested && status.state !== 'starting') {
      startRequested = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready');
}

async function createSession(app: ElectronApplication, label: string): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label },
    timeoutMs: 60_000,
  });
  const candidates = [created, created.result, created.payload, created.data].filter(
    (value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'),
  );
  const key = candidates.flatMap((value) => [value.key, value.sessionKey]).find((value) => typeof value === 'string');
  if (typeof key !== 'string') throw new Error('sessions.create returned no key: ' + JSON.stringify(created));
  return key;
}

async function liveSessionId(app: ElectronApplication, sessionKey: string): Promise<string | null> {
  const listed = await hostInvoke<{ sessions?: Array<Record<string, unknown>> }>(app, 'gateway', 'rpc', {
    method: 'sessions.list',
    params: { agentId: 'main' },
    timeoutMs: 30_000,
  });
  const entry = (listed.sessions ?? []).find((session) => session.key === sessionKey || session.sessionKey === sessionKey);
  const id = entry && (typeof entry.sessionId === 'string' ? entry.sessionId : typeof entry.id === 'string' ? entry.id : '');
  return id || null;
}

/**
 * The forced run is enqueued, so the fence verdict lands in the run log rather
 * than in the trigger response. Poll the real scheduler receipts.
 */
async function waitForCoordinatorRefusal(app: ElectronApplication, jobId: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const result = await hostInvoke<Array<Record<string, unknown>> | { runs?: Array<Record<string, unknown>> }>(
      app,
      'gateway',
      'rpc',
      { method: 'cron.runs', params: { scope: 'job', id: jobId, jobId, limit: 5 }, timeoutMs: 20_000 },
    );
    const runs = Array.isArray(result) ? result : (result.runs ?? []);
    last = JSON.stringify(runs);
    if (last.includes('coordinator-scope-')) return last;
    const stateProbe = (await listJobs(app)).find((job) => job.id === jobId) as
      | (CronJobShape & { lastRun?: { success?: boolean; error?: string } })
      | undefined;
    last = last + '|state:' + JSON.stringify(stateProbe?.lastRun ?? null);
    if (last.includes('coordinator-scope-')) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('coordinator fence refusal was not observed in the scheduler run log: ' + last.slice(0, 400));
}

async function listJobs(app: ElectronApplication): Promise<CronJobShape[]> {
  const jobs = await hostInvoke<CronJobShape[] | { jobs?: CronJobShape[] }>(app, 'cron', 'list');
  return Array.isArray(jobs) ? jobs : (jobs.jobs ?? []);
}
test('real Host/Gateway long-session follow-up is bound to one coordinator generation and cannot fire after it is invalidated', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  let app: ElectronApplication | undefined;
  const observation: Record<string, unknown> = {
    schema: 'clawx.long-session.e1-followup-journey/v1',
    driven_by: 'agent',
    actor: 'codex-long-session-e1',
    steps: [] as Array<Record<string, unknown>>,
    negatives: [] as string[],
  };
  try {
    app = await launchElectronApp({ skipSetup: true });
    await ensureGatewayReady(app);
    const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
    const workspace = active.activeWorkspace;
    if (!workspace) throw new Error('No active workspace');
    const token = Date.now().toString(36);
    await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, permissionMode: 'fullAccess' });
    const coordinatorSessionKey = await createSession(app, 'E1 coordinator ' + token);
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspace.id,
      agentId: 'main',
      activeSessionKey: coordinatorSessionKey,
      sessionKey: coordinatorSessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string }> } }>(app, 'taskLedger', 'createNode', {
      workspaceId: workspace.id,
      node: {
        title: 'E1 follow-up task ' + token,
        kind: 'task',
        status: 'doing',
        owner: 'agent',
        metadata: { nextAction: 'Await the authorized follow-up.' },
      },
    });
    const taskNodeId = ledger.snapshot.nodes.find((node) => node.title === 'E1 follow-up task ' + token)?.id;
    if (!taskNodeId) throw new Error('Task Ledger node missing');
    await hostInvoke(app, 'sessions', 'bindCoordinator', {
      workspaceId: workspace.id,
      agentId: 'main',
      sessionKey: coordinatorSessionKey,
      expectedRevision: 0,
      taskRefs: [{ kind: 'task-ledger', nodeId: taskNodeId }],
    });

    const expectedSessionId = await liveSessionId(app, coordinatorSessionKey);
    expect(expectedSessionId).toBeTruthy();
    if (!expectedSessionId) throw new Error('coordinator session has no physical id');

    const created = await hostInvoke<CronJobShape>(app, 'cron', 'create', {
      name: 'E1 follow-up ' + token,
      message: 'Report the follow-up status only from receipts.',
      schedule: '0 3 * * *',
      enabled: true,
      agentId: 'main',
      coordinator: {
        schemaVersion: 'CronCoordinatorScope/v1',
        workspaceId: workspace.id,
        coordinatorSessionKey,
        expectedSessionId,
        taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
        intent: 'follow-up',
        expiresAtMs: Date.now() + 60 * 60 * 1000,
        notificationPolicy: 'silent-unless-result',
      },
    });
    expect(created.id).toBeTruthy();
    const jobId = created.id;

    const boundJobs = await listJobs(app);
    const boundJob = boundJobs.find((job) => job.id === jobId);
    expect(boundJob).toBeTruthy();
    expect(boundJob?.enabled).toBe(true);
    expect(boundJob?.coordinator?.coordinatorSessionKey).toBe(coordinatorSessionKey);
    expect(boundJob?.coordinatorStatus?.state).toBe('allowed');
    (observation.steps as Array<Record<string, unknown>>).push({
      step: 'bound-follow-up-created',
      jobId,
      state: boundJob?.coordinatorStatus?.state,
      expectedSessionId,
    });

    // NOTE: the job is deliberately *not* force-run while the binding is
    // current — a real agent turn would occupy the scheduler slot and mask the
    // fence verdict with "already-running". The fence itself is exercised on
    // the post-invalidation trigger below, where it must refuse the run.

    await hostInvoke(app, 'sessions', 'delete', { id: coordinatorSessionKey });
    const afterDelete = await listJobs(app);
    const staleJob = afterDelete.find((job) => job.id === jobId);
    expect(staleJob).toBeTruthy();
    expect(staleJob?.coordinatorStatus?.state).not.toBe('allowed');
    expect(staleJob?.enabled).toBe(true);
    (observation.negatives as string[]).push(
      'deleted coordinator session -> binding invalidated -> cron fence state ' + String(staleJob?.coordinatorStatus?.state),
    );

    await hostInvoke<Record<string, unknown>>(app, 'cron', 'trigger', { id: jobId });
    const refusedText = await waitForCoordinatorRefusal(app, jobId);
    expect(refusedText).toContain('coordinator-scope-');
    (observation.steps as Array<Record<string, unknown>>).push({
      step: 'trigger-after-invalidation',
      refusedWith: refusedText.slice(0, 400),
    });

    await hostInvoke(app, 'cron', 'toggle', { id: jobId, enabled: false });
    const paused = (await listJobs(app)).find((job) => job.id === jobId);
    expect(paused).toBeTruthy();
    expect(paused?.enabled).toBe(false);
    (observation.steps as Array<Record<string, unknown>>).push({ step: 'pause-keeps-schedule', enabled: paused?.enabled });

    await hostInvoke(app, 'cron', 'delete', { id: jobId });
    const cancelled = (await listJobs(app)).find((job) => job.id === jobId);
    expect(cancelled).toBeUndefined();
    (observation.steps as Array<Record<string, unknown>>).push({ step: 'cancel-removes-schedule', removed: cancelled === undefined });

    observation.status = 'passed';
    observation.workspaceId = workspace.id;
    observation.coordinatorSessionKey = coordinatorSessionKey;
    observation.jobId = jobId;
    const observationPath = testInfo.outputPath('followup-journey-observation.json');
    await writeFile(observationPath, JSON.stringify(observation, null, 2) + '\n', 'utf8');
    observation.observationPath = observationPath;
    console.log(JSON.stringify(observation));
  } finally {
    if (app) await closeElectronApp(app);
  }
});