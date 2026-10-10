// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { forkSessionFromParent } from '../../openclaw_runtime/src/auto-reply/reply/session-fork';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('session fork fail-closed boundary (#148)', () => {
  it('rejects a branch that has no assistant tail instead of returning an unwritten path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-fork-empty-'));
    roots.push(root);
    const sessionsDir = join(root, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const parentFile = join(sessionsDir, 'parent.jsonl');
    const timestamp = '2026-10-10T00:00:00.000Z';
    writeFileSync(parentFile, [
      JSON.stringify({ type: 'session', version: 3, id: 'parent', timestamp, cwd: root }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'interrupted before an assistant reply' },
      }),
    ].join('\n') + '\n', 'utf8');

    const forked = await forkSessionFromParent({
      parentEntry: { sessionId: 'parent', sessionFile: parentFile } as never,
      agentId: 'main',
      sessionsDir,
    });

    expect(forked).toBeNull();
    expect(readdirSync(sessionsDir)).toEqual(['parent.jsonl']);
  });
});
