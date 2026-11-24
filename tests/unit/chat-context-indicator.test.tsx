import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../shared/i18n/locales/en/chat.json';
import { ChatContextIndicator } from '../../src/components/chat/ChatContextIndicator';
import type { WorkspaceContextRange } from '../../shared/types/workspace';

const mocks = vi.hoisted(() => ({ receipts: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { memory: { injectionReceipts: mocks.receipts } } }));
vi.mock('@lobehub/ui/es/chat/TokenTag/TokenTag', () => ({ default: () => <span data-testid="lobe-token-ring" /> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values: Record<string, unknown> = {}) => {
  const value = key.split('.').reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, en);
  return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')) : key;
} }) }));

const sessionKey = 'agent:main:context-a';
const sessionId = 'generation-a';
const range = (patch: Partial<WorkspaceContextRange> = {}): WorkspaceContextRange => ({
  sessionKey, sessionId, usedTokens: 12000, maxTokens: 128000, usageSource: 'runtime', status: 'bestEffort', retainedMessageCount: 12,
  composition: {
    sessionId, generatedAt: 100, source: 'run', modelRef: 'test/model', systemPromptChars: 6000, instructionsChars: 1500, currentTurnChars: 100, runtimeContextChars: 200,
    workspaceFiles: { chars: 3000, totalEntries: 1, entries: [{ name: 'AGENTS.md', path: '/project/AGENTS.md', chars: 3000, rawChars: 4000, status: 'truncated' }] },
    skills: { chars: 1000, totalEntries: 1, entries: [{ name: 'search', chars: 1000, status: 'included' }] },
    tools: { chars: 2000, totalEntries: 1, entries: [{ name: 'exec', chars: 2000, status: 'included' }] },
  }, ...patch,
});
const receipt = { sessionKey, source: 'working-memory', selected: ['memory:fact-1'], omitted: [], budgetCharsApplied: 120, budgetCharsRequested: 120, createdAt: 110 };

beforeEach(() => { vi.clearAllMocks(); mocks.receipts.mockResolvedValue({ success: true, receipts: [receipt] }); });

describe('context indicator', () => {
  it('keeps the composer trigger circular and puts measured source shares in the details', () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    const trigger = screen.getByTestId('chat-context-indicator');
    expect(trigger.textContent).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('Context: 12,000 of 128,000 tokens');
    fireEvent.click(trigger);
    expect(screen.getByTestId('chat-context-composition-bar').children).toHaveLength(6);
    expect(screen.getByText('Share of recorded characters')).toBeTruthy();
    expect(screen.getByText('Recorded composition: 7,800 characters')).toBeTruthy();
  });

  it('opens all source groups from the detailed breakdown action', () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    const groups = screen.getAllByTestId('chat-context-source-group') as HTMLDetailsElement[];
    expect(groups.every(group => !group.open)).toBe(true);
    fireEvent.click(screen.getByTestId('chat-context-detailed-breakdown'));
    expect(groups.every(group => group.open)).toBe(true);
    expect(screen.getByText(/Details stay open/)).toBeTruthy();
  });

  it('keeps source reads lazy, then exposes hover details and truncated file metadata', async () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    const trigger = screen.getByTestId('chat-context-indicator');
    expect(mocks.receipts).not.toHaveBeenCalled();
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByTestId('chat-context-details')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('chat-context-usage').textContent).toBe('12,000 / 128,000 tokens'));
    expect(screen.getByText(/Project files/)).toBeTruthy();
    expect(screen.getByText('AGENTS.md')).toBeTruthy();
    expect(screen.getByText(/Trimmed to fit the context/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('working-memory')).toBeTruthy());
    expect(mocks.receipts).toHaveBeenCalledWith({ sessionKey, limit: 8 });
  });

  it('supports focus, pinning, Escape and outside dismissal', async () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    const trigger = screen.getByTestId('chat-context-indicator');
    act(() => trigger.focus());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    expect(screen.getByText(/Details stay open/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('chat-context-details')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('chat-context-details')).toBeNull();
  });

  it('shows an unavailable measurement as unknown', () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range({ usedTokens: null, usageSource: 'unavailable', composition: null })} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    expect(screen.getByTestId('chat-context-usage').textContent).toBe('— / 128,000 tokens');
    expect(screen.getByTestId('chat-context-composition-pending')).toBeTruthy();
    expect(mocks.receipts).not.toHaveBeenCalled();
  });

  it('keeps a missing snapshot unknown when an unbound compaction status is present', () => {
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={null}
      compactionStatus={{ available: true, canCompact: true, inProgress: false, usedTokens: 900000, maxTokens: 128000, pressure: 'high', truncatedMessageCount: 3, warnings: [] }} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    expect(screen.getByTestId('chat-context-indicator').getAttribute('data-status')).toBe('unknown');
    expect(screen.getByTestId('chat-context-usage').textContent).toBe('— / — tokens');
    expect(screen.queryByTestId('chat-context-hidden-messages')).toBeNull();
  });

  it('marks high pressure from current window usage', () => {
    render(<ChatContextIndicator sessionKey={sessionKey} contextRange={range({ usedTokens: 120000 })} />);
    expect(screen.getByTestId('chat-context-indicator').getAttribute('data-status')).toBe('overload');
  });

  it('uses the current range instead of an older compaction reading', () => {
    const compactionStatus = { available: true, canCompact: true, inProgress: false, usedTokens: 120000, maxTokens: 256000, pressure: 'high' as const, truncatedMessageCount: 0, warnings: [] };
    const { rerender } = render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} compactionStatus={compactionStatus} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    expect(screen.getByTestId('chat-context-usage').textContent).toBe('12,000 / 128,000 tokens');
    rerender(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range({ usedTokens: null, usageSource: 'unavailable' })} compactionStatus={compactionStatus} />);
    expect(screen.getByTestId('chat-context-indicator').getAttribute('data-status')).toBe('unknown');
    expect(screen.getByTestId('chat-context-usage').textContent).toBe('— / 128,000 tokens');
  });

  it('filters old and foreign receipt sources and permits a failed read to be retried', async () => {
    mocks.receipts.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, receipts: [receipt, { ...receipt, source: 'previous-generation', createdAt: 10 }, { ...receipt, source: 'foreign', sessionKey: 'agent:main:other' }] });
    render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    await waitFor(() => expect(screen.getByText('Memory receipts could not be loaded.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('working-memory')).toBeTruthy());
    expect(screen.queryByText('previous-generation')).toBeNull();
    expect(screen.queryByText('foreign')).toBeNull();
  });

  it('discards a late receipt when the composer moves to another generation', async () => {
    let finish!: (value: unknown) => void;
    mocks.receipts.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<ChatContextIndicator key={sessionId} sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    rerender(<ChatContextIndicator key="generation-b" sessionKey={sessionKey} sessionId="generation-b" contextRange={range()} />);
    await act(async () => finish({ success: true, receipts: [receipt] }));
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    expect(screen.queryByText('working-memory')).toBeNull();
    expect(screen.getByTestId('chat-context-usage').textContent).toBe('— / — tokens');
    expect(screen.getByTestId('chat-context-composition-pending')).toBeTruthy();
  });

  it('hides the prior report receipts while a new report is loading', async () => {
    let finish!: (value: unknown) => void;
    const { rerender } = render(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={range()} />);
    fireEvent.click(screen.getByTestId('chat-context-indicator'));
    await waitFor(() => expect(screen.getByText('working-memory')).toBeTruthy());
    mocks.receipts.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const nextRange = range();
    nextRange.composition = { ...nextRange.composition!, generatedAt: 200 };
    rerender(<ChatContextIndicator sessionKey={sessionKey} sessionId={sessionId} contextRange={nextRange} />);
    expect(screen.queryByText('working-memory')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en.contextDisplay.memoryLoading);
    await act(async () => finish({ success: true, receipts: [receipt] }));
    expect(screen.queryByText('working-memory')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
