import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import type { ElectronApplication } from '@playwright/test';

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

async function installKnowledgeInvokeRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) return;
    (globalThis as unknown as { __clawxKnowledgeChatPayload?: unknown }).__clawxKnowledgeChatPayload = null;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
      if (request.module === 'chat' && request.action === 'sendWithMedia') {
        (globalThis as unknown as { __clawxKnowledgeChatPayload?: unknown }).__clawxKnowledgeChatPayload = request.payload;
        return { id: request.id as string | undefined, ok: true, data: { success: true, result: { runId: 'run-knowledge' } } };
      }
      if (request.module === 'workspaces' && request.action === 'saveState') {
        return { id: request.id as string | undefined, ok: true, data: { success: true } };
      }
      return previous(event, request);
    });
  });
}

async function installKnowledgeGovernanceRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) return;
    (globalThis as unknown as { __clawxKnowledgeRequests?: unknown[] }).__clawxKnowledgeRequests = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
      if (request.module === 'knowledge') {
        (globalThis as unknown as { __clawxKnowledgeRequests?: unknown[] }).__clawxKnowledgeRequests?.push(request);
        if (request.action === 'createDraft') {
          const payload = request.payload as Record<string, unknown> | undefined;
          return {
            id: request.id as string | undefined,
            ok: true,
            data: {
              success: true,
              draft: {
                id: 'draft-1',
                title: String(payload?.title ?? 'Knowledge Hub decision'),
                body: String(payload?.body ?? 'Keep Obsidian optional.'),
                type: 'synthesis',
                status: 'draft',
                sourceIds: Array.isArray(payload?.sourceIds) ? payload.sourceIds : ['notes/decision.md'],
                sourceRefs: [],
                tags: Array.isArray(payload?.tags) ? payload.tags : [],
                workspaceId: null,
                agentId: null,
                createdBy: 'user',
                createdAt: '2026-06-19T00:00:00.000Z',
                updatedAt: '2026-06-19T00:00:00.000Z',
              },
            },
          };
        }
        if (request.action === 'proposeChange') {
          return {
            id: request.id as string | undefined,
            ok: true,
            data: {
              success: true,
              proposal: {
                id: 'proposal-1',
                operation: 'create',
                status: 'proposed',
                draftId: 'draft-1',
                reason: 'User-created knowledge draft awaiting explicit review and apply.',
                sources: [{ id: 'notes/decision.md', kind: 'manual' }],
                requiresUserConfirmation: true,
                createdAt: '2026-06-19T00:00:00.000Z',
                updatedAt: '2026-06-19T00:00:00.000Z',
              },
            },
          };
        }
        if (request.action === 'reviewDraft') {
          return { id: request.id as string | undefined, ok: true, data: { success: true, draft: { id: 'draft-1', status: 'approved' } } };
        }
        if (request.action === 'applyReviewedChange') {
          return { id: request.id as string | undefined, ok: true, data: { success: true } };
        }
      }
      return previous(event, request);
    });
  });
}

test.describe('Knowledge Hub MVP', () => {
  test('initializes, imports, searches, inspects, and applies an editable draft', async ({ electronApp, page }) => {
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
            vaultExists: false,
            vaultPath: 'C:/clawx/wiki',
            vaultMode: 'isolated',
            renderMode: 'native',
            pageCounts: { source: 1, synthesis: 0 },
            sourceCounts: { native: 1 },
            warnings: [],
            obsidianCli: { available: false },
          },
        },
        [typed('knowledge', 'runtimeLessonsReport')]: {
          success: true,
          available: true,
          counts: { trajectories: 4, undistilledTrajectories: 1, activePrinciples: 1 },
          undistilled: [{
            trajectory_id: 'traj-e2e-1',
            created_at: '2026-07-06T00:00:00.000Z',
            task_intent: 'E2E runtime lesson capture',
            task_type: 'knowledge-ui',
            context_fingerprint: ['knowledge', 'runtime-lessons'],
            outcome: 'success',
            error_signature: null,
          }],
          activePrinciples: [{
            principle_id: 'principle-e2e-1',
            title: 'Keep Runtime Lessons review-only in Phase 1',
            task_types: ['knowledge-ui'],
            context_tags: ['knowledge'],
            criticality: 'medium',
            retrieval_count: 2,
            adoption_count: 1,
          }],
          indexPreview: 'E2E runtime lesson index',
        },
        [typed('knowledge', 'init')]: { success: true },
        [typed('knowledge', 'ingestFiles', { paths: ['C:/notes/decision.md'] })]: {
          success: true,
          items: [{ inputPath: 'C:/notes/decision.md', pageId: 'decision', pagePath: 'notes/decision.md' }],
          scanned: 1,
          imported: 1,
          failed: 0,
        },
        [typed('knowledge', 'listInboxItems', { status: 'pending', limit: 100 })]: {
          success: true,
          items: [{
            id: 'inbox-1',
            title: 'Task decision candidate',
            body: 'Use Knowledge Inbox before writing formal wiki pages.',
            kind: 'task-ledger',
            type: 'decision',
            status: 'pending',
            sourceIds: ['task-1'],
            sourceRefs: [{ id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' }],
            tags: ['governance'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            warnings: ['Needs user review before writing.'],
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          }],
        },
        [typed('knowledge', 'promoteInboxItemToDraft', { id: 'inbox-1' })]: {
          success: true,
          item: { id: 'inbox-1', status: 'promoted' },
          draft: {
            id: 'draft-inbox-1',
            title: 'Task decision candidate',
            body: 'Use Knowledge Inbox before writing formal wiki pages.',
            type: 'decision',
            status: 'draft',
            sourceIds: ['task-1'],
            sourceRefs: [],
            tags: ['governance'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
          proposal: {
            id: 'proposal-inbox-1',
            operation: 'create',
            status: 'proposed',
            draftId: 'draft-inbox-1',
            reason: 'Knowledge Inbox item promoted to an editable draft for explicit review and apply.',
            sources: [{ id: 'task-1', kind: 'task_ledger' }],
            requiresUserConfirmation: true,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'validateOkfBundle', { path: 'C:/okf' })]: {
          success: true,
          bundleId: 'okf-test',
          bundlePath: 'C:/okf',
          okfVersion: '0.1',
          summary: {
            scannedFiles: 4,
            markdownFiles: 4,
            conceptFiles: 2,
            validConcepts: 2,
            reservedFiles: 2,
            warnings: 1,
            errors: 0,
            truncated: false,
          },
          typeDistribution: { architecture: 1, decision: 1 },
          concepts: [{
            conceptId: 'guides/alpha',
            filePath: 'C:/okf/guides/alpha.md',
            frontmatter: { type: 'architecture', title: 'Alpha', resource: 'local', timestamp: '2026-06-20' },
            bodyPreview: 'Alpha architecture note.',
            links: ['missing.md'],
            citations: [],
            warnings: [{ code: 'brokenLink', message: 'Broken OKF link: missing.md', conceptId: 'guides/alpha' }],
          }, {
            conceptId: 'beta',
            filePath: 'C:/okf/beta.md',
            frontmatter: { type: 'decision', title: 'Beta' },
            bodyPreview: 'Beta decision note.',
            links: [],
            citations: [],
            warnings: [],
          }],
          warnings: [{ code: 'brokenLink', message: 'Broken OKF link: missing.md', conceptId: 'guides/alpha' }],
          errors: [],
        },
        [typed('knowledge', 'importOkfBundle', { path: 'C:/okf', conceptIds: ['guides/alpha'] })]: {
          success: true,
          bundleId: 'okf-test',
          bundlePath: 'C:/okf',
          imported: 1,
          skipped: 1,
          failed: 0,
          items: [{ conceptId: 'guides/alpha', inputPath: 'C:/okf/guides/alpha.md', pageId: 'alpha' }],
          mappingPath: 'C:/config/knowledge/okf/bundles/okf-test.json',
        },
        [typed('knowledge', 'search', { query: 'native wiki', maxResults: 12, corpus: 'wiki' })]: {
          success: true,
          results: [{ pagePath: 'notes/decision.md', title: 'Decision', snippet: 'Use native wiki.' }],
        },
        [typed('knowledge', 'get', { lookup: 'notes/decision.md', lineCount: 120, corpus: 'wiki' })]: {
          success: true,
          content: '# Decision\nUse native wiki.',
        },
        [typed('knowledge', 'recordKnowledgeReference', {
          targetId: 'notes/decision.md',
          targetKind: 'wiki-page',
          title: 'Decision',
          sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md' }],
          reference: { kind: 'search', lookup: 'notes/decision.md', query: 'native wiki' },
        })]: {
          success: true,
          record: {
            id: 'kpv-1',
            targetId: 'notes/decision.md',
            targetKind: 'wiki-page',
            title: 'Decision',
            sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md' }],
            references: [{ id: 'ref-1', kind: 'search', lookup: 'notes/decision.md', timestamp: '2026-06-20T00:00:00.000Z' }],
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'compile')]: { success: true },
        [typed('knowledge', 'lint')]: { success: true },
        [typed('knowledge', 'listDrafts', { status: 'all', limit: 100 })]: {
          success: true,
          drafts: [{
            id: 'draft-1',
            title: 'Knowledge Hub decision',
            body: 'Keep Obsidian optional.',
            type: 'synthesis',
            status: 'draft',
            sourceIds: ['notes/decision.md'],
            sourceRefs: [],
            tags: [],
            workspaceId: null,
            agentId: null,
            createdBy: 'user',
            createdAt: '2026-06-19T00:00:00.000Z',
            updatedAt: '2026-06-19T00:00:00.000Z',
          }],
        },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: {
          success: true,
          proposals: [{
            id: 'proposal-1',
            operation: 'create',
            status: 'proposed',
            draftId: 'draft-1',
            reason: 'User-created knowledge draft awaiting explicit review and apply.',
            sources: [{ id: 'notes/decision.md', kind: 'manual' }],
            requiresUserConfirmation: true,
            createdAt: '2026-06-19T00:00:00.000Z',
            updatedAt: '2026-06-19T00:00:00.000Z',
          }],
        },
        [typed('knowledge', 'createDraft', {
          title: 'Knowledge Hub decision',
          body: 'Keep Obsidian optional.',
          type: 'synthesis',
          sourceIds: ['notes/decision.md'],
          tags: [],
          createdBy: 'user',
        })]: {
          success: true,
          draft: {
            id: 'draft-1',
            title: 'Knowledge Hub decision',
            body: 'Keep Obsidian optional.',
            type: 'synthesis',
            status: 'draft',
            sourceIds: ['notes/decision.md'],
            sourceRefs: [],
            tags: [],
            workspaceId: null,
            agentId: null,
            createdBy: 'user',
            createdAt: '2026-06-19T00:00:00.000Z',
            updatedAt: '2026-06-19T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'proposeChange', {
          operation: 'create',
          draftId: 'draft-1',
          reason: 'User-created knowledge draft awaiting explicit review and apply.',
          sources: [{ id: 'notes/decision.md', kind: 'manual' }],
        })]: {
          success: true,
          proposal: {
            id: 'proposal-1',
            operation: 'create',
            status: 'proposed',
            draftId: 'draft-1',
            reason: 'User-created knowledge draft awaiting explicit review and apply.',
            sources: [{ id: 'notes/decision.md', kind: 'manual' }],
            requiresUserConfirmation: true,
            createdAt: '2026-06-19T00:00:00.000Z',
            updatedAt: '2026-06-19T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'reviewDraft', {
          id: 'draft-1',
          action: 'approve',
        })]: { success: true, draft: { id: 'draft-1', status: 'approved' } },
        [typed('knowledge', 'applyReviewedChange', { id: 'proposal-1' })]: { success: true },
        [typed('dialog', 'open', {
          title: 'Import knowledge files',
          properties: ['openFile', 'multiSelections'],
        })]: { canceled: false, filePaths: ['C:/notes/decision.md'] },
        [typed('dialog', 'open', {
          title: 'Select an OKF bundle folder',
          properties: ['openDirectory'],
        })]: { canceled: false, filePaths: ['C:/okf'] },
      },
    });
    await installKnowledgeGovernanceRecorder(electronApp);

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();

    await page.getByTestId('knowledge-tab-runtime').click();
    await expect(page.getByTestId('knowledge-runtime-lessons')).toBeVisible();
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('E2E runtime lesson capture');
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('Keep Runtime Lessons review-only in Phase 1');
    await expect(page.getByTestId('knowledge-runtime-lessons')).toContainText('E2E runtime lesson index');
    await expect(page.getByTestId('knowledge-runtime-lessons')).not.toContainText('Approve and Apply');

    await page.getByRole('button', { name: /Initialize/ }).click();
    await expect(page.getByText(/Knowledge vault initialized/)).toBeVisible();

    await page.getByRole('button', { name: /Import Files/ }).click();
    await expect(page.getByText(/Knowledge imported/)).toBeVisible();

    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Task decision candidate');
    await page.getByTestId('knowledge-inbox-promote').click();
    await expect(page.getByText(/Inbox item promoted to draft/)).toBeVisible();

    await page.getByRole('button', { name: /Validate OKF Bundle/ }).click();
    await expect(page.getByTestId('knowledge-okf-panel')).toBeVisible();
    await expect(page.getByTestId('knowledge-okf-panel')).toContainText('Broken OKF link: missing.md');
    await page.getByTestId('knowledge-okf-concept').nth(1).getByRole('checkbox').click();
    await expect(page.getByTestId('knowledge-okf-import')).toBeEnabled();
    await page.getByTestId('knowledge-okf-import').click();
    await expect(page.getByText(/OKF concepts imported/)).toBeVisible();

    await page.getByRole('button', { name: /Compile/ }).click();
    await expect(page.getByText(/Knowledge compiled/)).toBeVisible();
    await page.getByRole('button', { name: /Lint/ }).click();
    await expect(page.getByText(/Knowledge lint complete/)).toBeVisible();

    await page.getByTestId('knowledge-search-input').fill('native wiki');
    await page.getByTestId('knowledge-search-submit').click();
    await expect(page.getByTestId('knowledge-search-result').filter({ hasText: 'Decision' })).toBeVisible();

    await page.getByTestId('knowledge-search-result').click();
    await expect(page.getByTestId('knowledge-use-result-draft')).toBeVisible();
    await page.getByTestId('knowledge-use-result-draft').click();
    await expect(page.getByTestId('knowledge-draft-title')).toHaveValue('Decision');
    await expect(page.getByTestId('knowledge-draft-body')).toHaveValue('# Decision\nUse native wiki.');

    await page.getByTestId('knowledge-draft-title').fill('Knowledge Hub decision');
    await page.getByTestId('knowledge-draft-sources').fill('notes/decision.md');
    await page.getByTestId('knowledge-draft-body').fill('Keep Obsidian optional.');
    await expect(page.getByTestId('knowledge-draft-apply')).toBeEnabled();
    await page.getByTestId('knowledge-draft-apply').click();
    await expect(page.getByTestId('knowledge-review')).toBeVisible();
    await expect(page.getByTestId('knowledge-review')).toContainText('Knowledge Hub decision');
    await page.getByTestId('knowledge-review-apply').click();
    await expect(page.getByTestId('knowledge-error')).not.toBeVisible();
  });

  test('quickly enables wiki knowledge from the chat composer', async ({ electronApp, page }) => {
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
    await installKnowledgeInvokeRecorder(electronApp);

    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();

    await page.getByTestId('chat-knowledge-quick-toggle').click();
    await expect(page.getByTestId('chat-knowledge-quick-toggle')).toHaveAttribute('title', 'Disable wiki knowledge');

    await page.getByTestId('chat-composer-input').fill('Use my project notes for this answer');
    await page.getByTitle('Send').click();

    await expect.poll(async () => await electronApp.evaluate(() => (
      (globalThis as unknown as { __clawxKnowledgeChatPayload?: { knowledgeScope?: string } }).__clawxKnowledgeChatPayload?.knowledgeScope
    ))).toBe('wiki');
  });

  test('attaches wiki context through slash palette before sending', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [] },
        },
      },
      hostApi: {
        [typed('knowledge', 'search', { query: 'context palette', maxResults: 8, corpus: 'wiki' })]: {
          success: true,
          results: [{
            id: 'context-palette-page',
            title: 'Context Palette Notes',
            pagePath: 'knowledge/context-palette.md',
            snippet: 'Use slash commands to keep the composer clean.',
          }],
        },
        [typed('knowledge', 'recordKnowledgeReference', null)]: {
          success: true,
        },
      },
    });
    await installKnowledgeInvokeRecorder(electronApp);

    await completeSetup(page);
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible();

    await input.fill('/wiki context palette');
    await input.press('Enter');

    await expect(page.getByTestId('chat-knowledge-search-input')).toHaveValue('context palette');
    await expect(page.getByTestId('chat-knowledge-search-result')).toContainText('Context Palette Notes');
    await page.getByTestId('chat-knowledge-search-result').click();
    await expect(page.getByTestId('chat-knowledge-selected')).toContainText('Context Palette Notes');

    await page.getByTitle('Send').click();

    await expect.poll(async () => await electronApp.evaluate(() => (
      (globalThis as unknown as {
        __clawxKnowledgeChatPayload?: {
          knowledgeScope?: string;
          knowledgeReferences?: Array<{ id?: string; title?: string; lookup?: string; corpus?: string }>;
        };
      }).__clawxKnowledgeChatPayload
    ))).toMatchObject({
      knowledgeScope: 'wiki',
      knowledgeReferences: [{
        id: 'context-palette-page',
        title: 'Context Palette Notes',
        lookup: 'knowledge/context-palette.md',
        corpus: 'wiki',
      }],
    });
  });
});
