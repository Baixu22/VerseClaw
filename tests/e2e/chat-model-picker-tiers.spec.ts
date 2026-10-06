import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const alphaModelRef = 'custom-alpha123/model-alpha';
const betaModelRef = 'custom-beta5678/provider/model-beta';

/**
 * Area 2 §8 E2E: three-tier model picker (turn / session / persistent).
 * Mocks `host:invoke` at the Main boundary so renderer-side `hostApi.chat.sendWithMedia`
 * and `hostApi.sessions.patchRuntimeModel` are captured without requiring a real Gateway.
 */
test.describe('Verse Claw chat model picker tiers (Area 2)', () => {
  test('turn scope: sets chip and forwards modelRef in send payload', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        const hostRequests: Array<{ path: string; method: string; body: unknown }> = [];
        const now = new Date().toISOString();
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        const agentsSnapshot = () => ({
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            isDefault: true,
            modelDisplay: 'model-alpha',
            modelRef: refs.alphaModelRef,
            overrideModelRef: refs.alphaModelRef,
            inheritedModel: false,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.alphaModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params ?? null });
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? null;
          hostRequests.push({
            path: `${request?.module ?? ''}:${request?.action ?? ''}`,
            method: 'HOST',
            body,
          });

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body?.method === 'string' ? body.method : '';
            const params = body?.params ?? null;
            hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params });
            if (method === 'sessions.list') {
              return makeResponse(request.id, { sessions: [{ key: 'agent:main:main', displayName: 'main' }] });
            }
            if (method === 'chat.history') {
              return makeResponse(request.id, { messages: [] });
            }
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            hostRequests.push({
              path: '/api/agents/main/model',
              method: 'PUT',
              body: { modelRef: body?.modelRef ?? null },
            });
            return makeResponse(request.id, agentsSnapshot());
          }
          // Area 2 §3.2: capture chat.sendWithMedia payload (renderer → Main entry).
          // The renderer calls hostApi.chat.sendWithMedia which routes here; we
          // intercept to capture the modelRef field without requiring a real Gateway.
          if (request?.module === 'chat' && request.action === 'sendWithMedia') {
            (globalThis as typeof globalThis & { __area2TurnSendParams?: unknown }).__area2TurnSendParams = body;
            return makeResponse(request.id, { success: true, result: { runId: 'run-turn-override' } });
          }
          // Area 2 §3.3: capture sessions.patchRuntimeModel payload.
          if (request?.module === 'sessions' && request.action === 'patchRuntimeModel') {
            (globalThis as typeof globalThis & { __area2SessionPatchParams?: unknown }).__area2SessionPatchParams = body;
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, [
              {
                id: 'alpha1234', vendorId: 'custom', label: 'Alpha', authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1', model: 'model-alpha', enabled: true, isDefault: true, createdAt: now, updatedAt: now,
              },
              {
                id: 'beta5678', vendorId: 'custom', label: 'Beta', authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1', model: refs.betaModelRef, enabled: true, isDefault: false, createdAt: now, updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'alpha1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'beta5678', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'alpha1234' });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & { __chatModelPickerTiersRequests?: typeof hostRequests }).__chatModelPickerTiersRequests = hostRequests;
      }, { alphaModelRef, betaModelRef });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      // Open the model picker
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();

      // Switch to "This message" scope (turn tier)
      await page.getByTestId('chat-model-scope-turn').click();

      // Select the beta model
      await page.getByTestId('chat-model-picker-menu').getByRole('button', { name: 'provider/model-beta' }).click();

      // Verify the turn chip appears
      await expect(page.getByTestId('chat-turn-model-chip')).toBeVisible();
      await expect(page.getByTestId('chat-turn-model-chip')).toContainText('model-beta');

      // Type and send
      await page.getByTestId('chat-composer-input').fill('Turn override message');
      await page.getByTestId('chat-composer-send').click();

      // Verify the send payload contains modelRef
      const sendParams = await app.evaluate(() =>
        (globalThis as typeof globalThis & { __area2TurnSendParams?: unknown }).__area2TurnSendParams
      );
      expect(sendParams).toMatchObject({
        message: 'Turn override message',
        modelRef: betaModelRef,
      });

      // Verify the chip is cleared after send
      await expect(page.getByTestId('chat-turn-model-chip')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('session scope: calls sessions.patchRuntimeModel with modelRef', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        const hostRequests: Array<{ path: string; method: string; body: unknown }> = [];
        const now = new Date().toISOString();
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        const agentsSnapshot = () => ({
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            isDefault: true,
            modelDisplay: 'model-alpha',
            modelRef: refs.alphaModelRef,
            overrideModelRef: refs.alphaModelRef,
            inheritedModel: false,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.alphaModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params ?? null });
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main', modelProvider: 'custom-beta5678', model: 'provider/model-beta', modelRefOverride: refs.betaModelRef }] } };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? null;
          hostRequests.push({
            path: `${request?.module ?? ''}:${request?.action ?? ''}`,
            method: 'HOST',
            body,
          });

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body?.method === 'string' ? body.method : '';
            const params = body?.params ?? null;
            hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params });
            if (method === 'sessions.list') {
              return makeResponse(request.id, { sessions: [{ key: 'agent:main:main', displayName: 'main', modelProvider: 'custom-beta5678', model: 'provider/model-beta', modelRefOverride: refs.betaModelRef }] });
            }
            if (method === 'chat.history') {
              return makeResponse(request.id, { messages: [] });
            }
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            hostRequests.push({
              path: '/api/agents/main/model',
              method: 'PUT',
              body: { modelRef: body?.modelRef ?? null },
            });
            return makeResponse(request.id, agentsSnapshot());
          }
          // Area 2 §3.2: capture chat.sendWithMedia payload.
          if (request?.module === 'chat' && request.action === 'sendWithMedia') {
            (globalThis as typeof globalThis & { __area2TurnSendParams?: unknown }).__area2TurnSendParams = body;
            return makeResponse(request.id, { success: true, result: { runId: 'run-turn-override' } });
          }
          // Area 2 §3.3: capture sessions.patchRuntimeModel payload.
          if (request?.module === 'sessions' && request.action === 'patchRuntimeModel') {
            (globalThis as typeof globalThis & { __area2SessionPatchParams?: unknown }).__area2SessionPatchParams = body;
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, [
              {
                id: 'alpha1234', vendorId: 'custom', label: 'Alpha', authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1', model: 'model-alpha', enabled: true, isDefault: true, createdAt: now, updatedAt: now,
              },
              {
                id: 'beta5678', vendorId: 'custom', label: 'Beta', authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1', model: refs.betaModelRef, enabled: true, isDefault: false, createdAt: now, updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'alpha1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'beta5678', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'alpha1234' });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & { __chatModelPickerTiersRequests?: typeof hostRequests }).__chatModelPickerTiersRequests = hostRequests;
      }, { alphaModelRef, betaModelRef });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      await expect(page.getByTestId('chat-model-picker-button')).toContainText('provider/model-beta');
      // Re-selecting the existing persistent default must settle optimistic state.
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-model-scope-persistent').click();
      await page.getByTestId('chat-model-options').getByRole('button', { name: 'model-alpha', exact: true }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('model-alpha');

      // Open the model picker
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();

      // Switch to "This session" scope
      await page.getByTestId('chat-model-scope-session').click();

      // Select the beta model
      await page.getByTestId('chat-model-picker-menu').getByRole('button', { name: 'provider/model-beta' }).click();

      await expect(page.getByTestId('chat-model-picker-button')).toContainText('provider/model-beta');

      // Verify sessions.patchRuntimeModel was called with the model override
      const patchParams = await app.evaluate(() =>
        (globalThis as typeof globalThis & { __area2SessionPatchParams?: unknown }).__area2SessionPatchParams
      );
      expect(patchParams).toMatchObject({
        sessionKey: 'agent:main:main',
        modelRef: betaModelRef,
      });

      // Verify no additional persistent model update was written (session tier must not
      // touch Agent.modelRef — Area 2 §3.3).
      const requests = await app.evaluate(() =>
        (globalThis as typeof globalThis & { __chatModelPickerTiersRequests?: Array<{ path: string; method: string; body: unknown }> }).__chatModelPickerTiersRequests ?? []
      );
      expect(requests.filter((r) => r.path === '/api/agents/main/model')).toHaveLength(1);

      // Promoting the same currently selected session model still changes scope.
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-model-scope-persistent').click();
      await page.getByTestId('chat-model-options').getByRole('button', { name: 'provider/model-beta' }).click();
      await expect.poll(() => app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatModelPickerTiersRequests?: Array<{ path: string }> }).__chatModelPickerTiersRequests ?? []
      ).filter((request) => request.path === '/api/agents/main/model').length)).toBe(2);
      await expect.poll(() => app.evaluate(() => (
        (globalThis as typeof globalThis & { __area2SessionPatchParams?: unknown }).__area2SessionPatchParams
      ))).toMatchObject({ sessionKey: 'agent:main:main', modelRef: null });
    } finally {
      await closeElectronApp(app);
    }
  });
});
