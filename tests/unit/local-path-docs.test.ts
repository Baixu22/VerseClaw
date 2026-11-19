import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findLocalPathDocs } from '../../scripts/check-local-paths.mjs';

describe('active documentation local-path guard (#69)', () => {
  it('contains no developer-local absolute paths in AGENTS.md or docs', () => {
    expect(findLocalPathDocs(process.cwd())).toEqual([]);
  });
  it('exempts only the sealed review bytes, and rejects changed or active copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-path-docs-'));
    const path = 'docs/dev/evidence/project-rag/RAG-12/20261116-258457d6a/independent-review-notes.md';
    try {
      const bytes = readFileSync(resolve(path));
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
      execFileSync('git', ['init', '--quiet', root]);
      execFileSync('git', ['add', '--', path], { cwd: root });
      expect(findLocalPathDocs(root)).toEqual([]);
      writeFileSync(join(root, path), Buffer.concat([bytes, Buffer.from('\nchanged\n')]));
      expect(findLocalPathDocs(root).map((item: { file: string }) => item.file)).toContain(path);
      writeFileSync(join(root, path), bytes);
      writeFileSync(join(root, 'docs/dev/current.md'), bytes);
      execFileSync('git', ['add', '--', 'docs/dev/current.md'], { cwd: root });
      expect(findLocalPathDocs(root).map((item: { file: string }) => item.file)).toContain('docs/dev/current.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
