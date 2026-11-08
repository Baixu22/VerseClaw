import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createContextArchiveHandleForPayloadSync,
  verifyContextArchiveHandle,
} from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';
import {
  buildArchiveRecallTruncationSuffix,
  truncateOversizedToolResultsInMessages,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Context Inline/Spill truncation reference', () => {
  it('puts a verified archive handle and bounded recall instruction in the model-visible truncated text', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-inline-spill-'));
    roots.push(root);
    const raw = `head-marker\n${'x'.repeat(12_000)}\ntail-marker`;
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: 'session-inline-spill',
      itemId: 'context-inline-spill-observation-1' as never,
      payload: raw,
      archiveRoot: root,
      source: { type: 'tool_call', sessionId: 'session-inline-spill', label: 'tool-output' },
    });
    const message = {
      role: 'toolResult',
      toolCallId: 'tool-call-1',
      content: [{ type: 'text', text: raw }],
      details: { status: 'completed', archiveHandle: handle },
    };

    const result = truncateOversizedToolResultsInMessages(
      [message] as never[],
      1_000,
      2_000,
      2_000,
      { sessionId: 'session-inline-spill' },
    );

    const text = JSON.stringify(result.messages[0] ?? {});
    expect(result.truncatedCount).toBe(1);
    expect(text).toContain(handle.uri);
    expect(text).toContain(handle.checksum);
    expect(text).toContain('context_archive_recall');
    expect(text).toContain('archive_uri');
    expect(text).toContain('checksum');
    expect(text).toContain('byte_length');
  });

  it('formats a bounded suffix without hiding the archive identity', () => {
    const suffix = buildArchiveRecallTruncationSuffix({
      truncatedChars: 12_345,
      archiveHandle: {
        uri: 'context-archive://session-a/tool-call-1',
        checksum: `sha256:${'a'.repeat(64)}`,
        byteLength: 9_876,
        createdAt: '2026-11-03T00:00:00.000Z',
      } as never,
    });

    expect(suffix).toContain('archive_uri');
    expect(suffix).toContain('checksum');
    expect(suffix).toContain('byte_length');
    expect(suffix).toContain('context_archive_recall');
    expect(suffix.length).toBeLessThanOrEqual(900);
  });

  it('does not claim recallability when the archive handle is absent', () => {
    const suffix = buildArchiveRecallTruncationSuffix({
      truncatedChars: 5_000,
      archiveHandle: undefined,
    });
    expect(suffix).not.toContain('context-archive://');
    expect(suffix).toContain('more characters truncated');
  });

  it('accepts a fresh archive round-trip in the same session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'context-inline-spill-roundtrip-'));
    roots.push(root);
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: 'session-roundtrip',
      itemId: 'context-inline-spill-observation-2' as never,
      payload: 'roundtrip-payload',
      archiveRoot: root,
      source: { type: 'tool_call', sessionId: 'session-roundtrip', label: 'roundtrip' },
    });
    const verified = await verifyContextArchiveHandle(handle);
    expect(verified.ok).toBe(true);
  });

  it('falls back to the compact notice when the aggregate target cannot fit a recall reference', () => {
    const root = mkdtempSync(join(tmpdir(), 'context-inline-spill-budget-'));
    roots.push(root);
    const first = `first-${'a'.repeat(2_000)}`;
    const second = `second-${'b'.repeat(2_000)}`;
    const messages = [first, second].map((text, index) => ({
      role: 'toolResult',
      toolCallId: `tool-budget-${index}`,
      content: [{ type: 'text', text }],
    }));

    const result = truncateOversizedToolResultsInMessages(
      messages as never[],
      1_000,
      1_100,
      300,
      { sessionId: 'session-budget' },
    );

    const visible = JSON.stringify(result.messages);
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(visible).not.toContain('archive_uri:');
    expect(visible.includes('narrow args') || visible.includes('more characters truncated')).toBe(true);
  });
});