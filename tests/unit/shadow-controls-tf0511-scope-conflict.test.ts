// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_DISPOSITION_ENTRIES } from '../../shared/dcs/component-disposition-catalog';

const root = process.cwd();
const conflictPath = 'tests/unit/fixtures/shadow-controls-tf0511/scope-conflict.json';
const consumerPath = 'tests/unit/fixtures/shadow-controls-tf0511/feature-leaf-consumer.json';

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as T;
}

describe('TF-0511 scope-conflict guard', () => {
  it('keeps the conflict evidence and Task Forest node coherent', () => {
    const conflict = readJson<{
      status: string;
      taskForestNodeId: string;
      driven_by: string;
      actor: string;
      relevantCatalogEntries: Array<{ id: string; catalogDisposition: string }>;
    }>(conflictPath);
    const nodes = readJson<Record<string, { status: string }>>('.agent-workbench/task-forest/graph/nodes.json');

    expect(conflict.status).toBe('blocked-by-scope');
    expect(conflict.taskForestNodeId).toBe('TF-0511');
    expect(conflict.driven_by).toBe('agent');
    expect(conflict.actor).toBe('codex');
    expect(nodes['TF-0511']?.status).toBe('ready');
    expect(fs.existsSync(path.join(root, 'openclaw_runtime/src/agents/shadow-control-dispositions.ts')))
      .toBe(false);
  });

  it('keeps the four scoped catalog families as experiments until authority expands', () => {
    const conflict = readJson<{ relevantCatalogEntries: Array<{ id: string; catalogDisposition: string }> }>(conflictPath);
    const expected = new Map(conflict.relevantCatalogEntries.map((entry) => [entry.id, entry.catalogDisposition]));
    for (const id of [
      'component.compass-context',
      'component.routing-memo-observation',
      'feature.agent-map',
      'feature.runtime-shadow-governance',
    ]) {
      const live = COMPONENT_DISPOSITION_ENTRIES.find((entry) => entry.id === id);
      expect(live, id).toBeDefined();
      expect(live?.disposition, id).toBe('experiment');
      expect(expected.get(id), id).toBe('experiment');
    }
  });

  it('records the TF-0510 patch-flow zero-consumer leaf without treating it as TF-0511 completion', () => {
    const consumer = readJson<{
      ok: boolean;
      unpinnedZeroConsumerLeaves: string[];
    }>(consumerPath);
    expect(consumer.ok).toBe(false);
    expect(consumer.unpinnedZeroConsumerLeaves).toContain('coding.patchFlow.enabled');
  });
});
