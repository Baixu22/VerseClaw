import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractRepoReferences, findMissingReferences } from '../../scripts/validate-policy-docs.mjs';

const ROOT = process.cwd();

// Entry documents that a clean checkout must be able to resolve. Issue #110:
// the orchestration control pack required a long-form development plan that had
// already been removed from main by the retention policy, so a fresh clone
// could not follow its own required reading order.
const ENTRY_DOCS = ['docs/multi-agent-orchestration/README.md'];

// Paths that are intentionally absent from Git. Keep this list explicit and
// justified: a silent gap is what the guard exists to catch.
const INTENTIONALLY_LOCAL = new Set([
  // Local session handoff; the retention policy keeps handoffs out of Git.
  'docs/dev/handoffs/LATEST.md',
]);

function readDoc(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('documentation entry references', () => {
  it('checks at least one entry document', () => {
    expect(ENTRY_DOCS.length).toBeGreaterThan(0);
  });

  it.each(ENTRY_DOCS)('%s resolves every repository path it requires', (docPath) => {
    const text = readDoc(docPath);
    const missing = findMissingReferences(text, { root: ROOT, docPath })
      .filter((reference) => !INTENTIONALLY_LOCAL.has(reference));

    expect(missing).toEqual([]);
  });

  it('keeps the self-declared reading order pointing at tracked files', () => {
    const text = readDoc('docs/multi-agent-orchestration/README.md');
    const references = extractRepoReferences(text);

    // The reading order (section 1) and the responsibility table (section 2)
    // must both resolve; the guard above covers resolution, this pins the
    // documents that replaced the removed long-form plan.
    expect(references).toContain('docs/runtime-design/area-2-multi-agent-orchestration.md');
    expect(references).toContain('docs/multi-agent-orchestration/acceptance-and-test-matrix.md');
    expect(references).toContain('docs/multi-agent-orchestration/runtime-v2-p3-p5-allocation.md');
    expect(references).not.toContain('docs/multi-agent-orchestration-development-plan.md');
  });
});
