import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-long-policy';
const READ_AT = 1_760_000_000_000;
const POLICY = JSON.parse(readFileSync(
  path.resolve('harness/specs/fixtures/long-session-development/b1/effective-session-policy.json'),
  'utf8',
)) as Record<string, unknown>;
const UI_POLICY = {
  ...POLICY,
  scope: { ...(POLICY.scope as Record<string, unknown>), workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY },
};
const PERSISTED_TURN = [{ role: 'user', id: 'policy-user-turn', content: [{ type: 'text', text: 'Show the session policy' }], timestamp: READ_AT }];
const WORKSPACE = {
  id: WORKSPACE_ID, name: 'Long Policy Workspace', rootPath: 'C:/workspace-long-policy', agentId: 'main', selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY, agentBindings: { main: { workspaceId: WORKSPACE_ID, agentId: 'main', sessionKey: SESSION_KEY } },
  permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {}, sessionStates: { [SESSION_KEY]: {} },
};
const CLEAN_REPOSITORY = { isRepository: true, workspaceRoot: WORKSPACE.rootPath, branch: 'main', ahead: 0, behind: 0, clean: true, hasConflicts: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, changes: [] };

function activitySnapshot() {
  return {
    session: { sessionKey: SESSION_KEY, runId: null, status: 'idle', startedAt: null, endedAt: null, error: null, updatedAt: 0 },
    /* Policy alone must remain reachable: this quiet session has no Git rows,
       tasks, workers, processes, goals or lineage to classify as activity. */
    git: null, tasks: [], subagents: [], terminals: [], goals: [], processes: [], lineage: [],
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true, policy: true },
    policy: UI_POLICY, backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null }, capturedAt: READ_AT,
  };
}

function hostApiMocks() {
  return {
    [stableStringify(['gateway', 'status', null])]: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    [stableStringify(['settings', 'getAll', null])]: { success: true, data: {} },
    [stableStringify(['workspaces', 'list', null])]: { success: true, profiles: [WORKSPACE], activeWorkspaceId: WORKSPACE_ID, activeWorkspace: WORKSPACE },
    [stableStringify(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: WORKSPACE_ID, activeWorkspace: WORKSPACE },
    [stableStringify(['/api/workspaces', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE_ID } } },
    [stableStringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: SESSION_KEY }], defaultAgentId: 'main', defaultModelRef: null },
    [stableStringify(['/api/agents', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } } },
    [stableStringify(['sessions', 'history', { sessionKey: SESSION_KEY, limit: 200 }])]: { messages: PERSISTED_TURN, hasMore: false },
    [stableStringify(['git', 'status', null])]: { success: true, status: CLEAN_REPOSITORY },
    [stableStringify(['sessionActivity', 'snapshot', null])]: { success: true, runtimeAvailable: true, snapshot: activitySnapshot() },
  };
}

function gatewayRpcMocks() {
  return {
    [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'Policy' }] } },
    [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'Policy' }] } },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500_000 }])]: { success: true, result: { messages: PERSISTED_TURN } },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: { success: true, result: { messages: PERSISTED_TURN } },
  };
}

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler({ sender, senderFrame: { url: sender.getURL() } }, { id: `policy-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
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

async function makeWritable(app: ElectronApplication): Promise<void> {
  const active = await hostInvoke<{ activeWorkspace?: { id?: string } }>(app, 'workspaces', 'getActive');
  if (active.activeWorkspace?.id) {
    await hostInvoke(app, 'workspaces', 'update', { id: active.activeWorkspace.id, permissionMode: 'fullAccess' });
  }
}

async function createSession(app: ElectronApplication, label: string): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create', params: { agentId: 'main', label }, timeoutMs: 60_000,
  });
  const key = typeof created.key === 'string' ? created.key : created.sessionKey;
  if (typeof key !== 'string') throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
  return key;
}

test.describe('long-session policy surface', () => {
  test.setTimeout(180_000);

  test('renders provenance, limits and action boundaries through a narrow Electron activity rail', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, { gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true }, gatewayRpc: gatewayRpcMocks(), hostApi: hostApiMocks() });
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 900, height: 760 });
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      const toggle = page.getByTestId('chat-session-activity-toggle');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('session-policy-summary')).toBeVisible();
      const policy = page.getByTestId('session-policy-summary');
      await expect(policy).toContainText('Session policy');
      await expect(policy).toContainText('openclaw-embedded');
      await expect(policy).toContainText('Source:');
      await expect(policy).toContainText('Abort stops only the current run');
      await expect(policy).toContainText('OpenClaw owns compaction');
      await expect(policy).toContainText('agents.defaults.compaction: Effective');
      await expect.poll(() => policy.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      const lifecycle = page.getByTestId('session-policy-lifecycle-help');
      await expect(lifecycle).toBeVisible();
      const summary = lifecycle.locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(lifecycle).not.toHaveAttribute('open');
      await page.keyboard.press('Enter');
      await expect(lifecycle).toHaveAttribute('open');

      /* Keyboard focus moves the rail's scroll position to the disclosure.
         Restore the top before the acceptance frame so the provenance header,
         backend row and limits are all visible together. */
      await policy.evaluate((element) => {
        let parent = element.parentElement;
        while (parent) {
          if (parent.scrollHeight > parent.clientHeight) {
            parent.scrollTop = 0;
            break;
          }
          parent = parent.parentElement;
        }
      });
      await page.screenshot({ path: testInfo.outputPath('policy-activity-rail-960.png'), animations: 'disabled' });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('real Host/Gateway policy reads stay scoped, refresh after permission and Gateway changes, and remain configuration-read-only', async ({ launchElectronApp, userDataDir }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await ensureGatewayReady(app);
      await makeWritable(app);
      const keyA = await createSession(app, `policy-a-${Date.now()}`);
      const keyB = await createSession(app, `policy-b-${Date.now()}`);
      const configPath = path.join(userDataDir, 'openclaw-source-state', 'openclaw.json');
      const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
      const a = await hostInvoke<{ success: boolean; policy?: Record<string, unknown> }>(app, 'sessions', 'effectivePolicy', { sessionKey: keyA });
      const b = await hostInvoke<{ success: boolean; policy?: Record<string, unknown> }>(app, 'sessions', 'effectivePolicy', { sessionKey: keyB });
      expect(a.success).toBe(true);
      expect(b.success).toBe(true);
      expect(a.policy?.scope).toMatchObject({ sessionKey: keyA });
      expect(b.policy?.scope).toMatchObject({ sessionKey: keyB });
      expect(a.policy?.scope).not.toMatchObject({ sessionKey: keyB });
      expect(a.policy?.generation).toMatchObject({ state: 'missing' });
      expect(a.policy?.backend).toMatchObject({ effective: { state: 'unknown' } });
      expect(a.policy?.limits).toMatchObject({ schedule: { state: 'unsupported' } });
      expect(JSON.stringify(a.policy)).not.toMatch(/apiKey|authProfileId|access_token|refresh_token/i);
      if (before != null) expect(readFileSync(configPath, 'utf8')).toBe(before);

      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      const permissionButton = page.getByTestId('chat-composer-permission-mode');
      await permissionButton.click();
      await page.getByTestId('chat-composer-permission-option-readOnly').focus();
      await page.keyboard.press('Enter');
      await expect(permissionButton).toContainText(/read.?only/i);

      /* Recovery reuses the exact policy projection and remains reachable for a
         quiet session whose empty Chat has no activity toggle. */
      await page.evaluate((sessionKey) => {
        window.location.hash = `#/settings/recovery?sessionKey=${encodeURIComponent(sessionKey)}`;
      }, keyA);
      await expect(page.getByTestId('recovery-settings-section')).toBeVisible({ timeout: 30_000 });
      const policy = page.getByTestId('session-policy-summary');
      await expect(policy).toBeVisible({ timeout: 30_000 });
      await expect(policy.getByTestId('session-policy-grant')).toContainText('readOnly');

      await hostInvoke(app, 'gateway', 'restart');
      await ensureGatewayReady(app);
      await expect(policy).toBeVisible({ timeout: 30_000 });
      await expect(policy.getByTestId('session-policy-unavailable')).toHaveCount(0);
      await expect(policy.getByTestId('session-policy-grant')).toContainText('readOnly');

      await page.evaluate(() => { window.location.hash = '#/'; });
      await expect(permissionButton).toContainText(/read.?only/i, { timeout: 30_000 });
      await permissionButton.click();
      await page.getByTestId('chat-composer-permission-option-fullAccess').focus();
      await page.keyboard.press('Enter');
      await expect(permissionButton).toContainText(/full access/i);
      await page.evaluate((sessionKey) => {
        window.location.hash = `#/settings/recovery?sessionKey=${encodeURIComponent(sessionKey)}`;
      }, keyA);
      await expect(policy.getByTestId('session-policy-grant')).toContainText('fullAccess', { timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
