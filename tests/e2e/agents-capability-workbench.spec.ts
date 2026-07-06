import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Agent capability workbench', () => {
  test('adds a candidate capability through the renderer workbench', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        hostApi: {
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
          [stableStringify(['agents', 'getBootstrap', { id: 'main' }])]: {
            success: true,
            agentId: 'main',
            soulMd: '',
            bootstrapPath: 'C:\\Users\\27933\\.openclaw\\agents\\main\\agent\\SOUL.md',
            defaultSkillIds: [],
            defaultMcpServerIds: [],
          },
          [stableStringify(['agents', 'updateBootstrap', null])]: {
            success: true,
            agentId: 'main',
            soulMd: '',
            bootstrapPath: 'C:\\Users\\27933\\.openclaw\\agents\\main\\agent\\SOUL.md',
            defaultSkillIds: ['create-skill'],
            defaultMcpServerIds: [],
          },
          [stableStringify(['capabilities', 'publications', null])]: {
            success: true,
            source: 'gateway',
            generatedAt: '2026-01-01T00:00:00.000Z',
            diagnostics: [],
            publications: [{
              id: 'skill:create-skill',
              kind: 'skill',
              sourceId: 'create-skill',
              name: 'create-skill',
              owner: { type: 'agent', id: 'main' },
              scope: 'agent',
              source: 'local',
              state: 'available',
              exposure: { runtimeVisible: false, promptVisible: false, userInvocable: false },
              useModes: ['adminAction'],
              runtime: { status: 'cold', method: 'prompt', source: 'gateway' },
              reasons: ['agent-skill-candidate'],
              diagnostics: [],
              skillId: 'create-skill',
            }],
          },
        },
      });

      const page = await getStableWindow(app);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('agent-settings-main').click();
      await expect(page.getByTestId('agent-capability-workbench')).toBeVisible();

      const row = page.getByTestId('agent-capability-row-skill-create-skill');
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /Add/ }).click();
      await expect(page.getByText(/to add|pending capability changes/i)).toBeVisible();

      await page.getByRole('button', { name: /Apply capability changes/ }).click();
      await expect(page.getByText(/No pending capability changes/i)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
