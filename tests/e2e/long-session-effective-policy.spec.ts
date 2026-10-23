import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type CreatedSession = { key?: string; sessionKey?: string };
type ActivityResult = {
  success: boolean;
  snapshot?: {
    policy?: {
      schemaVersion?: string;
      generation?: { state?: string; reason?: string | null };
      backend?: {
        configured?: { status?: string; value?: { runtime?: string; provider?: string; model?: string } };
        effective?: { status?: string; value?: unknown };
      };
      model?: { configured?: { value?: { effort?: string | null } } };
      compatibility?: Array<{ parameter?: string; status?: string; reason?: string | null }>;
    };
  };
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
    return await handler(event, { id: `policy-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'host invoke failed'}`);
  }
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let started = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!started && status.state !== 'starting') {
      started = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready for session policy E2E');
}

async function makeActiveWorkspaceWritable(app: ElectronApplication): Promise<string> {
  const active = await hostInvoke<{ activeWorkspace?: { id?: string }; id?: string }>(
    app,
    'workspaces',
    'getActive',
  );
  const workspaceId = active.activeWorkspace?.id ?? active.id;
  if (!workspaceId) return 'unknown';
  await hostInvoke(app, 'workspaces', 'update', {
    id: workspaceId,
    permissionMode: 'fullAccess',
  });
  return workspaceId;
}

test('real Host and Gateway expose a secret-free configured policy without inventing effective facts', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await ensureGatewayReady(app);
    const workspaceId = await makeActiveWorkspaceWritable(app);
    const created = await hostInvoke<CreatedSession>(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: {
        agentId: 'main',
        label: `effective-policy-${Date.now()}`,
      },
      timeoutMs: 60_000,
    });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);

    const activity = await hostInvoke<ActivityResult>(app, 'sessionActivity', 'snapshot', {
      workspaceId,
      sessionKey,
    });
    expect(activity.success).toBe(true);
    const policy = activity.snapshot?.policy;
    expect(policy).toBeTruthy();
    expect(policy?.schemaVersion).toBe('SessionEffectivePolicy/v1');
    expect(policy?.generation?.state).toBe('missing');
    expect(policy?.generation?.reason).toBe('no-current-run-capability-profile');
    expect(policy?.backend?.configured?.status).toBe('configured');
    expect(policy?.backend?.configured?.value?.provider).toBeTruthy();
    expect(policy?.backend?.configured?.value?.model).toBeTruthy();
    expect(policy?.model?.configured?.value?.effort).toBeTruthy();
    expect(policy?.backend?.effective?.status).toBe('unverified');
    expect(policy?.backend?.effective?.value).toBeNull();
    expect(policy?.compatibility?.some((row) => row.parameter === 'automatic-compaction')).toBe(true);

    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain('PRIVATE-PROMPT-MUST-NOT-LEAK');
    expect(serialized).not.toMatch(/auth(?:orization|Profile)?["']?\s*[:=]\s*["']?(?:bearer|sk-)/iu);

    const receipt = {
      schema: 'clawx.long-session.effective-policy/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      sessionKey,
      workspaceId,
      generationState: policy?.generation?.state,
      configuredBackend: policy?.backend?.configured?.value,
      effectiveBackend: policy?.backend?.effective,
      compatibilityRows: policy?.compatibility,
      transport: 'built Electron host:invoke sessionActivity.snapshot -> actual Gateway session.activitySnapshot',
    };
    const output = testInfo.outputPath('effective-session-policy.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
    await testInfo.attach('effective-session-policy', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(app);
  }
});
