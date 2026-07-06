import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const PACKS = [
  {
    id: 'superpowers',
    name: 'Superpowers',
    description: 'Curated expert workflows',
    status: 'notInstalled',
    enabled: false,
    skills: [
      { id: 'brainstorming', name: 'brainstorming', description: 'Explore the problem first', enabled: false, installed: false },
    ],
  },
  {
    id: 'officecli',
    name: 'Office CLI',
    description: 'Office document workflows',
    status: 'installed',
    enabled: false,
    skills: [
      { id: 'officecli-docx', name: 'Word', description: 'Word documents', enabled: false, installed: true },
    ],
  },
];

test.describe('Skills feature plugins', () => {
  test('shows managed packs and routes install and enable actions through host-api', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      hostApi: {
        [stableStringify(['skills', 'local', null])]: { success: true, skills: [] },
        [stableStringify(['skills', 'clawhubCapability', null])]: {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
        [stableStringify(['skillPacks', 'list', null])]: { success: true, packs: PACKS },
        [stableStringify(['officeTools', 'detect', null])]: {
          installed: true,
          version: 'officecli 1.2.3',
          path: 'C:/tools/officecli.exe',
          runtimeError: null,
        },
        [stableStringify(['agents', 'list', null])]: {
          success: true,
          agents: [
            {
              id: 'main',
              name: 'Main Agent',
              isDefault: true,
              modelDisplay: 'Not configured',
              inheritedModel: false,
              workspace: 'C:/workspace',
              agentDir: 'C:/agents/main',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
            },
          ],
          defaultAgentId: 'main',
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        },
        [stableStringify(['officeTools', 'listAllSkillInstallStatuses', null])]: [
          {
            expertId: 'officecli-docx',
            skillId: 'officecli-docx',
            agentId: 'main',
            agentType: 'main',
            agentName: 'Main Agent',
            state: 'not_linked',
            linkPath: 'agent:main:defaultSkillIds',
            targetPath: null,
            expectedTargetPath: 'C:/skills/officecli-docx',
            copyMode: false,
            installedCentrally: true,
          },
        ],
        [stableStringify(['officeTools', 'applySkillLinks', {
          ops: [{ expertId: 'officecli-docx', agentId: 'main', enable: true }],
        }])]: [
          {
            expertId: 'officecli-docx',
            skillId: 'officecli-docx',
            agentId: 'main',
            agentType: 'main',
            ok: true,
            status: {
              expertId: 'officecli-docx',
              skillId: 'officecli-docx',
              agentId: 'main',
              agentType: 'main',
              agentName: 'Main Agent',
              state: 'linked_to_codeg',
              linkPath: 'agent:main:defaultSkillIds',
              targetPath: 'C:/skills/officecli-docx',
              expectedTargetPath: 'C:/skills/officecli-docx',
              copyMode: false,
              installedCentrally: true,
            },
            error: null,
          },
        ],
        [stableStringify(['skillPacks', 'install', { packId: 'superpowers' }])]: { success: true },
        [stableStringify(['skillPacks', 'setEnabled', { packId: 'officecli', enabled: true }])]: { success: true },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-skills').click();
    await expect(page.getByTestId('skills-page')).toBeVisible();

    await page.getByRole('button', { name: 'Feature Plugins' }).click();
    await expect(page.getByTestId('skill-packs-panel')).toBeVisible();
    await expect(page.getByTestId('skill-pack-card-superpowers')).toContainText('Superpowers');
    await expect(page.getByTestId('skill-pack-card-officecli')).toContainText('Office CLI');
    await expect(page.getByTestId('officecli-detection-card')).toContainText('officecli 1.2.3');
    await expect(page.getByTestId('officecli-agent-matrix')).toBeVisible();
    await expect(page.getByTestId('officecli-agent-cell-officecli-docx-main')).toHaveAttribute('aria-checked', 'false');

    await page.getByTestId('skill-pack-install-superpowers').click();
    await page.getByTestId('skill-pack-enable-officecli').click();
    await page.getByTestId('officecli-agent-cell-officecli-docx-main').click();

    const hostCalls = await electronApp.evaluate(() => (
      globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string; payload: unknown }> }
    ).__verseClawE2eHostCalls ?? []);

    expect(hostCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'skillPacks', action: 'install', payload: { packId: 'superpowers' } }),
      expect.objectContaining({ module: 'skillPacks', action: 'setEnabled', payload: { packId: 'officecli', enabled: true } }),
      expect.objectContaining({
        module: 'officeTools',
        action: 'applySkillLinks',
        payload: { ops: [{ expertId: 'officecli-docx', agentId: 'main', enable: true }] },
      }),
    ]));
  });
});
