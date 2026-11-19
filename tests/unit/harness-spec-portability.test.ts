import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findMachineLocalPaths, validateSpecPortability } from '../../harness/src/rules.mjs';

const ROOT = process.cwd();
const SPEC_ROOT = join(ROOT, 'harness', 'specs');

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'fixtures') files.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

// Regression for issue #145. Eleven specs were reported as hardcoding an
// `rtk.exe` path under a Windows user profile; the checked-in library actually
// carried the wrapper in far more files. `requiredTests` must stay runnable
// from a clean checkout, so the whole spec library is guarded, not one file.
describe('harness spec portability', () => {
  it('scans a non-empty spec library', () => {
    expect(walkMarkdown(SPEC_ROOT).length).toBeGreaterThan(0);
  });

  it('finds no machine-specific user path in any checked-in spec', () => {
    const offences: string[] = [];
    for (const file of walkMarkdown(SPEC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const finding of findMachineLocalPaths(text)) {
        offences.push(`${file.replaceAll('\\', '/')}: ${finding.label} ${finding.value}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it('reports a Windows user profile path in requiredTests', () => {
    const failures = validateSpecPortability({
      path: 'harness/specs/tasks/fixture.md',
      data: {
        id: 'fixture',
        title: 'Fixture',
        requiredTests: ['C:\\Users\\operator\\.cherrystudio\\bin\\rtk.exe node harness/src/cli.mjs list'],
      },
      body: '',
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('harness/specs/tasks/fixture.md');
    expect(failures[0]).toContain('Windows user profile path');
    expect(failures[0]).toContain('machine-specific');
  });

  it('reports a POSIX home path in the spec body', () => {
    const failures = validateSpecPortability({
      path: 'harness/specs/tasks/fixture.md',
      data: { id: 'fixture', title: 'Fixture' },
      body: 'Continue in /home/operator/verse-claw from local docs only.',
    });

    expect(failures).toEqual([
      expect.stringContaining('Linux user home path'),
    ]);
  });

  it('allows portable and deliberately illustrative path shapes', () => {
    const failures = validateSpecPortability({
      path: 'harness/specs/tasks/fixture.md',
      data: {
        id: 'fixture',
        title: 'Fixture',
        requiredTests: [
          'pnpm harness validate --spec harness/specs/tasks/fixture.md --no-diff',
          'node scripts/scan-pattern.mjs --pattern "ipcRenderer\\.invoke" src/pages',
          'py -3 %USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py validate',
        ],
      },
      body: [
        'Runtime state lives under `~/.openclaw/openclaw.json`.',
        'A Windows drive path (`C:\\Users\\...\\workspace`) maps to `/mnt/c/Users/.../workspace`.',
      ].join('\n'),
    });

    expect(failures).toEqual([]);
  });

  it('fails closed through the CLI even for --no-diff structural validation', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-portability-'));
    try {
      cpSync(join(ROOT, 'harness', 'src'), join(fixtureRoot, 'harness', 'src'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'machine-local.md'), `---
id: machine-local-fixture
title: Machine local fixture
requiredTests:
  - C:\\\\Users\\\\operator\\\\.cherrystudio\\\\bin\\\\rtk.exe node harness/src/cli.mjs list
---

# Machine local fixture
`, 'utf8');
      writeFileSync(join(fixtureRoot, 'owned.txt'), 'base\n', 'utf8');

      execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
      execFileSync('git', ['config', 'user.email', 'harness-fixture@example.invalid'], { cwd: fixtureRoot });
      execFileSync('git', ['config', 'user.name', 'Harness Fixture'], { cwd: fixtureRoot });
      execFileSync('git', ['add', '.'], { cwd: fixtureRoot });
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture base'], { cwd: fixtureRoot });

      const result = spawnSync(process.execPath, [
        join(fixtureRoot, 'harness', 'src', 'cli.mjs'), 'validate',
        '--spec', 'harness/specs/tasks/machine-local.md', '--no-diff',
      ], { cwd: fixtureRoot, encoding: 'utf8' });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain('Windows user profile path');
      expect(output).not.toContain('Spec is valid');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
