// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertTrackedSourceStateUnchanged,
  captureTrackedSourceState,
} from '../e2e/fixtures/source-mutation-guard';

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
}

function createTrackedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-source-mutation-guard-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', 'SKILL.md'), '# tracked skill\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

describe('electron E2E tracked-source mutation guard', () => {
  it('accepts a run that leaves tracked source untouched', async () => {
    const root = createTrackedRepo();
    try {
      const before = await captureTrackedSourceState(root);
      const after = await captureTrackedSourceState(root);
      expect(() => assertTrackedSourceStateUnchanged(before, after)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when a tracked file is modified during the run', async () => {
    const root = createTrackedRepo();
    try {
      const before = await captureTrackedSourceState(root);
      writeFileSync(join(root, 'skills', 'SKILL.md'), '# mutated by run\n', 'utf8');
      const after = await captureTrackedSourceState(root);
      expect(() => assertTrackedSourceStateUnchanged(before, after)).toThrow(
        /tracked source changed during Electron E2E run/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when a tracked file is deleted during the run', async () => {
    const root = createTrackedRepo();
    try {
      const before = await captureTrackedSourceState(root);
      rmSync(join(root, 'skills', 'SKILL.md'));
      const after = await captureTrackedSourceState(root);
      expect(() => assertTrackedSourceStateUnchanged(before, after)).toThrow(
        /tracked source changed during Electron E2E run/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when an already-dirty tree is changed further during the run', async () => {
    const root = createTrackedRepo();
    try {
      writeFileSync(join(root, 'skills', 'SKILL.md'), '# pre-existing dirty edit\n', 'utf8');
      const before = await captureTrackedSourceState(root);
      writeFileSync(join(root, 'skills', 'SKILL.md'), '# dirty edit plus run mutation\n', 'utf8');
      const after = await captureTrackedSourceState(root);
      expect(() => assertTrackedSourceStateUnchanged(before, after)).toThrow(
        /tracked source changed during Electron E2E run/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});