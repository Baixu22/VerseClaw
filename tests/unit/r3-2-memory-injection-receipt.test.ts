// R3-2: sanitized memory-injection receipt (task 1). Asserts the receipt
// carries only selected/omitted fact refs, char counts, and producer source —
// never raw fact content — through the existing ContextReceipt/v1 shape.
import { describe, expect, it } from 'vitest';
import {
  buildMemoryInjectionReceiptInput,
  buildMemoryInjectionReceiptSummary,
} from '../../openclaw_runtime/src/context-engine/dcs-receipts';

describe('R3-2: memory injection receipt (sanitized)', () => {
  it('maps selected/omitted fact ids to sanitized refs with a char budget', () => {
    const input = buildMemoryInjectionReceiptInput({
      identity: { runtimeMode: 'source', sessionKey: 's1', runId: 'r1' },
      callIndex: { attemptIndex: 0, modelCallIndex: 1, wireAttemptIndex: 0 },
      correlationDigest: 'abc123',
      summary: {
        selectedFactIds: ['fact-a', 'fact-b'],
        omittedFactIds: ['fact-c'],
        selectedChars: 120,
        requestedChars: 300,
        source: 'compass-pre-reply-retrieval',
      },
    });

    expect(input.kind).toBe('context');
    expect(input.version).toBe('1');
    expect(input.content.selected).toEqual(['ref:memory:fact-a', 'ref:memory:fact-b']);
    expect(input.content.omitted).toEqual(['ref:memory:fact-c']);
    expect(input.content.budget).toEqual({ unit: 'chars', charsRequested: 300, charsApplied: 120 });
    expect(input.content.policyDigest).toBe('compass-pre-reply-retrieval');
    expect(input.content.correlationDigest).toBe('abc123');
  });

  it('computes selected/omitted summary from injectedFactIds + candidate facts', () => {
    const summary = buildMemoryInjectionReceiptSummary({
      injectedFactIds: ['fact-a'],
      candidateFacts: [{ factId: 'fact-a' }, { factId: 'fact-b' }, { factId: 'fact-c' }],
      injectedChars: 40,
    });
    expect(summary.selectedFactIds).toEqual(['fact-a']);
    expect(summary.omittedFactIds).toEqual(['fact-b', 'fact-c']);
    expect(summary.selectedChars).toBe(40);
    expect(summary.source).toBe('compass-pre-reply-retrieval');

    // Full bridge: summary → sanitized receipt input.
    const input = buildMemoryInjectionReceiptInput({
      identity: { runtimeMode: 'source' },
      callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      correlationDigest: 'd2',
      summary,
    });
    expect(input.content.selected).toEqual(['ref:memory:fact-a']);
    expect(input.content.omitted).toEqual(['ref:memory:fact-b', 'ref:memory:fact-c']);
    expect(input.content.budget).toEqual({ unit: 'chars', charsRequested: 40, charsApplied: 40 });
  });

  it('never carries raw fact content — only refs, digests, and counts', () => {
    const input = buildMemoryInjectionReceiptInput({
      identity: { runtimeMode: 'source' },
      callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      correlationDigest: 'd1',
      summary: {
        selectedFactIds: ['fact-a'],
        omittedFactIds: [],
        selectedChars: 10,
        requestedChars: 10,
        source: 'compass-pre-reply-retrieval',
      },
    });

    // The receipt content shape has no field for subject/predicate/object text.
    expect(input.content).not.toHaveProperty('logicalDigest');
    expect(input.content).not.toHaveProperty('wireDigest');
    expect(Object.keys(input.content).sort()).toEqual([
      'budget',
      'correlationDigest',
      'omitted',
      'policyDigest',
      'selected',
    ]);
  });
});
