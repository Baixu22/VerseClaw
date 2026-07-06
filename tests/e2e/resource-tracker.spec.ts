import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-resource-tracker';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workspace = {
  id: WORKSPACE_ID,
  name: 'Resource Workspace',
  rootPath: '/workspace/resource-tracker',
  permissionMode: 'acceptEdits',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

async function hostCalls(app: Parameters<typeof closeElectronApp>[0]) {
  return await app.evaluate(() => (
    (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? []
  ));
}

test.describe('Session resource tracker', () => {
  test('shows tracked resources and sends manual stop requests', async ({ launchElectronApp }) => {
    const now = new Date().toISOString();
    const resources = [
      {
        id: 'res-1',
        port: 54321,
        label: 'Vite dev server',
        pid: 4242,
        command: 'pnpm dev',
        sessionKey: SESSION_KEY,
        sessionLabel: 'main',
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        status: 'healthy',
        startedAt: now,
        lastHeartbeatAt: now,
        sessionLastActiveAt: now,
      },
      {
        id: 'res-2',
        port: 54322,
        label: 'Preview server',
        pid: 4243,
        sessionKey: SESSION_KEY,
        sessionLabel: 'main',
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        status: 'idle',
        startedAt: now,
        lastHeartbeatAt: now,
        sessionLastActiveAt: now,
      },
    ];

    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/resource-tracker',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['resourceTracker', 'list', null])]: {
            success: true,
            resources,
            healthyCount: 1,
            idleCount: 1,
            unreachableCount: 0,
            idleTimeoutMinutes: 10,
          },
          [stableStringify(['resourceTracker', 'stop', { resourceId: 'res-1' }])]: {
            success: true,
            resourceId: 'res-1',
          },
          [stableStringify(['resourceTracker', 'stopAll', null])]: {
            success: true,
            stoppedCount: 2,
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await page.setViewportSize({ width: 1280, height: 820 });
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
          }
          [data-sonner-toaster] {
            display: none !important;
          }
        `,
      });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('resource-chip')).toBeVisible();
      await expect(page.getByTestId('resource-chip')).toContainText('2');
      const chipBox = await page.getByTestId('resource-chip').boundingBox();
      expect(chipBox).not.toBeNull();
      expect(chipBox!.height).toBeLessThanOrEqual(34);
      expect(chipBox!.width).toBeLessThanOrEqual(64);

      await page.getByTestId('resource-chip').click();
      const popover = page.getByTestId('resource-popover');
      await expect(popover).toBeVisible();
      const popoverBox = await popover.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox!.width).toBeLessThanOrEqual(300);
      expect(popoverBox!.height).toBeLessThanOrEqual(220);
      await expect(popover).toContainText('Running Resources');
      await expect(popover).toContainText('Vite dev server');
      await expect(popover).toContainText(':54321');
      await expect(popover).toContainText('pid 4242');
      await expect(popover).toContainText('Preview server');
      await expect(popover).toContainText('idle');

      await page.getByTestId('resource-row-res-1').hover();
      await page.getByTestId('resource-row-stop-res-1').click();
      await expect.poll(async () => {
        const calls = await hostCalls(app);
        return calls.some((call) => {
          const record = call as { module?: string; action?: string; payload?: { resourceId?: string } };
          return record.module === 'resourceTracker'
            && record.action === 'stop'
            && record.payload?.resourceId === 'res-1';
        });
      }).toBe(true);

      await page.getByTestId('resource-popover-stop-all').click();
      await expect.poll(async () => {
        const calls = await hostCalls(app);
        return calls.some((call) => {
          const record = call as { module?: string; action?: string };
          return record.module === 'resourceTracker' && record.action === 'stopAll';
        });
      }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
