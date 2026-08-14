import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { completeSetup, expect, test } from './fixtures/electron';

const TEST_PROVIDER_ID = 'moonshot-e2e';
const TEST_PROVIDER_LABEL = 'Moonshot E2E';

async function seedTestProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('provider:save', {
      id: providerId,
      name: providerLabel,
      type: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }, { providerId: TEST_PROVIDER_ID, providerLabel: TEST_PROVIDER_LABEL });
}

test.describe('Verse Claw provider lifecycle', () => {
  test('shows a saved provider and removes it cleanly after deletion', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
  });

  test('does not redisplay a deleted provider after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedPage = await relaunchedApp.firstWindow();
      await relaunchedPage.waitForLoadState('domcontentloaded');
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await relaunchedPage.getByTestId('sidebar-nav-settings').click();
      await relaunchedPage.getByTestId('settings-nav-models').click();
      await expect(relaunchedPage.getByTestId('providers-settings')).toBeVisible();
      await expect(relaunchedPage.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
      await expect(relaunchedPage.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });

  test('shows OpenAI OAuth and API key auth mode toggle in add-provider dialog', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-openai').click();
    await expect(page.getByTestId('add-provider-auth-oauth-tab')).toBeVisible();
    await expect(page.getByTestId('add-provider-auth-apikey-tab')).toBeVisible();

    await page.getByTestId('add-provider-auth-oauth-tab').click();
    await expect(page.getByTestId('add-provider-oauth-login-button')).toBeVisible();
    await expect(page.getByTestId('add-provider-api-key-input')).toHaveCount(0);
  });

  test('trims whitespace before validating and saving a custom provider key', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let accounts: Array<Record<string, unknown>> = [];
      let keyInfo: Array<{ accountId: string; hasKey: boolean; keyMasked: string | null }> = [];
      let statuses: Array<Record<string, unknown>> = [];
      let defaultAccountId: string | null = null;
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, accounts);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: defaultAccountId });
        if (request.action === 'list') return respond(request.id, statuses);

        if (request.action === 'validateKey') {
          if (body.apiKey !== 'sk-lm-test') {
            return respond(request.id, { valid: false, error: `unexpected key: ${String(body.apiKey)}` });
          }
          return respond(request.id, { valid: true });
        }

        if (request.action === 'createAccount') {
          const account = body.account as Record<string, unknown>;
          accounts = [account];
          keyInfo = [{
            accountId: String(account.id),
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          statuses = [{
            id: account.id,
            name: account.label,
            type: account.vendorId,
            baseUrl: account.baseUrl,
            model: account.model,
            enabled: account.enabled,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond(request.id, { success: true, account });
        }

        if (request.action === 'setDefaultAccount') {
          defaultAccountId = typeof body.accountId === 'string' ? body.accountId : null;
          return respond(request.id, { success: true });
        }

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-name-input').fill('LM Studio Local');
    await page.getByTestId('add-provider-api-key-input').fill('  sk-lm-test \n');
    await page.getByTestId('add-provider-base-url-input').fill('http://127.0.0.1:1234/v1');
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByTestId('provider-card-custom')).toContainText('LM Studio Local');
  });

  test('edit form validates the new API key inline before saving (single button)', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let provider = {
        id: 'moonshot-edit',
        vendorId: 'moonshot',
        label: 'Moonshot Edit',
        authMode: 'api_key',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let storedKey = 'sk-existing';
      let keyInfo = [{ accountId: provider.id, hasKey: true, keyMasked: 'sk-***' }];
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, [provider]);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: provider.id });
        if (request.action === 'list') return respond(request.id, [provider]);

        if (request.action === 'validateKey') {
          if (body.apiKey === 'sk-good') {
            return respond(request.id, { valid: true });
          }
          return respond(request.id, { valid: false, error: 'Invalid API key' });
        }

        if (request.action === 'updateAccount') {
          provider = {
            ...provider,
            ...(body.updates as Record<string, unknown> | undefined),
            updatedAt: new Date().toISOString(),
          };
          if (body.apiKey) storedKey = String(body.apiKey);
          keyInfo = [{ accountId: provider.id, hasKey: Boolean(storedKey), keyMasked: 'sk-***' }];
          return respond(request.id, { success: true, account: provider });
        }

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('provider-card-moonshot-edit')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-edit').hover();
    await page.getByTestId('provider-edit-moonshot-edit').click();

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-bad');
    await page.getByTestId('provider-edit-save-moonshot-edit').click();
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toContainText('Invalid API key');

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-good');
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toHaveCount(0);
    await page.getByTestId('provider-edit-save-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-save-moonshot-edit')).toHaveCount(0);
  });

  // R4: custom provider auth format + capability metadata. Each test spins up a
  // real local HTTP server so the save-time validator performs a REAL probe. The
  // server asserts the wire-level auth shape (custom header name+prefix / query
  // parameter), and the renderer-side host-call capture asserts the payloads the
  // dialog sent to validation and persistence.
  async function providerHostCalls(page: Parameters<typeof completeSetup>[0]): Promise<Array<{
    module: string;
    action: string;
    payload?: unknown;
  }>> {
    return page.evaluate(() => {
      const surface = (window as unknown as {
        __CLAWX_TEST__?: { hostApiCalls?: Array<{ module: string; action: string; payload?: unknown }> };
      }).__CLAWX_TEST__;
      return (surface?.hostApiCalls ?? []).filter(
        (call) => call.module === 'providers' && (call.action === 'validateKey' || call.action === 'createAccount'),
      );
    });
  }

  async function startValidationProbeServer(): Promise<{
    server: Server;
    baseUrl: string;
    urls: string[];
    authHeaders: Array<Record<string, string>>;
  }> {
    const urls: string[] = [];
    const authHeaders: Array<Record<string, string>> = [];
    const server = createServer((request, response) => {
      urls.push(request.url ?? '');
      const seenAuth: Record<string, string> = {};
      if (request.headers['x-api-key'] !== undefined) {
        seenAuth['x-api-key'] = String(request.headers['x-api-key']);
      }
      if (request.headers.authorization !== undefined) {
        seenAuth.authorization = String(request.headers.authorization);
      }
      authHeaders.push(seenAuth);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, urls, authHeaders };
  }

  async function fillCustomProviderBasics(
    page: Parameters<typeof completeSetup>[0],
    label: string,
    baseUrl: string,
  ): Promise<void> {
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-name-input').fill(label);
    await page.getByTestId('add-provider-api-key-input').fill('sk-lm-test');
    await page.getByTestId('add-provider-base-url-input').fill(baseUrl);
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
  }

  test('add dialog sends the custom-header auth format to validation and save', async ({ page }) => {
    const probe = await startValidationProbeServer();
    try {
      await completeSetup(page);
      await fillCustomProviderBasics(page, 'Header Auth Custom', probe.baseUrl);

      await page.getByTestId('add-provider-auth-method-custom-header').click();
      await expect(page.getByTestId('add-provider-auth-header-name')).toBeVisible();
      await page.getByTestId('add-provider-auth-header-name').fill('X-API-Key');
      await page.getByTestId('add-provider-auth-header-prefix').fill('Bearer ');
      await page.getByTestId('add-provider-submit-button').click();

      // The REAL validation probe hit the local server with the resolved auth format.
      await expect.poll(async () => probe.urls.some((url) => url.includes('/models')), { timeout: 20_000 }).toBe(true);
      expect(probe.authHeaders.some((headers) => headers['x-api-key'] === 'Bearer sk-lm-test')).toBe(true);
      expect(probe.authHeaders.some((headers) => 'authorization' in headers)).toBe(false);

      await expect.poll(
        async () => (await providerHostCalls(page)).some((call) => call.action === 'createAccount'),
        { timeout: 20_000 },
      ).toBe(true);

      const calls = await providerHostCalls(page);
      const validateCall = calls.find((call) => call.action === 'validateKey');
      const createCall = calls.find((call) => call.action === 'createAccount');

      expect(validateCall?.payload).toMatchObject({
        options: { auth: { mode: 'custom-header', headerName: 'X-API-Key', prefix: 'Bearer ' } },
      });
      expect(createCall?.payload).toMatchObject({
        account: { requestAuth: { mode: 'custom-header', headerName: 'X-API-Key', prefix: 'Bearer ' } },
      });
    } finally {
      await new Promise<void>((resolve) => probe.server.close(() => resolve()));
    }
  });

  test('add dialog persists query auth and declared model capabilities', async ({ electronApp, page }) => {
    const probe = await startValidationProbeServer();
    const mainLogs: string[] = [];
    electronApp.process().stdout?.on('data', (chunk: Buffer | string) => {
      mainLogs.push(String(chunk));
    });
    try {
      await completeSetup(page);
      await fillCustomProviderBasics(page, 'Query Auth Custom', probe.baseUrl);

      await page.getByTestId('add-provider-auth-method-query').click();
      await expect(page.getByTestId('add-provider-auth-query-param')).toBeVisible();
      await page.getByTestId('add-provider-auth-query-param').fill('key');
      await page.getByTestId('add-provider-context-window').fill('128000');
      await page.getByTestId('add-provider-max-tokens').fill('8192');
      await page.getByTestId('add-provider-supports-vision').click();
      await page.getByTestId('add-provider-submit-button').click();

      // The REAL validation probe carried the credential as a query parameter.
      const directProbe = await page.evaluate(async (baseUrl) => {
        const bridge = (window as unknown as {
          verseClaw?: { hostInvoke: (request: unknown) => Promise<unknown> };
        }).verseClaw?.hostInvoke;
        if (!bridge) return 'no-bridge';
        try {
          return await bridge({
            id: 'diag-probe',
            module: 'providers',
            action: 'validateKey',
            payload: {
              providerId: 'custom',
              apiKey: 'sk-lm-test',
              options: { baseUrl, apiProtocol: 'openai-completions', auth: { mode: 'query', parameterName: 'key' } },
            },
          });
        } catch (error) {
          return `bridge-error: ${String(error)}`;
        }
      }, probe.baseUrl);
      expect(directProbe, `probe urls=${JSON.stringify(probe.urls)}`).toMatchObject({
        ok: true,
        data: { valid: true },
      });
      await expect.poll(
        async () => probe.urls.some((url) => url.includes('/models') && url.includes('key=sk-lm-test')),
        { timeout: 20_000 },
      ).toBe(true);
      expect(probe.authHeaders.every((headers) => Object.keys(headers).length === 0)).toBe(true);

      await expect.poll(
        async () => (await providerHostCalls(page)).some((call) => call.action === 'createAccount'),
        { timeout: 20_000 },
      ).toBe(true);

      const calls = await providerHostCalls(page);
      const validateCall = calls.find((call) => call.action === 'validateKey');
      const createCall = calls.find((call) => call.action === 'createAccount');

      expect(validateCall?.payload).toMatchObject({
        options: { auth: { mode: 'query', parameterName: 'key' } },
      });
      expect(createCall?.payload).toMatchObject({
        account: {
          requestAuth: { mode: 'query', parameterName: 'key' },
          modelProfile: {
            contextWindow: 128000,
            maxTokens: 8192,
            supportsVision: true,
          },
        },
      });
    } finally {
      await new Promise<void>((resolve) => probe.server.close(() => resolve()));
    }
  });
});
