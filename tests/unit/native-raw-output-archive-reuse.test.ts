import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContextArchiveHandleForPayloadSync } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';
import { truncateOversizedToolResultsInMessages } from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native raw output archive reuse', () => {
  it('uses the pre-truncation archive handle instead of archiving the already capped result', () => {
    const root = mkdtempSync(join(tmpdir(), 'native-raw-reuse-'));
    roots.push(root);
    const raw = `head-marker\n${'x'.repeat(12_000)}\ntail-marker`;
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: 'session-native-reuse',
      itemId: 'native-output-proc-1' as never,
      payload: raw,
      archiveRoot: root,
      source: { type: 'tool_call', sessionId: 'session-native-reuse', label: 'native-output' },
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
      { sessionId: 'session-native-reuse' },
    );

    expect(result.truncatedCount).toBe(1);
    expect(result.auditEvents?.[0]?.metadata).toMatchObject({
      archiveHandle: expect.objectContaining({ uri: handle.uri, checksum: handle.checksum }),
    });
  });
});