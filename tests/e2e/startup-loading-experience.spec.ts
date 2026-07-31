import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('startup and route loading experience', () => {
  test('shows the branded boot shell until the React shell is ready', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, bootHoldMs: 3_000 });

    try {
      const page = await getStableWindow(app);
      const bootShell = page.getByTestId('boot-shell');

      await expect(bootShell).toBeVisible();
      await expect(bootShell).toHaveAttribute('aria-hidden', 'true');
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(bootShell).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('disables boot-shell looping animation when reduced motion is requested', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, bootHoldMs: 3_000 });

    try {
      const page = await getStableWindow(app);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();

      const bootShell = page.getByTestId('boot-shell');
      await expect(bootShell).toBeVisible();
      const animatedDescendants = await bootShell.evaluate((shell) => {
        return [shell, ...Array.from(shell.querySelectorAll('*'))]
          .filter((element) => getComputedStyle(element).animationName !== 'none')
          .map((element) => ({
            tag: element.tagName,
            animationName: getComputedStyle(element).animationName,
          }));
      });

      expect(animatedDescendants).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the Settings shell stable while a lazy section loads', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      skipSetup: true,
      settingsSectionDelayMs: 1_200,
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-implementation')).toBeVisible();
      await page.getByTestId('settings-nav-storage').click();

      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-back-button')).toBeVisible();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const transitionContent = page.locator('[data-testid="settings-section-loading"], [data-testid="settings-implementation"]');
      await expect(transitionContent.first()).toBeVisible();

      await expect(page.getByTestId('storage-info-ram')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('settings-section-loading')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows a Chat skeleton and never the welcome state before empty history is confirmed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          gatewayReady: true,
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        },
        gatewayRpc: {},
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
        },
      });

      await app.evaluate(async ({ app: _app }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
            };
          }
          if (method === 'chat.history') {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      await page.reload();

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const skeleton = page.getByTestId('chat-startup-skeleton');
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByTestId('chat-welcome-suggestions')).toHaveCount(0);

      await expect(page.getByTestId('chat-welcome-suggestions')).toBeVisible({ timeout: 10_000 });
      await expect(skeleton).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});


test('keeps a gateway-startup connection failure inside the Chat skeleton', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: {
        state: 'starting',
        gatewayReady: false,
        port: 18789,
        pid: 12345,
      },
    });

    const page = await getStableWindow(app);
    await page.reload();

    await expect(page.getByTestId('chat-startup-skeleton')).toBeVisible();
    await expect(page.getByTestId('chat-startup-skeleton')).toHaveAttribute('data-startup-phase', 'waiting-for-gateway');
    await expect(page.getByTestId('chat-error')).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});


test('keeps the loading skeleton centered when an active workspace has no rail content', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const sessionKey = 'agent:main:main';
  const workspace = {
    id: 'startup-workspace',
    name: 'Startup workspace',
    rootPath: '/tmp/startup-workspace',
    agentId: 'main',
    activeSessionKey: sessionKey,
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: { [sessionKey]: {} },
  };

  try {
    await installIpcMocks(app, {
      gatewayStatus: {
        state: 'running',
        gatewayReady: true,
        port: 18789,
        pid: 12345,
        connectedAt: Date.now(),
      },
      gatewayRpc: {},
      hostApi: {
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, agents: [{ id: 'main', name: 'main', workspace: workspace.rootPath }] },
          },
        },
        [stableStringify(['workspaces', 'list', null])]: {
          success: true,
          profiles: [workspace],
          activeWorkspaceId: workspace.id,
          activeWorkspace: workspace,
        },
      },
    });

    await app.evaluate(async () => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      ipcMain.removeHandler('gateway:rpc');
      ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
        if (method === 'sessions.list') {
          return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
        }
        if (method === 'chat.history') {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          return { success: true, result: { messages: [] } };
        }
        return { success: true, result: {} };
      });
    });

    const page = await getStableWindow(app);
    await page.reload();

    await expect(page.getByTestId('chat-startup-skeleton')).toBeVisible();
    await expect(page.getByTestId('chat-assistive-rail')).toHaveCount(0);
    await expect(page.getByTestId('chat-message-layout')).not.toHaveClass('xl:flex-row');
  } finally {
    await closeElectronApp(app);
  }
});
