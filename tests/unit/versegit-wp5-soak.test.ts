// @vitest-environment node
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWp5Report, validateWp5Report } from '../../scripts/versegit-wp5-soak.mjs';

describe('WP5 bounded replay/soak', () => {
  it('cleans disposable worktrees and preserves pass/failure facts', async () => {
    const built = await buildWp5Report({ root: resolve(process.cwd()) });
    expect(built.report.summary).toMatchObject({ cycles: 3, failedScenarios: 0, processCalls: 0 });
    expect(built.report.cycles.every((entry: { cleanup: { worktreesDeleted: number; survivors: number; tempRootRemoved: boolean } }) => entry.cleanup.worktreesDeleted === 2 && entry.cleanup.survivors === 0 && entry.cleanup.tempRootRemoved)).toBe(true);
    expect(built.report.failures.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining(['single_worktree', 'verseshell_unavailable', 'sidecar_crash', 'report_tamper']));
    expect(validateWp5Report(built.report).issues).toEqual([]);
  }, 30_000);
});