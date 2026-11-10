import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWp2Report, validateWp2Report, WP2_SCHEMA } from '../../scripts/versegit-wp2-profile.mjs';

const root = resolve(process.cwd());
const fixturePath = resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json');

describe('WP2 concurrency-aux diagnostic profile', () => {
  it('keeps single-worktree calls at zero and records observed/partial/unavailable facts', async () => {
    const built = await buildWp2Report({ root, fixturePath });
    expect(built.report.schema).toBe(WP2_SCHEMA);
    expect(built.report.profile).toBe('concurrency-aux');
    expect(built.report.summary).toMatchObject({ caseCount: 3, eligibleCount: 2, processCalls: 3 });
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree')?.usage.processesStarted).toBe(0);
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'multi-worktree')?.status).toBe('degraded');
    expect(built.report.cases.find((entry: { caseId: string }) => entry.caseId === 'missing-binary')?.status).toBe('unavailable');
    expect(validateWp2Report(built.report).issues).toEqual([]);
  });

  it('rejects a widened single-worktree call or a leaked host path', async () => {
    const built = await buildWp2Report({ root, fixturePath });
    const widened = structuredClone(built.report);
    widened.cases.find((entry: { caseId: string }) => entry.caseId === 'single-worktree').usage.processesStarted = 1;
    expect(validateWp2Report(widened).issues).toContain('single-worktree case must start zero VG processes');
    const leaked = structuredClone(built.report);
    leaked.cases[0].repository = { path: 'D:/Projects/VerseGit' };
    leaked.digest = '0'.repeat(64);
    expect(validateWp2Report(leaked).issues).toContain('WP2 report digest is not reproducible');
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