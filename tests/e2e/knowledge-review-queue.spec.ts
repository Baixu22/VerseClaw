import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

// KE-P1-3: Review Queue (Knowledge Hub inbox) — confirm / reject / empty + flag-gate.

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function typed(module: string, action: string, payload: unknown = null): string {
  return stableStringify([module, action, payload]);
}

const pendingItem = {
  id: 'ke-inbox-1',
  title: 'Repeated failure guard candidate',
  body: 'Command exited with code 1 during the codegen task. Reuse this error card for retry guidance.',
  kind: 'task-ledger',
  type: 'troubleshooting',
  status: 'pending',
  sourceIds: ['task-1'],
  sourceRefs: [{ id: 'task-loop:loop-1:error:error', kind: 'task_loop', label: 'TaskLoop terminal' }],
  tags: ['ke-candidate'],
  workspaceId: null,
  agentId: null,
  createdBy: 'agent',
  warnings: [],
  metadata: { sensitivity: 'normal', tokenCost: 18 },
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

function flagsSnapshot(enabled: boolean) {
  return {
    productionMode: 'opt-in',
    flags: [
      {
        id: 'runtime-memory-candidate-generation',
        writable: true,
        enabled,
        defaultEnabled: false,
        status: 'applied',
      },
    ],
    gatewayState: 'running',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
}

function knowledgeStatus() {
  return {
    success: true,
    status: {
      vaultExists: true,
      vaultPath: 'C:/clawx/wiki',
      vaultMode: 'isolated',
      renderMode: 'native',
      pageCounts: { source: 1, synthesis: 0 },
      sourceCounts: { native: 1 },
      warnings: [],
      obsidianCli: { available: false },
    },
  };
}

test.describe('KE-P1-3 Review Queue', () => {
  test('confirm promotes a candidate and shows KE fields', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [typed('dcsProdFlags', 'getFlags')]: flagsSnapshot(true),
        [typed('knowledge', 'status')]: knowledgeStatus(),
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [pendingItem],
        },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: { success: true, drafts: [] },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: { success: true, proposals: [] },
        [typed('knowledge', 'listSourceSets')]: { success: true, sourceSets: [] },
        [typed('knowledge', 'promoteInboxItemToDraft', { id: 'ke-inbox-1' })]: {
          success: true,
          item: { id: 'ke-inbox-1', status: 'promoted' },
          draft: { id: 'draft-ke-inbox-1', status: 'draft' },
        },
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Repeated failure guard candidate');
    await expect(page.getByTestId('knowledge-inbox-sensitivity')).toContainText('Normal');
    await expect(page.getByTestId('knowledge-inbox-token-cost')).toContainText('tokens');
    await page.getByTestId('knowledge-inbox-promote').click();
    await expect(page.getByText(/promoted to draft/)).toBeVisible();
  });

  test('reject dismisses a candidate without persisting', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [typed('dcsProdFlags', 'getFlags')]: flagsSnapshot(true),
        [typed('knowledge', 'status')]: knowledgeStatus(),
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [pendingItem],
        },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: { success: true, drafts: [] },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: { success: true, proposals: [] },
        [typed('knowledge', 'listSourceSets')]: { success: true, sourceSets: [] },
        [typed('knowledge', 'dismissInboxItem', { id: 'ke-inbox-1' })]: {
          success: true,
          item: { id: 'ke-inbox-1', status: 'dismissed' },
        },
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Repeated failure guard candidate');
    await page.getByTestId('knowledge-inbox-dismiss').click();
    await expect(page.getByText(/dismissed/)).toBeVisible();
  });

  test('shows an empty state when there are no candidates', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [typed('dcsProdFlags', 'getFlags')]: flagsSnapshot(true),
        [typed('knowledge', 'status')]: knowledgeStatus(),
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: { success: true, items: [] },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: { success: true, drafts: [] },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: { success: true, proposals: [] },
        [typed('knowledge', 'listSourceSets')]: { success: true, sourceSets: [] },
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toContainText('No pending knowledge candidates');
  });

  test('flag off shows unavailable state and hides KE fields', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: {
        [typed('dcsProdFlags', 'getFlags')]: flagsSnapshot(false),
        [typed('knowledge', 'status')]: knowledgeStatus(),
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [pendingItem],
        },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: { success: true, drafts: [] },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: { success: true, proposals: [] },
        [typed('knowledge', 'listSourceSets')]: { success: true, sourceSets: [] },
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox-ke-unavailable')).toBeVisible();
    await expect(page.getByTestId('knowledge-inbox-sensitivity')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-inbox-token-cost')).toHaveCount(0);
  });
});
