/**
 * TF-0111 (T-P0-2): when pruning and iterative compaction happen together,
 * the main summarization must explicitly see BOTH the previous round's
 * summary and the dropped-messages summary (merge, not replace), capped at
 * MAX_COMPACTION_SUMMARY_CHARS. Covers the concurrent path plus the three
 * A6 boundaries (dropped empty / previous empty / both empty).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '../runtime/index.js';
import compactionSafeguardExtension, { testing } from './compaction-safeguard.js';
import { setCompactionSafeguardRuntime } from './compaction-safeguard-runtime.js';

const {
  setSummarizeInStagesForTest,
  setHistoryPrunePlanForTest,
  mergeCompactionPreviousSummaries,
  PREVIOUS_SUMMARY_MERGE_LABEL,
  DROPPED_SUMMARY_MERGE_LABEL,
  MAX_COMPACTION_SUMMARY_CHARS,
  SUMMARY_TRUNCATED_MARKER,
} = testing;

function userMessage(text: string): AgentMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: 1 } as AgentMessage;
}

afterEach(() => {
  setSummarizeInStagesForTest();
  setHistoryPrunePlanForTest();
  vi.clearAllMocks();
});

describe('TF-0111 mergeCompactionPreviousSummaries (A6 boundaries + cap)', () => {
  it('both empty -> undefined (legacy: nothing to feed)', () => {
    expect(mergeCompactionPreviousSummaries({})).toBeUndefined();
    expect(
      mergeCompactionPreviousSummaries({ previousSummary: '   ', droppedSummary: '' }),
    ).toBeUndefined();
  });

  it('dropped empty -> previousSummary unchanged (legacy behavior)', () => {
    const previous = 'PREV round summary';
    expect(mergeCompactionPreviousSummaries({ previousSummary: previous, droppedSummary: undefined }))
      .toBe(previous);
    expect(mergeCompactionPreviousSummaries({ previousSummary: previous, droppedSummary: '  ' }))
      .toBe(previous);
  });

  it('previous empty -> droppedSummary unchanged (legacy behavior)', () => {
    const dropped = 'DROPPED messages summary';
    expect(mergeCompactionPreviousSummaries({ previousSummary: undefined, droppedSummary: dropped }))
      .toBe(dropped);
    expect(mergeCompactionPreviousSummaries({ previousSummary: '', droppedSummary: dropped }))
      .toBe(dropped);
  });

  it('both present -> explicit labeled merge, previous first, both contents kept', () => {
    const merged = mergeCompactionPreviousSummaries({
      previousSummary: 'PREV-MARKER old round',
      droppedSummary: 'DROPPED-MARKER pruned chunk',
    });
    expect(merged).toBeDefined();
    const prevIdx = merged!.indexOf(PREVIOUS_SUMMARY_MERGE_LABEL);
    const droppedIdx = merged!.indexOf(DROPPED_SUMMARY_MERGE_LABEL);
    expect(prevIdx).toBeGreaterThanOrEqual(0);
    expect(droppedIdx).toBeGreaterThan(prevIdx);
    expect(merged).toContain('PREV-MARKER old round');
    expect(merged).toContain('DROPPED-MARKER pruned chunk');
  });

  it('merged length never exceeds maxChars (segments budgeted, marker kept)', () => {
    const merged = mergeCompactionPreviousSummaries({
      previousSummary: 'P'.repeat(5000),
      droppedSummary: 'D'.repeat(5000),
      maxChars: 400,
    });
    expect(merged!.length).toBeLessThanOrEqual(400);
    expect(merged).toContain(SUMMARY_TRUNCATED_MARKER);
    expect(merged).toContain(PREVIOUS_SUMMARY_MERGE_LABEL);
    expect(merged).toContain(DROPPED_SUMMARY_MERGE_LABEL);
  });

  it('default cap: huge inputs stay within MAX_COMPACTION_SUMMARY_CHARS', () => {
    const merged = mergeCompactionPreviousSummaries({
      previousSummary: 'P'.repeat(60_000),
      droppedSummary: 'D'.repeat(60_000),
    });
    expect(merged!.length).toBeLessThanOrEqual(MAX_COMPACTION_SUMMARY_CHARS);
  });
});

type FakeHandler = (event: unknown, ctx: unknown) => Promise<Record<string, unknown>>;
type FakeApi = { on: (event: string, handler: FakeHandler) => void; handlers: Record<string, FakeHandler> };

function registerHandler(): { handler: FakeHandler } {
  const api: FakeApi = { handlers: {}, on: (event, handler) => { api.handlers[event] = handler; } };
  compactionSafeguardExtension(api as never);
  const handler = api.handlers['session_before_compact'];
  if (!handler) throw new Error('session_before_compact not registered');
  return { handler };
}

function harnessCtx() {
  const sessionManager = {};
  const model = {
    id: 'test-model',
    provider: 'test',
    contextWindow: 8192,
    contextWindowTokens: 8192,
    maxTokens: 4096,
  };
  const ctx = {
    sessionManager,
    model,
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'test-key' }),
    },
  };
  return { sessionManager, ctx };
}

function preparationWithPreviousSummary() {
  return {
    firstKeptEntryId: 'keep-1',
    messagesToSummarize: [userMessage('current turn content MSG-CURRENT')],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 2_000,
    previousSummary: 'PREV-MARKER previous round goal: ship the pipeline',
    previousArtifact: undefined,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
}

describe('TF-0111 concurrent path (pruning + iterative compaction)', () => {
  function prunePlanStub(droppedText: string) {
    return vi.fn(async () => ({
      summarizableTokens: 500,
      newContentTokens: 9_000,
      maxHistoryTokens: 1_000,
      pruned: {
        droppedChunks: 1,
        droppedMessages: 1,
        messages: [userMessage('remaining history MSG-REMAINING')],
        droppedMessagesList: [userMessage(droppedText)],
      },
    })) as unknown as Parameters<typeof setHistoryPrunePlanForTest>[0];
  }

  it('AC: with droppedChunks>0 and previousSummary non-empty, the final summary carries both sources', async () => {
    const { sessionManager, ctx } = harnessCtx();
    setCompactionSafeguardRuntime(sessionManager, { qualityGuardEnabled: false, contextWindowTokens: 8192, recentTurnsPreserve: 0 });
    setHistoryPrunePlanForTest(prunePlanStub('DROPPED-MARKER pruned older decision: use pnpm'));

    const calls: string[] = [];
    setSummarizeInStagesForTest(
      vi.fn(async (params: { messages: AgentMessage[] }) => {
        const text = JSON.stringify(params.messages);
        calls.push(text);
        const found: string[] = [];
        if (text.includes('PREV-MARKER')) found.push('PREV-MARKER');
        if (text.includes('DROPPED-MARKER')) found.push('DROPPED-MARKER');
        return `## Goal and Progress\nEcho: ${found.join(' + ') || 'none'}`;
      }) as never,
    );

    const { handler } = registerHandler();
    const result = (await handler(
      {
        preparation: preparationWithPreviousSummary(),
        customInstructions: undefined,
        signal: new AbortController().signal,
      },
      ctx,
    )) as { cancel?: boolean; compaction?: { summary: string } };

    expect(result.cancel).toBeUndefined();
    // Two summarizations: dropped-messages call, then the main call.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const droppedCall = calls[0]!;
    const mainCall = calls[calls.length - 1]!;
    // Dropped summarization sees the pruned message (and the previous summary
    // folded in, pre-existing behavior).
    expect(droppedCall).toContain('DROPPED-MARKER');
    // Main call sees BOTH sources through explicit labeled segments (the fix):
    expect(mainCall).toContain(PREVIOUS_SUMMARY_MERGE_LABEL);
    expect(mainCall).toContain(DROPPED_SUMMARY_MERGE_LABEL);
    expect(mainCall).toContain('PREV-MARKER');
    expect(mainCall).toContain('DROPPED-MARKER');
    // AC-1: the final summary contains key identifiers of both sources.
    expect(result.compaction?.summary).toContain('PREV-MARKER');
    expect(result.compaction?.summary).toContain('DROPPED-MARKER');
  });

  it('guard: without pruning, previousSummary feeds the main call unlabeled (legacy path unchanged)', async () => {
    const { sessionManager, ctx } = harnessCtx();
    setCompactionSafeguardRuntime(sessionManager, { qualityGuardEnabled: false, contextWindowTokens: 8192, recentTurnsPreserve: 0 });
    // No prune plan stub: tokensBefore present but no pruning pressure path is
    // forced; force the no-prune branch by stubbing a plan without pruned.
    setHistoryPrunePlanForTest(
      vi.fn(async () => ({
        summarizableTokens: 500,
        newContentTokens: 500,
        maxHistoryTokens: 1_000,
        pruned: null,
      })) as never,
    );

    const calls: string[] = [];
    setSummarizeInStagesForTest(
      vi.fn(async (params: { messages: AgentMessage[] }) => {
        calls.push(JSON.stringify(params.messages));
        return '## Goal and Progress\nPlain summary';
      }) as never,
    );

    const { handler } = registerHandler();
    await handler(
      {
        preparation: preparationWithPreviousSummary(),
        customInstructions: undefined,
        signal: new AbortController().signal,
      },
      ctx,
    );

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('PREV-MARKER');
    expect(calls[0]).not.toContain(PREVIOUS_SUMMARY_MERGE_LABEL);
    expect(calls[0]).not.toContain(DROPPED_SUMMARY_MERGE_LABEL);
  });
});
