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
    const runtimeSuggestionToConfirm = {
      cluster_summary: 'Keep knowledge changes reviewable.',
      source_trajectory_ids: ['traj-e2e-1'],
      suggested_principle: {
        title: 'Review before durable knowledge writes',
        condition: 'A runtime lesson is proposed for reuse.',
        action: 'Show the proposal and require explicit confirmation.',
        reason: 'Suggestion generation is not durable approval.',
        task_types: ['knowledge-ui'],
        context_tags: ['knowledge', 'review'],
        criticality: 'high',
      },
      confidence: 0.91,
    };
    const runtimeSuggestionToReject = {
      cluster_summary: 'Reject low-value candidates.',
      source_trajectory_ids: ['traj-e2e-2'],
      suggested_principle: {
        title: 'Reject sparse runtime lessons',
        condition: 'A candidate lacks reusable evidence.',
        action: 'Reject it without promotion.',
        reason: 'Sparse evidence should not enter durable knowledge.',
      },
      confidence: 0.72,
    };

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
          counts: { trajectories: 4, undistilledTrajectories: 2, activePrinciples: 1 },
          undistilled: [{
            trajectory_id: 'traj-e2e-1',
            created_at: '2026-07-06T00:00:00.000Z',
            task_intent: 'E2E runtime lesson capture',
            task_type: 'knowledge-ui',
            context_fingerprint: ['knowledge', 'runtime-lessons'],
            outcome: 'success',
            error_signature: null,
            lineage: {
              schema: 'runtime-lineage.v1',
              sessionId: 'session-e2e-runtime-1',
              missionId: 'mission-e2e-1',
              missionTick: 1,
              loopRunId: 'loop-e2e-1',
              traceId: 'trace-e2e-1',
              taskLedgerRootId: 'ledger-e2e-1',
            },
          }, {
            trajectory_id: 'traj-e2e-2',
            created_at: '2026-07-06T00:01:00.000Z',
            task_intent: 'Discard a sparse lesson',
            task_type: 'knowledge-ui',
            context_fingerprint: ['knowledge', 'review'],
            outcome: 'partial',
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
            source_trajectories: ['traj-e2e-1'],
            lineage: {
              schema: 'runtime-lineage.v1',
              sessionId: 'session-e2e-runtime-1',
              missionId: 'mission-e2e-1',
              missionTick: 1,
              loopRunId: 'loop-e2e-1',
              traceId: 'trace-e2e-1',
              taskLedgerRootId: 'ledger-e2e-1',
            },
          }],
          indexPreview: 'E2E runtime lesson index',
        },
        [typed('knowledge', 'sekbSuggestPrinciples', { trajectoryIds: ['traj-e2e-1', 'traj-e2e-2'] })]: {
          success: true,
          available: true,
          mode: 'deterministic',
          suggestions: [runtimeSuggestionToConfirm, runtimeSuggestionToReject],
        },
        [typed('knowledge', 'sekbConfirmPrinciple', {
          suggestion: runtimeSuggestionToConfirm,
          sessionId: 'session-e2e-runtime-1',
          sourceSystem: 'ui-confirm',
          integrityClaim: 'confirmed',
        })]: {
          success: true,
          available: true,
          principleId: 'principle-e2e-confirmed',
          provenance: {
            schema: 'sekb-confirm-provenance.v1',
            sessionId: 'session-e2e-runtime-1',
            sourceSystem: 'ui-confirm',
            sourceTrajectoryIds: ['traj-e2e-1'],
            integrity: 'confirmed',
            confirmedAt: '2026-07-06T00:02:00.000Z',
            revokeKey: 'revoke:sekb-principle:principle-e2e-confirmed',
            taskId: 'P3-002',
            findingIds: ['F-DATA-002', 'F-DATA-004'],
            summaryOnlyClaimDowngraded: false,
            highTrustEligible: true,
          },
          dcsWrite: 'written',
          principleOnly: false,
        },
        [typed('knowledge', 'sekbRejectSuggestion', { suggestion: runtimeSuggestionToReject })]: {
          success: true,
          available: true,
        },
        [typed('knowledge', 'sekbRetrieveForTask', {
          taskIntent: 'Review a runtime lesson',
          taskType: 'knowledge-ui',
          contextTags: ['knowledge', 'review'],
          topK: 5,
        })]: {
          success: true,
          available: true,
          principles: [{
            principle_id: 'principle-e2e-confirmed',
            title: 'Review before durable knowledge writes',
            condition: 'A runtime lesson is proposed for reuse.',
            action: 'Show the proposal and require explicit confirmation.',
            reason: 'Suggestion generation is not durable approval.',
            retrieval_count: 1,
          }],
          injection: '## Runtime Lessons\n- Review before durable knowledge writes',
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
            sourceIds: ['task-1', 'trace:trace-loop'],
            sourceRefs: [
              { id: 'task-1', kind: 'task_ledger', label: 'Task Ledger decision' },
              { id: 'trace:trace-loop', kind: 'trace', label: 'Mission trace' },
            ],
            tags: ['governance'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            warnings: ['Needs user review before writing.'],
            metadata: {
              mvpVersion: 'knowledge-interaction-mvp-1',
              recommendation: 'save',
              score: { reusability: 0.82, uniqueness: 0.5, confidence: 0.86, overall: 0.77 },
              temporality: 'stable',
              reason: 'Mission completed with reusable evidence-backed knowledge.',
              missionId: 'mission-1',
              tick: 1,
              outcome: 'complete',
              evidenceRefs: ['task-1', 'trace:trace-loop'],
              captureKey: 'mission:mission-1:tick:1:knowledge:abcdef0123456789',
            },
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
        [typed('knowledge', 'listSourceSets')]: {
          success: true,
          sourceSets: [],
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
          stewardNotes: undefined,
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
    await expect(page.getByTestId('knowledge-library')).toBeVisible();
    await expect(page.getByTestId('knowledge-markdown-workspace')).toBeVisible();
    await expect(page.getByTestId('knowledge-assistant-overview')).not.toBeVisible();
    await expect(page.getByTestId('knowledge-metrics')).not.toBeVisible();

    await page.getByTestId('knowledge-tab-runtime').click();
    await expect(page.getByTestId('knowledge-runtime-lessons')).toBeVisible();
    await expect(page.getByText('Manual trajectories are audit-only and are not distillation candidates.')).toBeVisible();
    await page.getByTestId('knowledge-runtime-suggest').click();
    await expect(page.getByTestId('knowledge-runtime-suggestion-list')).toContainText('Review before durable knowledge writes');
    await expect(page.getByTestId('knowledge-runtime-lineage-traj-e2e-1')).toContainText('mission-e2e-1');
    await expect(page.getByTestId('knowledge-runtime-review-lineage-traj-e2e-1')).toContainText('trace-e2e-1');
    const preConfirmKnowledgeActions = await electronApp.evaluate(() => (
      (globalThis as unknown as { __clawxKnowledgeRequests?: Array<{ action?: string }> }).__clawxKnowledgeRequests ?? []
    ).map((request) => request.action));
    expect(preConfirmKnowledgeActions).toContain('sekbSuggestPrinciples');
    expect(preConfirmKnowledgeActions).not.toContain('sekbConfirmPrinciple');

    await expect(page.getByTestId('knowledge-runtime-confirm')).toBeDisabled();
    await page.getByTestId('knowledge-runtime-session-id').fill('session-e2e-runtime-1');
    await page.getByTestId('knowledge-runtime-confirm').click();
    await expect(page.getByTestId('knowledge-runtime-confirm-result')).toContainText('principle-e2e-confirmed');
    await expect(page.getByTestId('knowledge-runtime-confirm-provenance')).toContainText('session-e2e-runtime-1');

    await page.getByTestId('knowledge-runtime-suggestion-0').click();
    await page.getByTestId('knowledge-runtime-reject').click();
    await expect(page.getByTestId('knowledge-runtime-suggestion-list')).not.toBeVisible();

    await page.getByTestId('knowledge-runtime-retrieve-intent').fill('Review a runtime lesson');
    await page.getByTestId('knowledge-runtime-retrieve-type').fill('knowledge-ui');
    await page.getByTestId('knowledge-runtime-retrieve-tags').fill('knowledge, review');
    await page.getByTestId('knowledge-runtime-retrieve').click();
    await expect(page.getByTestId('knowledge-runtime-retrieve-result')).toContainText('Review before durable knowledge writes');
    await expect(page.getByTestId('knowledge-runtime-injection')).toContainText('Runtime Lessons');

    const postReviewKnowledgeActions = await electronApp.evaluate(() => (
      (globalThis as unknown as { __clawxKnowledgeRequests?: Array<{ action?: string }> }).__clawxKnowledgeRequests ?? []
    ).map((request) => request.action));
    expect(postReviewKnowledgeActions.filter((action) => action === 'sekbConfirmPrinciple')).toHaveLength(1);
    expect(postReviewKnowledgeActions).toContain('sekbRejectSuggestion');
    expect(postReviewKnowledgeActions).toContain('sekbRetrieveForTask');

    await page.getByRole('button', { name: /Initialize/ }).click();
    await expect(page.getByText(/Knowledge vault initialized/)).toBeVisible();

    await page.getByTestId('knowledge-more-actions').click();
    await page.getByRole('menuitem', { name: /Import Files/ }).click();
    await expect(page.getByText(/Knowledge imported/)).toBeVisible();

    await page.getByTestId('knowledge-tab-inbox').click();
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Task decision candidate');
    await expect(page.getByTestId('knowledge-inbox-group-ready-for-review')).toContainText('Ready for review');
    await expect(page.getByTestId('knowledge-inbox-group-ready-for-review')).toContainText('Save');
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Mission completed with reusable evidence-backed knowledge.');
    await expect(page.getByTestId('knowledge-inbox')).toContainText('2 evidence');
    await expect(page.getByTestId('knowledge-inbox')).toContainText('Score 77');
    await expect(page.getByTestId('knowledge-inbox-boundary')).toContainText('Draft review only');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('Reusability');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('82%');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('Uniqueness');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('50%');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('Confidence');
    await expect(page.getByTestId('knowledge-inbox-scores')).toContainText('86%');
    await expect(page.getByTestId('knowledge-inbox-sources')).toContainText('Task Ledger');
    await expect(page.getByTestId('knowledge-inbox-sources')).toContainText('Trace');
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('Pending');
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('mission-1');
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('Tick 1');
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('Complete');
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('Stable');
    await expect(page.getByTestId('knowledge-inbox-audit')).toContainText('Audit details');
    await page.getByTestId('knowledge-inbox-audit').getByText('Audit details').click();
    await expect(page.getByTestId('knowledge-inbox-context')).toContainText('mission:mission-1:tick:1:knowledge:abcdef0123456789');
    await page.getByTestId('knowledge-inbox-promote').click();
    await expect(page.getByText(/Inbox item promoted to draft/)).toBeVisible();
    const postPromoteKnowledgeActions = await electronApp.evaluate(() => (
      (globalThis as unknown as { __clawxKnowledgeRequests?: Array<{ action?: string }> }).__clawxKnowledgeRequests ?? []
    ).map((request) => request.action));
    expect(postPromoteKnowledgeActions).toContain('promoteInboxItemToDraft');
    expect(postPromoteKnowledgeActions).not.toContain('applyReviewedChange');

    await page.getByTestId('knowledge-more-actions').click();
    await page.getByRole('menuitem', { name: /Validate OKF Bundle/ }).click();
    await expect(page.getByTestId('knowledge-okf-panel')).toBeVisible();
    await expect(page.getByTestId('knowledge-okf-panel')).toContainText('Broken OKF link: missing.md');
    await page.getByTestId('knowledge-okf-concept').nth(1).getByRole('checkbox').click();
    await expect(page.getByTestId('knowledge-okf-import')).toBeEnabled();
    await page.getByTestId('knowledge-okf-import').click();
    await expect(page.getByText(/OKF concepts imported/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('knowledge-utility-sheet')).not.toBeVisible();

    await page.getByTestId('knowledge-more-actions').click();
    await page.getByTestId('knowledge-tab-governance').click();
    await page.getByRole('button', { name: /Compile/ }).click();
    await expect(page.getByText(/Compile complete/)).toBeVisible();
    await page.getByRole('button', { name: /Lint/ }).click();
    await expect(page.getByText(/Lint complete/)).toBeVisible();

    await page.getByTestId('knowledge-tab-library').click();
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

  test('creates a Source Set from search results and generates a review-only Studio draft', async ({ electronApp, page }) => {
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
            pageCounts: { source: 1, synthesis: 0 },
            sourceCounts: { native: 1 },
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
          drafts: [{
            id: 'studio-draft-1',
            title: 'Decision Memo',
            body: '## Sources used\n- Decision (notes/decision.md)',
            type: 'decision',
            status: 'draft',
            sourceIds: ['notes/decision.md'],
            sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
            tags: ['studio-artifact', 'decision-memo'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            createdAt: '2026-07-05T00:00:00.000Z',
            updatedAt: '2026-07-05T00:00:00.000Z',
          }],
        },
        [typed('knowledge', 'listProposals', { status: 'all', limit: 100 })]: {
          success: true,
          proposals: [],
        },
        [typed('knowledge', 'listSourceSets')]: {
          success: true,
          sourceSets: [],
        },
        [typed('knowledge', 'search', { query: 'durable writes', maxResults: 12, corpus: 'wiki' })]: {
          success: true,
          results: [{
            pagePath: 'notes/decision.md',
            title: 'Decision',
            snippet: 'Use source-backed drafts before durable Knowledge writes.',
          }],
        },
        [typed('knowledge', 'saveSourceSet', {
          title: 'Decision sources',
          sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
        })]: {
          success: true,
          sourceSet: {
            id: 'ks-e2e',
            title: 'Decision sources',
            sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
            createdAt: '2026-07-05T00:00:00.000Z',
            updatedAt: '2026-07-05T00:00:00.000Z',
          },
        },
        [typed('knowledge', 'createArtifactDraft', {
          artifactType: 'decision-memo',
          title: 'Decision Memo',
          question: 'Create a Decision Memo from the current Source Set.',
          sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
          sourceSetId: 'ks-e2e',
        })]: {
          success: true,
          draft: {
            id: 'studio-draft-1',
            title: 'Decision Memo',
            body: '## Sources used\n- Decision (notes/decision.md)',
            type: 'decision',
            status: 'draft',
            sourceIds: ['notes/decision.md'],
            sourceRefs: [{ id: 'notes/decision.md', kind: 'wiki', path: 'notes/decision.md', label: 'Decision' }],
            tags: ['studio-artifact', 'decision-memo'],
            workspaceId: null,
            agentId: null,
            createdBy: 'agent',
            createdAt: '2026-07-05T00:00:00.000Z',
            updatedAt: '2026-07-05T00:00:00.000Z',
          },
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    await page.getByTestId('knowledge-source-tools').click();
    await expect(page.getByTestId('knowledge-source-set-panel')).toContainText('Current Source Set');
    await page.getByRole('button', { name: /Close panel/ }).click();

    await page.getByTestId('knowledge-search-input').fill('durable writes');
    await page.getByTestId('knowledge-search-submit').click();
    await expect(page.getByTestId('knowledge-search-result')).toContainText('Decision');

    await page.getByTestId('knowledge-source-set-add-result').click();
    await page.getByTestId('knowledge-source-tools').click();
    await expect(page.getByTestId('knowledge-source-set-panel')).toContainText('Decision');
    await expect(page.getByTestId('knowledge-source-set-panel')).toContainText('1 sources');

    await page.getByTestId('knowledge-source-set-title').fill('Decision sources');
    await expect(page.getByTestId('knowledge-source-set-save')).toBeEnabled();
    await page.getByTestId('knowledge-source-set-save').click();
    await expect(page.getByText(/Source Set saved/)).toBeVisible();

    await page.getByTestId('knowledge-studio-artifact-decision-memo').click();
    await expect(page.getByText(/Studio draft created/)).toBeVisible();
    await expect(page.getByTestId('knowledge-draft-inbox')).toBeVisible();
    await expect(page.getByTestId('knowledge-draft-row')).toContainText('Decision Memo');

    const knowledgeActions = await electronApp.evaluate(() => (
      (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }).__verseClawE2eHostCalls ?? []
    ).filter((request) => request.module === 'knowledge').map((request) => request.action));
    expect(knowledgeActions).toContain('saveSourceSet');
    expect(knowledgeActions).toContain('createArtifactDraft');
    expect(knowledgeActions).not.toContain('applyDraft');
    expect(knowledgeActions).not.toContain('applyReviewedChange');
  });

  test('enables wiki knowledge from the chat composer scope picker', async ({ electronApp, page }) => {
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
      },
    });
    await installKnowledgeInvokeRecorder(electronApp);
    await page.reload();

    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();

    await page.getByTestId('chat-knowledge-scope-button').click();
    await page.getByTestId('chat-knowledge-scope-wiki').click();
    await expect(page.getByTestId('chat-knowledge-scope-button')).toContainText('Wiki');

    await page.getByTestId('chat-composer-input').fill('Use my project notes for this answer');
    await page.getByTestId('chat-composer-send').click();

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
        ...readyProviderHostApi,
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
    await page.reload();

    await completeSetup(page);
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible();

    await input.fill('/wiki context palette');
    await input.press('Enter');

    await expect(page.getByTestId('chat-knowledge-search-input')).toHaveValue('context palette');
    await expect(page.getByTestId('chat-knowledge-search-result')).toContainText('Context Palette Notes');
    await page.getByTestId('chat-knowledge-search-result').click();
    await expect(page.getByTestId('chat-knowledge-selected')).toContainText('Context Palette Notes');

    await page.getByTestId('chat-composer-send').click();

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
