import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupContextArchiveArtifacts, upsertArchiveEntry } from '../../electron/utils/session-files';

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('session file helpers', () => {
  it.skipIf(process.platform === 'win32')('writes the shared archive index with owner-only permissions', async () => {
    tempRoot = await mkTempRoot();
    const indexPath = path.join(tempRoot, 'sessions.archives.json');
    await upsertArchiveEntry(indexPath, {
      sessionKey: 'agent:main:main',
      agentId: 'main',
      transcriptPath: path.join(tempRoot, 'session-1.archived.jsonl'),
      label: 'Session',
      archivedAt: Date.now(),
      originalWorkspaceId: null,
      originalFolderId: null,
      sessionsJsonSnapshot: { key: 'agent:main:main' },
    });
    expect((await stat(indexPath)).mode & 0o077).toBe(0);
  });

  it('removes context archive artifacts for deleted sessions without deleting unrelated files', async () => {
    tempRoot = await mkTempRoot();
    const sessionDir = path.join(tempRoot, 'session-1');
    await mkdir(sessionDir, { recursive: true });
    const archivePath = path.join(sessionDir, 'observation.context-archive.json');
    const unrelatedPath = path.join(sessionDir, 'notes.txt');
    await writeFile(archivePath, '{}\n', 'utf8');
    await writeFile(unrelatedPath, 'keep me', 'utf8');

    const cleanup = await cleanupContextArchiveArtifacts({
      archiveRoot: tempRoot,
      sessionIds: ['session-1'],
    });

    await expect(readFile(archivePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(unrelatedPath, 'utf8')).resolves.toBe('keep me');
    expect(cleanup).toEqual({
      removed: [archivePath],
      errors: [],
    });
  });
});

function mkTempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'clawx-session-files-'));
}
