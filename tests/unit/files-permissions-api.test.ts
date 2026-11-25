import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('@electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('../../electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'clawx-user-data-mock')),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
    })),
  },
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
      if (storeState.decisionEvents.length === 0 && options?.defaults?.decisionEvents) {
        storeState.decisionEvents = [...options.defaults.decisionEvents];
      }
    }

    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
      }
      if (key === 'decisionEvents') {
        storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('../../electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => join(tmpdir(), 'clawx-openclaw-config-mock'),
}));

vi.mock('../../electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => join(tmpdir(), 'clawx-openclaw-config-mock'),
}));

function workspace(rootPath: string, permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath,
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

async function runWindowsAclScript(script: string): Promise<string> {
  const psHome = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0');
  const { stdout } = await promisify(execFile)(join(psHome, 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString('base64'),
  ]);
  return stdout.trim();
}

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

describe('files api permission approval flow', () => {
  beforeEach(async () => {
    storeState.approvals = [];
    storeState.decisionEvents = [];
    const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
    permissionsApiTestDouble.reset();
    activeWorkspace.profile = null;
  });

  it('rejects an in-workspace hard link without changing its external inode', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-hardlink-ws-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-hardlink-out-'));
    const outsideFile = join(outsideDir, 'outside.txt');
    const alias = join(workspaceDir, 'alias.txt');
    await writeFile(outsideFile, 'outside-original');
    await link(outsideFile, alias);
    activeWorkspace.profile = workspace(workspaceDir);
    const { createFilesApi } = await import('../../electron/services/files-api');
    const result = await createFilesApi().writeText({ path: alias, content: 'overwrite' });
    expect(result).toMatchObject({ ok: false, error: 'unsafePath' });
    expect(await readFile(outsideFile, 'utf8')).toBe('outside-original');
    expect(await readFile(alias, 'utf8')).toBe('outside-original');
  });

  it.each([true, false])('saves the exact literal ~ path with homeInsideWorkspace=%s', async (homeInsideWorkspace) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-literal-path-'));
    const fixtureHome = homeInsideWorkspace ? workspaceDir : await mkdtemp(join(tmpdir(), 'clawx-literal-home-'));
    const literalDir = join(workspaceDir, '~');
    const literal = join(literalDir, 'note.txt');
    const shadow = join(workspaceDir, 'note.txt');
    try {
      vi.stubEnv('HOME', fixtureHome);
      await mkdir(literalDir);
      await writeFile(literal, 'old literal');
      await writeFile(shadow, 'retained shadow');
      activeWorkspace.profile = workspace(workspaceDir);
      const { createFilesApi } = await import('../../electron/services/files-api');
      const saved = await createFilesApi().writeText({ path: literal, content: 'new literal' });
      expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
      expect(await readFile(literal, 'utf8')).toBe('new literal');
      expect(await readFile(shadow, 'utf8')).toBe('retained shadow');
    } finally {
      vi.unstubAllEnvs();
      await rm(workspaceDir, { recursive: true, force: true });
      if (!homeInsideWorkspace) await rm(fixtureHome, { recursive: true, force: true });
    }
  });

  it('updates the existing inode, metadata and open readers when saving shorter content', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-save-inode-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'original content longer than the replacement');
    const fileLiteral = psLiteral(filePath);
    const aclBefore = process.platform === 'win32' ? await runWindowsAclScript(`
$acl = [IO.File]::GetAccessControl(${fileLiteral})
$acl.SetAccessRuleProtection($true, $true)
[IO.File]::SetAccessControl(${fileLiteral}, $acl)
[IO.File]::GetAccessControl(${fileLiteral}).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
`) : undefined;
    const before = await stat(filePath);
    const reader = await open(filePath, 'r');
    try {
      activeWorkspace.profile = workspace(workspaceDir);
      const { createFilesApi } = await import('../../electron/services/files-api');
      expect(await createFilesApi().writeText({ path: filePath, content: 'new' })).toMatchObject({ ok: true });
      const after = await stat(filePath);
      expect([after.dev, after.ino, after.mode, after.uid, after.gid]).toEqual([
        before.dev, before.ino, before.mode, before.uid, before.gid,
      ]);
      expect(await reader.readFile('utf8')).toBe('new');
      if (aclBefore !== undefined) {
        expect(await runWindowsAclScript(`[IO.File]::GetAccessControl(${fileLiteral}).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)`)).toBe(aclBefore);
      }
    } finally {
      await reader.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }, 20_000);

  it.skipIf(process.platform !== 'win32')('saves a writable file when its parent denies sibling creation', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-save-parent-acl-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'old');
    const directoryLiteral = psLiteral(workspaceDir);
    const fileLiteral = psLiteral(filePath);
    const originalAcl = await runWindowsAclScript(`[IO.Directory]::GetAccessControl(${directoryLiteral}).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)`);
    try {
      await runWindowsAclScript(`
$fileAcl = [IO.File]::GetAccessControl(${fileLiteral})
$fileAcl.SetAccessRuleProtection($true, $true)
[IO.File]::SetAccessControl(${fileLiteral}, $fileAcl)
$acl = [IO.Directory]::GetAccessControl(${directoryLiteral})
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$deny = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::CreateFiles, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny)
$acl.AddAccessRule($deny)
[IO.Directory]::SetAccessControl(${directoryLiteral}, $acl)
`);
      await writeFile(filePath, 'control write');
      await expect(writeFile(join(workspaceDir, 'sibling.txt'), 'forbidden')).rejects.toThrow();
      activeWorkspace.profile = workspace(workspaceDir);
      const { createFilesApi } = await import('../../electron/services/files-api');
      expect(await createFilesApi().writeText({ path: filePath, content: 'saved' })).toMatchObject({ ok: true });
      expect(await readFile(filePath, 'utf8')).toBe('saved');
    } finally {
      await runWindowsAclScript(`
$acl = [IO.Directory]::GetAccessControl(${directoryLiteral})
$acl.SetSecurityDescriptorSddlForm(${psLiteral(originalAcl)}, [Security.AccessControl.AccessControlSections]::Access)
[IO.Directory]::SetAccessControl(${directoryLiteral}, $acl)
`);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('returns an approval event for workspace-external writes and consumes it once', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-workspace-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-outside-'));
    const filePath = join(outsideDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createPermissionsApi } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const permissions = createPermissionsApi();

    const first = await api.writeText({ path: filePath, content: 'new' });
    expect(first).toMatchObject({
      ok: false,
      error: 'approvalRequired',
      approvalRequired: true,
      approval: {
        source: 'file',
        paths: [filePath],
      },
    });

    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    await permissions.decideApproval({ id: approvalId, decision: 'approved' } as never);

    await expect(api.writeText({ path: filePath, content: 'new', approvalId })).resolves.toMatchObject({
      ok: true,
    });

    await expect(api.writeText({ path: filePath, content: 'new', approvalId })).resolves.toMatchObject({
      ok: false,
      error: 'approvalRequired',
    });
  });

  it.each([['abc', 'xyz'], ['甲', '乙']])('requires fresh approval for equal-byte content %s changed to %s', async (approvedContent, changedContent) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-content-approval-ws-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-content-approval-out-'));
    const filePath = join(outsideDir, 'note.txt');
    try {
      await writeFile(filePath, 'old', 'utf8');
      activeWorkspace.profile = workspace(workspaceDir);
      const { createPermissionsApi } = await import('../../electron/services/permissions-api');
      const { createFilesApi } = await import('../../electron/services/files-api');
      const api = createFilesApi();
      const permissions = createPermissionsApi();
      expect(Buffer.byteLength(changedContent, 'utf8')).toBe(Buffer.byteLength(approvedContent, 'utf8'));
      const first = await api.writeText({ path: filePath, content: approvedContent });
      const approvalId = first.approval?.id;
      expect(approvalId).toBeTruthy();
      await permissions.decideApproval({ id: approvalId, decision: 'approved' } as never);

      await expect(api.writeText({ path: filePath, content: changedContent, approvalId })).resolves.toMatchObject({ ok: false, error: 'approvalRequired' });
      expect(await readFile(filePath, 'utf8')).toBe('old');
      await expect(api.writeText({ path: filePath, content: approvedContent, approvalId })).resolves.toMatchObject({ ok: true });
      expect(await readFile(filePath, 'utf8')).toBe(approvedContent);
      await expect(api.writeText({ path: filePath, content: approvedContent, approvalId })).resolves.toMatchObject({ ok: false, error: 'approvalRequired' });
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('blocks writes outright in plan mode', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-workspace-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir, 'plan');

    const { listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();

    await expect(api.writeText({ path: filePath, content: 'new' })).resolves.toMatchObject({
      ok: false,
      error: 'permissionDenied',
    });
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        tool: 'files.writeText',
        boundary: 'user-file',
        decision: 'deny',
      }),
    ]));
  });

  it('P2-001: readOnly default blocks files.writeText without silent acceptEdits', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-ro-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir, 'readOnly');

    const { listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();

    await expect(api.writeText({ path: filePath, content: 'new' })).resolves.toMatchObject({
      ok: false,
      error: 'permissionDenied',
    });
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceMode: 'readOnly',
        tool: 'files.writeText',
        decision: 'deny',
      }),
    ]));
  });
});

describe('files api read allowlist (P1-003)', () => {
  it('rejects arbitrary local path reads outside workspace and write roots', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-read-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-out-read-'));
    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'top-secret', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const result = await api.readText({ path: secretPath });
    expect(result).toMatchObject({ ok: false, error: 'outsideSandbox' });
  });

  it('allows reading files inside the active workspace', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-in-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'hello', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const result = await api.readText({ path: filePath });
    expect(result).toMatchObject({ ok: true, content: 'hello' });
  });
});
