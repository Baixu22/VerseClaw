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

it('prepares browser declarations and invalidates cached checks when browser, test or runtime inputs change', () => {
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
    const reportStart = result.stdout.search(/^\{\r?\n {2}"success":/m);
    expect(reportStart).toBeGreaterThanOrEqual(0);
    return { exitCode: result.status, report: JSON.parse(result.stdout.slice(reportStart)) };
  };
  try {
    write('scripts/generate-ext-bridge.mjs', '');
    write('scripts/build-versebrowser.mjs', `import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, '-p', 'packages/versebrowser/tsconfig.build.json'], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);`);
    write('packages/versebrowser/tsconfig.build.json', JSON.stringify({
      compilerOptions: { strict: true, types: [], declaration: true, emitDeclarationOnly: true, rootDir: 'src', outDir: 'dist' },
      include: ['src/**/*.ts'],
    }));
    write('packages/versebrowser/src/index.ts', 'export interface Browser { count: number }');
    write('scripts/check-test.mjs', `import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [${JSON.stringify(compiler)}, '--noEmit', '-p', 'tsconfig.test.json'], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);`);
    write('package.json', JSON.stringify({ scripts: {
      'typecheck:node': 'node -e "process.exit(0)"',
      'typecheck:web': 'node -e "process.exit(0)"',
      'typecheck:test': 'node scripts/check-test.mjs',
    } }));
    write('tsconfig.test.json', JSON.stringify({ compilerOptions: { strict: true, types: [] }, include: ['tests/**/*.ts'] }));
    write('tests/check.ts', 'import type { Browser } from "../packages/versebrowser/dist/index"; export const value: Browser = { count: "wrong" };');
    const broken = run();
    expect(broken.report.cache).toMatchObject({ enabled: false, status: 'disabled', key: null, inputCount: 0 });
    expect(broken.report.testTypes.errorCount).toBe(1);
    expect(broken.exitCode).not.toBe(0);
    expect(broken.report.success).toBe(false);
    expect(readFileSync(join(root, 'artifacts/typecheck-cache/test-typecheck-errors.log'), 'utf8')).toContain('TS2322');

    write('tests/check.ts', 'import type { Browser } from "../packages/versebrowser/dist/index"; export const value: Browser = { count: 1 };');
    const clean = run('--cache');
    expect(clean.exitCode).toBe(0);
    expect(clean.report.cache.status).toBe('miss');
    const hit = run('--cache');
    expect(hit.report.cache.status).toBe('hit');
    expect(hit.report.results.filter((result: { commandLine: string }) => result.commandLine === 'node scripts/build-versebrowser.mjs')).toHaveLength(1);
    expect(hit.report.results[0]).toMatchObject({ commandLine: 'node scripts/build-versebrowser.mjs', exitCode: 0 });
    expect(hit.report.results[0].skipped).toBeUndefined();

    rmSync(join(root, 'packages/versebrowser/dist'), { recursive: true });
    expect(run('--cache').report.cache.status).toBe('hit');
    expect(readFileSync(join(root, 'packages/versebrowser/dist/index.d.ts'), 'utf8')).toContain('count: number');

    write('packages/versebrowser/src/index.ts', 'export interface Browser { count: string }');
    const changedBrowser = run('--cache');
    expect(changedBrowser.exitCode).not.toBe(0);
    expect(changedBrowser.report.cache.status).toBe('miss');
    expect(changedBrowser.report.testTypes.errorCount).toBe(1);
    write('packages/versebrowser/src/index.ts', 'export interface Browser { count: number }');

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

    write('scripts/build-versebrowser.mjs', 'process.exit(7);');
    const failedPrerequisite = run('--cache');
    expect(failedPrerequisite.exitCode).toBe(7);
    expect(failedPrerequisite.report.success).toBe(false);
    expect(failedPrerequisite.report.cache.status).toBe('not-checked');
    expect(failedPrerequisite.report.results).toHaveLength(1);
    expect(failedPrerequisite.report.results[0]).toMatchObject({ commandLine: 'node scripts/build-versebrowser.mjs', exitCode: 7 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
