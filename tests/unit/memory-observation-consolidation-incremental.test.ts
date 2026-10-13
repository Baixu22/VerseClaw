// @vitest-environment node
// Regression for the interrupted cross-session consolidation gap: the 500-question
// run previously wrote observations-cache.json only after ALL conversations
// finished, so an interruption (host process sweep / OOM) discarded every
// conversation's work. This proves the callback fires per conversation so the
// caller can persist incrementally and resume only what is missing.
import { describe, expect, it, vi } from 'vitest';
import { consolidateObservations, type ObservationInputFact } from './helpers/memory-observation-consolidation';

function fact(convId: string, subject: string, n: number): ObservationInputFact {
  return {
    factId: `${convId}-f${n}`,
    subject,
    predicate: `pred-${n}`,
    objectSummary: `object ${n} for ${subject}`,
    sessionDate: 1_700_000_000_000 + n,
  };
}

// A deterministic stub: merges each subject group into ONE observation.
const llm = vi.fn(async (_system: string, user: string) => {
  const ids = [...user.matchAll(/factId["':\s]+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const subject = (user.match(/subject["':\s]+"?([^"\n,]+)/)?.[1] ?? 'subject').trim();
  return {
    content: JSON.stringify([
      {
        subject,
        predicate: 'merged',
        objectSummary: `merged ${ids.length} facts`,
        sourceMemoryIds: ids,
        proofCount: ids.length,
      },
    ]),
  };
});

function inputByConversation(convIds: readonly string[]): Map<string, ObservationInputFact[]> {
  const map = new Map<string, ObservationInputFact[]>();
  for (const convId of convIds) {
    // Two facts under the same subject => reaches MIN_FACTS_FOR_CONSOLIDATION.
    map.set(convId, [fact(convId, `Alice ${convId}`, 1), fact(convId, `Alice ${convId}`, 2)]);
  }
  return map;
}

describe('observation consolidation incremental persistence', () => {
  it('reports each conversation as soon as it is final, in order', async () => {
    const completed: string[] = [];
    const result = await consolidateObservations(inputByConversation(['conv-a', 'conv-b', 'conv-c']), llm, {
      onConversationComplete: (convId) => completed.push(convId),
    });
    expect(completed).toEqual(['conv-a', 'conv-b', 'conv-c']);
    expect([...result.keys()]).toEqual(['conv-a', 'conv-b', 'conv-c']);
    for (const obs of result.values()) expect(obs).toHaveLength(1);
  });

  it('survives an interruption: conversations reported before the throw are the ones a caller can keep', async () => {
    // The suite's own retry swallows LLM failures, so the honest interruption
    // point is the caller's persist callback: it fires per conversation and can
    // abort the run (that is what an external process sweep looks like to us).
    const persisted = new Map<string, unknown>();
    await expect(
      consolidateObservations(inputByConversation(['conv-a', 'conv-b', 'conv-c']), llm, {
        onConversationComplete: (convId, observations) => {
          persisted.set(convId, observations);
          if (convId === 'conv-b') throw new Error('synthetic interruption');
        },
      }),
    ).rejects.toThrow('synthetic interruption');

    // Exactly the conversations completed before the abort are durable.
    expect([...persisted.keys()]).toEqual(['conv-a', 'conv-b']);
    expect(persisted.get('conv-a')).toHaveLength(1);
    expect(persisted.get('conv-b')).toHaveLength(1);
  });

  it('lets a resumed call skip already-persisted conversations (the caller filters them)', async () => {
    const all = inputByConversation(['conv-a', 'conv-b', 'conv-c']);
    const already = new Map([['conv-a', []]]);
    const pending = new Map([...all].filter(([id]) => !already.has(id)));
    expect([...pending.keys()]).toEqual(['conv-b', 'conv-c']);

    const seen: string[] = [];
    const result = await consolidateObservations(pending, llm, {
      onConversationComplete: (convId) => seen.push(convId),
    });
    // Only the missing conversations are recomputed.
    expect(seen).toEqual(['conv-b', 'conv-c']);
    expect(result.has('conv-a')).toBe(false);
    expect([...result.keys()]).toEqual(['conv-b', 'conv-c']);
  });
});
