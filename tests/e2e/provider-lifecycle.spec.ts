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
          return respond(request.id, { valid: false, error: 'mock-consulted' });
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

  test('add dialog persists custom-header auth format through validation and save', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      const validateCalls: Array<Record<string, unknown>> = [];
      const savedAccounts: Array<Record<string, unknown>> = [];
      const allActions: string[] = [];
      let accounts: Array<Record<string, unknown>> = [];
      let statuses: Array<Record<string, unknown>> = [];
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
        console.log('[r4-e2e] host:invoke', request.module, request.action);
        if (request.action) allActions.push(request.action);
        if (request.action === 'accounts') return respond(request.id, accounts);
        if (request.action === 'accountKeyInfo') return respond(request.id, []);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: null });
        if (request.action === 'list') return respond(request.id, statuses);

        if (request.action === 'validateKey') {
          validateCalls.push(body);
          return respond(request.id, { valid: true });
        }

        if (request.action === 'createAccount') {
          const account = body.account as Record<string, unknown>;
          savedAccounts.push(account);
          accounts = [account];
          statuses = [{
            id: account.id,
            name: account.label,
            type: account.vendorId,
            baseUrl: account.baseUrl,
            model: account.model,
            enabled: account.enabled,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond(request.id, { success: true, account });
        }

        if (request.action === 'setDefaultAccount') {
          return respond(request.id, { success: true });
        }

        // Live references captured for the test assertions below.
        const invokeMap = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers;
        let selfTest = 'n/a';
        try {
          const installed = invokeMap?.get('host:invoke') as unknown as
            | ((event: unknown, request: unknown) => Promise<unknown>)
            | undefined;
          selfTest = JSON.stringify({
            handlerCount: invokeMap?.size ?? -1,
            installedIsFunction: typeof installed === 'function',
            probe: await installed?.({ sender: null }, { id: 'probe', module: 'providers', action: 'probeAction', payload: {} }),
          });
        } catch (error) {
          selfTest = `self-test error: ${String(error)}`;
        }
        (globalThis as unknown as Record<string, unknown>).__r4E2eCapture = { validateCalls, savedAccounts, allActions, selfTest };

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-auth-method-custom-header').click();
    await expect(page.getByTestId('add-provider-auth-header-name')).toBeVisible();
    await page.getByTestId('add-provider-auth-header-name').fill('X-API-Key');
    await page.getByTestId('add-provider-auth-header-prefix').fill('Bearer ');
    await page.getByTestId('add-provider-name-input').fill('Header Auth Custom');
    await page.getByTestId('add-provider-api-key-input').fill('sk-lm-test');
    await page.getByTestId('add-provider-base-url-input').fill('http://127.0.0.1:1234/v1');
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByTestId('provider-card-custom')).toContainText('Header Auth Custom');

    const captured = await electronApp.evaluate(async () => {
      const g = globalThis as unknown as {
        __r4E2eCapture?: { validateCalls: Array<Record<string, unknown>>; savedAccounts: Array<Record<string, unknown>>; allActions: string[] };
      };
      return {
        validateCalls: g.__r4E2eCapture?.validateCalls ?? [],
        savedAccounts: g.__r4E2eCapture?.savedAccounts ?? [],
        allActions: g.__r4E2eCapture?.allActions ?? [],
      };
    });

    expect(captured.validateCalls.length, `providers actions seen: ${JSON.stringify(captured.allActions)}`).toBeGreaterThan(0);
    expect(captured.validateCalls[0].options).toMatchObject({
      auth: { mode: 'custom-header', headerName: 'X-API-Key', prefix: 'Bearer ' },
    });
    expect(captured.savedAccounts.length).toBeGreaterThan(0);
    expect(captured.savedAccounts[0]).toMatchObject({
      requestAuth: { mode: 'custom-header', headerName: 'X-API-Key', prefix: 'Bearer ' },
    });
  });

  test('add dialog persists query auth and declared model capabilities', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      const validateCalls: Array<Record<string, unknown>> = [];
      const savedAccounts: Array<Record<string, unknown>> = [];
      const allActions: string[] = [];
      let accounts: Array<Record<string, unknown>> = [];
      let statuses: Array<Record<string, unknown>> = [];
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
        console.log('[r4-e2e] host:invoke', request.module, request.action);
        if (request.action) allActions.push(request.action);
        if (request.action === 'accounts') return respond(request.id, accounts);
        if (request.action === 'accountKeyInfo') return respond(request.id, []);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: null });
        if (request.action === 'list') return respond(request.id, statuses);

        if (request.action === 'validateKey') {
          validateCalls.push(body);
          return respond(request.id, { valid: true });
        }

        if (request.action === 'createAccount') {
          const account = body.account as Record<string, unknown>;
          savedAccounts.push(account);
          accounts = [account];
          statuses = [{
            id: account.id,
            name: account.label,
            type: account.vendorId,
            baseUrl: account.baseUrl,
            model: account.model,
            enabled: account.enabled,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond(request.id, { success: true, account });
        }

        if (request.action === 'setDefaultAccount') {
          return respond(request.id, { success: true });
        }

        // Live references captured for the test assertions below.
        const invokeMap = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers;
        let selfTest = 'n/a';
        try {
          const installed = invokeMap?.get('host:invoke') as unknown as
            | ((event: unknown, request: unknown) => Promise<unknown>)
            | undefined;
          selfTest = JSON.stringify({
            handlerCount: invokeMap?.size ?? -1,
            installedIsFunction: typeof installed === 'function',
            probe: await installed?.({ sender: null }, { id: 'probe', module: 'providers', action: 'probeAction', payload: {} }),
          });
        } catch (error) {
          selfTest = `self-test error: ${String(error)}`;
        }
        (globalThis as unknown as Record<string, unknown>).__r4E2eCapture = { validateCalls, savedAccounts, allActions, selfTest };

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-auth-method-query').click();
    await expect(page.getByTestId('add-provider-auth-query-param')).toBeVisible();
    await page.getByTestId('add-provider-auth-query-param').fill('key');
    await page.getByTestId('add-provider-context-window').fill('128000');
    await page.getByTestId('add-provider-max-tokens').fill('8192');
    await page.getByTestId('add-provider-supports-vision').click();
    await page.getByTestId('add-provider-name-input').fill('Query Auth Custom');
    await page.getByTestId('add-provider-api-key-input').fill('sk-lm-test');
    await page.getByTestId('add-provider-base-url-input').fill('http://127.0.0.1:1234/v1');
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByTestId('provider-card-custom')).toContainText('Query Auth Custom');

    const captured = await electronApp.evaluate(async () => {
      const g = globalThis as unknown as {
        __r4E2eCapture?: { validateCalls: Array<Record<string, unknown>>; savedAccounts: Array<Record<string, unknown>>; allActions: string[]; selfTest: string };
      };
      return {
        validateCalls: g.__r4E2eCapture?.validateCalls ?? [],
        savedAccounts: g.__r4E2eCapture?.savedAccounts ?? [],
        allActions: g.__r4E2eCapture?.allActions ?? [],
        selfTest: g.__r4E2eCapture?.selfTest ?? 'missing',
      };
    });

    const rendererCalls = await page.evaluate(() => {
      const s = (window as unknown as {
        __CLAWX_TEST__?: { hostApiCalls?: Array<{ module: string; action: string; payload?: unknown; ok?: boolean; error?: string }> };
      }).__CLAWX_TEST__;
      return s?.hostApiCalls ?? [];
    });

    expect(captured.validateCalls.length, `selfTest: ${captured.selfTest}; providers actions seen: ${JSON.stringify(captured.allActions)}; renderer validate/create: ${JSON.stringify(rendererCalls.filter((c) => c.module === 'providers' && (c.action === 'validateKey' || c.action === 'createAccount')).map((c) => ({ a: c.action, ok: c.ok, p: c.payload })))}`).toBeGreaterThan(0);
    expect(captured.savedAccounts.length).toBeGreaterThan(0);
    expect(captured.savedAccounts[0]).toMatchObject({
      requestAuth: { mode: 'query', parameterName: 'key' },
      modelProfile: {
        contextWindow: 128000,
        maxTokens: 8192,
        supportsVision: true,
      },
    });
  });
});
