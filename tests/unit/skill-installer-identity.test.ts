/**
 * Regression for issue #131.
 *
 * The managed-skill installer used to fetch a mutable default branch, ignore the
 * requested version entirely, and then write the catalog-declared version into
 * `origin.json` as `installedVersion` — a claim about bytes that were never part
 * of the install. These tests pin the replacement contract:
 *
 *  - a requested version is honored when it resolves to a real git ref, and the
 *    outcome (`honored` / `unresolved`) is recorded rather than implied;
 *  - every install records a sha256 digest of the installed tree plus the ref and
 *    revision it came from, so installed bytes have a verifiable identity;
 *  - an install whose recorded identity cannot be verified is removed and fails.
 *
 * All fixtures are local: `child_process` and `https` boundaries are mocked, no
 * third-party repository is downloaded and nothing is installed for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));
vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  default: { execFileSync: execFileSyncMock },
}));

const CATALOG_ENTRY = {
  slug: 'pdf',
  name: 'PDF Reader',
  description: 'fixture entry',
  version: '1.2.0',
  author: 'fixture',
  github: 'openclaw/skill-pdf',
  tags: ['pdf'],
};

const DEFAULT_FILES: Record<string, string> = { 'SKILL.md': '---\nname: fixture\n---\n' };

let skillsRoot = '';
let createdRoots: string[] = [];

function makeSkillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-skill-install-'));
  createdRoots.push(root);
  return root;
}

function cloneCalls(): string[] {
  return execFileSyncMock.mock.calls
    .filter((call) => call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'clone')
    .map((call) => (call[1] as string[])[(call[1] as string[]).indexOf('--branch') + 1]);
}

function writeFixtureFiles(dir: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

/** Mocks the git boundary: only accepted refs "clone"; `rev-parse` reports a fixed revision. */
function mockGitInstall(params: {
  accept: (ref: string) => boolean;
  files?: Record<string, string>;
  revision?: string;
}): void {
  execFileSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command === 'git' && args[0] === '-C') {
      return Buffer.from(`${params.revision ?? 'f'.repeat(40)}\n`);
    }
    if (command !== 'git' || args[0] !== 'clone') {
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    }
    const ref = args[args.indexOf('--branch') + 1];
    const target = args[args.length - 1];
    if (!params.accept(ref)) {
      throw new Error(`fatal: Remote branch ${ref} not found`);
    }
    writeFixtureFiles(target, params.files ?? DEFAULT_FILES);
    return Buffer.from('');
  });
}

/** Mocks the archive fallback: git is unavailable and codeload answers with `statusCode`. */
function mockArchiveInstall(params: { statusCode: number; files?: Record<string, string> }): void {
  execFileSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command === 'git') {
      throw new Error('fatal: git is not available');
    }
    if (command === 'powershell') {
      const extractDir = args[args.length - 1];
      writeFixtureFiles(join(extractDir, 'skill-pdf'), params.files ?? DEFAULT_FILES);
      return Buffer.from('');
    }
    throw new Error(`unexpected command: ${command}`);
  });
  vi.doMock('https', () => {
    const request = { on: () => request };
    return {
      default: {
        get: (_url: string, _options: unknown, callback: (response: unknown) => void) => {
          const response = {
            statusCode: params.statusCode,
            headers: {},
            resume: () => {},
            on: (event: string, handler: (chunk?: Buffer) => void) => {
              if (event === 'data') handler(Buffer.from('fixture-archive'));
              if (event === 'end') handler();
              return response;
            },
          };
          callback(response);
          return request;
        },
      },
    };
  });
}

async function loadInstaller(): Promise<typeof import('@electron/gateway/skill-installer')> {
  vi.resetModules();
  const paths = await import('@electron/utils/paths');
  vi.spyOn(paths, 'getOpenClawSkillsDir').mockReturnValue(skillsRoot);
  return import('@electron/gateway/skill-installer');
}

function readOrigin(slug: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(skillsRoot, slug, '.clawhub', 'origin.json'), 'utf8'),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  execFileSyncMock.mockReset();
  skillsRoot = makeSkillsRoot();
});

afterEach(() => {
  vi.doUnmock('https');
  vi.doUnmock('crypto');
  for (const root of createdRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  createdRoots = [];
});

describe('skill install identity (#131)', () => {
  it('honors a requested version that resolves to a real git ref and records verifiable byte identity', async () => {
    mockGitInstall({
      accept: (ref) => ref === 'v1.2.0',
      files: {
        'SKILL.md': '---\nname: PDF\n---\n',
        'package.json': JSON.stringify({ name: 'skill-pdf', version: '1.4.0' }),
      },
      revision: 'c'.repeat(40),
    });
    const installer = await loadInstaller();

    const identity = await installer.installSkillFromCatalog(CATALOG_ENTRY, '1.2.0');

    expect(identity.requestedVersionStatus).toBe('honored');
    expect(identity.requestedVersion).toBe('1.2.0');
    expect(identity.trackedRef).toBe('v1.2.0');
    expect(identity.trackedRefKind).toBe('pinned');
    expect(identity.resolvedRevision).toBe('c'.repeat(40));
    expect(identity.installSource).toBe('git-clone');
    expect(identity.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.contentDigestAlgorithm).toBe('sha256');
    // The declared catalog version is recorded as source metadata, and the only
    // `installedVersion` claim comes from the bytes that were actually installed.
    expect(identity.declaredCatalogVersion).toBe('1.2.0');
    expect(identity.installedVersion).toBe('1.4.0');
    expect(identity.installedVersionSource).toBe('installed-package-json');
    expect(cloneCalls()).toContain('v1.2.0');

    const skillDir = join(skillsRoot, 'pdf');
    expect(readOrigin('pdf')).toEqual(identity);
    expect(installer.verifyInstalledSkillIntegrity(skillDir)).toMatchObject({
      verified: true,
      reason: 'verified',
      actualDigest: identity.contentDigest,
    });
  });

  it('tracks the default branch and records that the requested version could not be resolved', async () => {
    mockGitInstall({ accept: (ref) => ref === 'main' });
    const installer = await loadInstaller();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const identity = await installer.installSkillFromCatalog(CATALOG_ENTRY, '9.9.9');

    expect(cloneCalls()).toEqual(['9.9.9', 'v9.9.9', 'main']);
    expect(identity.requestedVersionStatus).toBe('unresolved');
    expect(identity.requestedVersion).toBe('9.9.9');
    expect(identity.trackedRef).toBe('main');
    expect(identity.trackedRefKind).toBe('branch');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a resolvable git ref'));
    expect(readOrigin('pdf').requestedVersionStatus).toBe('unresolved');
  });

  it('never presents the catalog version as the installed version when the bytes declare none', async () => {
    mockGitInstall({ accept: (ref) => ref === 'main' });
    const installer = await loadInstaller();

    const identity = await installer.installSkillFromCatalog(CATALOG_ENTRY);

    expect(identity.requestedVersionStatus).toBe('not-requested');
    expect(identity.requestedVersion).toBeUndefined();
    expect(identity.installedVersion).toBeUndefined();
    expect(identity.installedVersionSource).toBe('unavailable');
    expect(identity.declaredCatalogVersion).toBe('1.2.0');
    const onDisk = readOrigin('pdf');
    expect('installedVersion' in onDisk).toBe(false);
    expect(onDisk.declaredCatalogVersion).toBe('1.2.0');
  });

  it('falls back to the archive path and records the archive ref, or fails when the download fails', async () => {
    mockArchiveInstall({ statusCode: 200 });
    const installer = await loadInstaller();

    const identity = await installer.installSkillFromCatalog(CATALOG_ENTRY);

    expect(identity.installSource).toBe('zip-archive');
    expect(identity.trackedRef).toBe('refs/heads/main');
    expect(identity.trackedRefKind).toBe('branch');
    expect(identity.resolvedRevision).toBeUndefined();
    expect(installer.verifyInstalledSkillIntegrity(join(skillsRoot, 'pdf')).verified).toBe(true);

    const failingRoot = makeSkillsRoot();
    skillsRoot = failingRoot;
    mockArchiveInstall({ statusCode: 404 });
    const failingInstaller = await loadInstaller();
    await expect(failingInstaller.installSkillFromCatalog(CATALOG_ENTRY)).rejects.toThrow(
      /Failed to download from GitHub: HTTP 404/,
    );
    expect(existsSync(join(failingRoot, 'pdf'))).toBe(false);
  });

  it('derives a deterministic digest that ignores installer metadata and VCS internals', async () => {
    const installer = await loadInstaller();
    const plain = join(skillsRoot, 'plain');
    const decorated = join(skillsRoot, 'decorated');
    for (const dir of [plain, decorated]) {
      mkdirSync(join(dir, 'nested'), { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'body');
      writeFileSync(join(dir, 'nested', 'x.txt'), 'x');
    }
    mkdirSync(join(decorated, '.clawhub'), { recursive: true });
    writeFileSync(join(decorated, '.clawhub', 'origin.json'), '{}');
    mkdirSync(join(decorated, '.git'), { recursive: true });
    writeFileSync(join(decorated, '.git', 'config'), 'vcs internals');

    expect(installer.computeSkillContentDigest(plain)).toBe(
      installer.computeSkillContentDigest(decorated),
    );

    writeFileSync(join(plain, 'nested', 'x.txt'), 'y');
    expect(installer.computeSkillContentDigest(plain)).not.toBe(
      installer.computeSkillContentDigest(decorated),
    );
  });

  it('reports explicit integrity states instead of assuming trust', async () => {
    const installer = await loadInstaller();

    expect(installer.verifyInstalledSkillIntegrity(join(skillsRoot, 'absent'))).toMatchObject({
      verified: false,
      reason: 'not-installed',
    });

    const noOrigin = join(skillsRoot, 'no-origin');
    mkdirSync(noOrigin, { recursive: true });
    writeFileSync(join(noOrigin, 'SKILL.md'), 'body');
    expect(installer.verifyInstalledSkillIntegrity(noOrigin)).toMatchObject({
      verified: false,
      reason: 'identity-missing',
    });

    const malformed = join(skillsRoot, 'malformed');
    mkdirSync(join(malformed, '.clawhub'), { recursive: true });
    writeFileSync(join(malformed, '.clawhub', 'origin.json'), 'not json');
    expect(installer.verifyInstalledSkillIntegrity(malformed)).toMatchObject({
      verified: false,
      reason: 'identity-malformed',
    });

    const wrongAlgorithm = join(skillsRoot, 'wrong-algorithm');
    mkdirSync(join(wrongAlgorithm, '.clawhub'), { recursive: true });
    writeFileSync(
      join(wrongAlgorithm, '.clawhub', 'origin.json'),
      JSON.stringify({ contentDigest: 'a'.repeat(64), contentDigestAlgorithm: 'md5' }),
    );
    expect(installer.verifyInstalledSkillIntegrity(wrongAlgorithm)).toMatchObject({
      verified: false,
      reason: 'identity-malformed',
    });

    const mismatch = join(skillsRoot, 'mismatch');
    mkdirSync(join(mismatch, '.clawhub'), { recursive: true });
    writeFileSync(join(mismatch, 'SKILL.md'), 'body');
    writeFileSync(
      join(mismatch, '.clawhub', 'origin.json'),
      JSON.stringify({ contentDigest: 'a'.repeat(64), contentDigestAlgorithm: 'sha256' }),
    );
    const mismatchCheck = installer.verifyInstalledSkillIntegrity(mismatch);
    expect(mismatchCheck.verified).toBe(false);
    expect(mismatchCheck.reason).toBe('digest-mismatch');
    expect(mismatchCheck.expectedDigest).toBe('a'.repeat(64));
    expect(mismatchCheck.actualDigest).toBe(installer.computeSkillContentDigest(mismatch));
  });

  it('rejects an encoded traversal slug that would escape the skills root', async () => {
    const installer = await loadInstaller();
    expect(() => installer.resolveInstalledSkillDir('..%2Fescape')).toThrow(/Invalid skill slug/);
  });

  it('rejects path traversal, unsafe slugs and unsafe GitHub coordinates before any fetch', async () => {
    const installer = await loadInstaller();
    expect(() => installer.resolveInstalledSkillDir('../outside')).toThrow(/Invalid skill slug/);
    expect(() => installer.resolveInstalledSkillDir('..')).toThrow(/outside skills directory/);
    await expect(installer.installSkillFromCatalog({
      ...CATALOG_ENTRY,
      slug: '../escape',
    })).rejects.toThrow(/Invalid skill slug/);
    await expect(installer.installSkillFromCatalog({
      ...CATALOG_ENTRY,
      github: 'owner/repo/extra',
    })).rejects.toThrow(/Invalid GitHub repo/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects redirect and archive URLs outside the GitHub host allowlist', async () => {
    const installer = await loadInstaller();
    expect(installer.isAllowedDownloadUrl('https://codeload.github.com/openclaw/skill-pdf/zip/refs/heads/main')).toBe(true);
    expect(installer.isAllowedDownloadUrl('https://github.com/openclaw/skill-pdf')).toBe(true);
    expect(installer.isAllowedDownloadUrl('https://evil.example/payload')).toBe(false);
    expect(installer.isAllowedDownloadUrl('http://codeload.github.com/payload')).toBe(false);
    expect(installer.isAllowedDownloadUrl('file:///etc/passwd')).toBe(false);
  });
  it('removes the install and fails when the recorded digest cannot be re-verified', async () => {
    // Force a mismatch between the digest written at install time and the digest
    // recomputed during verification, without touching the real filesystem.
    vi.resetModules();
    const paths = await import('@electron/utils/paths');
    vi.spyOn(paths, 'getOpenClawSkillsDir').mockReturnValue(skillsRoot);
    let digestCalls = 0;
    const hash = {
      update: () => hash,
      digest: () => {
        digestCalls += 1;
        return digestCalls === 1 ? 'a'.repeat(64) : 'b'.repeat(64);
      },
    };
    vi.doMock('crypto', () => ({ default: { createHash: () => hash } }));
    mockGitInstall({ accept: (ref) => ref === 'main' });
    const installer = await import('@electron/gateway/skill-installer');

    await expect(installer.installSkillFromCatalog(CATALOG_ENTRY)).rejects.toThrow(
      /failed install integrity verification/,
    );
    expect(existsSync(join(skillsRoot, 'pdf'))).toBe(false);
    expect(existsSync(join(skillsRoot, 'pdf.tmp'))).toBe(false);
    expect(readOriginSafe()).toBeUndefined();
  });
});

function readOriginSafe(): unknown {
  try {
    return readOrigin('pdf');
  } catch {
    return undefined;
  }
}
