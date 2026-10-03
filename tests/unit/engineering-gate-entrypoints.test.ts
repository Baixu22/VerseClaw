// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
const gates = [
  {
    script: 'scripts/contract-check.mjs',
    successArgs: [],
    successOutput: 'Contract check passed.',
    failureArgs: [],
    failureCode: 1,
    failureOutput: 'ENOENT',
  },
  {
    script: 'scripts/lint-artifact-completion-class.mjs',
    successArgs: ['--help'],
    successOutput: 'Usage: node scripts/lint-artifact-completion-class.mjs',
    failureArgs: ['--not-an-option'],
    failureCode: 1,
    failureOutput: 'unknown option: --not-an-option',
  },
  {
    script: 'openclaw_runtime/scripts/check-production-reachable.mjs',
    successArgs: ['--help'],
    successOutput: 'check-production-reachable — §D1 production reachability gate',
    failureArgs: ['--exports-report'],
    failureCode: 3,
    failureOutput: '--exports-report requires a path',
  },
];

let scratch: string;
let aliasRoot: string;
let importer: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'clawx-gate-entrypoints-'));
  aliasRoot = join(scratch, 'repo junction 空格');
  symlinkSync(repoRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
  importer = join(scratch, 'importer.mjs');
  writeFileSync(importer, "await import(process.argv[2]); console.log('import completed');\n");
});

afterAll(() => {
  // Remove the junction itself before cleaning up the disposable fixture directory.
  if (aliasRoot) unlinkSync(aliasRoot);
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function run(args: string[], cwd = repoRoot) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe.each(gates)('$script entrypoint', (gate) => {
  it('runs successfully with identical output through real and linked directories', () => {
    const direct = run([join(repoRoot, gate.script), ...gate.successArgs]);
    const linked = run([join(aliasRoot, gate.script), ...gate.successArgs], aliasRoot);
    for (const result of [direct, linked]) {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(gate.successOutput);
      expect(result.stderr).toBe('');
    }
    expect(linked.stdout).toBe(direct.stdout);
  });

  it('rejects invalid inputs through real and linked directories', () => {
    for (const root of [repoRoot, aliasRoot]) {
      const result = run([join(root, gate.script), ...gate.failureArgs], scratch);
      expect(result.status).toBe(gate.failureCode);
      expect(result.stderr).toContain(gate.failureOutput);
    }
  });

  it('can be imported without running the CLI or terminating the caller', () => {
    for (const root of [repoRoot, aliasRoot]) {
      const result = run([importer, pathToFileURL(join(root, gate.script)).href], scratch);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('import completed');
      expect(result.stderr).toBe('');
    }
  });
});
