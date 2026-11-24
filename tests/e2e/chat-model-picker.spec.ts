import { closeElectronApp, expect, getStableWindow, test, installIpcMocks } from './fixtures/electron';

const alphaModelRef = 'custom-alpha123/model-alpha';
const betaModelRef = 'custom-beta5678/provider/model-beta';

test.describe('Verse Claw chat model picker', () => {
  test('selects an imported account model and preserves the previous choice on save failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        let currentModelRef = refs.alphaModelRef;
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
            modelDisplay: currentModelRef.split('/').slice(1).join('/'),
            modelRef: currentModelRef,
            overrideModelRef: currentModelRef,
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
              return makeResponse(request.id, { sessions: [{ key: 'agent:main:main', displayName: 'main', modelProvider: 'custom-beta5678', model: 'provider/model-beta' }] });
            }
            if (method === 'chat.history') {
              return makeResponse(request.id, { messages: [] });
            }
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'sessions' && request.action === 'patchRuntimeModel') {
            const fail = (globalThis as typeof globalThis & { __failModelReset?: boolean }).__failModelReset;
            return makeResponse(request.id, fail ? { success: false, error: 'Gateway disconnected during reset' } : { success: true });
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            currentModelRef = typeof body?.modelRef === 'string' ? body.modelRef : refs.alphaModelRef;
            hostRequests.push({
              path: '/api/agents/main/model',
              method: 'PUT',
              body: { modelRef: currentModelRef },
            });
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, [
              {
                id: 'alpha1234',
                vendorId: 'custom',
                label: 'Alpha',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1',
                model: 'model-alpha',
                enabled: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'custom-beta5678',
                vendorId: 'custom',
                label: 'Beta',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1',
                model: refs.betaModelRef,
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'custom-beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'alpha1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'custom-beta5678', hasKey: true, keyMasked: 'sk-***' },
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

        (globalThis as typeof globalThis & { __chatModelPickerRequests?: typeof hostRequests }).__chatModelPickerRequests = hostRequests;
      }, { alphaModelRef, betaModelRef });

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main', modelProvider: 'custom-beta5678', model: 'provider/model-beta' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('model-alpha');
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-model-picker-current').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-scope-selector')).toHaveCount(0);
      await expect(page.getByTestId('chat-model-options')).toBeVisible();
      await expect(page.getByTestId('chat-model-options')).toContainText('model-beta');
      await page.getByTestId('chat-model-options').getByRole('button', { name: 'provider/model-beta' }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('model-beta');

      const requests = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatModelPickerRequests?: Array<{ path: string; method: string; body: unknown }> }).__chatModelPickerRequests ?? []
      ));
      expect(requests).toContainEqual({
        path: 'sessions:patchRuntimeModel',
        method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: betaModelRef },
      });
      expect(requests.some((request) => request.path === '/api/agents/main/model')).toBe(false);
      expect(requests.some((request) =>
        request.path === '/api/gateway/restart'
        || request.path === '/api/gateway/start'
        || request.path === 'gateway:restart'
        || request.path === 'gateway:start'
        || request.path === 'gateway:config.patch'
      )).toBe(false);

      await app.evaluate(() => { (globalThis as typeof globalThis & { __failModelReset?: boolean }).__failModelReset = true; });
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-model-picker-current').click();
      await page.getByTestId('chat-model-options').getByRole('button', { name: 'model-alpha', exact: true }).click();
      await expect(page.getByText(/Gateway disconnected during reset/)).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('model-beta');
      await expect(page.getByTestId('chat-turn-model-chip')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
