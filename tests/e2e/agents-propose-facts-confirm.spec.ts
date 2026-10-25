// R3-2.4 proposeFacts manual-confirm queue — Electron E2E on the Agents page.
// Covers the three states: enabled with a pending candidate that confirms,
// enabled-empty, and disabled (default-off, flags not set). Confirm routes only
// through hostApi.memory.proposeFactsConfirm; the runtime E-1 owner-convergence
// gate is exercised in unit/runtime tests, so here we stub the host result.
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const candidate = {
  factId: 'fact-1',
  subject: 'user',
  predicate: 'prefers',
  objectSummary: 'dark mode',
  confidence: 0.82,
  source: 'human_confirmation',
  proposedAt: 1_726_000_000_000,
};

const baseHostApi: Record<string, unknown> = {
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
      workspace: 'C:\\project',
      agentDir: 'C:\\openclaw\\agents\\main\\agent',
      mainSessionKey: 'agent:main:main',
      channelTypes: [],
    }],
  },
  [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
  [stableStringify(['providers', 'snapshot', null])]: {
    success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '',
  },
};

async function gotoAgents(app: Parameters<typeof getStableWindow>[0]) {
  const page = await getStableWindow(app);
  const url = new URL(page.url());
  url.hash = '/settings/agents?advancedMemory=1';
  await page.goto(url.toString());
  await expect(page.getByTestId('agents-page')).toBeVisible();
  await page.getByTestId('role-orchestration-toggle').click();
  await expect(page.getByTestId('propose-facts-confirm-queue')).toBeVisible();
  return page;
}

test.describe('R3-2.4 proposeFacts confirm queue', () => {
  test('lists a pending candidate and confirms it', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          ...baseHostApi,
          [stableStringify(['memory', 'proposeFactsList', null])]: {
            success: true, enabled: true, candidates: [candidate],
          },
          [stableStringify(['memory', 'proposeFactsConfirm', null])]: {
            success: true, confirmed: true, message: 'confirmed and persisted', factId: 'fact-1',
          },
        },
      });
      const page = await gotoAgents(app);

      const row = page.getByTestId('propose-facts-candidate');
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-fact-id', 'fact-1');
      await page.getByTestId('propose-facts-confirm').click();
      // Confirmed candidate leaves the queue.
      await expect(page.getByTestId('propose-facts-candidate')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the empty state when enabled with no candidates', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          ...baseHostApi,
          [stableStringify(['memory', 'proposeFactsList', null])]: {
            success: true, enabled: true, candidates: [],
          },
        },
      });
      const page = await gotoAgents(app);
      await expect(page.getByTestId('propose-facts-empty')).toBeVisible();
      await expect(page.getByTestId('propose-facts-candidate')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the disabled notice when proposeFacts flags are off (default)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          ...baseHostApi,
          [stableStringify(['memory', 'proposeFactsList', null])]: {
            success: true, enabled: false, candidates: [],
          },
        },
      });
      const page = await gotoAgents(app);
      await expect(page.getByTestId('propose-facts-disabled')).toBeVisible();
      await expect(page.getByTestId('propose-facts-confirm')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
