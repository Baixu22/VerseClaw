import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendOutput,
  markExited,
  type ProcessSession,
} from '../../openclaw_runtime/src/agents/bash-process-registry';
import { createBashRawOutputCapture } from '../../openclaw_runtime/src/agents/bash-raw-output-capture';
import { verifyContextArchiveHandle } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createSession(): ProcessSession {
  return {
    id: 'proc-1',
    command: 'fixture',
    startedAt: Date.now(),
    maxOutputChars: 200_000,
    pendingMaxOutputChars: 30_000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: '',
    tail: '',
    exited: false,
    truncated: false,
    backgrounded: false,
    cursorKeyMode: 'normal',
  };
}

describe('native raw output capture', () => {
  it('archives the untruncated stream before the process registry caps it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-raw-output-'));
    roots.push(root);
    const raw = `head-marker\n${'x'.repeat(260_000)}\ntail-marker`;
    const session = createSession();
    const capture = createBashRawOutputCapture({
      sessionId: 'session-native-1',
      itemKey: session.id,
      archiveRoot: root,
    });
    session.captureRawOutput = capture.append;
    session.finalizeRawOutput = capture.finalize;

    appendOutput(session, 'stdout', raw);
    markExited(session, 0, null, 'completed', 'exit');

    expect(session.aggregated.length).toBe(200_000);
    expect(session.truncated).toBe(true);
    const handle = session.rawOutputCapture?.handle;
    expect(handle).toBeDefined();
    const verified = await verifyContextArchiveHandle(handle!);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toContain('head-marker');
      expect(verified.payload).toContain('tail-marker');
      expect(String(verified.payload).length).toBe(raw.length);
    }
  });
});