import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');

describe('documentation index and repository layout', () => {
  it('links every top-level docs markdown file from docs/README.md', () => {
    const index = readFileSync(join(DOCS, 'README.md'), 'utf8');
    const topLevel = readdirSync(DOCS)
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .sort();

    expect(topLevel.length).toBeGreaterThan(0);
    for (const name of topLevel) expect(index).toContain(`](${name})`);
  });

  it('makes the documentation index reachable from every README locale', () => {
    for (const name of ['README.md', 'README.zh-CN.md', 'README.ja-JP.md', 'README.ru-RU.md']) {
      expect(readFileSync(join(ROOT, name), 'utf8')).toContain('(docs/README.md)');
    }
  });

  it('keeps root process assets out of the repository root', () => {
    expect(existsSync(join(ROOT, 'send-button-states-design.md'))).toBe(false);
    expect(existsSync(join(ROOT, 'docs', 'dev', 'send-button-states-design.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'public', 'lobe-icons'))).toBe(false);
  });
});
