import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

const WORKSPACE_SNAPSHOT = {
  profiles: [{
    id: 'workspace-1',
    name: 'Demo Workspace',
    rootPath: '/tmp/demo-workspace',
    agentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  }],
  activeWorkspaceId: 'workspace-1',
  activeWorkspace: {
    id: 'workspace-1',
    name: 'Demo Workspace',
    rootPath: '/tmp/demo-workspace',
    agentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  },
};

const SETTINGS_PACKS = [
  {
    id: 'officecli',
    name: 'Office CLI',
    description: 'Office document workflows',
    status: 'notInstalled',
    enabled: false,
    skills: [
      { id: 'officecli-docx', name: 'Word', description: 'Word documents', enabled: false, installed: false },
    ],
  },
];

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function okJson(json: unknown) {
  return { ok: true, data: { status: 200, ok: true, json } };
}

async function mockChatHost(electronApp: Parameters<typeof installIpcMocks>[0], skills: unknown[]) {
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: [] },
      },
    },
    hostApi: {
      [stableStringify(['/api/agents', 'GET'])]: okJson({
        success: true,
        agents: [{ id: 'main', name: 'main' }],
      }),
      [stableStringify(['workspaces', 'list', null])]: WORKSPACE_SNAPSHOT,
      [stableStringify(['workspaces', 'saveState', {
        id: 'workspace-1',
        sessionKey: SESSION_KEY,
        state: {},
      }])]: { success: true },
      [stableStringify(['/api/skills/quick-access', 'POST'])]: okJson({
        success: true,
        skills,
      }),
      [stableStringify(['skills', 'local', null])]: { success: true, skills: [] },
      [stableStringify(['skills', 'clawhubCapability', null])]: {
        success: true,
        capability: { canSearch: false, canInstall: false },
      },
      [stableStringify(['skillPacks', 'list', null])]: { success: true, packs: SETTINGS_PACKS },
      [stableStringify(['officeTools', 'detect', null])]: {
        installed: false,
        version: null,
        path: null,
        runtimeError: null,
      },
    },
  });
}

test.describe('Chat composer feature plugins', () => {
  test('shows Superpowers skills and inserts enabled Office CLI actions', async ({ electronApp, page }) => {
    await mockChatHost(electronApp, [
      {
        name: 'brainstorming',
        description: 'Explore the problem before implementation.',
        source: 'openclaw',
        sourceLabel: 'OpenClaw',
        manifestPath: '/tmp/openclaw/skills/brainstorming/SKILL.md',
        baseDir: '/tmp/openclaw/skills/brainstorming',
      },
      {
        name: 'officecli-docx',
        description: 'Work with Word documents.',
        source: 'openclaw',
        sourceLabel: 'OpenClaw',
        manifestPath: '/tmp/openclaw/skills/officecli-docx/SKILL.md',
        baseDir: '/tmp/openclaw/skills/officecli-docx',
      },
    ]);

    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('chat-composer-actions').click();
    await expect(page.getByTestId('chat-composer-action-skill-brainstorming')).toBeVisible();
    await expect(page.getByTestId('chat-composer-action-group-office')).toBeVisible();
    await page.getByTestId('chat-composer-action-office-word').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(/\/officecli-docx {2}.+/);
  });

  test('keeps Office actions visible and routes to setup when Office CLI skills are not enabled', async ({ electronApp, page }) => {
    await mockChatHost(electronApp, [
      {
        name: 'brainstorming',
        description: 'Explore the problem before implementation.',
        source: 'openclaw',
        sourceLabel: 'OpenClaw',
        manifestPath: '/tmp/openclaw/skills/brainstorming/SKILL.md',
        baseDir: '/tmp/openclaw/skills/brainstorming',
      },
    ]);

    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('chat-composer-actions').click();
    await expect(page.getByTestId('chat-composer-action-skill-brainstorming')).toBeVisible();
    await expect(page.getByTestId('chat-composer-action-group-office')).toBeVisible();
    await page.getByTestId('chat-composer-action-office-word').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/skills?tab=packs');
    await expect(page.getByTestId('skill-packs-panel')).toBeVisible();
    await expect(page.getByTestId('skill-pack-card-officecli')).toBeVisible();
  });
});
