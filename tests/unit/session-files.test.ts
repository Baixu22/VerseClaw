import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cleanupContextArchiveArtifacts, upsertArchiveEntry } from '../../electron/utils/session-files';

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('session file helpers', () => {
  it('writes the shared archive index with owner-only permissions', async () => {
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
    if (process.platform === 'win32') {
      const script = `$acl = [System.IO.File]::GetAccessControl($env:CLAWX_PRIVATE_FILE_PATH); $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{ protected = $acl.AreAccessRulesProtected; owner = $owner; rules = @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; type = [string]$_.AccessControlType } }) } | ConvertTo-Json -Depth 4 -Compress`;
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, env: { ...process.env, CLAWX_PRIVATE_FILE_PATH: indexPath },
      });
      const acl = JSON.parse(raw) as { protected: boolean; owner: string; rules: Array<{ sid: string; inherited: boolean; type: string }> };
      expect(acl.protected).toBe(true);
      expect(acl.rules).toEqual([{ sid: acl.owner, inherited: false, type: 'Allow' }]);
    } else {
      expect((await stat(indexPath)).mode & 0o077).toBe(0);
    }
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
