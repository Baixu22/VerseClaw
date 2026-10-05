import { completeSetup, closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

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
    await page.getByTestId('knowledge-tab-review-queue').click();
    await page.getByTestId('knowledge-review-filter-inbox').click();
    await page.getByTestId('knowledge-review-item').first().click();
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
    await page.getByTestId('knowledge-tab-review-queue').click();
    await page.getByTestId('knowledge-review-filter-inbox').click();
    await page.getByTestId('knowledge-review-item').first().click();
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
    await page.getByTestId('knowledge-tab-review-queue').click();
    await page.getByTestId('knowledge-review-filter-inbox').click();
    await expect(page.getByTestId('knowledge-review-queue')).toContainText("No review items match this view.");
    await expect(page.getByTestId('knowledge-review-item')).toHaveCount(0);
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
    await page.getByTestId('knowledge-tab-review-queue').click();
    await page.getByTestId('knowledge-review-filter-inbox').click();
    await page.getByTestId('knowledge-review-item').first().click();
    await expect(page.getByTestId('knowledge-inbox-ke-unavailable')).toBeVisible();
    await expect(page.getByTestId('knowledge-inbox-sensitivity')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-inbox-token-cost')).toHaveCount(0);
  });
});


const firstDraft = {
  id: 'draft-first', title: 'First decision', body: '# First decision\nReviewed evidence.',
  type: 'decision', status: 'draft', sourceIds: ['wiki/decision.md'], sourceRefs: [], tags: [],
  createdBy: 'user', createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z',
};
const secondDraft = { ...firstDraft, id: 'draft-second', title: 'Second decision', body: '# Second decision\nSeparate evidence.', status: 'steward_reviewed' };
const firstProposal = {
  id: 'proposal-first', draftId: firstDraft.id, operation: 'create', status: 'proposed',
  reason: 'Review this decision.', sources: [], requiresUserConfirmation: true,
  createdAt: firstDraft.createdAt, updatedAt: firstDraft.updatedAt,
};

const knowledgeMocks = Object.fromEntries([
  ['status', { success: true, status: { vaultExists: true, vaultPath: 'C:/test-wiki', vaultMode: 'isolated', renderMode: 'native', pageCounts: { source: 1 }, sourceCounts: {}, warnings: [], obsidianCli: { available: false } } }],
  ['listInboxItems', { success: true, items: [] }],
  ['listDrafts', { success: true, drafts: [firstDraft, secondDraft] }],
  ['listProposals', { success: true, proposals: [firstProposal] }],
  ['listSourceSets', { success: true, sourceSets: [] }],
  ['search', { success: true, results: [{ pagePath: 'wiki/decision.md', title: 'First decision', snippet: 'Reviewed evidence.' }] }],
  ['get', { success: true, content: firstDraft.body }],
  ['recordKnowledgeReference', { success: true }],
].map(([action, result]) => [JSON.stringify(['knowledge', action, null]), result]));

test('review selection prepares and approves only the corresponding proposal', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, { hostApi: knowledgeMocks });
    await app.evaluate(async (_, initialProposal) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>> })._invokeHandlers;
      const previous = handlers.get('host:invoke')!;
      const proposals = [initialProposal];
      const calls: Array<{ action: unknown; payload: unknown }> = [];
      (globalThis as unknown as { knowledgeQueueCalls: typeof calls }).knowledgeQueueCalls = calls;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
        if (request.module !== 'knowledge') return previous(event, request);
        calls.push({ action: request.action, payload: request.payload });
        const success = (data: unknown) => ({ id: request.id, ok: true, data });
        if (request.action === 'listProposals') return success({ success: true, proposals });
        if (request.action === 'listReviewBundles') return success({
          success: true,
          bundles: proposals.map((proposal) => ({
            id: `bundle-${proposal.id}`,
            draftId: proposal.draftId,
            proposalId: proposal.id,
            operation: proposal.operation,
            status: proposal.status,
          })),
        });
        if (request.action === 'proposeChange') {
          const payload = request.payload as { draftId: string };
          const proposal = { ...initialProposal, id: 'proposal-second', draftId: payload.draftId };
          proposals.push(proposal);
          return success({ success: true, proposal });
        }
        if (request.action === 'reviewDraft' || request.action === 'applyReviewedChange') return success({ success: true });
        return previous(event, request);
      });
    }, firstProposal);
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.getByTestId('knowledge-tab-review-queue').click();
    await expect(page.getByTestId('knowledge-review-item')).toHaveCount(3);
    await page.getByTestId('knowledge-review-filter-proposal').click();
    await page.getByTestId('knowledge-review-item').click();
    await expect(page.getByTestId('knowledge-review-apply')).toBeEnabled();
    await page.getByTestId('knowledge-steward-queue').getByText('Second decision').click();
    await expect(page.getByTestId('knowledge-review-apply')).toBeDisabled();
    await page.getByTestId('knowledge-review-prepare').click();
    await expect(page.getByTestId('knowledge-review-apply')).toBeEnabled();
    const readCalls = () => app.evaluate(() => (globalThis as unknown as { knowledgeQueueCalls: Array<{ action: string; payload: unknown }> }).knowledgeQueueCalls);
    expect((await readCalls()).filter((call) => ['reviewDraft', 'applyReviewedChange'].includes(call.action))).toEqual([]);
    await page.getByTestId('knowledge-review-apply').click();
    await expect.poll(async () => (await readCalls()).filter((call) => call.action === 'applyReviewedChange')).toEqual([{ action: 'applyReviewedChange', payload: { reviewBundleId: 'bundle-proposal-second' } }]);
    expect((await readCalls()).find((call) => call.action === 'reviewDraft')?.payload).toMatchObject({ id: 'draft-second', action: 'approve' });
    await page.getByTestId('knowledge-review-back').click();
    await page.getByTestId('knowledge-review-filter-draft').click();
    await page.getByTestId('knowledge-review-search').fill('Second');
    await expect(page.getByTestId('knowledge-review-item')).toHaveCount(1);
    await expect(page.getByTestId('knowledge-review-item')).toContainText('Second decision');
  } finally {
    await closeElectronApp(app);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Knowledge editing and Chat round trip fit supported widths in ${theme}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, theme });
    try {
      await installIpcMocks(app, { hostApi: knowledgeMocks });
      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId('sidebar-nav-knowledge').click();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId('knowledge-search-input').fill('decision');
      await page.getByTestId('knowledge-search-submit').click();
      await page.getByTestId('knowledge-search-result').click();
      await expect(page.getByTestId('knowledge-markdown-preview')).toContainText('Reviewed evidence.');
      await expect(page.getByTestId('knowledge-markdown-editor')).toHaveCount(0);
      await page.getByTestId('knowledge-editor-mode-split').click();
      await expect(page.getByTestId('knowledge-markdown-editor')).toBeVisible();
      await expect(page.getByTestId('knowledge-markdown-preview')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`knowledge-${theme}-1280-split.png`) });
      await page.setViewportSize({ width: 960, height: 800 });
      await expect(page.getByTestId('knowledge-markdown-editor')).toHaveCount(0);
      await expect(page.getByTestId('knowledge-editor-mode-split')).toHaveCount(0);
      await expect(page.getByTestId('knowledge-markdown-preview')).toBeVisible();
      await page.getByTestId('knowledge-editor-mode-edit').click();
      await page.getByTestId('knowledge-markdown-editor').fill('# Unfinished\nRetain these details.');
      await expect(page.getByTestId('knowledge-markdown-preview')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.getByTestId('main-content').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.getByTestId('main-content').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`knowledge-${theme}-960-edit.png`) });
      await page.getByTestId('knowledge-librarian-open').click();
      await expect(page.getByTestId('knowledge-chat-page')).toBeVisible();
      await expect(page).toHaveURL(/knowledge=ask/);
      await expect(page.getByTestId('knowledge-page')).toHaveCount(0);
      await expect(page.getByTestId('knowledge-librarian-composer')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`knowledge-${theme}-960-chat.png`) });
      await page.getByTestId('knowledge-chat-library').click();
      await expect(page.getByTestId('knowledge-markdown-editor')).toHaveValue('# Unfinished\nRetain these details.');
      await expect(page.getByTestId('knowledge-search-result')).toContainText('First decision');
      await expect(page.getByTestId('knowledge-search-input')).toHaveValue('decision');
      const legacyUrl = new URL(page.url());
      legacyUrl.searchParams.set('uiVersion', 'legacy');
      legacyUrl.hash = '/knowledge';
      await page.goto(legacyUrl.toString());
      await expect(page.getByTestId('main-layout')).toHaveAttribute('data-ui-version', 'v2');
      await expect.poll(() => page.getByTestId('main-content').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.getByTestId('main-content').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });
}
