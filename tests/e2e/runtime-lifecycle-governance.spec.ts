import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const SECOND_SESSION_KEY = 'agent:main:session-1700000000000';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

const TEST_WORKSPACE = {
  id: 'workspace-runtime-lifecycle',
  name: 'Runtime Lifecycle Workspace',
  rootPath: 'C:/project',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: MAIN_SESSION_KEY,
  agentBindings: {
    main: { workspaceId: 'workspace-runtime-lifecycle', agentId: 'main', sessionKey: MAIN_SESSION_KEY },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [MAIN_SESSION_KEY]: {},
    [SECOND_SESSION_KEY]: {},
  },
};

test.describe('runtime lifecycle governance', () => {
  test('delete success removes the session and conversation switch keeps the app usable', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'Main' },
                { key: SECOND_SESSION_KEY, displayName: 'Second' },
              ],
            },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'Main' },
                { key: SECOND_SESSION_KEY, displayName: 'Second' },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main', isDefault: true, modelDisplay: 'gpt-5', modelRef: 'openai/gpt-5', overrideModelRef: null, inheritedModel: true, workspace: 'C:/project', agentDir: 'C:/openclaw/agents/main/agent', mainSessionKey: MAIN_SESSION_KEY, channelTypes: [] }],
                defaultAgentId: 'main',
                configuredChannelTypes: [],
                channelOwners: {},
                channelAccountOwners: {},
              },
            },
          },
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['workspaces', 'list', null])]: {
            success: true,
            profiles: [TEST_WORKSPACE],
            activeWorkspaceId: TEST_WORKSPACE.id,
            activeWorkspace: TEST_WORKSPACE,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            success: true,
            activeWorkspaceId: TEST_WORKSPACE.id,
            activeWorkspace: TEST_WORKSPACE,
          },
          [stableStringify(['sessions', 'delete', { id: SECOND_SESSION_KEY }])]: { success: true },
        },
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      const secondRow = page.getByTestId(`sidebar-session-${SECOND_SESSION_KEY}`);
      await expect(secondRow).toBeVisible({ timeout: 30_000 });
      await secondRow.hover();
      await page.getByTestId(`sidebar-session-more-${SECOND_SESSION_KEY}`).click();
      await page.getByTestId('sidebar-session-context-delete').click();
      const confirmDialog = page.getByTestId('session-delete-dialog');
      await expect(confirmDialog).toBeVisible();
      await page.getByTestId('session-delete-dialog-permanent').click();
      await expect(secondRow).toHaveCount(0);

      const mainRow = page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`);
      await expect(mainRow).toBeVisible();
      await mainRow.click();
      await expect(page.getByTestId('main-layout')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('delete failure keeps the persisted operationId so a retry reuses it', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await getStableWindow(app);
      const result = await app.evaluate(async (_ctx, sessionKey) => {
        const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        const handler = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        if (!handler) throw new Error('host:invoke handler not registered');

        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('no Electron window');
        const sender = {
          id: window.webContents.id,
          isDestroyed: () => false,
          getURL: () => window.webContents.getURL(),
        };
        const event = { sender, senderFrame: { url: window.webContents.getURL() } };

        const request = (id: string) => ({
          id,
          module: 'sessions',
          action: 'delete',
          payload: { id: sessionKey },
        });
        const stopped = await handler(event, { id: 'stop-before-delete', module: 'gateway', action: 'stop', payload: null });
        if ((stopped as { ok?: boolean }).ok !== true) throw new Error('Could not stop the Gateway for the transport failure fixture');
        const first = await handler(event, request('delete-1'));
        const second = await handler(event, request('delete-2'));

        const { readFileSync } = process.mainModule!.require('node:fs') as typeof import('node:fs');
        const { join } = process.mainModule!.require('node:path') as typeof import('node:path');
        const { homedir } = process.mainModule!.require('node:os') as typeof import('node:os');
        const gatePath = join(
          process.env.OPENCLAW_CONFIG_DIR ?? join(homedir(), '.openclaw'),
          'runtime-lifecycle-governance',
          'session-delete-gates.json',
        );
        const gateFile = JSON.parse(readFileSync(gatePath, 'utf8')) as {
          gates: Record<string, { operationId: string; sessionKey: string }>;
        };

        return { first, second, gates: gateFile.gates };
      }, SECOND_SESSION_KEY);

      expect((result.first as { data?: { success?: boolean } }).data?.success).toBe(false);
      expect((result.second as { data?: { success?: boolean } }).data?.success).toBe(false);
      const gates = result.gates;
      expect(Object.keys(gates)).toHaveLength(1);
      const operationId = Object.values(gates)[0].operationId;
      expect(Object.values(gates)[0].sessionKey).toBe(SECOND_SESSION_KEY);
      expect(operationId).toBeTruthy();
      expect((result.first as { data?: { operationId?: string } }).data?.operationId).toBe(operationId);
      expect((result.second as { data?: { operationId?: string } }).data?.operationId).toBe(operationId);
      expect(String((result.second as { data?: { error?: unknown } }).data?.error)).toContain(
        'Gateway not connected',
      );
    } finally {
      await closeElectronApp(app);
    }
  });

  test('goal wake path records zero process.poll tool calls and duplicate wake has one tick', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await getStableWindow(app);
      const trace = await app.evaluate(async () => {
        const { spawnSync } = process.mainModule!.require("node:child_process") as typeof import("node:child_process");
        const env: NodeJS.ProcessEnv = { ...process.env };
        // The E2E gate must run without ELECTRON_RUN_AS_NODE shadowing the
        // spawned Node runtime.
        delete env.ELECTRON_RUN_AS_NODE;
        // Playwright exports FORCE_COLOR while NO_COLOR may also be present; the
        // spawned Node then prints "NO_COLOR ... is ignored" warnings on stderr.
        // Drop both so the stderr assertion below only reflects real failures.
        delete env.FORCE_COLOR;
        delete env.NO_COLOR;
        const command =
          process.platform === "win32"
            ? "pnpm --dir openclaw_runtime exec tsx scripts/goal-wake-e2e-trace.ts"
            : "pnpm --dir openclaw_runtime exec tsx scripts/goal-wake-e2e-trace.ts";
        const run = spawnSync(command, {
          cwd: process.cwd(),
          env,
          encoding: "utf8",
          shell: true,
          windowsHide: true,
          timeout: 120_000,
        });
        return {
          status: run.status,
          stdout: run.stdout,
          stderr: run.stderr,
          spawnError: run.error ? String(run.error) : null,
        };
      });

      expect(trace.spawnError ?? trace.stderr).toBeFalsy();
      expect(trace.status).toBe(0);
      const stdout = String(trace.stdout ?? "");
      const readAudit = (name: string): number | null => {
                const pattern = String.raw`\[runtime-lifecycle-audit\] ${name}=(\d+)`;
        const match = stdout.match(new RegExp(pattern));
        return match ? Number(match[1]) : null;
      };
      const processPollToolCalls = readAudit("processPollToolCalls");
      const duplicateWakeTickCount = readAudit("duplicateWakeTickCount");
      expect(processPollToolCalls).not.toBeNull();
      expect(duplicateWakeTickCount).not.toBeNull();
      console.log(`[runtime-lifecycle-audit] processPollToolCalls=${processPollToolCalls}`);
      expect(processPollToolCalls).toBe(0);
      expect(duplicateWakeTickCount).toBe(1);
      expect(stdout).toContain("flagOffGoalWaitBlocked=true");
      expect(stdout).toContain("flagOffBackgroundDefaultUnchanged=true");
    } finally {
      await closeElectronApp(app);
    }
  });
});
