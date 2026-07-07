import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Role management', () => {
  test('shows role origins and saves config roles through host-api with pending runtime state', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['roles.list', null])]: {
            roles: [
              {
                name: 'planner',
                displayName: 'Planner',
                description: 'Plans the work.',
                rolePrompt: 'Plan the work.',
                tools: ['read'],
                effort: 'medium',
                origin: 'built-in',
              },
              {
                name: 'docs-helper',
                displayName: 'Docs Helper',
                description: 'Config-backed writing role.',
                rolePrompt: 'Write docs.',
                tools: ['read'],
                effort: 'low',
                origin: 'config',
              },
            ],
          },
          [stableStringify(['roles.get', { name: 'docs-helper' }])]: { soul: 'Docs helper contract' },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
          },
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              modelDisplay: 'gpt-5',
              modelRef: 'openai/gpt-5',
              overrideModelRef: null,
              inheritedModel: true,
              workspace: 'C:\\Users\\27933\\Desktop\\project',
              agentDir: 'C:\\Users\\27933\\.openclaw\\agents\\main\\agent',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
            }],
          },
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['providers', 'snapshot', null])]: { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
          [stableStringify(['roles', 'upsertConfigRole', null])]: {
            success: true,
            pendingRuntimeRefresh: true,
            role: {
              name: 'qa-helper',
              displayName: 'QA Helper',
              rolePrompt: 'Check risky paths.',
              tools: ['read', 'shell'],
              effort: 'medium',
              permissions: { filesystem: 'read', network: 'none', commands: [] },
              tags: ['qa'],
              origin: 'config',
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await page.getByTestId('role-orchestration-toggle').click();

      await expect(page.getByTestId('role-origin-badge-built-in')).toContainText('Built-in');
      await expect(page.getByTestId('role-origin-badge-config')).toContainText('Custom');

      await page.getByTestId('role-config-create').click();
      await page.getByTestId('role-config-name').fill('qa-helper');
      await page.getByTestId('role-config-display-name').fill('QA Helper');
      await page.getByTestId('role-config-prompt').fill('Check risky paths.');
      await page.getByTestId('role-config-tools').fill('read, shell');
      await page.getByTestId('role-config-tags').fill('qa');
      await page.getByTestId('role-config-save').click();

      await expect(page.getByTestId('role-config-pending-runtime')).toContainText('Saved to config');
      const upsertCall = await app.evaluate(() => {
        const calls = (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.findLast((call) => call.module === 'roles' && call.action === 'upsertConfigRole') ?? null;
      });
      expect(upsertCall).toMatchObject({
        payload: {
          name: 'qa-helper',
          displayName: 'QA Helper',
          rolePrompt: 'Check risky paths.',
          tools: ['read', 'shell'],
          effort: 'medium',
          permissions: {
            filesystem: 'read',
            network: 'none',
            commands: [],
          },
          tags: ['qa'],
        },
      });

      await page.getByText('Docs Helper').click();
      await expect(page.getByTestId('role-config-edit-selected')).toBeVisible();
      await page.getByText('Planner').click();
      await expect(page.getByTestId('role-config-edit-selected')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
