// Agent-driven verification of the Main host supply -> assembler -> visible activity pipeline.
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { createEmptySessionActivitySnapshot } from '../../shared/types/session-activity';

const sessionKey = 'agent:main:main';
const workspaceId = 'trajectory-audit-workspace';
const workspace = { id: workspaceId, name: 'Trajectory audit', rootPath: 'D:/tmp/trajectory-audit',
  agentId: 'main', selectedAgentId: 'main', activeSessionKey: sessionKey,
  agentBindings: { main: { workspaceId, agentId: 'main', sessionKey } }, permissionMode: 'acceptEdits',
  createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {}, sessionStates: { [sessionKey]: {} } };
const message = { role: 'user', id: 'trajectory-turn', content: [{ type: 'text', text: 'Observe trajectory lifecycle' }], timestamp: 1760000000 };
const start = { traceSchema: 'openclaw-trajectory', schemaVersion: 2, traceId: 'trajectory-audit', source: 'runtime',
  type: 'run/start', role: 'run', phase: 'start', runId: 'trajectory-audit-run', seq: 1,
  ts: '2026-11-07T00:00:00.000Z', state: { status: 'running' } };

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
}

test('raw v2 lifecycle drives visible errors while delayed legacy events cannot restore them', async ({ launchElectronApp }, info) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const history = (fromSeq: number) => ({ sessionKey, schemaVersion: 2, fromSeq, events: fromSeq === 0 ? [start] : [],
      asOfSeq: fromSeq === 0 ? 1 : fromSeq, hasMore: false, legacyFallback: false, rejected: 0 });
    const snapshot = createEmptySessionActivitySnapshot(sessionKey);
    snapshot.backgroundRead = { state: 'known', readAt: 1760000000000, failedAt: null };
    snapshot.availability.git = true;
    snapshot.availability.terminals = true;
    snapshot.processes = [{ id: 'background-process', kind: 'bash', label: 'Background process', status: 'running', updatedAt: 1760000000000 }];
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stable(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: sessionKey, displayName: 'Trajectory audit' }] } },
        [stable(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: { success: true, result: { sessions: [{ key: sessionKey, displayName: 'Trajectory audit' }] } },
        [stable(['chat.history', { sessionKey, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: [message] } },
        [stable(['chat.history', { sessionKey, limit: 200 }])]: { success: true, result: { messages: [message] } },
      },
      hostApi: {
        [stable(['settings', 'getAll', null])]: { success: true, data: {} },
        [stable(['workspaces', 'list', null])]: { success: true, profiles: [workspace], activeWorkspaceId: workspaceId, activeWorkspace: workspace },
        [stable(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: workspaceId, activeWorkspace: workspace },
        [stable(['/api/workspaces', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, workspaces: [workspace], activeWorkspaceId: workspaceId } } },
        [stable(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: sessionKey }], defaultAgentId: 'main', defaultModelRef: null },
        [stable(['sessions', 'history', { sessionKey, limit: 200 }])]: { messages: [message], hasMore: false },
        [stable(['sessionActivity', 'snapshot', null])]: { success: true, snapshot, runtimeAvailable: true },
        [stable(['git', 'status', null])]: { success: false },
        ...Object.fromEntries([0, 1, 2].map((fromSeq) => [stable(['observability', 'trajectoryHistory', { sessionKey, fromSeq, limit: 200 }]), history(fromSeq)])),
      },
    });
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Observe trajectory lifecycle')).toBeVisible({ timeout: 30000 });
    const toggle = page.getByTestId('chat-session-activity-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as {
      __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }>;
    }).__verseClawE2eHostCalls?.filter((call) => call.module === 'observability' && call.action === 'trajectoryHistory').length ?? 0)).toBeGreaterThan(0);
    await expect(page.getByTestId('session-activity-panel')).toBeVisible();
    await expect(page.getByTestId('session-activity-alert')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('trajectory-running.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }, payload) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('observability:trajectory-event', payload);
    }, { sessionKey, schemaVersion: 2, events: [{ ...start, type: 'run/end', phase: 'end', seq: 2,
      ts: '2026-11-07T00:00:02.000Z', state: { status: 'error', terminalError: 'Trajectory verification failed' } }] });
    await expect(page.getByTestId('session-activity-alert')).toContainText('Trajectory verification failed');
    await page.screenshot({ path: info.outputPath('trajectory-failed.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }, payload) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('observability:trajectory-event', payload);
    }, { sessionKey, schemaVersion: 2, events: [{ ...start, runId: 'next-trajectory-run', seq: 3,
      ts: '2026-11-07T00:00:03.000Z' }, { ...start, runId: 'next-trajectory-run', seq: 4, type: 'run/end', phase: 'end',
      ts: '2026-11-07T00:00:04.000Z', state: { status: 'success' } }] });
    await expect(page.getByTestId('session-activity-alert')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, payload) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:runtime-event', payload);
    }, { type: 'run.ended', status: 'error', error: 'Stale runtime failure', sessionKey, runId: start.runId, seq: 2, ts: Date.parse(start.ts) });
    await expect(page.getByTestId('session-activity-alert')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('trajectory-completed.png'), animations: 'disabled' });
  } finally { await closeElectronApp(app); }
});
