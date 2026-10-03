import { expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

const APPROVAL_ID = 'approval-e2e-1';

const requestedFrame = {
  approvalId: APPROVAL_ID,
  command: 'node --test',
  commandPreview: null,
  cwd: 'C:/workspace',
  host: 'gateway',
  agentId: 'main',
  sessionKey: 'agent:main:main',
  allowedDecisions: ['allow-once', 'deny'],
  createdAtMs: 1,
  expiresAtMs: 2,
};

test.describe('Runtime approval bridge', () => {
  test('answers a pending runtime approval from the app-level prompt', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
          [stableStringify(['runtimeApprovals', 'resolve', {
            approvalId: APPROVAL_ID,
            decision: 'allow-once',
          }])]: { success: true, approvalId: APPROVAL_ID, decision: 'allow-once' },
        },
      });

      const page = await getStableWindow(app);

      // The prompt only exists once the renderer has mounted and subscribed.
      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Send the exact frame the production main process forwards when the Gateway
      // broadcasts exec.approval.requested.
      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, requestedFrame);

      const prompt = page.getByTestId('runtime-approval-prompt');
      await expect(prompt).toBeVisible();
      await expect(prompt).toContainText('node --test');
      await expect(prompt).toContainText('C:/workspace');

      await page.getByTestId('runtime-approval-allow-once').click();

      // The prompt clears only after the host accepted the decision.
      await expect(page.getByTestId('runtime-approval-prompt')).toHaveCount(0);

      const calls = await app.evaluate(
        () => (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? [],
      );
      expect(calls).toContainEqual({
        module: 'runtimeApprovals',
        action: 'resolve',
        payload: { approvalId: APPROVAL_ID, decision: 'allow-once' },
      });
    } finally {
      await app.close();
    }
  });

  test('offers only the decisions the runtime listed for the request', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
        },
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, { ...requestedFrame, approvalId: 'approval-e2e-deny-only', allowedDecisions: ['deny'] });

      await expect(page.getByTestId('runtime-approval-deny')).toBeVisible();
      await expect(page.getByTestId('runtime-approval-allow-once')).toHaveCount(0);
      await expect(page.getByTestId('runtime-approval-allow-always')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
