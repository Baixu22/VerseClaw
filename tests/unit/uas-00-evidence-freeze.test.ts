// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildUas00AuditManifest,
  compareUas00AuditManifest,
} from '../../scripts/uas-00-evidence-freeze.mjs';

const root = process.cwd();
const manifestPath = join(
  root,
  'artifacts/unified-agent-system/TF-0011/audit-manifest.json',
);

type Manifest = ReturnType<typeof buildUas00AuditManifest>;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

describe('TF-0011 UAS-00 evidence freeze', () => {
  const manifest = readManifest();

  it('binds the current dirty baseline and executable provenance', () => {
    expect(manifest.schema).toBe('unified-agent-system/uas-00-audit-manifest/v1');
    expect(manifest.evidenceClass).toBe('dirty-engineering-baseline-not-release');
    expect(manifest.releaseEligible).toBe(false);
    expect(manifest.repository.dirty).toBe(true);
    expect(manifest.repository.headSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(manifest.repository.trackedDiffSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.repository.stagedDiffSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.repository.untrackedFileCount).toBeGreaterThan(0);
    expect(manifest.environment.executables.map(({ id }) => id)).toEqual([
      'node',
      'git',
      'pnpm',
      'python',
      'electron',
    ]);
    for (const executable of manifest.environment.executables) {
      expect(executable.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(executable.bytes).toBeGreaterThan(0);
    }
  });

  it('keeps agent evidence separate while advancing only one engineering leaf', () => {
    expect(manifest.taskForest.tf0009).toMatchObject({
      status: 'review_needed',
      progress: 50,
      semanticLabel: 'degraded-agent-complete',
      canMarkDone: false,
      humanQualifyingRuns: {
        'dcs-coding': 0,
        'sekb-assisted': 0,
        'browser-supervised': 0,
      },
    });
    expect(manifest.taskForest.tf0011.engineeringEvidenceEdge).toMatchObject({
      type: 'derived_from',
      blocking: false,
    });
    expect([
      { tf0011Status: 'ready', tf0011Progress: 0, tf0012Status: 'proposed' },
      { tf0011Status: 'done', tf0011Progress: 100, tf0012Status: 'ready' },
    ]).toContainEqual({
      tf0011Status: manifest.taskForest.tf0011.status,
      tf0011Progress: manifest.taskForest.tf0011.progress,
      tf0012Status: manifest.taskForest.nextEngineeringNode.status,
    });
  });

  it('freezes product boundaries and assigns one owner per governed surface', () => {
    expect(manifest.frozenBoundaries).toEqual({
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      c1ReductionFactor: 4.5,
      c1MeetsGate: false,
      c1Recommendation: 'keep-off',
      tf0006: 'blocked',
      runtimeMemory: 'diagnostics-only',
      sekbAutoWriteback: false,
    });
    const surfaces = manifest.authorityMatrix.map(({ surface }) => surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(manifest.authorityMatrix).toContainEqual(
      expect.objectContaining({
        surface: 'long-term-memory-lifecycle',
        owner: 'TF-0018/UAS-07',
      }),
    );
  });

  it('keeps the frozen snapshot self-consistent and rejects meaningful input drift', () => {
    const metadataMatchesCanonical =
      typeof manifest.taskForest.exportWorkspaceMetadata === 'string' &&
      resolve(manifest.taskForest.exportWorkspaceMetadata).toLowerCase() ===
        resolve(manifest.taskForest.canonicalWorkspace).toLowerCase();
    expect(manifest.taskForest.workspaceMetadataMatchesCanonical).toBe(
      metadataMatchesCanonical,
    );
    if (!metadataMatchesCanonical) {
      expect(manifest.residuals).toContain(
        'Task Forest export metadata still names a workspace other than the canonical audit root.',
      );
    }

    const current = structuredClone(manifest);
    expect(compareUas00AuditManifest(manifest, current)).toEqual({ ok: true, errors: [] });

    const drifted = structuredClone(current);
    drifted.repository.snapshotSha256 = '0'.repeat(64);
    expect(compareUas00AuditManifest(manifest, drifted)).toEqual({
      ok: false,
      errors: ['working-tree snapshot drifted'],
    });
  });
});
