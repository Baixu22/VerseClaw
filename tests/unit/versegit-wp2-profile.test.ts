import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateWp2Report, WP2_SCHEMA } from '../../scripts/versegit-wp2-profile.mjs';

const root = resolve(process.cwd());
const fixturePath = resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json');
let fixtureRoot: string;
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function buildWp2Report(input: { root: string; fixture: typeof fixture }) {
  const code = `import { register } from 'node:module';
    import { readFileSync } from 'node:fs';
    register(${JSON.stringify(pathToFileURL(resolve(root, 'scripts/lib/ts-import-hooks.mjs')).href)});
    const { buildWp2Report } = await import(${JSON.stringify(pathToFileURL(resolve(root, 'scripts/versegit-wp2-profile.mjs')).href)});
    console.log(JSON.stringify(await buildWp2Report(JSON.parse(readFileSync(0, 'utf8')))));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 30_000,
  }));
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'versegit-wp2-current-package-'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'resources/versegit/manifest.json'), 'utf8'));
  const binaryPath = resolve(root, manifest.artifact.devPath);
  expect(createHash('sha256').update(readFileSync(binaryPath)).digest('hex')).toBe(manifest.artifact.sha256);
  const capabilities = execFileSync(binaryPath, ['capabilities', '--json'], { encoding: 'utf8', windowsHide: true });
  expect(createHash('sha256').update(capabilities).digest('hex')).toBe(manifest.provider.capabilitiesSha256);
  const capabilitiesDigest = createHash('sha256').update(JSON.stringify(JSON.parse(capabilities))).digest('hex');
  const repo = join(fixtureRoot, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '--quiet', repo]);
  execFileSync('git', ['-c', 'user.name=Test Agent', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'WP2 fixture'], { cwd: repo, stdio: 'pipe' });
  execFileSync(binaryPath, ['init', '--json'], { cwd: repo, windowsHide: true, stdio: 'pipe' });
  const base = 'harness/specs/fixtures/versegit-planning-correction/';
  for (const path of ['mc0-evidence/baseline.json', 'mc1-evidence/contract.json', 'wp0-evidence/contract.json']) {
    const value = JSON.parse(readFileSync(resolve(root, base, path), 'utf8'));
    // The regression drives the packaged binary using isolated fixture metadata.
    if (path.startsWith('mc0')) {
      value.source.repo = repo;
      value.binary.path = binaryPath;
      value.binary.sha256 = manifest.artifact.sha256;
    }
    if (path.startsWith('wp0')) value.binary_identity.capabilities_digest = capabilitiesDigest;
    mkdirSync(dirname(resolve(fixtureRoot, base, path)), { recursive: true });
    writeFileSync(resolve(fixtureRoot, base, path), JSON.stringify(value));
  }
  mkdirSync(resolve(fixtureRoot, 'electron/services'), { recursive: true });
  copyFileSync(resolve(root, 'electron/services/versegit-module.ts'), resolve(fixtureRoot, 'electron/services/versegit-module.ts'));
  fixture.cases.find((entry: { id: string }) => entry.id === 'missing-binary').binaryPath = resolve(fixtureRoot, 'missing-vg.exe');
});
afterAll(() => { if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true }); });

describe('WP2 concurrency-aux diagnostic profile', () => {
  it('keeps single-worktree calls at zero and records observed/partial/unavailable facts', async () => {
    const built = await buildWp2Report({ root: fixtureRoot, fixture });
    expect(built.report.schema).toBe(WP2_SCHEMA);
    expect(built.report.profile).toBe('concurrency-aux');
    expect(built.report.summary).toMatchObject({ caseCount: 3, eligibleCount: 2, processCalls: 3 });
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree')?.usage.processesStarted).toBe(0);
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'multi-worktree')?.status, JSON.stringify(built.report.cases)).toBe('partial');
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'missing-binary')?.status).toBe('unavailable');
    expect(validateWp2Report(built.report).issues).toEqual([]);
  });

  it('rejects a widened single-worktree call or a leaked host path', async () => {
    const built = await buildWp2Report({ root: fixtureRoot, fixture });
    const widened = structuredClone(built.report);
    widened.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree').usage.processesStarted = 1;
    expect(validateWp2Report(widened).issues).toContain('single-worktree case must start zero VG processes');
    const leaked = structuredClone(built.report);
    leaked.cases[0].repository = { path: 'D:/Projects/VerseGit' };
    leaked.digest = '0'.repeat(64);
    expect(validateWp2Report(leaked).issues).toContain('WP2 report digest is not reproducible');
  });

  it('rejects a binary whose bytes differ from the fixture pin without spawning', async () => {
    const path = resolve(fixtureRoot, 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json');
    const original = readFileSync(path);
    try {
      const changed = JSON.parse(original.toString());
      changed.binary.sha256 = '0'.repeat(64);
      writeFileSync(path, JSON.stringify(changed));
      const built = await buildWp2Report({ root: fixtureRoot, fixture });
      expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'multi-worktree')).toMatchObject({
        status: 'rejected_by_policy', reason: 'binary_digest_mismatch', usage: { processesStarted: 0 },
      });
    } finally {
      writeFileSync(path, original);
    }
  });

  it('does not add the concurrency profile to fast or comms', () => {
    const source = readFileSync(resolve(root, 'harness/src/profiles.mjs'), 'utf8');
    expect(source).toContain("'concurrency-aux'");
    const fast = source.match(/fast:\s*\[([\s\S]*?)\],\s*comms:/u)?.[1] ?? '';
    const comms = source.match(/comms:\s*\[([\s\S]*?)\],\s*e2e:/u)?.[1] ?? '';
    expect(fast).not.toContain('versegit');
    expect(comms).not.toContain('versegit');
  });
});
