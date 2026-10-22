import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { KnowledgeChat, type KnowledgeChatContext } from '@/pages/Chat/KnowledgeChat';

const knowledge = vi.hoisted(() => ({
  status: vi.fn(), search: vi.fn(), get: vi.fn(), recordKnowledgeReference: vi.fn(),
  answerFromSourceSet: vi.fn(), createDraft: vi.fn(), createInboxItem: vi.fn(), stewardReview: vi.fn(),
  applyDraft: vi.fn(), applyReviewedChange: vi.fn(),
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { knowledge } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const storageKey = 'clawx.knowledge.librarian.checkpoint.v1';
function Destination() {
  const location = useLocation();
  return <output data-testid="destination">{JSON.stringify({ search: location.search, state: location.state })}</output>;
}
function renderChat(context: KnowledgeChatContext = {}) {
  return render(<MemoryRouter initialEntries={[{ pathname: '/', search: '?knowledge=ask&uiVersion=legacy', state: { knowledgeContext: context } }]}>
    <Routes><Route path="/" element={<KnowledgeChat />} /><Route path="/knowledge" element={<Destination />} /></Routes>
  </MemoryRouter>);
}

describe('Chat knowledge mode', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    localStorage.clear();
    knowledge.status.mockResolvedValue({ success: true, status: { vaultPath: 'C:/vault' } });
    knowledge.createDraft.mockResolvedValue({ success: true, draft: { id: 'draft-new' } });
    knowledge.recordKnowledgeReference.mockResolvedValue({ success: true });
  });

  it('restores the v1 checkpoint and opens its citation in Library', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1, updatedAt: '2026-09-14T00:00:00Z', editorTitle: 'Original note', editorSource: '',
      messages: [{ id: 'old-answer', role: 'assistant', content: 'Saved answer', createdAt: '2026-09-14T00:00:00Z',
        citations: [{ lookup: 'wiki/decision.md', title: 'Decision', excerpt: 'Reviewed evidence.' }] }],
    }));
    renderChat({ editorTitle: 'Unfinished draft', editorBody: 'Retain this text.', editorMode: 'edit' });
    expect(await screen.findByTestId('knowledge-librarian-message-assistant')).toHaveTextContent('Saved answer');
    fireEvent.click(screen.getByTestId('knowledge-librarian-citation'));
    const result = JSON.parse((await screen.findByTestId('destination')).textContent!);
    expect(new URLSearchParams(result.search).get('lookup')).toBe('wiki/decision.md');
    expect(new URLSearchParams(result.search).get('uiVersion')).toBe('legacy');
    expect(result.state.knowledgeContext.editorBody).toBe('Retain this text.');
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(knowledge.applyReviewedChange).not.toHaveBeenCalled();
  });

  it('uses selected sources and saves a cited draft only after the explicit action', async () => {
    const refs = [{ id: 'wiki/decision.md', kind: 'wiki' as const, path: 'wiki/decision.md' }];
    knowledge.answerFromSourceSet.mockResolvedValue({
      success: true, answer: 'A source-backed answer.', question: 'What was decided?',
      sources: [{ id: 'wiki/decision.md', lookup: 'wiki/decision.md', title: 'Decision', excerpt: 'Reviewed evidence.' }],
      unknowns: [], suggestedNextActions: [], confidence: 0.8, groundingStatus: 'grounded',
      retrievalDiagnostics: { query: 'What was decided?', corpus: 'wiki', resultCount: 1 },
    });
    renderChat({ sourceRefs: refs, sourceSetId: 'source-set-1', sourceSetTitle: 'Decision sources' });
    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'What was decided?' } });
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));
    expect(await screen.findByTestId('knowledge-librarian-answer-section')).toHaveTextContent('A source-backed answer.');
    expect(knowledge.answerFromSourceSet).toHaveBeenCalledWith({ question: 'What was decided?', sourceRefs: refs, sourceSetId: 'source-set-1' });
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(knowledge.createDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('knowledge-librarian-save-draft'));
    const result = JSON.parse((await screen.findByTestId('destination')).textContent!);
    expect(new URLSearchParams(result.search).get('id')).toBe('draft-new');
    expect(new URLSearchParams(result.search).get('view')).toBe('review-queue');
    expect(result.state.knowledgeContext.sourceRefs).toEqual(refs);
    expect(knowledge.createDraft).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ['wiki/decision.md'] }));
    expect(knowledge.applyDraft).not.toHaveBeenCalled();
    expect(knowledge.applyReviewedChange).not.toHaveBeenCalled();
    await waitFor(() => expect(localStorage.getItem(storageKey)).toContain('What was decided?'));
  });

  it('follows pending search and page reads, then an actual failure and retry outcome', async () => {
    let resolveSearch!: (value: unknown) => void;
    let resolvePage!: (value: unknown) => void;
    knowledge.search.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve; }));
    knowledge.get.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    renderChat();
    const page = screen.getByTestId('knowledge-chat-page');
    fireEvent.focus(screen.getByTestId('knowledge-librarian-question'));
    expect(page).toHaveAttribute('data-bot-state', 'listening');
    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'Find the decision' } });
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));
    expect(page).toHaveAttribute('data-bot-state', 'searching');
    await act(async () => resolveSearch({ success: true, results: [{ lookup: 'decision.md', title: 'Decision', snippet: 'Keep sources.' }] }));
    expect(page).toHaveAttribute('data-bot-state', 'reading');
    await act(async () => resolvePage({ success: true, content: '# Decision\nKeep sources.' }));
    expect(page).toHaveAttribute('data-bot-state', 'finished');
    expect(screen.getByTestId('knowledge-librarian-answer-section').querySelector('.codex-markdown')).not.toBeNull();
    knowledge.search.mockRejectedValueOnce(new Error('Search unavailable'));
    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'Retry this question' } });
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));
    expect(await screen.findByTestId('knowledge-librarian-error')).toHaveTextContent('Search unavailable');
    expect(page).toHaveAttribute('data-bot-state', 'failed');
    knowledge.search.mockResolvedValueOnce({ success: true, results: [] });
    fireEvent.click(screen.getByTestId('knowledge-librarian-retry'));
    await waitFor(() => expect(page).toHaveAttribute('data-bot-state', 'confused'));
    expect(knowledge.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Retry this question' }));
    expect(knowledge.applyDraft).not.toHaveBeenCalled();
  });

  it('reflects source-set waiting and the actual draft/review phases before opening governed review', async () => {
    let finishAnswer!: (value: unknown) => void;
    let finishDraft!: (value: unknown) => void;
    let finishReview!: (value: unknown) => void;
    const refs = [{ id: 'decision.md', kind: 'wiki' as const }];
    knowledge.answerFromSourceSet.mockReturnValueOnce(new Promise((resolve) => { finishAnswer = resolve; }));
    renderChat({ sourceRefs: refs });
    const page = screen.getByTestId('knowledge-chat-page');
    fireEvent.change(screen.getByTestId('knowledge-librarian-question'), { target: { value: 'Review this decision' } });
    fireEvent.click(screen.getByTestId('knowledge-librarian-ask'));
    expect(page).toHaveAttribute('data-bot-state', 'waiting');
    await act(async () => finishAnswer({ success: true, answer: 'Cited decision.', sources: [{ id: 'decision.md', lookup: 'decision.md', title: 'Decision', excerpt: 'Keep sources.' }], unknowns: [], suggestedNextActions: [], confidence: .8, groundingStatus: 'grounded', retrievalDiagnostics: { query: 'Review this decision', corpus: 'wiki', resultCount: 1 } }));
    expect(page).toHaveAttribute('data-bot-state', 'finished');
    knowledge.createDraft.mockReturnValueOnce(new Promise((resolve) => { finishDraft = resolve; }));
    knowledge.stewardReview.mockReturnValueOnce(new Promise((resolve) => { finishReview = resolve; }));
    fireEvent.click(screen.getByTestId('knowledge-librarian-send-steward'));
    expect(page).toHaveAttribute('data-bot-state', 'writing');
    expect(knowledge.stewardReview).not.toHaveBeenCalled();
    await act(async () => finishDraft({ success: true, draft: { id: 'governed-draft' } }));
    expect(page).toHaveAttribute('data-bot-state', 'working');
    expect(knowledge.stewardReview).toHaveBeenCalledWith({ draftId: 'governed-draft' });
    await act(async () => finishReview({ success: true }));
    const target = JSON.parse((await screen.findByTestId('destination')).textContent!);
    expect(new URLSearchParams(target.search).get('id')).toBe('governed-draft');
    expect(knowledge.applyDraft).not.toHaveBeenCalled();
    expect(knowledge.applyReviewedChange).not.toHaveBeenCalled();
  });
});
