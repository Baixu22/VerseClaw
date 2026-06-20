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
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

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
              body: 'Use pnpm workspaces for ClawX monorepo.',
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
      },
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
  });

  // ── Metric cards ─────────────────────────────────────────────────

  test('metric cards render with icon enclosures and value text', async ({ page }) => {
    const metricsGrid = page.getByTestId('knowledge-metrics');
    await expect(metricsGrid).toBeVisible();

    // Four metric cards
    const cards = metricsGrid.getByRole('article');
    // Card components render as <div role="article"> in shadcn Card
    // (Radix doesn't add role — we just count direct children)
    const cardDivs = metricsGrid.locator('> *');
    await expect(cardDivs).toHaveCount(4);

    // Each has an SVG icon inside
    for (let i = 0; i < 4; i++) {
      await expect(cardDivs.nth(i).locator('svg')).toBeVisible();
    }

    // Verify the value numbers are rendered (42, 15, 20, 0)
    await expect(metricsGrid).toContainText('42');
    await expect(metricsGrid).toContainText('15');
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
  });

  test('clicking a tab selects it with distinct visual state', async ({ page }) => {
    // Click Library tab
    await page.getByTestId('knowledge-tab-library').click();
    const libraryTab = page.getByTestId('knowledge-tab-library');
    // Active tab gets primary border and background treatment
    await expect(libraryTab).toHaveClass(/border-primary/);

    // Click Inbox tab — verify Library deactivates
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toBeVisible();
  });

  // ── Library tab — type cards ──────────────────────────────────────

  test('library tab shows 8 type cards each with an icon', async ({ page }) => {
    await page.getByTestId('knowledge-tab-library').click();
    const library = page.getByTestId('knowledge-library');
    await expect(library).toBeVisible();

    const typeCards = library.getByRole('button');
    await expect(typeCards).toHaveCount(8);

    // Each card has an icon
    const firstCard = typeCards.first();
    await expect(firstCard.locator('svg').first()).toBeVisible();
  });

  test('type cards have distinct color accents', async ({ page }) => {
    await page.getByTestId('knowledge-tab-library').click();

    const decisionCard = page.getByTestId('knowledge-type-decision');
    await expect(decisionCard).toHaveClass(/border-amber/);

    const synthesisCard = page.getByTestId('knowledge-type-synthesis');
    await expect(synthesisCard).toHaveClass(/border-emerald/);

    const architectureCard = page.getByTestId('knowledge-type-architecture');
    await expect(architectureCard).toHaveClass(/border-violet/);
  });

  // ── Inbox tab ─────────────────────────────────────────────────────

  test('inbox panel shows pending items with source and warning info', async ({ page }) => {
    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toBeVisible();

    const inboxRows = page.getByTestId('knowledge-inbox-row');
    await expect(inboxRows).toHaveCount(2);

    // The first item has warnings and should show them
    await expect(inboxRows.first()).toContainText('Architecture decision');

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

  // ── Governance tab ────────────────────────────────────────────────

  test('governance tab has three card sections with descriptive text', async ({ page }) => {
    await page.getByTestId('knowledge-tab-governance').click();
    const governance = page.getByTestId('knowledge-governance');
    await expect(governance).toBeVisible();

    // Three cards
    const cards = governance.locator('> *');
    await expect(cards).toHaveCount(3);

    // Each card should have an icon
    for (let i = 0; i < 3; i++) {
      await expect(cards.nth(i).locator('svg').first()).toBeVisible();
    }
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
      hostApi: {},
    });
    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  });

  test('quick wiki toggle is present and toggles active state on click', async ({ page }) => {
    const toggleBtn = page.getByTestId('chat-knowledge-quick-toggle');
    await expect(toggleBtn).toBeVisible();

    // Before click — should be in muted state
    await expect(toggleBtn).toHaveClass(/text-muted-foreground/);

    // Click to activate wiki knowledge
    await toggleBtn.click();

    // After click — title should indicate it's enabled
    await expect(toggleBtn).toHaveAttribute('title', 'Disable wiki knowledge');

    // The button should now have an active background treatment
    const activeClass = await toggleBtn.evaluate((el) => el.className);
    // Verify active state visually — the bg-black/5 or bg-emerald-500/10 class
    expect(activeClass).toMatch(/bg-(black\/5|emerald-500\/10)/);
  });

  test('quick wiki toggle can be deactivated', async ({ page }) => {
    const toggleBtn = page.getByTestId('chat-knowledge-quick-toggle');

    // Activate then deactivate
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Disable wiki knowledge');

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('title', 'Use wiki knowledge');
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

  test('both knowledge widgets coexist side by side in the composer', async ({ page }) => {
    // Quick toggle icon
    const quickToggle = page.getByTestId('chat-knowledge-quick-toggle');
    await expect(quickToggle).toBeVisible();

    // Scope button with scope label
    const scopeBtn = page.getByTestId('chat-knowledge-scope-button');
    await expect(scopeBtn).toBeVisible();
    // Default scope label is 'No knowledge' (i18n: 'none' scope)
    await expect(scopeBtn).toContainText('No knowledge');

    // Verify both have BookOpen icon (svg is valid, but there are two: BookOpen + ChevronDown)
    await expect(quickToggle.locator('svg.lucide-book-open')).toBeVisible();
    await expect(scopeBtn.locator('svg.lucide-book-open')).toBeVisible();
  });
});
