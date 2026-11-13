// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');
const gate = resolve('scripts/typecheck-agent-dev.mjs');

it('fails on test type errors and invalidates cached checks when tests or runtime inputs change', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawx-typecheck-gate-'));
  const write = (name: string, value: string) => {
    const target = join(root, name);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, value);
  };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [gate, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    const reportStart = result.stdout.search(/^\{\r?\n  "success":/m);
    expect(reportStart).toBeGreaterThanOrEqual(0);
    return { exitCode: result.status, report: JSON.parse(result.stdout.slice(reportStart)) };
  };
  try {
    write('scripts/generate-ext-bridge.mjs', '');
    write('scripts/check-test.mjs', `import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, '--noEmit', '-p', 'tsconfig.test.json'], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);`);
    write('package.json', JSON.stringify({ scripts: {
      'typecheck:node': 'node -e "process.exit(0)"',
      'typecheck:web': 'node -e "process.exit(0)"',
      'typecheck:test': 'node scripts/check-test.mjs',
    } }));
    write('tsconfig.test.json', JSON.stringify({ compilerOptions: { strict: true, types: [] }, include: ['tests/**/*.ts'] }));
    write('tests/check.ts', 'export const value: number = "wrong";');
    const broken = run();
    expect(broken.report.cache).toMatchObject({ enabled: false, status: 'disabled', key: null, inputCount: 0 });
    expect(broken.report.testTypes.errorCount).toBe(1);
    expect(broken.exitCode).not.toBe(0);
    expect(broken.report.success).toBe(false);
    expect(readFileSync(join(root, 'artifacts/typecheck-cache/test-typecheck-errors.log'), 'utf8')).toContain('TS2322');

    write('tests/check.ts', 'export const value: number = 1;');
    const clean = run('--cache');
    expect(clean.exitCode).toBe(0);
    expect(clean.report.cache.status).toBe('miss');
    expect(run('--cache').report.cache.status).toBe('hit');

    write('tests/check.ts', 'export const value: number = "regression";');
    const changedTest = run('--cache');
    expect(changedTest.exitCode).not.toBe(0);
    expect(changedTest.report.cache.status).toBe('miss');

    write('openclaw_runtime/packages/llm-core/src/check.ts', 'export const value: number = 1;');
    write('tests/check.ts', 'export { value } from "../openclaw_runtime/packages/llm-core/src/check";');
    expect(run('--cache').exitCode).toBe(0);
    write('openclaw_runtime/packages/llm-core/src/check.ts', 'export const value: number = "runtime regression";');
    const changedRuntime = run('--cache');
    expect(changedRuntime.exitCode).not.toBe(0);
    expect(changedRuntime.report.cache.status).toBe('miss');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
