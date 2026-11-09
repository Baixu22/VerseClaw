// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function ciEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  // Windows selects one spelling when env keys differ only by case. Reproduce
  // nested pnpm's uppercase spelling and replace every overridden spelling.
  const inherited = { ...process.env, NPM_EXECPATH: process.env.npm_execpath };
  const replaced = new Set(Object.keys(overrides).map(key => key.toLowerCase()));
  return { ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !replaced.has(key.toLowerCase()))), ...overrides };
}

describe('Harness CI process entry', () => {
  it.each([0, 7])('records every completed gate and stops only on failure at stage %i', (failAt) => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-harness-ci-'));
    const pnpm = join(root, 'pnpm.mjs'), report = join(root, 'report.json'), calls = join(root, 'calls.jsonl');
    writeFileSync(pnpm, `import fs from 'node:fs';\nconst path=process.env.HARNESS_TEST_CALLS;\nfs.appendFileSync(path,JSON.stringify(process.argv.slice(2))+'\\n');\nconst count=fs.readFileSync(path,'utf8').trim().split('\\n').length;\nprocess.exit(count===Number(process.env.HARNESS_TEST_FAIL_AT)?3:0);\n`);
    let code = 0;
    try {
      execFileSync(process.execPath, ['scripts/harness-ci.mjs'], { cwd: process.cwd(), windowsHide: true,
        env: ciEnv({ npm_execpath: pnpm, CLAWX_HARNESS_CI_REPORT: report,
          HARNESS_TEST_CALLS: calls, HARNESS_TEST_FAIL_AT: String(failAt) }), stdio: 'pipe' });
    } catch (error) { code = (error as { status: number }).status; }
    try {
      const result = JSON.parse(readFileSync(report, 'utf8'));
      const observed = readFileSync(calls, 'utf8').trim().split('\n').map(row => JSON.parse(row));
      expect(code).toBe(failAt ? 3 : 0);
      expect(result.success).toBe(!failAt);
      expect(result.results).toHaveLength(failAt || 12);
      expect(result.results.map((row: { args: string[] }) => row.args)).toEqual(observed);
      if (!failAt) expect(observed.slice(6).map(row => row[0])).toEqual([
        'repo:duplicates:check', 'docs:policy:validate', 'catalogs:check', 'agent-dev:audit', 'repo:evidence:check', 'repo:test-coverage:check',
      ]);
      else expect(result.results.at(-1).exitCode).toBe(3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects recursive use of the same pnpm entry before starting a gate', () => {
    const pnpm = resolve(tmpdir(), 'never-executed', 'pnpm.mjs');
    const identity = process.platform === 'win32' ? pnpm.toLowerCase() : pnpm;
    expect(() => execFileSync(process.execPath, ['scripts/harness-ci.mjs'], {
      cwd: process.cwd(), windowsHide: true,
      env: ciEnv({ npm_execpath: pnpm, CLAWX_HARNESS_CI_ACTIVE_PNPM: identity }), stdio: 'pipe',
    })).toThrow(/Recursive Harness CI invocation/);
  });
});
