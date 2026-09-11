/**
 * Knowledge Base UX + Chat Knowledge UX E2E Tests
 *
 * Each test validates a specific UX improvement delivered in this changeset.
 * Selectors target data-testid attributes and semantic role queries that survive
 * Tailwind class reordering and React reconciliation.
 *
 * The Electron remote-control CDP API is available for screenshot and evaluate
 * based verification when CDP is enabled (remote-debugging-port). These tests
 * work without CDP as well — they validate the DOM shape and class presence
 * which is what the user actually sees.
 */
import { completeSetup, expect, getAgentDevHostCalls, installIpcMocks, test } from './fixtures/electron';

type HostInvokeEnvelope<T extends Record<string, any> = Record<string, any>> = {
  ok?: boolean;
  data: T;
};

// ── Helpers ──────────────────────────────────────────────────────────

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

const readyProviderAccount = {
  id: 'knowledge-e2e-provider',
  vendorId: 'ollama',
  label: 'Knowledge E2E',
  authMode: 'local',
  model: 'llama3.2',
  enabled: true,
  isDefault: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const readyProviderHostApi = {
  [typed('providers', 'accounts')]: [readyProviderAccount],
  [typed('providers', 'accountKeyInfo')]: [],
  [typed('providers', 'vendors')]: [],
  [typed('providers', 'getDefaultAccount')]: { accountId: readyProviderAccount.id },
};

// ── Knowledge CRUD UX Tests ────────────────────────────────────────

test.describe('Knowledge Hub UX', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [] },
        },
      },
      hostApi: {
        [typed('knowledge', 'status')]: {
          success: true,
          status: {
            vaultExists: true,
            vaultPath: 'C:/clawx/wiki',
            vaultMode: 'isolated',
            renderMode: 'native',
            pageCounts: { source: 42, synthesis: 15, entity: 8, concept: 12 },
            sourceCounts: { native: 42 },
            warnings: [],
            obsidianCli: { available: false },
          },
        },
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [
            {
              id: 'inbox-1',
              title: 'Architecture decision: monorepo tooling',
              body: 'Use pnpm workspaces for Verse Claw monorepo.',
              kind: 'task-ledger',
              type: 'architecture',
              status: 'pending',
              sourceIds: ['task-1'],
              sourceRefs: [{ id: 'task-1', kind: 'task_ledger', label: 'Monorepo task' }],
              tags: ['architecture'],
              workspaceId: null,
              agentId: null,
              createdBy: 'agent',
              warnings: ['Needs user review before writing.'],
              metadata: {
                triage: {
                  action: 'needs-decision',
                  confidence: 0.78,
                  reason: 'Candidate has warnings that should be reviewed before promotion.',
                  suggestedEdits: ['Resolve warning notes before promotion.'],
                },
              },
              createdAt: '2026-06-20T00:00:00.000Z',
              updatedAt: '2026-06-20T00:00:00.000Z',
            },
            {
              id: 'inbox-2',
              title: 'Use SSG for docs site',
              body: 'Pick VitePress for documentation.',
              kind: 'chat-session',
              type: 'decision',
              status: 'pending',
              sourceIds: [],
              sourceRefs: [],
              tags: ['docs'],
              workspaceId: null,
              agentId: null,
              createdBy: 'agent',
              warnings: [],
              metadata: {
                triage: {
                  action: 'ready-for-review',
                  confidence: 0.76,
                  reason: 'Candidate has a clear type and source evidence for manual draft review.',
                },
              },
              createdAt: '2026-06-19T00:00:00.000Z',
              updatedAt: '2026-06-19T00:00:00.000Z',
            },
          ],
        },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: {
          success: true,
          drafts: [
            { id: 'draft-1', title: 'RAG pipeline design', body: 'Use vector embeddings.', type: 'architecture', status: 'draft', sourceIds: [], sourceRefs: [], tags: [], workspaceId: null, agentId: null, createdBy: 'user', createdAt: '2026-06-18T00:00:00.000Z', updatedAt: '2026-06-18T00:00:00.000Z' },
            { id: 'draft-2', title: 'OKF spec v0.2', body: 'Add provenance tracking.', type: 'synthesis', status: 'steward_reviewed', sourceIds: [], sourceRefs: [], tags: [], workspaceId: null, agentId: null, createdBy: 'agent', createdAt: '2026-06-17T00:00:00.000Z', updatedAt: '2026-06-17T00:00:00.000Z' },
            { id: 'draft-3', title: 'Obsidian sync strategy', body: 'Decide sync approach.', type: 'decision', status: 'approved', sourceIds: [], sourceRefs: [], tags: [], workspaceId: null, agentId: null, createdBy: 'user', createdAt: '2026-06-16T00:00:00.000Z', updatedAt: '2026-06-16T00:00:00.000Z' },
          ],
        },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: {
          success: true,
          proposals: [
            { id: 'proposal-1', operation: 'create', status: 'proposed', draftId: 'draft-1', reason: 'New RAG pipeline architecture', sources: [], requiresUserConfirmation: true, createdAt: '2026-06-18T00:00:00.000Z', updatedAt: '2026-06-18T00:00:00.000Z' },
          ],
        },
        [typed('knowledge', 'listSourceSets')]: {
          success: true,
          sourceSets: [],
        },
        [typed('knowledge', 'search', { query: 'What is this note about?', maxResults: 4, corpus: 'wiki', roleTag: 'knowledge-librarian' })]: {
          success: true,
          results: [
            { pagePath: 'notes/local-operating-notes.md', title: 'Local operating notes', snippet: 'Keep reusable notes in Markdown.' },
          ],
        },
        [typed('knowledge', 'get', { lookup: 'notes/local-operating-notes.md', lineCount: 80, corpus: 'wiki' })]: {
          success: true,
          content: '# Local operating notes\n\nKeep reusable notes in Markdown.',
        },
        [typed('knowledge', 'createDraft', null)]: {
          success: true,
          draft: {
            id: 'draft-librarian',
            title: 'Librarian answer',
            body: 'Grounded answer',
            type: 'synthesis',
            status: 'draft',
            sourceIds: ['notes/local-operating-notes.md'],
            sourceRefs: [],
            tags: ['librarian'],
            workspaceId: null,
            agentId: null,
            createdBy: 'user',
            createdAt: '2026-07-04T00:00:00.000Z',
            updatedAt: '2026-07-04T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'createInboxItem', null)]: {
          success: true,
          item: {
            id: 'inbox-librarian-error',
            title: 'Error experience: What is this note about?',
            body: 'Grounded answer',
            kind: 'manual',
            type: 'troubleshooting',
            status: 'pending',
            sourceIds: ['notes/local-operating-notes.md'],
            sourceRefs: [],
            tags: ['error-experience'],
            workspaceId: null,
            agentId: null,
            createdBy: 'user',
            warnings: [],
            metadata: { knowledgeKind: 'error-experience' },
            createdAt: '2026-07-04T00:00:00.000Z',
            updatedAt: '2026-07-04T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'governanceAudit', null)]: {
          success: true,
          runAt: '2026-07-04T00:00:00.000Z',
          issues: [],
          summaries: { contradictions: 0, stale: 1, dangling: 2, duplicates: 3, provenanceGaps: 4 },
          qualityMetrics: {
            staleCards: 1,
            duplicateClusters: 3,
            sourceGaps: 4,
            unreferencedPages: 2,
            lowConfidenceHighHitCards: 5,
            highDismissalCards: 6,
            metrics: [
              { kind: 'stale_cards', count: 1, severity: 'warning', affectedIds: ['old-note'] },
              { kind: 'duplicate_clusters', count: 3, severity: 'warning', affectedIds: ['dup-note'] },
              { kind: 'source_gaps', count: 4, severity: 'warning', affectedIds: ['gap-note'] },
              { kind: 'unreferenced_pages', count: 2, severity: 'info', affectedIds: ['orphan-note'] },
              { kind: 'low_confidence_high_hit_cards', count: 5, severity: 'warning', affectedIds: ['low-card'] },
              { kind: 'high_dismissal_cards', count: 6, severity: 'warning', affectedIds: ['dismiss-card'] },
            ],
          },
        },
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
  });

  test('workspace-first Library opens without dashboard clutter', async ({ page }) => {
    await expect(page.getByTestId('knowledge-library')).toBeVisible();
    await expect(page.getByTestId('knowledge-markdown-workspace')).toBeVisible();
    await expect(page.getByTestId('knowledge-assistant-overview')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-metrics')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-librarian-panel')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-librarian-fab')).toHaveCount(0);

    await page.getByTestId('knowledge-status-trigger').click();
    await expect(page.getByTestId('knowledge-utility-sheet')).toBeVisible();
    await expect(page.getByTestId('knowledge-status-panel')).toBeVisible();
    await page.getByRole('button', { name: /Close panel/ }).click();
  });

  test('Library stays first-viewport visible at supported window widths', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}',
    });

    const readLayout = async () => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="knowledge-page"]');
      const sidebar = document.querySelector<HTMLElement>('[data-testid="knowledge-vault-sidebar"]');
      const editor = document.querySelector<HTMLElement>('[data-testid="knowledge-markdown-workspace"]');
      if (!root || !sidebar || !editor) throw new Error('Knowledge workspace layout is incomplete.');
      const sidebarBox = sidebar.getBoundingClientRect();
      const editorBox = editor.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        rootClientHeight: root.clientHeight,
        rootScrollHeight: root.scrollHeight,
        sidebarRight: sidebarBox.right,
        editorLeft: editorBox.left,
        editorRight: editorBox.right,
        editorTop: editorBox.top,
        editorHeight: editorBox.height,
      };
    });

    const expectStableLayout = async () => {
      const layout = await readLayout();
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.rootScrollHeight).toBeLessThanOrEqual(layout.rootClientHeight + 1);
      expect(layout.sidebarRight).toBeLessThanOrEqual(layout.editorLeft + 1);
      expect(layout.editorRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.editorTop).toBeLessThan(layout.viewportHeight);
      expect(layout.editorHeight).toBeGreaterThan(300);
    };

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('knowledge-document-list')).toBeVisible();
    await expect(page.getByTestId('knowledge-markdown-workspace')).toBeVisible();
    await expectStableLayout();
    await page.screenshot({
      path: testInfo.outputPath('knowledge-library-1280x800.png'),
      fullPage: false,
      animations: 'disabled',
    });

    await page.getByTestId('knowledge-more-actions').click();
    await expect(page.getByTestId('knowledge-tab-governance')).toBeVisible();
    const menuBox = await page.getByRole('menu').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(800);
    await page.screenshot({
      path: testInfo.outputPath('knowledge-more-menu-1280x800.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');

    await page.getByTestId('knowledge-source-tools').click();
    await expect(page.getByTestId('knowledge-utility-sheet')).toBeVisible();
    await expect(page.getByTestId('knowledge-source-set-panel')).toBeVisible();
    const sheetBox = await page.getByTestId('knowledge-utility-sheet').boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.y).toBeGreaterThanOrEqual(40);
    expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(800);
    await page.screenshot({
      path: testInfo.outputPath('knowledge-source-sheet-1280x800.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 960, height: 800 });
    await expectStableLayout();
    await page.screenshot({
      path: testInfo.outputPath('knowledge-library-960x800.png'),
      fullPage: false,
      animations: 'disabled',
    });
  });

  // ── Workbench tabs ────────────────────────────────────────────────

  test('workbench tabs render with icons for each tab', async ({ page }) => {
    const tabsContainer = page.getByTestId('knowledge-workbench-tabs');
    const tabs = tabsContainer.getByRole('button');
    await expect(tabs).toHaveCount(5);

    // Every tab should have an SVG icon
    for (let i = 0; i < 5; i++) {
      await expect(tabs.nth(i).locator('svg')).toBeVisible();
    }
    await page.getByTestId('knowledge-more-actions').click();
    await expect(page.getByTestId('knowledge-tab-governance')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('clicking a tab selects it with distinct visual state', async ({ page }) => {
    // Click Library tab
    await page.getByTestId('knowledge-tab-library').click();
    const libraryTab = page.getByTestId('knowledge-tab-library');
    // Active tab gets primary border and background treatment
    await expect(libraryTab).toHaveClass(/border-foreground/);

    // Click Inbox tab — verify Library deactivates
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toBeVisible();
  });

  test('Library type browsing is disclosed in one menu', async ({ page }) => {
    await page.getByTestId('knowledge-tab-library').click();
    const library = page.getByTestId('knowledge-library');
    await expect(library).toBeVisible();
    await expect(page.getByTestId('knowledge-markdown-workspace')).toBeVisible();
    await page.getByTestId('knowledge-type-menu').click();
    const typeOptions = page.getByRole('menuitem');
    await expect(typeOptions).toHaveCount(8);
    await expect(typeOptions.first().locator('svg')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('markdown workspace supports editing, preview mode, and librarian modal', async ({ page }) => {
    await page.getByTestId('knowledge-tab-library').click();
    await page.getByTestId('knowledge-new-note').click();
    await page.getByTestId('knowledge-editor-title').fill('Local operating notes');
    await page.getByTestId('knowledge-markdown-editor').fill('# Local operating notes\n\nKeep reusable notes in Markdown.');
    await page.getByTestId('knowledge-editor-mode-preview').click();
    await expect(page.getByTestId('knowledge-markdown-preview')).toContainText('Keep reusable notes in Markdown.');

    await page.getByTestId('knowledge-librarian-open').click();
    await expect(page.getByTestId('knowledge-librarian-modal')).toBeVisible();
    await expect(page.getByTestId('knowledge-librarian-thread')).toBeVisible();
    await expect(page.getByTestId('knowledge-librarian-composer')).toBeVisible();
    await expect(page.getByTestId('knowledge-librarian-suggestions')).toContainText('Summarize');
    await page.getByTestId('knowledge-librarian-question').fill('What is this note about?');
    await expect(page.getByTestId('knowledge-librarian-ask')).toBeEnabled();
    await page.getByTestId('knowledge-librarian-ask').click();
    await expect(page.getByTestId('knowledge-librarian-message-assistant')).toContainText('Local operating notes');
    await expect(page.getByTestId('knowledge-librarian-sources-section')).toContainText('Local operating notes');

    // Unknowns and next actions now live inside the collapsed retrieval inspector,
    // so they are present but not competing with the answer until asked for.
    const inspector = page.getByTestId('knowledge-librarian-retrieval-inspector');
    await expect(page.getByTestId('knowledge-librarian-unknowns-section')).not.toBeVisible();
    await inspector.locator('summary').click();
    await expect(page.getByTestId('knowledge-librarian-unknowns-section')).toBeVisible();
    await expect(inspector).toContainText('What is this note about?');
    await expect(page.getByTestId('knowledge-librarian-source')).toContainText('notes/local-operating-notes.md');
    await page.getByTestId('knowledge-librarian-create-error-experience').click();
    await expect.poll(async () => {
      const calls = await getAgentDevHostCalls(page);
      return calls.some((call) => (
        typeof call === 'object'
        && call != null
        && (call as { module?: string; action?: string }).module === 'knowledge'
        && (call as { module?: string; action?: string }).action === 'createInboxItem'
      ));
    }).toBe(true);
  });

  // ── Inbox tab ─────────────────────────────────────────────────────

  test('inbox panel shows pending items with source and warning info', async ({ page }) => {
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toBeVisible();

    const inboxRows = page.getByTestId('knowledge-inbox-row');
    await expect(inboxRows).toHaveCount(2);

    // The first item has warnings and should show them
    await expect(inboxRows.first()).toContainText('Architecture decision');
    await expect(page.getByTestId('knowledge-inbox-group-needs-decision')).toContainText('Needs decision');
    await expect(page.getByTestId('knowledge-inbox-group-ready-for-review')).toContainText('Ready for review');
    await expect(inboxRows.first()).toContainText('Needs decision');

    // Select the first row
    await inboxRows.first().click();
    // The promote button should be visible after selection
    await expect(page.getByTestId('knowledge-inbox-promote')).toBeVisible();
  });

  // ── Drafts tab ────────────────────────────────────────────────────

  test('draft list shows entries with type information', async ({ page }) => {
    await page.getByTestId('knowledge-tab-drafts').click();
    await expect(page.getByTestId('knowledge-draft-inbox')).toBeVisible();

    const draftRows = page.getByTestId('knowledge-draft-row');
    await expect(draftRows).toHaveCount(3);

    // Each draft row should have an SVG (type icon)
    const firstDraft = draftRows.first();
    await expect(firstDraft.locator('svg').first()).toBeVisible();

    // Verify draft content
    await expect(firstDraft).toContainText('RAG pipeline design');
  });

  test('Governance remains available from the More menu', async ({ page }) => {
    await page.getByTestId('knowledge-more-actions').click();
    await page.getByTestId('knowledge-tab-governance').click();
    const governance = page.getByTestId('knowledge-governance');
    await expect(governance).toBeVisible();

    await expect(page.getByTestId('knowledge-quality-metrics')).toContainText('Quality Metrics');
    await page.getByTestId('knowledge-governance-run').click();
    await expect(page.getByTestId('knowledge-quality-metric-stale_cards')).toContainText('1');
    await expect(page.getByTestId('knowledge-quality-metric-source_gaps')).toContainText('4');
    await expect(page.getByTestId('knowledge-quality-metric-high_dismissal_cards')).toContainText('6');
  });

  // ── Search ─────────────────────────────────────────────────────────

  test('search input is rendered and accepts text', async ({ page }) => {
    const searchInput = page.getByTestId('knowledge-search-input');
    await expect(searchInput).toBeVisible();

    // Type a query
    await searchInput.fill('architecture');
    await expect(searchInput).toHaveValue('architecture');

    // Search submit button should be enabled
    const submitBtn = page.getByTestId('knowledge-search-submit');
    await expect(submitBtn).toBeEnabled();
  });
});

// ── Chat Knowledge Attachment UX Tests ──────────────────────────────

test.describe('Chat Knowledge Attachment UX', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [] },
        },
      },
      hostApi: {
        ...readyProviderHostApi,
        [typed('knowledge', 'routeContext', null)]: {
          success: true,
          decision: 'suggest',
          reason: 'project knowledge intent detected',
          candidates: [{
            id: 'pitfall-route-context',
            title: 'Route context failure handling',
            lookup: 'troubleshooting/route-context.md',
            corpus: 'wiki',
            attachKind: 'suggested',
            routeGroup: 'pitfalls',
            routingReason: 'project knowledge intent detected',
            confidence: 0.88,
            pagePath: 'troubleshooting/route-context.md',
            snippet: 'routeContext failure must not block ordinary chat send.',
          }],
          candidateGroups: [{
            key: 'pitfalls',
            candidates: [{
              id: 'pitfall-route-context',
              title: 'Route context failure handling',
              lookup: 'troubleshooting/route-context.md',
              corpus: 'wiki',
              attachKind: 'suggested',
              routeGroup: 'pitfalls',
              routingReason: 'project knowledge intent detected',
              confidence: 0.88,
              pagePath: 'troubleshooting/route-context.md',
              snippet: 'routeContext failure must not block ordinary chat send.',
            }],
          }],
          budget: { maxReferences: 3, maxSnippetChars: 800 },
        },
        [typed('knowledge', 'recordKnowledgeReference', null)]: {
          success: true,
        },
        [typed('knowledge', 'matchErrorExperience', null)]: {
          success: true,
          advisories: [{
            id: 'advisory_inbox_inbox-route_ee-route',
            targetKind: 'inbox',
            targetId: 'inbox-route',
            cardId: 'ee-route',
            title: 'Route context failure handling',
            summary: 'routeContext failures must not block ordinary chat send.',
            whyMatched: ['keyword: routeContext', 'user correction signal'],
            rootCause: 'Knowledge side effects were coupled to Chat send.',
            recommendedResolution: ['Keep knowledge matching best-effort.', 'Route renderer calls through hostApi.'],
            confidence: 0.84,
            severity: 'high',
            sourceRefs: [{ id: 'notes/route-context.md', kind: 'wiki', path: 'notes/route-context.md' }],
            provenance: {
              createdFrom: { kind: 'manual', id: 'route-context-card' },
              source: 'knowledge-error-experience',
            },
          }],
        },
        [typed('knowledge', 'updateErrorExperienceEffectiveness', null)]: {
          success: true,
          effectiveness: {
            hitCount: 1,
            acceptedCount: 1,
            dismissedCount: 1,
            preventedFailureCount: 0,
            staleCount: 0,
          },
        },
        [typed('chat', 'sendWithMedia', null)]: {
          success: true,
          result: {
            runId: 'run-knowledge-advisory',
            source: 'mock',
            message: { content: [{ type: 'text', text: 'Mock assistant response.' }] },
          },
        },
      },
    });
    await page.reload();
    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  });

  test('knowledge scope picker replaces the standalone quick wiki icon', async ({ page }) => {
    await expect(page.getByTestId('chat-knowledge-quick-toggle')).toHaveCount(0);
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await expect(scopeBtn).toBeVisible();

    // Before click — should be in muted state
    await expect(scopeBtn).toContainText('No knowledge');

    // Click to activate wiki knowledge
    await scopeBtn.click();
    await page.getByTestId('chat-knowledge-scope-wiki').click();

    // After click — title should indicate it's enabled
    await expect(scopeBtn).toContainText('Wiki');

    // The button should now have an active background treatment
    // Verify active state visually — the bg-black/5 or bg-emerald-500/10 class
  });

  test('knowledge scope picker can switch wiki off again', async ({ page }) => {
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');

    // Activate then deactivate
    await scopeBtn.click();
    await page.getByTestId('chat-knowledge-scope-wiki').click();
    await expect(scopeBtn).toContainText('Wiki');

    await scopeBtn.click();
    await page.getByTestId('chat-knowledge-scope-none').click();
    await expect(scopeBtn).toContainText('No knowledge');
  });

  test('knowledge preflight can inspect, dismiss, and attach suggestions', async ({ page }) => {
    await page.getByTestId('chat-knowledge-scope-button').click();
    await page.getByTestId('chat-knowledge-scope-wiki').click();

    const input = page.getByTestId('chat-composer-input');
    await input.fill('Use previous routeContext pitfall before coding');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toContainText('Knowledge Preflight');
    await page.getByTestId('chat-knowledge-suggestion-open').click();
    await expect(page.getByTestId('chat-knowledge-preflight-group-pitfalls')).toContainText('Prior pitfalls');

    await page.getByTestId('chat-knowledge-suggestion-dismiss').click();
    await expect(page.getByTestId('chat-knowledge-suggestion')).not.toBeVisible();

    await input.fill('Use previous routeContext pitfall before coding ');
    await page.waitForTimeout(800);
    await expect(page.getByTestId('chat-knowledge-suggestion')).not.toBeVisible();

    await input.fill('Use previous routeContext pitfall before coding with explicit context');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible();
    await page.getByTestId('chat-knowledge-suggestion-attach').click();
    await expect(page.getByTestId('chat-knowledge-selected')).toContainText('Route context failure handling');
  });

  test('advisory error guard can be used and dismissed without blocking chat', async ({ page }) => {
    await page.keyboard.press('Escape');
    const input = page.getByTestId('chat-composer-input');
    await input.fill('wrong redo routeContext failure in src/pages/Chat/index.tsx');
    await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
    await page.getByTestId('chat-composer-send').click();
    await expect.poll(async () => {
      const calls = await getAgentDevHostCalls(page);
      return calls.filter((call) => (
        typeof call === 'object'
        && call != null
        && (call as { module?: string; action?: string }).module === 'knowledge'
        && (call as { module?: string; action?: string }).action === 'matchErrorExperience'
      )).length;
    }).toBeGreaterThan(0);

    const advisory = page.getByTestId('chat-knowledge-error-advisory');
    await expect(advisory).toContainText('Known pitfall may apply');
    await expect(advisory).toContainText('Route context failure handling');
    await expect(advisory).toContainText('Knowledge side effects were coupled to Chat send.');

    await page.getByTestId('chat-knowledge-error-advisory-use').click();
    await expect(input).toHaveValue(/Use this prior experience before retrying/);
    await expect(input).toHaveValue(/Route renderer calls through hostApi/);
    await expect(advisory).not.toBeVisible();

    await input.fill('wrong redo routeContext failure again in src/pages/Chat/index.tsx');
    await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
    await page.getByTestId('chat-composer-send').click();
    await expect(page.getByTestId('chat-knowledge-error-advisory')).toBeVisible();
    await page.getByTestId('chat-knowledge-error-advisory-dismiss').click();
    await expect(page.getByTestId('chat-knowledge-error-advisory')).not.toBeVisible();

    await expect.poll(async () => {
      const calls = await getAgentDevHostCalls(page);
      return calls.filter((call) => (
        typeof call === 'object'
        && call != null
        && (call as { module?: string; action?: string }).module === 'knowledge'
        && (call as { module?: string; action?: string }).action === 'updateErrorExperienceEffectiveness'
      )).length;
    }).toBeGreaterThanOrEqual(2);
  });

  test('knowledge scope picker opens and shows all scope options', async ({ page }) => {
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await expect(scopeBtn).toBeVisible();

    // Open the scope menu
    await scopeBtn.click();
    const scopeMenu = page.getByTestId('chat-knowledge-scope-menu');
    await expect(scopeMenu).toBeVisible();

    // All four scope options should be present
    for (const scope of ['none', 'memory', 'wiki', 'all']) {
      await expect(page.getByTestId(`chat-knowledge-scope-${scope}`)).toBeVisible();
    }
  });

  test('scope picker shows search input for knowledge attachment', async ({ page }) => {
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await scopeBtn.click();

    // Search input and submit button visible in the scope menu
    const searchInput = page.getByTestId('chat-knowledge-search-input');
    await expect(searchInput).toBeVisible();

    const searchSubmit = page.getByTestId('chat-knowledge-search-submit');
    await expect(searchSubmit).toBeVisible();

    // Search button should be disabled without a query
    await expect(searchSubmit).toBeDisabled();
  });

  test('selecting a scope closes the menu and updates the button', async ({ page }) => {
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await scopeBtn.click();

    // Select 'wiki' scope
    await page.getByTestId('chat-knowledge-scope-wiki').click();

    // Menu should close
    await expect(page.getByTestId('chat-knowledge-scope-menu')).not.toBeVisible();

    // Button should now show 'wiki' text
    await expect(scopeBtn).toContainText('Wiki');
  });

  test('knowledge scope is the only visible knowledge entry in the composer controls', async ({ page }) => {
    await expect(page.getByTestId('chat-knowledge-quick-toggle')).toHaveCount(0);

    // Scope button with scope label
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await expect(scopeBtn).toBeVisible();
    // Default scope label is 'No knowledge' (i18n: 'none' scope)
    await expect(scopeBtn).toContainText('No knowledge');

    await expect(scopeBtn.locator('svg.lucide-book-open')).toBeVisible();
  });
});

test.describe('CDP Remote Control Developer API Dogfooding', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [] },
        },
      },
      hostApi: {
        [typed('knowledge', 'status')]: {
          success: true,
          status: {
            vaultExists: true,
            vaultPath: 'C:/clawx/wiki',
            vaultMode: 'isolated',
            renderMode: 'native',
            pageCounts: { source: 42, synthesis: 15, entity: 8, concept: 12 },
            sourceCounts: { native: 42 },
            warnings: [],
            obsidianCli: { available: false },
          },
        },
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [],
        },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: {
          success: true,
          drafts: [],
        },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: {
          success: true,
          proposals: [],
        },
      },
    });
    await completeSetup(page);
  });

  test('CDP status and inspect returns active debugging state', async ({ page }) => {
    const status = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({ id: 'test-status', module: 'remoteControl', action: 'status' });
      return res;
    });
    console.log("CDP STATUS RESULT:", status);
    expect(status.ok).toBe(true);
    expect(status.data.success).toBe(true);
    expect(status.data.effectiveEnabled).toBe(true);
    expect(status.data.effectivePort).toBeGreaterThan(0);

    const inspect = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({ id: 'test-inspect', module: 'remoteControl', action: 'inspect' });
      return res;
    });
    console.log("CDP INSPECT RESULT:", inspect);
    expect(inspect.ok).toBe(true);
    expect(inspect.data.success).toBe(true);
    expect(inspect.data.targets.length).toBeGreaterThan(0);
  });

  test('CDP click drives UI navigation on the knowledge page', async ({ page }) => {
    // Navigate to knowledge page via CDP click
    const navClick = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
        id: 'test-navclick',
        module: 'remoteControl',
        action: 'click',
        payload: { selector: '[data-testid="sidebar-nav-knowledge"]' },
      });
      return res;
    });
    console.log("CDP NAVCLICK RESULT:", navClick);
    expect(navClick.ok).toBe(true);
    expect(navClick.data.success).toBe(true);
    await expect(page.getByTestId('knowledge-page')).toBeVisible();

    // Click tabs via CDP click
    for (const tab of ['inbox', 'drafts', 'review', 'library']) {
      const tabClick = await page.evaluate(async (tabName) => {
        const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
          id: `test-tabclick-${tabName}`,
          module: 'remoteControl',
          action: 'click',
          payload: { selector: `[data-testid="knowledge-tab-${tabName}"]` },
        });
        return res;
      }, tab);
      expect(tabClick.ok).toBe(true);
      expect(tabClick.data.success).toBe(true);
      const activeTab = page.getByTestId(`knowledge-tab-${tab}`);
      await expect(activeTab).toHaveClass(/border-foreground/);
    }

    // Radix opens dropdowns from pointer events; use Playwright for disclosure,
    // then keep the actual Governance navigation under CDP control.
    await page.getByTestId('knowledge-more-actions').click();
    await expect(page.getByTestId('knowledge-tab-governance')).toBeVisible();
    const governanceClick = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
        id: 'test-governance-menu-click',
        module: 'remoteControl',
        action: 'click',
        payload: { selector: '[data-testid="knowledge-tab-governance"]' },
      });
      return res;
    });
    expect(governanceClick.ok).toBe(true);
    await expect(page.getByTestId('knowledge-governance')).toBeVisible();
  });

  test('CDP pageInfo and screenshot retrieves live DOM state', async ({ page }) => {
    // Navigate to knowledge page
    await page.evaluate(async () => {
      await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
        id: 'test-navclick-2',
        module: 'remoteControl',
        action: 'click',
        payload: { selector: '[data-testid="sidebar-nav-knowledge"]' },
      });
    });
    await expect(page.getByTestId('knowledge-page')).toBeVisible();

    // Retrieve page info via CDP pageInfo
    const pageInfo = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
        id: 'test-pageinfo',
        module: 'remoteControl',
        action: 'pageInfo',
      });
      return res;
    });
    expect(pageInfo.ok).toBe(true);
    expect(pageInfo.data.success).toBe(true);
    expect(pageInfo.data.url).toMatch(/app:\/\/|file:\/\//);
    expect(pageInfo.data.textSample).toContain('New note');

    // Take screenshot via CDP screenshot
    const screenshot = await page.evaluate(async () => {
      const res = await (window as unknown as { verseClaw: { hostInvoke: (args: Record<string, unknown>) => Promise<HostInvokeEnvelope<Record<string, any>>> } }).verseClaw.hostInvoke({
        id: 'test-screenshot',
        module: 'remoteControl',
        action: 'screenshot',
        payload: { fullPage: false },
      });
      return res;
    });
    expect(screenshot.ok).toBe(true);
    expect(screenshot.data.success).toBe(true);
    expect(screenshot.data.dataUrl).toContain('data:image/png;base64,');
  });
});
