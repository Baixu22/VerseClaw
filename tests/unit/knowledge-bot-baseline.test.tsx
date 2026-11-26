import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { KnowledgeChat, type KnowledgeChatContext } from '@/pages/Chat/KnowledgeChat';
import { useWorkspacesStore } from '@/stores/workspaces';
import { createKnowledgeApi } from '@electron/services/knowledge-api';
import { createWorkspacesApi, getActiveWorkspaceProfile } from '@electron/services/workspaces-api';
import type { GatewayManager } from '@electron/gateway/manager';
import type { KnowledgeAnswerFromSourceSetResult, KnowledgeAnswerFromSourceSetPayload, KnowledgeSourceRef } from '@shared/host-api/contract';
import { FixtureGateway } from '../fixtures/knowledge-bot-baseline/gateway';
import corpus from '../fixtures/knowledge-bot-baseline/corpus.json';

const sandbox = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  return mkdtempSync(join(tmpdir(), 'clawx-kb-k01-state-'));
});
const facade = vi.hoisted(() => ({ knowledge: {} }));
vi.mock('@/lib/host-api', () => ({ hostApi: facade }));
vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }));
vi.mock('@electron/utils/paths', () => ({
  expandPath: (p: string) => p, getOpenClawConfigDir: () => sandbox, getDataDir: () => join(sandbox, 'data'),
  getOpenClawConfigPath: () => join(sandbox, 'openclaw.json'),
  getResourcesDir: () => join(process.cwd(), 'resources'), getOpenClawRuntimeDir: () => join(sandbox, 'unused-runtime'),
}));
vi.mock('@/lib/host-events', () => ({ hostEvents: { onKnowledgeAnswerProgress: () => () => {} } }));
vi.mock('react-i18next', async original => ({
  ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const output = process.env.CLAWX_KB_BASELINE_RAW;
const route = <output data-testid="review-destination" />;
let workspaceId: string;
beforeAll(async () => {
  const result = await createWorkspacesApi().create({ name: 'Knowledge baseline', rootPath: sandbox, agentId: 'main', permissionMode: 'acceptEdits' });
  expect(result.success).toBe(true);
  const workspace = await getActiveWorkspaceProfile();
  if (!workspace) throw Error('Missing isolated workspace');
  workspaceId = workspace.id;
  useWorkspacesStore.setState({ activeWorkspaceId: workspace.id, activeWorkspace: workspace });
  if (output) mkdirSync(output, { recursive: true });
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

for (const task of corpus.cases) {
  it('captures the running assistant: ' + task.id, async () => {
    const gateway = new FixtureGateway(task);
    const api = createKnowledgeApi({ gatewayManager: gateway as unknown as GatewayManager });
    const actions: string[] = [];
    const created: string[] = [];
    const reviews: string[] = [];
    let request: KnowledgeAnswerFromSourceSetPayload | undefined, answer: KnowledgeAnswerFromSourceSetResult | undefined;
    let hostError: string | undefined;
    const context: KnowledgeChatContext = { workspaceId };
    const refs: KnowledgeSourceRef[] = (task.members ?? []).map(id => ({ id, path: id, kind: 'wiki' }));
    if (task.scope === 'set') {
      const saved = await api.saveSourceSet({ title: task.id, sourceRefs: refs, metadata: { workspaceId } });
      if (!saved.sourceSet) throw Error('Failed to seed source set');
      Object.assign(context, { sourceRefs: refs, sourceSetId: saved.sourceSet.id, sourceSetTitle: saved.sourceSet.title });
    }
    if (task.page) {
      const page = corpus.sources.find(source => source.id === task.page)!;
      Object.assign(context, { editorTitle: page.title, editorSource: page.id, editorMode: task.selection ? 'edit' : 'preview',
        editorBody: task.selection ?? page.body, selectedRow: { pagePath: page.id, title: page.title } });
    }
    const before = await api.listDrafts({ status: 'all', limit: 100 });
    Object.assign(facade.knowledge, {
      operationsStatus: async () => ({ success: true, operations: { config: { answerMode: 'strict' } } }),
      status: async () => ({ success: true, status: { vaultExists: true } }),
      answerFromSourceSet: async (payload: KnowledgeAnswerFromSourceSetPayload) => {
        request = payload;
        try {
          answer = await api.answerFromSourceSet(payload);
          return answer;
        } catch (error) {
          hostError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      createDraft: async (payload: Parameters<typeof api.createDraft>[0]) => {
        const result = await api.createDraft(payload);
        if (result.draft) created.push(result.draft.id);
        if (task.action === 'retry-save') {
          const replayed = await api.createDraft(payload);
          if (replayed.draft) created.push(replayed.draft.id);
        }
        return result;
      },
      stewardReview: async (payload: Parameters<typeof api.stewardReview>[0]) => {
        const result = await api.stewardReview(payload);
        if (result.success && payload.draftId) reviews.push(payload.draftId);
        return result;
      },
    });
    const started = performance.now();
    render(<MemoryRouter initialEntries={['/?knowledge=ask']}><Routes>
      <Route path="/" element={<>
        {task.selection && <textarea data-testid="fixture-editor" readOnly value={task.selection} />}
        <KnowledgeChat context={context} />
      </>} /><Route path="/knowledge" element={route} /></Routes></MemoryRouter>);
    if (task.selection) {
      const editor = screen.getByTestId('fixture-editor') as HTMLTextAreaElement;
      editor.setSelectionRange(0, editor.value.length);
    }
    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: task.query } });
    actions.push('enter-question');
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));
    actions.push('submit-question');
    const rendered = await waitFor(() => {
      const terminal = screen.queryByTestId('knowledge-librarian-answer-section') ?? screen.queryByTestId('knowledge-librarian-error');
      if (!terminal) throw Error('Awaiting KnowledgeChat result');
      return terminal;
    }, { timeout: 20_000 }).catch(error => {
      if (output) writeFileSync(join(output, task.id + '.failure.json'), JSON.stringify({
        caseId: task.id, request, answer, methods: gateway.methods, unexpected: gateway.unexpected,
        message: screen.queryByTestId('knowledge-librarian-error')?.textContent ?? error.message.split('\n')[0],
      }, null, 2), { flag: 'wx' });
      throw error;
    });
    const display = rendered.textContent;
    if (task.action && answer?.success) {
      const control = task.action === 'review' ? 'knowledge-librarian-send-steward' : 'knowledge-librarian-save-draft';
      fireEvent.click(screen.getByTestId(control));
      actions.push(control);
      await waitFor(() => expect(screen.getByTestId('review-destination')).toBeInTheDocument(), { timeout: 10_000 });
    }
    const after = await api.listDrafts({ status: 'all', limit: 100 });
    const drafts = after.drafts.filter(draft => !before.drafts.some(old => old.id === draft.id));
    const record = { caseId: task.id, query: task.query, actions, request, answer, hostError, display, reads: gateway.reads, modelInputs: gateway.modelInputs,
      methods: gateway.methods, unexpected: gateway.unexpected, created, reviews, drafts, elapsedMs: Math.round(performance.now() - started) };
    if (output) writeFileSync(join(output, task.id + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    expect(request?.question).toBe(task.query);
    expect(Boolean(answer?.success || hostError && rendered.dataset.testid === 'knowledge-librarian-error')).toBe(true);
    expect(gateway.unexpected).toEqual([]);
    expect(answer?.model?.status).not.toBe('error');
    expect(answer?.claimSupport?.status).not.toBe('error');
    expect(drafts.map(d => d.id).sort()).toEqual([...created].sort());
  }, 30_000);
}
