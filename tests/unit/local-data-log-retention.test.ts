import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_LOG_RETENTION_DAYS,
  rotateLogIfNeeded,
  testApi,
} from '@electron/utils/log-retention';

describe('append-only log retention', () => {
  let dir: string;
  let audit: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clawx-retention-'));
    audit = join(dir, 'audit.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when the log does not exist', async () => {
    const result = await rotateLogIfNeeded(audit);
    expect(result.rotated).toBe(false);
    expect(result.removed).toEqual([]);
  });

  it('does not rotate a small, fresh log', async () => {
    writeFileSync(audit, '{"event":"one"}\n');
    const result = await rotateLogIfNeeded(audit, { maxBytes: 1024 * 1024 });
    expect(result.rotated).toBe(false);
    expect(existsSync(audit)).toBe(true);
  });

  it('rotates once the log exceeds the size threshold', async () => {
    writeFileSync(audit, 'x'.repeat(4096));
    const result = await rotateLogIfNeeded(audit, { maxBytes: 1024 });
    expect(result.rotated).toBe(true);
    expect(result.reason).toBe('size');

    // The live file is gone (rotated away) and a generation now exists.
    expect(existsSync(audit)).toBe(false);
    const generations = readdirSync(dir).filter((n) => n.endsWith('.log'));
    expect(generations).toHaveLength(1);
    // The rotated content is preserved verbatim.
    expect(readFileSync(join(dir, generations[0]), 'utf-8')).toHaveLength(4096);
  });

  it('rotates once the log exceeds the age threshold', async () => {
    writeFileSync(audit, '{"event":"old"}\n');
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    utimesSync(audit, new Date(old), new Date(old));

    const result = await rotateLogIfNeeded(audit, {
      maxBytes: 1024 * 1024,
      maxAgeMs: DEFAULT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    });
    expect(result.rotated).toBe(true);
    expect(result.reason).toBe('age');
  });

  it('never clobbers an existing generation on repeated rotation', async () => {
    const nowMs = 1_800_000_000_000;
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(audit, `line-${i}\n`);
      await rotateLogIfNeeded(audit, { maxBytes: 1, nowMs });
    }
    const generations = readdirSync(dir).filter((n) => n.endsWith('.log'));
    // Each rotation produced a distinct file rather than overwriting one.
    expect(new Set(generations).size).toBe(generations.length);
    expect(generations.length).toBe(3);
  });

  it('prunes generations beyond the keep cap', async () => {
    const nowMs = 1_800_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(audit, `line-${i}\n`);
      await rotateLogIfNeeded(audit, { maxBytes: 1, keep: 2, maxAgeMs: Number.MAX_SAFE_INTEGER, nowMs });
    }
    const generations = readdirSync(dir).filter((n) => n.endsWith('.log'));
    // keep=2 means at most two generations survive.
    expect(generations.length).toBeLessThanOrEqual(2);
  });

  it('does not treat the live file as a generation', async () => {
    writeFileSync(audit, 'live\n');
    await rotateLogIfNeeded(audit, { maxBytes: 1, keep: 0 });
    // keep=0 removes all generations, but the freshly rotated live file's
    // generation may remain; the live path itself is never a generation.
    expect(testApi.isRotatedGeneration('audit.jsonl', 'audit.jsonl')).toBe(false);
    expect(testApi.isRotatedGeneration('audit.jsonl.2020.log', 'audit.jsonl')).toBe(true);
  });

  it('leaves unrelated files and transcripts untouched', async () => {
    const transcript = join(dir, 'session-abc.jsonl');
    writeFileSync(transcript, 'user conversation content\n');
    writeFileSync(audit, 'x'.repeat(4096));

    await rotateLogIfNeeded(audit, { maxBytes: 1, keep: 1 });

    // The conversation transcript is user data and must survive untouched.
    expect(existsSync(transcript)).toBe(true);
    expect(readFileSync(transcript, 'utf-8')).toBe('user conversation content\n');
  });

  it('does not delete other log families sharing the directory', async () => {
    const events = join(dir, 'events.jsonl');
    writeFileSync(audit, 'x'.repeat(4096));
    writeFileSync(events, 'y'.repeat(4096));

    await rotateLogIfNeeded(audit, { maxBytes: 1, keep: 0 });

    // events.jsonl is a different base name and must be unaffected.
    expect(existsSync(events)).toBe(true);
    expect(readFileSync(events, 'utf-8')).toBe('y'.repeat(4096));
  });
});