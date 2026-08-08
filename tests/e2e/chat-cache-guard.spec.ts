import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const alphaModelRef = 'anthropic/claude-sonnet';
const betaModelRef = 'anthropic/claude-opus';
const mainSessionKey = 'agent:main:main';

test.describe('Verse Claw chat prompt cache guard', () => {
  test('shows cache health and requires confirmation before switching models', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async (_electron, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        let currentModelRef = refs.alphaModelRef;
        const hostRequests: Array<{ path: string; body: unknown }> = [];
        const riskEvents: unknown[] = [];
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
            mainSessionKey: refs.mainSessionKey,
            channelTypes: [],
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.alphaModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345, gatewayReady: true }));

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? {};
          hostRequests.push({ path: `${request?.module ?? ''}:${request?.action ?? ''}`, body });

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body.method === 'string' ? body.method : '';
            if (method === 'sessions.list') {
              return makeResponse(request.id, { success: true, result: { sessions: [{ key: refs.mainSessionKey, displayName: 'main' }] } });
            }
            if (method === 'chat.history') {
              return makeResponse(request.id, { success: true, result: { messages: [] } });
            }
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            currentModelRef = typeof body.modelRef === 'string' ? body.modelRef : refs.alphaModelRef;
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            const now = new Date().toISOString();
            return makeResponse(request.id, [
              {
                id: 'anthropic-alpha',
                vendorId: 'anthropic',
                label: 'Anthropic',
                authMode: 'api_key',
                model: refs.alphaModelRef,
                enabled: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'anthropic-beta',
                vendorId: 'anthropic',
                label: 'Anthropic Alt',
                authMode: 'api_key',
                model: refs.betaModelRef,
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            const now = new Date().toISOString();
            return makeResponse(request.id, [
              { id: 'anthropic-alpha', type: 'anthropic', name: 'Anthropic', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'anthropic-beta', type: 'anthropic', name: 'Anthropic Alt', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'anthropic-alpha', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'anthropic-beta', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'anthropic-alpha' });
          }
          if (request?.module === 'usage' && request.action === 'live') {
            return makeResponse(request.id, {
              success: true,
              usage: {
                sessionKey: refs.mainSessionKey,
                inputTokens: 1000,
                outputTokens: 200,
                cacheReadTokens: 9000,
                cacheWriteTokens: 1000,
                totalTokens: 11_200,
                updatedAt: Date.now(),
                status: 'final',
              },
            });
          }
          if (request?.module === 'usage' && request.action === 'contextRange') {
            return makeResponse(request.id, {
              success: true,
              range: {
                sessionKey: refs.mainSessionKey,
                modelRef: currentModelRef,
                usedTokens: 11_200,
                maxTokens: 200_000,
                truncatedMessageCount: 0,
                status: 'bestEffort',
              },
            });
          }
          if (request?.module === 'usage' && request.action === 'promptCacheStatus') {
            const action = typeof body.action === 'string' ? body.action : undefined;
            return makeResponse(request.id, {
              success: true,
              assessment: {
                sessionKey: refs.mainSessionKey,
                ...(action ? { action } : {}),
                status: action ? 'at-risk' : 'warm',
                severity: action ? 'medium' : 'none',
                shouldWarn: Boolean(action),
                confidence: 'high',
                providerStrategy: 'anthropic',
                hitRate: 9000 / 11_000,
                promptTokens: 11_000,
                cacheReadTokens: 9000,
                cacheWriteTokens: 1000,
                costEstimateReliable: false,
                ...(action ? { reason: action } : {}),
                warningCount: riskEvents.length,
                cancelledBreakCount: riskEvents.filter((entry) => (entry as { decision?: string }).decision === 'cancelled').length,
                updatedAt: Date.now(),
              },
            });
          }
          if (request?.module === 'usage' && request.action === 'recordPromptCacheRiskEvent') {
            riskEvents.push(body);
            return makeResponse(request.id, { success: true, event: body });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & {
          __promptCacheGuardRequests?: typeof hostRequests;
          __promptCacheRiskEvents?: typeof riskEvents;
        }).__promptCacheGuardRequests = hostRequests;
        (globalThis as typeof globalThis & {
          __promptCacheGuardRequests?: typeof hostRequests;
          __promptCacheRiskEvents?: typeof riskEvents;
        }).__promptCacheRiskEvents = riskEvents;
      }, { alphaModelRef, betaModelRef, mainSessionKey });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      // The prompt-cache chip is now only rendered when the cache actually needs
      // attention, and this session's ambient assessment is `warm`, so gate on the
      // composer being interactive instead of on the chip appearing.
      await expect(page.getByTestId('chat-composer-actions')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-prompt-cache-status')).toHaveCount(0);

      await page.getByTestId('chat-composer-actions').click();
    await page.getByTestId('chat-composer-action-more').click();
      await page.getByTestId('chat-composer-actions-menu').getByTestId('chat-composer-action-model').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await page.getByTestId('chat-model-picker-option-claude-opus').click();
      const cancelToast = page.getByTestId('prompt-cache-risk-toast').last();
      await expect(cancelToast).toBeVisible();
      await cancelToast.getByRole('button', { name: 'Cancel' }).click();

      let requests = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __promptCacheGuardRequests?: Array<{ path: string; body: unknown }> }).__promptCacheGuardRequests ?? []
      ));
      expect(requests.some((request) => request.path === 'agents:updateModel')).toBe(false);

      await page.getByTestId('chat-composer-actions').click();
    await page.getByTestId('chat-composer-action-more').click();
      await page.getByTestId('chat-composer-actions-menu').getByTestId('chat-composer-action-model').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await page.getByTestId('chat-model-picker-option-claude-opus').click();
      const continueToast = page.getByTestId('prompt-cache-risk-toast').last();
      await expect(continueToast).toBeVisible();
      await continueToast.getByRole('button', { name: 'Continue' }).click();

      requests = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __promptCacheGuardRequests?: Array<{ path: string; body: unknown }> }).__promptCacheGuardRequests ?? []
      ));
      expect(requests).toContainEqual({
        path: 'agents:updateModel',
        body: { id: 'main', modelRef: betaModelRef },
      });

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __promptCacheRiskEvents?: Array<{ decision?: string }> }).__promptCacheRiskEvents?.length ?? 0
      ))).toBe(2);
      const riskEvents = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __promptCacheRiskEvents?: Array<{ decision?: string }> }).__promptCacheRiskEvents ?? []
      ));
      expect(riskEvents.map((event) => event.decision)).toEqual(['cancelled', 'continued']);
    } finally {
      await closeElectronApp(app);
    }
  });
});
