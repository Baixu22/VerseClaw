// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkRuntimeDeepRefs,
  collectReferences,
  loadBaseline,
  normalizeSpecifier,
  resolvesToExistingPath,
} from '../../scripts/check-runtime-deep-refs.mjs';

const repoRoot = resolve(__dirname, '../..');
const tempRoots: string[] = [];

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'runtime-deep-refs-'));
  tempRoots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('openclaw_runtime/src/state/openclaw-state-db.ts', 'export const openDatabase = () => {};\n');
  write('openclaw_runtime/src/knowledge/governance-store.ts', 'export const store = 1;\n');
  write('scripts/runtime-deep-refs-baseline.json', JSON.stringify({ schemaVersion: 1, entries: [] }));
  write('package.json', JSON.stringify({ scripts: { 'runtime:inspect': 'node openclaw_runtime/scripts/inspect.mjs' } }));
  write('openclaw_runtime/scripts/inspect.mjs', 'export {};\n');
  return { root, write };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime deep reference guard (#93)', () => {
  it('resolves files, extension-probed files, ESM .js -> .ts aliases and directories', () => {
    const { root } = fixtureRepo();
    expect(resolvesToExistingPath(root, 'openclaw_runtime/src/state/openclaw-state-db.ts')).toBe(true);
    expect(resolvesToExistingPath(root, 'openclaw_runtime/src/state/openclaw-state-db')).toBe(true);
    expect(resolvesToExistingPath(root, 'openclaw_runtime/src/state/openclaw-state-db.js')).toBe(true);
    expect(resolvesToExistingPath(root, 'openclaw_runtime/src/state')).toBe(true);
    expect(resolvesToExistingPath(root, 'openclaw_runtime/src/missing-module')).toBe(false);
  });

  it('normalizes relative specifiers and ignores external packages', () => {
    expect(normalizeSpecifier('../../openclaw_runtime/src/x', 'electron/services/y.ts')).toBe('openclaw_runtime/src/x');
    expect(normalizeSpecifier('openclaw_runtime/src/x', 'electron/services/y.ts')).toBe('openclaw_runtime/src/x');
    expect(normalizeSpecifier('node:fs', 'electron/services/y.ts')).toBeNull();
    expect(normalizeSpecifier('./local', 'electron/services/y.ts')).toBe('electron/services/local');
  });

  it('collects imports, strings and package scripts while skipping non-path patterns', () => {
    const { root, write } = fixtureRepo();
    write(
      'electron/services/example.ts',
      [
        "import { openDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';",
        "const lazy = await import('../../openclaw_runtime/src/knowledge/governance-store');",
        "const claim = ['openclaw_runtime/src/knowledge/governance-store.ts'];",
        "const glob = 'openclaw_runtime/src/**';",
        "const braced = 'openclaw_runtime/src/x.{ts,js}';",
        "const negated = '!openclaw_runtime/extensions/codegraph/dist/';",
        'const interpolated = `openclaw_runtime/src/${name}`;',
      ].join('\n'),
    );

    const references = collectReferences(root, ['electron/services/example.ts', 'package.json']);
    const kinds = references.map((reference) => `${reference.kind}:${reference.target}`);
    expect(kinds).toContain('import:openclaw_runtime/src/state/openclaw-state-db');
    expect(kinds).toContain('import:openclaw_runtime/src/knowledge/governance-store');
    expect(kinds).toContain('string:openclaw_runtime/src/knowledge/governance-store.ts');
    expect(kinds.filter((entry) => entry.includes('**') || entry.includes('{') || entry.startsWith('string:!'))).toEqual([]);
    expect(kinds.filter((entry) => entry.includes('${'))).toEqual([]);
    // The quoted import specifier is reported once, as an import, not also as a string.
    expect(references.filter((reference) => reference.line === 1)).toHaveLength(1);
    // Root package.json runtime script paths are collected too.
    expect(kinds).toContain('package-script:openclaw_runtime/scripts/inspect.mjs');
  });

  it('fails closed on a dangling reference and passes when it is exempted with a reason', () => {
    const { root, write } = fixtureRepo();
    write('electron/services/stale.ts', "import { gone } from '../../openclaw_runtime/src/removed-module';\n");
    const files = ['electron/services/stale.ts', 'package.json'];

    const withoutExemption = checkRuntimeDeepRefs({ root, baseline: { entries: [] }, files });
    expect(withoutExemption.ok).toBe(false);
    expect(withoutExemption.dangling.map((entry) => entry.target)).toEqual(['openclaw_runtime/src/removed-module']);
    expect(withoutExemption.errors.join('\n')).toContain('does not resolve');

    const withExemption = checkRuntimeDeepRefs({
      root,
      baseline: { entries: [{ file: 'electron/services/stale.ts', target: 'openclaw_runtime/src/removed-module', reason: 'tracked removal' }] },
      files,
    });
    expect(withExemption.ok).toBe(true);
    expect(withExemption.exempted).toHaveLength(1);
    expect(withExemption.exempted[0].reason).toBe('tracked removal');
  });

  it('requires a reason on every exemption and treats a stale exemption as informational', () => {
    const { root, write } = fixtureRepo();
    write('electron/services/ok.ts', "import { openDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';\n");
    const files = ['electron/services/ok.ts', 'package.json'];

    const reasonless = checkRuntimeDeepRefs({
      root,
      baseline: { entries: [{ file: 'electron/services/ok.ts', target: 'openclaw_runtime/src/whatever', reason: '  ' }] },
      files,
    });
    expect(reasonless.ok).toBe(false);
    expect(reasonless.errors.join('\n')).toContain('baseline entry without a reason');

    const stale = checkRuntimeDeepRefs({
      root,
      baseline: { entries: [{ file: 'electron/services/ok.ts', target: 'openclaw_runtime/src/whatever', reason: 'merged upstream' }] },
      files,
    });
    // A stale exemption is a ledger entry that matched nothing: informational only.
    expect(stale.ok).toBe(true);
    expect(stale.errors).toEqual([]);
    expect(stale.staleExemptions).toHaveLength(1);
  });

  it('passes on the real tree and ships a reasoned exemption ledger', () => {
    const baseline = loadBaseline(repoRoot);
    const report = checkRuntimeDeepRefs({ root: repoRoot });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.referenceCount).toBeGreaterThan(100);
    expect(report.countsByKind.import).toBeGreaterThan(10);
    expect(report.countsByKind['package-script']).toBeGreaterThan(0);
    for (const entry of baseline.entries) expect(entry.reason.trim().length).toBeGreaterThan(0);
    // The shared evidence string assertions are covered by the vendored-tree policy
    // gate as well; this guard must not silently stop seeing imports.
    expect(report.countsByKind.string).toBeGreaterThan(0);
  });

  it('reports the real tree reference inventory deterministically', () => {
    const first = collectReferences(repoRoot);
    const second = collectReferences(repoRoot);
    expect(second).toEqual(first);
    const sample = readFileSync(join(repoRoot, 'electron/services/knowledge-api.ts'), 'utf8');
    expect(sample).toContain('openclaw_runtime/');
  });
});
