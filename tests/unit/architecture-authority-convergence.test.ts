// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMPONENT_AUTHORITY_MANIFEST } from '../../shared/component-authority-manifest';
import { COMPONENT_DISPOSITION_ENTRIES } from '../../shared/dcs/component-disposition-catalog';
import { DCS_PROD_FLAGS } from '../../shared/dcs/prod-flags-catalog';

function expectCurrentSourceAnchor(text: string, anchor: string): void {
  expect(anchor.trim().length).toBeGreaterThan(0);
  expect(text).toContain(anchor);
}

describe('component declarations reflect the already enacted product decisions', () => {
  it.each([
    ['working-memory-context-source', 'baseline'],
    ['tool-registry-context-source', 'baseline'],
    ['vtoken-context-source', 'retired'],
    ['vtoken-bridge', 'retired'],
    ['retired-surface-registry', 'internal'],
  ])('%s describes its own lifecycle as %s', (id, mode) => {
    expect(COMPONENT_AUTHORITY_MANIFEST.components.find((component) => component.id === id)?.defaultMode).toBe(mode);
  });

  it('retains the Workspace Context default and keeps the inert bridge retired', () => {
    for (const id of ['working-memory', 'tool-registry']) {
      expect(DCS_PROD_FLAGS.find((flag) => flag.id === id)).toMatchObject({ defaultValue: true, risk: 'baseline-on' });
    }
    expect(COMPONENT_DISPOSITION_ENTRIES.find((entry) => entry.id === 'component.vtoken-bridge')).toMatchObject({
      disposition: 'retired', currentMode: 'retired', targetDefaultMode: 'retired', retirementNodeId: 'TF-0496',
    });
    expect(COMPONENT_DISPOSITION_ENTRIES.find((entry) => entry.id === 'component.retired-surface-registry')).toMatchObject({
      disposition: 'internal', currentMode: 'baseline', targetDefaultMode: 'internal',
    });
  });

  it('accounts for every registered gap with a source-bound classification and keeps it unresolved', () => {
    const registry = JSON.parse(readFileSync('scripts/check-semantic-authority-adjudication.json', 'utf8'));
    const audit = JSON.parse(readFileSync('harness/specs/fixtures/architecture-authority-convergence/gap-classification.json', 'utf8'));
    const key = (row: { class: string; target: string }) => `${row.class}:${row.target}`;
    expect(audit.rows.map(key).sort()).toEqual(registry.gaps.map(key).sort());
    expect(new Set(audit.rows.map(key)).size).toBe(35);
    const counts: Record<string, number> = {};
    for (const row of audit.rows) {
      expect(['external-owner', 'description-gap', 'implementation-gap']).toContain(row.category);
      expect(row.registrationResolved).toBe(false);
      // Hashes and line numbers describe the historical audit candidate, not the live source.
      expectCurrentSourceAnchor(readFileSync(row.source, 'utf8'), row.anchor);
      counts[row.category] = (counts[row.category] ?? 0) + 1;
    }
    expect(counts).toEqual(audit.counts);
  });

  it('allows unrelated source comments to move a classification anchor', () => {
    const source = 'export function hybridSearchFacts() {}\n';
    expectCurrentSourceAnchor(`// Unrelated header\n${source}// Unrelated footer\n`, 'export function hybridSearchFacts');
  });

  it('rejects a removed live classification anchor', () => {
    const anchor = 'export function hybridSearchFacts';
    const source = `${anchor}() {}\n`;
    expect(() => expectCurrentSourceAnchor(source.replace(anchor, ''), anchor)).toThrow();
  });
});
