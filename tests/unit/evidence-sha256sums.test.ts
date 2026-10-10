// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyManifest } from '../../scripts/verify-evidence-sha256sums.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'evidence-sums-'));
  roots.push(root);
  const evidenceDir = join(root, 'artifacts', 'fixture');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(root, 'source.txt'), 'fixture', 'utf8');
  const hash = createHash('sha256').update('fixture').digest('hex');
  const manifest = join(evidenceDir, 'SHA256SUMS');
  writeFileSync(manifest, `${hash}  source.txt\n`, 'utf8');
  return { root, evidenceDir, manifest };
}

describe('evidence SHA256SUMS verification (#70)', () => {
  it('accepts a matching manifest', () => {
    const { root, manifest } = setup();
    const result = verifyManifest(root, manifest);
    expect(result).toMatchObject({ checked: 1, matched: 1, missing: [], drifted: [] });
  });

  it('accepts annotated historical drift and rejects unannotated drift', () => {
    const { root, evidenceDir, manifest } = setup();
    writeFileSync(join(root, 'source.txt'), 'changed', 'utf8');
    expect(verifyManifest(root, manifest).drifted).toEqual(['source.txt']);
    writeFileSync(join(evidenceDir, 'INTEGRITY.json'), JSON.stringify({
      excludedEntries: [{ path: 'source.txt', reason: 'historical drift' }],
    }), 'utf8');
    expect(verifyManifest(root, manifest).annotatedDrift).toEqual(['source.txt']);
    expect(verifyManifest(root, manifest).drifted).toEqual([]);
  });
});
