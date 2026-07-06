import { completeSetup, expect, test } from './fixtures/electron';

// Area 1 §8 E2E requirement: assert the RoleCard origin badge renders for both
// built-in and config-defined roles returned by `roles.list`.
test.describe('RoleCard origin badge (Area 1)', () => {
  test('renders built-in and config origin badges from roles.list', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      (globalThis as unknown as { __roleOriginBadgeState: { listCalls: number } }).__roleOriginBadgeState = {
        listCalls: 0,
      };

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string };
      }) => {
        const state = (globalThis as unknown as { __roleOriginBadgeState: { listCalls: number } }).__roleOriginBadgeState;

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:session' }],
          });
        }
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }
        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
        }
        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method ?? '';
          if (method === 'roles.list') {
            state.listCalls += 1;
            return respond(request.id, {
              roles: [
                {
                  name: 'planner',
                  displayName: 'Planner',
                  description: 'Untouched built-in role.',
                  rolePrompt: 'Plans the work.',
                  tools: ['read'],
                  effort: 'medium',
                  origin: 'built-in',
                },
                {
                  name: 'data-scientist',
                  displayName: 'Data Scientist',
                  description: 'Fresh config-defined role.',
                  rolePrompt: 'Analyzes data.',
                  tools: ['read', 'python'],
                  effort: 'high',
                  origin: 'config',
                },
              ],
            });
          }
          if (method === 'roles.get') {
            return respond(request.id, { soul: '' });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();

    await expect(page.getByTestId('role-origin-badge-built-in')).toBeVisible();
    await expect(page.getByTestId('role-origin-badge-built-in')).toContainText('Built-in');
    await expect(page.getByTestId('role-origin-badge-config')).toBeVisible();
    await expect(page.getByTestId('role-origin-badge-config')).toContainText('Custom');

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __roleOriginBadgeState?: { listCalls: number } }).__roleOriginBadgeState;
      return state?.listCalls ?? 0;
    });
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
