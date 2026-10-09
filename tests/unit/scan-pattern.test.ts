import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { globToRegExp, main, parseArgs, scanPattern, scanText } from '../../scripts/scan-pattern.mjs';

function withFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'scan-pattern-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

// Regression for issue #145: task specs declared evidence scans through a
// machine-local `rtk.exe rg` wrapper. This scanner is the tracked, dependency-
// free replacement those specs now call.
describe('scan-pattern', () => {
  it('parses its CLI options', () => {
    const args = parseArgs(['--pattern', 'ipcRenderer\\.invoke', '--include', '.ts,.tsx', '--fail-on-match', 'src']);
    expect(args.pattern).toBe('ipcRenderer\\.invoke');
    expect(args.include).toEqual(['.ts', '.tsx']);
    expect(args.failOnMatch).toBe(true);
    expect(args.targets).toEqual(['src']);
  });

  it('collects repeatable --glob filters', () => {
    const args = parseArgs(['--pattern', 'x', '--glob', '!**/*.md', '--glob', 'src/**', 'src']);
    expect(args.globs).toEqual(['!**/*.md', 'src/**']);
    expect(args.targets).toEqual(['src']);
  });

  it('matches globs with gitignore-style negation semantics', () => {
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('nested/notes.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('nested/notes.ts')).toBe(false);
    expect(globToRegExp('src/**').test('src/pages/App.tsx')).toBe(true);
  });

  it('reports file and line for every match', () => {
    withFixture((root) => {
      mkdirSync(join(root, 'nested'), { recursive: true });
      writeFileSync(join(root, 'nested', 'a.ts'), 'const ok = 1;\nwindow.electron.ipcRenderer.invoke("x");\n', 'utf8');
      writeFileSync(join(root, 'b.md'), 'window.electron.ipcRenderer.invoke("y")\n', 'utf8');

      const result = scanPattern({ pattern: 'ipcRenderer\\.invoke', targets: ['.'], cwd: root });

      expect(result.filesScanned).toBe(2);
      expect(result.matches).toEqual([
        { file: 'b.md', line: 1, text: 'window.electron.ipcRenderer.invoke("y")' },
        { file: 'nested/a.ts', line: 2, text: 'window.electron.ipcRenderer.invoke("x");' },
      ]);
    });
  });

  it('honours --include suffixes and skip directories', () => {
    withFixture((root) => {
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(root, 'keep.ts'), 'MARKER\n', 'utf8');
      writeFileSync(join(root, 'skip.md'), 'MARKER\n', 'utf8');
      writeFileSync(join(root, 'node_modules', 'pkg', 'dep.ts'), 'MARKER\n', 'utf8');

      const result = scanPattern({ pattern: 'MARKER', targets: ['.'], include: ['.ts'], cwd: root });

      expect(result.matches.map((match: { file: string }) => match.file)).toEqual(['keep.ts']);
    });
  });

  it('honours --glob exclusions used by the task specs', () => {
    withFixture((root) => {
      mkdirSync(join(root, 'src', 'pages'), { recursive: true });
      writeFileSync(join(root, 'README.md'), 'MARKER in docs\n', 'utf8');
      writeFileSync(join(root, 'src', 'pages', 'App.tsx'), 'MARKER in code\n', 'utf8');

      const excluded = scanPattern({ pattern: 'MARKER', targets: ['.'], globs: ['!**/*.md'], cwd: root });
      expect(excluded.matches.map((match: { file: string }) => match.file)).toEqual(['src/pages/App.tsx']);

      const limited = scanPattern({ pattern: 'MARKER', targets: ['.'], globs: ['src/**'], cwd: root });
      expect(limited.matches.map((match: { file: string }) => match.file)).toEqual(['src/pages/App.tsx']);
    });
  });

  it('skips binary files instead of decoding them', () => {
    withFixture((root) => {
      writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3, 77, 65, 82, 75, 69, 82]));
      const result = scanPattern({ pattern: 'MARKER', targets: ['.'], cwd: root });
      expect(result.matches).toEqual([]);
      expect(result.filesScanned).toBe(0);
    });
  });

  it('scans a single line repeatedly without leaking regex state', () => {
    const matches = scanText('a MARKER b MARKER\n', /MARKER/);
    expect(matches).toEqual([{ line: 1, text: 'a MARKER b MARKER' }]);
  });

  it('exits 1 only when --fail-on-match is set and something matched', () => {
    withFixture((root) => {
      writeFileSync(join(root, 'guard.ts'), 'forbiddenCall()\n', 'utf8');
      const found = main(['--pattern', 'forbiddenCall', '--fail-on-match', root]);
      expect(found).toBe(1);

      const inspectOnly = main(['--pattern', 'forbiddenCall', root]);
      expect(inspectOnly).toBe(0);

      const clean = main(['--pattern', 'neverPresent', '--fail-on-match', root]);
      expect(clean).toBe(0);
    });
  });

  it('requires a pattern and at least one target', () => {
    expect(() => scanPattern({ pattern: null, targets: ['.'] })).toThrow(/--pattern/);
    expect(() => scanPattern({ pattern: 'x', targets: [] })).toThrow(/path target/);
  });
});
