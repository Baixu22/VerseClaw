import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContextArchiveHandleForPayloadSync } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';
import { createContextArchiveRecallTool } from '../../openclaw_runtime/src/agents/tools/context-agent-tools';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content.find((part) => part.type === 'text')?.text;
  if (!text) throw new Error('tool result text missing');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('context_archive_recall model tool', () => {
  it('bounds output and keeps the current session able to recover a masked archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'archive-recall-'));
    roots.push(root);
    const payload = `head-marker\n${'x'.repeat(30_000)}\ntail-marker`;
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: 'session-a',
      itemId: 'masked-observation-1' as never,
      payload,
      archiveRoot: root,
      source: { type: 'transcript', sessionId: 'session-a', entryId: 'entry-1' },
    });
    const tool = createContextArchiveRecallTool({ sessionId: 'session-a' });
    expect(tool).toBeTruthy();

    const result = await tool!.execute('tool-call-1', {
      archive_uri: handle.uri,
      checksum: handle.checksum,
      byte_length: handle.byteLength,
      offset: 0,
      max_chars: 64,
    });
    const parsed = parseToolResult(result as never);

    expect(parsed.ok).toBe(true);
    expect(String(parsed.content)).toContain('head-marker');
    expect(String(parsed.content).length).toBeLessThanOrEqual(64);
    expect(parsed.truncated).toBe(true);
    expect(parsed.char_count).toBe(payload.length);
  });

  it('rejects a handle owned by another session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'archive-recall-cross-'));
    roots.push(root);
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: 'session-a',
      itemId: 'masked-observation-2' as never,
      payload: 'secret-free-marker',
      archiveRoot: root,
      source: { type: 'transcript', sessionId: 'session-a', entryId: 'entry-2' },
    });
    const tool = createContextArchiveRecallTool({ sessionId: 'session-b' });

    const parsed = parseToolResult(await tool!.execute('tool-call-2', {
      archive_uri: handle.uri,
      checksum: handle.checksum,
      byte_length: handle.byteLength,
    }) as never);

    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ code: 'session_mismatch' }),
    ]);
  });
});