import { describe, expect, it } from 'vitest';
import { SameOriginJsFetcher } from '../src/engine/browser-control/same-origin-js-fetcher.ts';

const PAGE = 'https://example.test/index.html';
const JS_URL = 'https://example.test/bundle.js';

/** Records what the fetcher does to the response body, so abandoned streams are visible. */
function makeBody(chunks: Uint8Array[], record: string[]) {
  let index = 0;
  const reader = {
    async read() {
      record.push('read');
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = chunks[index]!;
      index += 1;
      return { done: false, value };
    },
    releaseLock() { record.push('releaseLock'); },
    async cancel() { record.push('reader.cancel'); },
  };
  return {
    getReader: () => reader,
    async cancel() { record.push('body.cancel'); },
  };
}

function makeResponse(overrides: {
  status?: number;
  contentType?: string | null;
  chunks?: Uint8Array[];
  record: string[];
  url?: string;
}) {
  const chunks = overrides.chunks ?? [new TextEncoder().encode('console.log(1)')];
  return {
    url: overrides.url ?? JS_URL,
    type: 'basic',
    status: overrides.status ?? 200,
    ok: (overrides.status ?? 200) >= 200 && (overrides.status ?? 200) < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (overrides.contentType ?? 'application/javascript') : null,
    },
    body: makeBody(chunks, overrides.record),
  } as unknown as Response;
}

const jsBytes = (n: number) => new Uint8Array(n).fill(47);

describe('same-origin js fetcher body hygiene', () => {
  /**
   * A >1MB body used to be abandoned: the reader was released but never cancelled, and the caller's
   * abort timer had already been cleared, so the unread remainder (and its connection) was left to
   * GC. Real bundles routinely exceed the 1MB cap, so this happened on the normal path.
   */
  it('cancels an oversized body instead of abandoning it', async () => {
    const record: string[] = [];
    const fetcher = new SameOriginJsFetcher(
      (async () => makeResponse({ record, chunks: [jsBytes(700_000), jsBytes(700_000)] })) as unknown as typeof fetch,
    );
    const result = await fetcher.fetch(JS_URL, PAGE);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('超过大小上限');
    expect(record, 'the unread remainder must be cancelled, not just unlocked').toContain('reader.cancel');
  });

  /** Redirect / non-2xx / MIME rejection return before reading; the body used to stay unconsumed. */
  it.each([
    ['a non-2xx response', { status: 404 } as const],
    ['an untrusted MIME type', { contentType: 'text/html' } as const],
    ['an opaque redirect', { status: 302 } as const],
  ])('discards the body when it rejects %s', async (_label, overrides) => {
    const record: string[] = [];
    const fetcher = new SameOriginJsFetcher(
      (async () => makeResponse({ record, ...overrides })) as unknown as typeof fetch,
    );
    const result = await fetcher.fetch(JS_URL, PAGE);
    expect(result.ok).toBe(false);
    expect(record, 'an unread response body must be cancelled').toContain('body.cancel');
    expect(record).not.toContain('read');
  });

  it('still returns the fetched source on the happy path', async () => {
    const record: string[] = [];
    const source = 'export const answer = 42;\n';
    const fetcher = new SameOriginJsFetcher(
      (async () => makeResponse({ record, chunks: [new TextEncoder().encode(source)] })) as unknown as typeof fetch,
    );
    const result = await fetcher.fetch(JS_URL, PAGE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.content).toBe(source);
      expect(result.resource.url).toBe(JS_URL);
    }
    expect(record).not.toContain('reader.cancel');
    expect(record).not.toContain('body.cancel');
  });

  it('rejects cross-origin and non-script targets before fetching at all', async () => {
    let calls = 0;
    const fetcher = new SameOriginJsFetcher((async () => {
      calls += 1;
      return makeResponse({ record: [] });
    }) as unknown as typeof fetch);
    expect((await fetcher.fetch('https://other.test/bundle.js', PAGE)).ok).toBe(false);
    expect((await fetcher.fetch('https://example.test/notes.txt', PAGE)).ok).toBe(false);
    expect(calls, 'guard failures must not hit the network').toBe(0);
  });
});