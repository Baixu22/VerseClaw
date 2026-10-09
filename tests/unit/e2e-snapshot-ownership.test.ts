import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const E2E_DIR = join(process.cwd(), 'tests', 'e2e');
const SNAPSHOT_SUFFIX = '.spec.ts-snapshots';

function snapshotDirectories(): string[] {
  return readdirSync(E2E_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(SNAPSHOT_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

function owningSpecName(snapshotDirectory: string): string {
  return `${snapshotDirectory.slice(0, -SNAPSHOT_SUFFIX.length)}.spec.ts`;
}

function owningSpecSource(snapshotDirectory: string): string | null {
  const specPath = join(E2E_DIR, owningSpecName(snapshotDirectory));
  return existsSync(specPath) ? readFileSync(specPath, 'utf8') : null;
}

// Regression for issue #83. Deleting `tests/e2e/chat-work-context-bar.spec.ts`
// left its three Playwright baselines on disk, so an orphan directory looked
// like a live visual baseline. Snapshots must always be owned by a spec that
// actually captures a screenshot.
describe('e2e visual snapshot ownership', () => {
  it('finds the checked-in snapshot directories', () => {
    expect(snapshotDirectories().length).toBeGreaterThan(0);
  });

  it('reports no snapshot directory without a matching spec file', () => {
    const orphans = snapshotDirectories().filter(
      (directory) => !existsSync(join(E2E_DIR, owningSpecName(directory))),
    );

    expect(orphans).toEqual([]);
  });

  it('reports no snapshot directory whose spec never captures a screenshot', () => {
    const unused = snapshotDirectories().filter((directory) => {
      const source = owningSpecSource(directory);
      return source !== null && !source.includes('toHaveScreenshot');
    });

    expect(unused).toEqual([]);
  });
});
