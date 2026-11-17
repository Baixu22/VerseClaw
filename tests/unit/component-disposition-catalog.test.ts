// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_AUTHORITY_MANIFEST } from '../../shared/component-authority-manifest';
import { DCS_PROD_FLAGS } from '../../shared/dcs/prod-flags-catalog';
import { DCS_PREVIEW_COMBO_FLAG_IDS, DCS_WRITABLE_FLAG_SPECS } from '../../shared/dcs/prod-flags-control';
import {
  COMPONENT_DISPOSITION_ENTRIES,
  COMPONENT_DISPOSITION_MANIFEST,
  buildComponentDispositionProjection,
  findComponentDisposition,
  validateComponentDispositionManifest,
  type ComponentDispositionManifest,
} from '../../shared/dcs/component-disposition-catalog';
import { RUNTIME_FEATURE_EXHAUSTIVE, listLeafPaths } from '../../openclaw_runtime/src/config/runtime-feature-leaves';
import { SETTINGS_SECTION_SEGMENTS } from '../../src/pages/Settings/route-config';

const root = process.cwd();
const nodeFixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/component-graduation/task-forest-node-ids.json'), 'utf8')) as { ids: string[] };
const runtimeLeafPaths = listLeafPaths(RUNTIME_FEATURE_EXHAUSTIVE);
const settingsSectionIds = ['overview', ...Object.keys(SETTINGS_SECTION_SEGMENTS)];
const settingsPanelIds = fs.readdirSync(path.join(root, 'src/components/settings'))
  .filter((entry) => entry.endsWith('.tsx'))
  .map((entry) => entry.slice(0, -4));
const appSource = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const routePaths = [...new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]))];
const inputs = {
  authorityComponentIds: COMPONENT_AUTHORITY_MANIFEST.components.map((component) => component.id),
  dcsFlagIds: DCS_PROD_FLAGS.map((flag) => flag.id),
  runtimeLeafPaths,
  settingsSectionIds,
  settingsPanelIds,
  routePaths,
  knownNodeIds: new Set(nodeFixture.ids),
  now: '2026-10-21T00:00:00.000Z',
};

function exactPathExists(relativePath: string): boolean {
  let current = root;
  for (const segment of relativePath.split('/')) {
    if (!fs.existsSync(current)) return false;
    const entries = fs.readdirSync(current);
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

function mutableManifest(): ComponentDispositionManifest {
  return structuredClone(COMPONENT_DISPOSITION_MANIFEST) as ComponentDispositionManifest;
}

describe('ComponentDispositionManifest/v1', () => {
  it('covers every authority component, DCS flag, runtime leaf, route, Settings section and Settings panel exactly once', () => {
    const result = validateComponentDispositionManifest(COMPONENT_DISPOSITION_MANIFEST, inputs);
    expect(result.issues, JSON.stringify(result.issues)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(COMPONENT_DISPOSITION_MANIFEST.schemaVersion).toBe('ComponentDispositionManifest/v1');
    expect(new Set(COMPONENT_DISPOSITION_ENTRIES.map((entry) => entry.id)).size).toBe(COMPONENT_DISPOSITION_ENTRIES.length);
    expect(COMPONENT_AUTHORITY_MANIFEST.components).toHaveLength(35);
    expect(DCS_PROD_FLAGS).toHaveLength(27);
    expect(COMPONENT_DISPOSITION_ENTRIES.find(entry => entry.id === 'component.dcs-context-tools')?.coverage.dcsFlagIds)
      .toEqual(['context-view-tools', 'context-tools-alias', 'project-rag-code-relationships', 'project-rag-task-context-hint']);
    expect(runtimeLeafPaths.length).toBeGreaterThan(100);
  });

  it('records current consumer, owner, implementation/retirement node and evidence refs for every entry', () => {
    for (const entry of COMPONENT_DISPOSITION_ENTRIES) {
      if (entry.disposition === 'retired') expect(entry.retirementNodeId, entry.id).toBeTruthy();
      else expect(entry.currentConsumers.length, entry.id).toBeGreaterThan(0);
      expect(entry.owner.trim(), entry.id).not.toBe('');
      expect(entry.evidenceRefs.length, entry.id).toBeGreaterThan(0);
      if (entry.disposition === 'retired') expect(entry.retirementNodeId, entry.id).toBeTruthy();
      else expect(entry.implementationNodeId, entry.id).toBeTruthy();
      for (const evidenceRef of entry.evidenceRefs) expect(exactPathExists(evidenceRef), `${entry.id}: ${evidenceRef}`).toBe(true);
    }
  });

  it('covers every writable DCS control and keeps the product preview combo in a visible disposition', () => {
    const coveredFlagIds = new Set(COMPONENT_DISPOSITION_ENTRIES.flatMap((entry) => entry.coverage.dcsFlagIds ?? []));
    for (const writable of DCS_WRITABLE_FLAG_SPECS) expect(coveredFlagIds.has(writable.id), writable.id).toBe(true);
    for (const comboId of DCS_PREVIEW_COMBO_FLAG_IDS) {
      const owner = COMPONENT_DISPOSITION_ENTRIES.find((entry) => entry.coverage.dcsFlagIds?.includes(comboId));
      expect(['default', 'advanced'], comboId).toContain(owner?.disposition);
    }
  });
  it('keeps every registered authority component mapped to one disposition', () => {
    for (const component of COMPONENT_AUTHORITY_MANIFEST.components) {
      expect(findComponentDisposition(component.id), component.id).toBeDefined();
      expect(COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.coverage.authorityComponentIds?.includes(component.id))).toHaveLength(1);
    }
  });

  it('requires owner, future expiry and graduate/retire criteria on every experiment', () => {
    const experiments = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.disposition === 'experiment');
    expect(experiments).toEqual([]);
    for (const entry of experiments) {
      expect(entry.experimentOwner, entry.id).toBeTruthy();
      expect(Date.parse(entry.expiry ?? ''), entry.id).toBeGreaterThan(Date.parse('2026-10-21T00:00:00.000Z'));
      expect(entry.graduateOrRetireCriteria?.trim(), entry.id).not.toBe('');
      expect(entry.visibility, entry.id).toBe('internal');
      expect(entry.userEntry, entry.id).toBeNull();
    }
  });

  it('explicitly covers the required special surfaces', () => {
    const coverageText = JSON.stringify(COMPONENT_DISPOSITION_ENTRIES);
    for (const required of [
      'stale-write-guard',
      'symbol-lease',
      'write-journal',
      'patch-flow',
      'worktree-backend',
      'compass-context-block',
      'routing-memo-shadow',
      'agentMap.*',
      'memory-embedding-provider',
      'vtoken.assembly.*',
      'v3-capability-catalog',
      '/dreams',
    ]) {
      expect(coverageText, required).toContain(required);
    }
  });

  it('does not expose any shadow or experiment capability as a user surface', () => {
    const visible = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.visibility === 'user');
    expect(visible.every((entry) => entry.disposition === 'default' || entry.disposition === 'advanced')).toBe(true);
    expect(visible.every((entry) => entry.userEntry !== null)).toBe(true);
    expect(COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.currentMode === 'shadow' && entry.visibility === 'user')).toEqual([]);
  });

  it('rejects an unclassified route', () => {
    const manifest = mutableManifest();
    const dreams = (manifest.entries as Array<(typeof manifest.entries)[number]>).find((entry) => entry.id === 'surface.dreams');
    if (!dreams) throw new Error('missing dreams entry');
    (dreams.coverage as { routePaths?: readonly string[] }).routePaths = [];
    const result = validateComponentDispositionManifest(manifest, inputs);
    expect(result.issues.map((issue) => issue.code)).toContain('unclassified_component');
  });

  it('rejects a second disposition for the same authority component', () => {
    const manifest = mutableManifest();
    const dcs = (manifest.entries as Array<(typeof manifest.entries)[number]>).find((entry) => entry.id === 'component.dcs-context-authority');
    const runtime = (manifest.entries as Array<(typeof manifest.entries)[number]>).find((entry) => entry.id === 'feature.runtime-shadow-governance');
    if (!dcs || !runtime) throw new Error('missing mutation targets');
    (runtime.coverage as { authorityComponentIds?: readonly string[] }).authorityComponentIds = ['dcs-context-authority'];
    const result = validateComponentDispositionManifest(manifest, inputs);
    expect(result.issues.map((issue) => issue.code)).toContain('double_disposition');
  });

  it('rejects an experiment without expiry or owner', () => {
    const manifest = mutableManifest();
    const experiment = (manifest.entries as Array<(typeof manifest.entries)[number]>).find((entry) => entry.disposition === 'internal');
    if (!experiment) throw new Error('missing experiment');
    experiment.disposition = 'experiment';
    experiment.expiry = undefined;
    experiment.experimentOwner = '';
    const result = validateComponentDispositionManifest(manifest, inputs);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['experiment_expiry_missing', 'experiment_owner_missing']));
  });

  it('rejects an internal capability with a user entry', () => {
    const manifest = mutableManifest();
    const internalEntry = (manifest.entries as Array<(typeof manifest.entries)[number]>).find((entry) => entry.disposition === 'internal');
    if (!internalEntry) throw new Error('missing internal entry');
    internalEntry.userEntry = 'unexpected user settings';
    const result = validateComponentDispositionManifest(manifest, inputs);
    expect(result.issues.map((issue) => issue.code)).toContain('internal_boundary');
  });

  it('documents the single-page disposition table and links it from runtime control planes', () => {
    const matrix = fs.readFileSync(path.join(root, 'docs/dev/component-disposition-matrix-20261021.md'), 'utf8');
    const controlPlanes = fs.readFileSync(path.join(root, 'docs/dev/runtime-control-planes.md'), 'utf8');
    expect(matrix).toContain('ComponentDispositionManifest/v1');
    expect(matrix).toContain('shared/dcs/component-disposition-catalog.ts');
    expect(matrix).toContain('TF-0510');
    expect((matrix.match(/^\| `component\.|^\| `feature\.|^\| `surface\.|^\| `settings\./gm) ?? []).length).toBe(COMPONENT_DISPOSITION_ENTRIES.length);
    expect(controlPlanes).toContain('component-disposition-matrix-20261021.md');
  });
  it('projects the stable disposition index for a later ModelCapabilityProfile', () => {
    const projection = buildComponentDispositionProjection();
    expect(projection.schemaVersion).toBe('ComponentDispositionProjection/v1');
    expect(projection.entries).toHaveLength(COMPONENT_DISPOSITION_ENTRIES.length);
    expect(projection.entries.map((entry) => entry.id)).toEqual(COMPONENT_DISPOSITION_ENTRIES.map((entry) => entry.id));
  });
});
