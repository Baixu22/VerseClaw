import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWp2Report, validateWp2Report, WP2_SCHEMA } from '../../scripts/versegit-wp2-profile.mjs';

const root = resolve(process.cwd());
const fixturePath = resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json');
const temporaryRoots: string[] = [];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function replayFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'wp2-unit-replay-'));
  temporaryRoots.push(directory);
  const fixtureDirectory = 'harness/specs/fixtures/versegit-planning-correction';
  const baseline = JSON.parse(readFileSync(resolve(root, fixtureDirectory, 'mc0-evidence/baseline.json'), 'utf8'));
  const captures = baseline.golden as Array<{ args: string[]; stdout: string; stdout_sha256: string; stderr: string | null }>;
  const binary = resolve(directory, 'provider.fixture');
  const providerBytes = 'WP2 unit fixture; provider output is replayed.';
  writeFileSync(binary, providerBytes);
  baseline.binary = { ...baseline.binary, path: binary, bytes: Buffer.byteLength(providerBytes), sha256: digest(providerBytes) };
  baseline.source = { ...baseline.source, repo: directory };
  mkdirSync(resolve(directory, fixtureDirectory, 'mc0-evidence'), { recursive: true });
  writeFileSync(resolve(directory, fixtureDirectory, 'mc0-evidence/baseline.json'), JSON.stringify(baseline));
  for (const relative of ['mc1-evidence/contract.json', 'wp0-evidence/contract.json']) {
    const target = resolve(directory, fixtureDirectory, relative);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(resolve(root, fixtureDirectory, relative), target);
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  fixture.cases.find((entry: { id: string }) => entry.id === 'missing-binary').binaryPath = resolve(directory, 'absent-provider');
  const spawn = vi.fn((_binary: string, argv: string[]) => {
    const captured = captures.find((entry) => JSON.stringify(entry.args) === JSON.stringify(argv));
    if (!captured) throw new Error(`unexpected WP2 probe: ${argv.join(' ')}`);
    expect(digest(captured.stdout)).toBe(captured.stdout_sha256);
    return { stdout: captured.stdout, stderr: captured.stderr ?? '', status: 0 };
  });
  const moduleLoader = () => import('../../electron/services/versegit-module');
  return { binary, spawn, options: { root: directory, fixture, spawn, moduleLoader } };
}

describe('WP2 concurrency-aux diagnostic profile', () => {
  it('replays frozen probe outputs with zero calls for single-worktree and missing-binary cases', async () => {
    const replay = replayFixture();
    const built = await buildWp2Report(replay.options);
    expect(replay.spawn.mock.calls.map((call) => call[1])).toEqual([
      ['--version'], ['capabilities', '--json'], ['doctor', '--json'],
    ]);
    expect(built.report.schema).toBe(WP2_SCHEMA);
    expect(built.report.profile).toBe('concurrency-aux');
    expect(built.report.summary).toMatchObject({ caseCount: 3, eligibleCount: 2, processCalls: 3 });
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree')?.usage.processesStarted).toBe(0);
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'multi-worktree')?.status).toBe('partial');
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'missing-binary')?.status).toBe('unavailable');
    expect(validateWp2Report(built.report).issues).toEqual([]);
  });

  it('rejects a widened single-worktree call or a leaked host path', async () => {
    const built = await buildWp2Report(replayFixture().options);
    const widened = structuredClone(built.report);
    widened.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree').usage.processesStarted = 1;
    expect(validateWp2Report(widened).issues).toContain('single-worktree case must start zero VG processes');
    const leaked = structuredClone(built.report);
    leaked.cases[0].repository = { path: 'D:/Projects/VerseGit' };
    leaked.digest = '0'.repeat(64);
    expect(validateWp2Report(leaked).issues).toContain('WP2 report digest is not reproducible');
  });

  it('rejects changed provider bytes before invoking the probe runner', async () => {
    const replay = replayFixture();
    writeFileSync(replay.binary, 'changed provider');
    const built = await buildWp2Report(replay.options);
    expect(replay.spawn).not.toHaveBeenCalled();
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'multi-worktree')).toMatchObject({
      status: 'rejected_by_policy', reason: 'binary_digest_mismatch', usage: { processesStarted: 0 },
    });
    expect(built.report.passed).toBe(false);
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
