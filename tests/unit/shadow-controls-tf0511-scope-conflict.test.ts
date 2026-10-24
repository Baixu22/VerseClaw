// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_DISPOSITION_ENTRIES } from '../../shared/dcs/component-disposition-catalog';

const root = process.cwd();
const dir = 'tests/unit/fixtures/shadow-controls-tf0511';
const readJson = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as T;

describe('TF-0511 shadow/control closeout guard', () => {
  it('keeps the four scoped families internal in the single-source catalog', () => {
    const ids = [
      'component.compass-context',
      'component.routing-memo-observation',
      'feature.agent-map',
      'feature.runtime-shadow-governance',
    ];
    for (const id of ids) {
      const entry = COMPONENT_DISPOSITION_ENTRIES.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.disposition, id).toBe('internal');
      expect(entry?.implementationState, id).toBeTruthy();
      expect(entry?.verificationArtifact?.length, id).toBeGreaterThan(0);
      expect(entry?.remainingGap, id).toEqual([]);
    }
  });

  it('keeps every TF-0511-owned artifact resolvable and zero-gap', () => {
    const entries = COMPONENT_DISPOSITION_ENTRIES.filter(
      (entry) => entry.implementationNodeId === 'TF-0511' || entry.retirementNodeId === 'TF-0511',
    );
    expect(entries).toHaveLength(6);
    for (const entry of entries) {
      expect(entry.disposition, entry.id).not.toBe('experiment');
      expect(entry.implementationState, entry.id).toBeTruthy();
      expect(entry.remainingGap, entry.id).toEqual([]);
      for (const artifact of entry.verificationArtifact ?? []) {
        expect(fs.existsSync(path.join(root, artifact)), `${entry.id} -> ${artifact}`).toBe(true);
      }
    }
  });

  it('records the resolved scope decision and no second disposition ledger', () => {
    const conflict = readJson<{ status: string; resolution: { expandedAllowedPaths: string[] } }>(`${dir}/scope-conflict.json`);
    const readback = readJson<{ completionVerdict: string; summary: { noSecondDispositionLedger: boolean; openExperiments: number; componentsWithGaps: number; everyArtifactResolves: boolean } }>(`${dir}/catalog-readback.json`);
    const consumer = readJson<{ ok: boolean; unpinnedZeroConsumerLeaves: string[]; pinnedZeroConsumerLeaves: string[] }>(`${dir}/feature-leaf-consumer.json`);
    expect(conflict.status).toBe('resolved');
    expect(conflict.resolution.expandedAllowedPaths).toEqual(expect.arrayContaining([
      'shared/dcs/component-disposition-catalog.ts',
      'scripts/check-feature-leaf-consumers.mjs',
    ]));
    expect(readback.completionVerdict).toBe('complete');
    expect(readback.summary).toMatchObject({
      noSecondDispositionLedger: true,
      openExperiments: 0,
      componentsWithGaps: 0,
      everyArtifactResolves: true,
    });
    expect(consumer.ok).toBe(true);
    expect(consumer.unpinnedZeroConsumerLeaves).toEqual([]);
    expect(consumer.pinnedZeroConsumerLeaves).toContain('coding.patchFlow.enabled');
  });
});
