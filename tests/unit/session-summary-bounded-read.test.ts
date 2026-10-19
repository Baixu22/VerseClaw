// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsProbe = vi.hoisted(() => ({
  openPaths: new Map<number, string>(),
  reads: [] as Array<{ path: string; length: number; position: number }>,
  readFiles: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: ((...args: Parameters<typeof actual.openSync>) => {
      const fd = actual.openSync(...args);
      fsProbe.openPaths.set(fd, String(args[0]));
      return fd;
    }) as typeof actual.openSync,
    closeSync: ((fd: number) => {
      actual.closeSync(fd);
      fsProbe.openPaths.delete(fd);
    }) as typeof actual.closeSync,
    readSync: ((fd: number, buffer: NodeJS.ArrayBufferView, offset?: number | null, length?: number | null, position?: number | null) => {
      const path = fsProbe.openPaths.get(fd);
      if (path) {
        fsProbe.reads.push({
          path,
          length: typeof length === 'number' ? length : 0,
          position: typeof position === 'number' ? position : -1,
        });
      }
      if (typeof offset === 'number' && typeof length === 'number' && typeof position === 'number') {
        return actual.readSync(fd, buffer, offset, length, position);
      }
      return actual.readSync(fd, buffer, { offset: offset ?? undefined, length: length ?? undefined, position: position ?? undefined });
    }) as typeof actual.readSync,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      fsProbe.readFiles.push(String(args[0]));
      return actual.readFile(...args);
    }) as typeof actual.readFile,
  };
});

const SUMMARY_HEAD_BYTES = 64 * 1024;
const SUMMARY_TAIL_BYTES = 128 * 1024;

describe('bounded session summaries', () => {
  let configDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    fsProbe.openPaths.clear();
    fsProbe.reads.length = 0;
    fsProbe.readFiles.length = 0;
    configDir = join(process.env.TMP ?? process.env.TEMP ?? '.', `tf0423-summary-${randomUUID()}`);
    sessionsDir = join(configDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    process.env.OPENCLAW_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.OPENCLAW_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  });

  it('reads only the bounded head and tail and preserves a line ending exactly at the head boundary', async () => {
    const transcriptPath = join(sessionsDir, 'long.jsonl');
    const userMessageBase = {
      type: 'message',
      message: {
        role: 'user',
        content: 'x',
        timestamp: 1000,
      },
    };
    const baseBytes = Buffer.byteLength(JSON.stringify(userMessageBase));
    const paddedUserMessage = {
      ...userMessageBase,
      message: {
        ...userMessageBase.message,
        content: 'x'.repeat(1 + ((SUMMARY_HEAD_BYTES - 1) - baseBytes)),
      },
    };
    const userLine = JSON.stringify(paddedUserMessage);
    expect(Buffer.byteLength(userLine)).toBe(SUMMARY_HEAD_BYTES - 1);

    const fillerLine = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: 'f'.repeat(600 * 1024), timestamp: 1500 },
    });
    const lastLine = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: 'done', timestamp: 2000 },
    });
    const transcript = `${userLine}\n${fillerLine}\n${lastLine}\n`;
    await writeFile(transcriptPath, transcript, 'utf8');
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [{ key: 'agent:main:long', file: 'long.jsonl' }],
    }), 'utf8');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi().summaries({ sessionKeys: ['agent:main:long'] });

    expect(result).toEqual({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:long',
        firstUserText: 'x'.repeat(1 + ((SUMMARY_HEAD_BYTES - 1) - baseBytes)),
        lastTimestamp: 2_000_000,
      }],
    });
    expect(fsProbe.reads).toEqual([
      { path: transcriptPath, length: SUMMARY_HEAD_BYTES, position: 0 },
      { path: transcriptPath, length: 1, position: Buffer.byteLength(transcript) - SUMMARY_TAIL_BYTES - 1 },
      { path: transcriptPath, length: SUMMARY_TAIL_BYTES, position: Buffer.byteLength(transcript) - SUMMARY_TAIL_BYTES },
    ]);
    expect(fsProbe.reads.reduce((total, read) => total + read.length, 0))
      .toBeLessThanOrEqual(SUMMARY_HEAD_BYTES + SUMMARY_TAIL_BYTES + 1);
  });

  it('deduplicates keys, caps one request at 100 sessions, and reads sessions.json once per agent', async () => {
    const transcriptPath = join(sessionsDir, 'short.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'short title', timestamp: 1000 },
    })}\n`, 'utf8');
    const sessions = Array.from({ length: 110 }, (_, index) => ({
      key: `agent:main:s${index.toString().padStart(3, '0')}`,
      file: 'short.jsonl',
    }));
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ sessions }), 'utf8');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionKeys = [
      ...sessions.map((session) => session.key),
      sessions[0]!.key,
      sessions[1]!.key,
    ];
    const result = await createSessionsApi().summaries({ sessionKeys });

    expect(result.summaries).toHaveLength(100);
    expect(result.summaries?.map((summary) => summary.sessionKey)).toEqual(
      sessions.slice(0, 100).map((session) => session.key),
    );
    expect(fsProbe.readFiles).toHaveLength(1);
    expect(fsProbe.readFiles[0]).toBe(join(sessionsDir, 'sessions.json'));
  });
});