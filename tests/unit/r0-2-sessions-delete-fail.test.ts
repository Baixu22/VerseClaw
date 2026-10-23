// @vitest-environment node
// R0-2: session hard-delete / emptyArchive must report partial failures
// instead of returning success:true when unlinks or index writes fail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  configDir: null as string | null,
  failUnlinkSuffix: null as string | null,
  failWriteSuffix: null as string | null,
}));

// session-files.ts sweeps via node:fs promises, while deleteSession's index
// RMW uses the dynamic node:fs/promises import. Mock both specifiers with the
// same injected failure surfaces.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: async (target: string | URL) => {
        if (state.failUnlinkSuffix && String(target).includes(state.failUnlinkSuffix)) {
          const err: NodeJS.ErrnoException = new Error('EACCES: permission denied, unlink ' + String(target));
          err.code = 'EACCES';
          throw err;
        }
        return actual.promises.unlink(target);
      },
      writeFile: async (target: string | URL, data: unknown, options?: unknown) => {
        if (state.failWriteSuffix && String(target).includes(state.failWriteSuffix)) {
          const err: NodeJS.ErrnoException = new Error('EBUSY: resource busy, open ' + String(target));
          err.code = 'EBUSY';
          throw err;
        }
        return (actual.promises.writeFile as (t: string | URL, d: unknown, o?: unknown) => Promise<void>)(target, data, options);
      },
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (target: string | URL, data: unknown, options?: unknown) => {
      if (state.failWriteSuffix && String(target).includes(state.failWriteSuffix)) {
        const err: NodeJS.ErrnoException = new Error('EBUSY: resource busy, open ' + String(target));
        err.code = 'EBUSY';
        throw err;
      }
      return (actual.writeFile as (t: string | URL, d: unknown, o?: unknown) => Promise<void>)(target, data, options);
    },
  };
});

vi.mock('@electron/utils/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/paths')>();
  return {
    ...actual,
    getOpenClawConfigDir: () => state.configDir as string,
  };
});

vi.mock('@electron/services/session-cascade-delete', () => ({
  runHostSessionDerivativeCascade: vi.fn(async () => ({ success: true, removed: [], errors: [], retryable: false })),
}));

vi.mock('@electron/services/resource-tracker', () => ({
  getResourceTracker: () => ({ unregisterBySession: vi.fn(async () => 0) }),
}));

const tempRoots: string[] = [];

async function makeConfigDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawx-r0-2-sessions-'));
  tempRoots.push(root);
  const sessionsDir = join(root, 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  state.configDir = root;
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = join(root, 'context-archive');
  return sessionsDir;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.failUnlinkSuffix = null;
  state.failWriteSuffix = null;
});

afterEach(async () => {
  state.configDir = null;
  delete process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR;
  delete process.env.OPENCLAW_STATE_DIR;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('R0-2 sessions.delete partial failures', () => {
  it('returns partial with remainingPaths and keeps the index entry when an artefact unlink fails', async () => {
    const sessionsDir = await makeConfigDir();
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ 'agent:main:abc123': 'abc123.jsonl' }), 'utf8');
    await writeFile(join(sessionsDir, 'abc123.jsonl'), '{}', 'utf8');
    await writeFile(join(sessionsDir, 'abc123.jsonl.reset.bak'), '{}', 'utf8');
    state.failUnlinkSuffix = 'abc123.jsonl.reset.bak';

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();
    const result = await api.delete({ sessionKey: 'agent:main:abc123' } as never);

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.remainingPaths?.some((path) => path.includes('abc123.jsonl.reset.bak'))).toBe(true);
    expect(result.error).toContain('Failed to unlink');

    // The entry must stay so the user can retry instead of seeing a fake success.
    const indexAfter = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, unknown>;
    expect(indexAfter['agent:main:abc123']).toBe('abc123.jsonl');
  });

  it('returns partial when sessions.json read-modify-write fails after files were removed', async () => {
    const sessionsDir = await makeConfigDir();
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ 'agent:main:abc123': 'abc123.jsonl' }), 'utf8');
    await writeFile(join(sessionsDir, 'abc123.jsonl'), '{}', 'utf8');
    state.failWriteSuffix = 'sessions.json';

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();
    const result = await api.delete({ sessionKey: 'agent:main:abc123' } as never);

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.error).toContain('sessions.json');
  });

  it('reports success only when every artefact and the index update succeed', async () => {
    const sessionsDir = await makeConfigDir();
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ 'agent:main:abc123': 'abc123.jsonl' }), 'utf8');
    await writeFile(join(sessionsDir, 'abc123.jsonl'), '{}', 'utf8');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();
    const result = await api.delete({ sessionKey: 'agent:main:abc123' } as never);

    expect(result.success).toBe(true);
    const indexAfter = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, unknown>;
    expect(indexAfter['agent:main:abc123']).toBeUndefined();
  });

  it('succeeds without a legacy sessions.json instead of failing the committed delete', async () => {
    // The runtime keeps sessions in its own store, so this agent has no mirror
    // index at all. The Gateway delete is authoritative: the local sweep must
    // report success and must not fabricate an empty sessions.json.
    await makeConfigDir();
    const sessionsDir = join(state.configDir as string, 'agents', 'main', 'sessions');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi().delete({ sessionKey: 'agent:main:abc123' } as never);

    expect(result.success).toBe(true);
    await expect(access(join(sessionsDir, 'sessions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes runtime .jsonl.deleted.<timestamp> transcripts during hard delete', async () => {
    const sessionsDir = await makeConfigDir();
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({ 'agent:main:abc123': 'abc123.jsonl' }), 'utf8');
    await writeFile(join(sessionsDir, 'abc123.jsonl'), '{}', 'utf8');
    const deletedPath = join(sessionsDir, 'abc123.jsonl.deleted.2026-08-22T00-00-00.000Z');
    await writeFile(deletedPath, '{}', 'utf8');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi().delete({ sessionKey: 'agent:main:abc123' } as never);

    expect(result.success).toBe(true);
    await expect(access(deletedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('R0-2 context archive cleanup (#101)', () => {
  it('permanentDelete removes the context archive and retains the archive index on partial failure', async () => {
    const sessionsDir = await makeConfigDir();
    const archiveRoot = process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR as string;
    const archiveSessionDir = join(archiveRoot, 'arch1');
    await mkdir(archiveSessionDir, { recursive: true });
    await writeFile(join(sessionsDir, 'sessions.archives.json'), JSON.stringify({
      version: 1,
      entries: [{
        sessionKey: 'agent:main:arch1',
        agentId: 'main',
        transcriptPath: join(sessionsDir, 'arch1.archived.jsonl'),
      }],
    }), 'utf8');
    await writeFile(join(sessionsDir, 'arch1.archived.jsonl'), '{}', 'utf8');
    const contextArchive = join(archiveSessionDir, 'snapshot.context-archive.json');
    await writeFile(contextArchive, '{}', 'utf8');
    state.failUnlinkSuffix = 'snapshot.context-archive.json';

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi().permanentDelete({ sessionKey: 'agent:main:arch1' } as never) as {
      success: boolean;
      remainingPaths?: string[];
    };

    expect(result.success).toBe(false);
    expect(result.remainingPaths?.some((entry) => entry.endsWith('snapshot.context-archive.json'))).toBe(true);
    const indexAfter = JSON.parse(await readFile(join(sessionsDir, 'sessions.archives.json'), 'utf8')) as { entries: Array<{ sessionKey: string }> };
    expect(indexAfter.entries.map((entry) => entry.sessionKey)).toContain('agent:main:arch1');
  });

  it('emptyArchive removes the context archive when all derivatives are deletable', async () => {
    const sessionsDir = await makeConfigDir();
    const archiveRoot = process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR as string;
    const archiveSessionDir = join(archiveRoot, 'arch2');
    await mkdir(archiveSessionDir, { recursive: true });
    await writeFile(join(sessionsDir, 'sessions.archives.json'), JSON.stringify({
      version: 1,
      entries: [{
        sessionKey: 'agent:main:arch2',
        agentId: 'main',
        transcriptPath: join(sessionsDir, 'arch2.archived.jsonl'),
      }],
    }), 'utf8');
    await writeFile(join(sessionsDir, 'arch2.archived.jsonl'), '{}', 'utf8');
    const contextArchive = join(archiveSessionDir, 'snapshot.context-archive.json');
    await writeFile(contextArchive, '{}', 'utf8');

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi().emptyArchive({ agentId: 'main' } as never);

    expect(result.success).toBe(true);
    await expect(access(contextArchive)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('R0-2 sessions.emptyArchive failures', () => {
  it('does not report success when an archived file could not be removed', async () => {
    const sessionsDir = await makeConfigDir();
    await writeFile(join(sessionsDir, 'sessions.archives.json'), JSON.stringify({
      version: 1,
      entries: [{
        sessionKey: 'agent:main:arch1',
        agentId: 'main',
        transcriptPath: join(sessionsDir, 'arch1.archived.jsonl'),
      }],
    }), 'utf8');
    await writeFile(join(sessionsDir, 'arch1.archived.jsonl'), '{}', 'utf8');
    await writeFile(join(sessionsDir, 'arch1.deleted.jsonl'), '{}', 'utf8');
    state.failUnlinkSuffix = 'arch1.deleted.jsonl';

    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();
    const result = await api.emptyArchive({ agentId: 'main' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be removed');
  });
});
