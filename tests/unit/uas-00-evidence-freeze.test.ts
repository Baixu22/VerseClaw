// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertUas00HistoryRoot,
  buildUas00AuditManifest,
  compareUas00AuditManifest,
  parseUas00ReplayArgs,
  replayUas00History,
} from '../../scripts/uas-00-evidence-freeze.mjs';

const root = process.cwd();
const manifestPath = join(
  root,
  'artifacts/first-product-preview/TF-0009/policy-acceptance/legacy-uas00-audit-manifest.json',
);

type Manifest = ReturnType<typeof buildUas00AuditManifest>;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

const temporaryRoots: string[] = [];

function historyFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'uas00-history-replay-'));
  temporaryRoots.push(directory);
  writeFileSync(join(directory, 'FIXTURE.json'), JSON.stringify({ simulation: true, driven_by: 'agent' }));
  return directory;
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('explicit UAS-00 historical replay', () => {
  it('requires explicit opt-in and absolute input/output before reading task history', () => {
    expect(() => parseUas00ReplayArgs([])).toThrow('Explicit historical replay');
    expect(() => parseUas00ReplayArgs(['--history-replay', '--root=relative'])).toThrow('absolute historical root');
    expect(() => parseUas00ReplayArgs(['--history-replay', `--root=${root}`])).toThrow('absolute replay output');
    expect(() => parseUas00ReplayArgs(['--unknown'])).toThrow();
    const history = historyFixture();
    const output = join(tmpdir(), 'uas00-replay-output.json');
    expect(parseUas00ReplayArgs(['--history-replay', `--root=${history}`, `--output=${output}`, '--check'])).toEqual({
      historyReplay: true, root: history, output, check: true,
    });
    expect(assertUas00HistoryRoot(history, { historyReplay: true })).toBe(history);
    expect(() => buildUas00AuditManifest(history)).toThrow('Explicit historical replay');
    expect(() => assertUas00HistoryRoot(root, { historyReplay: true })).toThrow('outside the current');
  });

  it('does not create output or fall back to the local graph when restored inputs are missing', () => {
    const history = historyFixture();
    const destination = historyFixture();
    const output = join(destination, 'replay.json');
    expect(() => replayUas00History({ historyReplay: true, root: history, output })).toThrow('missing required UAS-00 evidence');
    expect(existsSync(output)).toBe(false);
    expect(() => replayUas00History({ historyReplay: true, root: history, output: join(history, 'replay.json') })).toThrow('outside both');
    expect(() => replayUas00History({ historyReplay: true, root: history, output: join(root, 'replay.json') })).toThrow('outside both');
  });

  it('never overwrites or checks sealed historical evidence as a new replay', () => {
    const history = historyFixture();
    const destination = historyFixture();
    const output = join(destination, 'sealed.json');
    const original = readFileSync(manifestPath);
    writeFileSync(output, original);
    expect(() => replayUas00History({ historyReplay: true, root: history, output })).toThrow('Refusing to overwrite');
    expect(() => replayUas00History({ historyReplay: true, root: history, output, check: true })).toThrow('sealed historical evidence is read-only');
    expect(readFileSync(output)).toEqual(original);
  });

  it('retains historical chain and product-lock checks on agent-built fixtures', () => {
    const history = historyFixture();
    const graph = join(history, '.agent-workbench/task-forest/graph');
    mkdirSync(graph, { recursive: true });
    const nodes = {
      'TF-0009': { status: 'review_needed', progress: 50 },
      'TF-0011': { status: 'proposed', progress: 0 },
      'TF-0012': { status: 'proposed', progress: 0 },
    };
    const putJson = (path: string, value: unknown) => {
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(value));
    };
    putJson(join(graph, 'nodes.json'), nodes);
    putJson(join(graph, 'forest.json'), { edges: { fixture: { id: 'fixture', from: 'TF-0011', to: 'TF-0009', type: 'derived_from', blocking: false } } });
    putJson(join(history, 'artifacts/first-product-preview/TF-0009/agent-surrogate-report.json'), { humanEquivalent: false, liveEvidence: false });
    const c1 = { authority: { reductionFactor: 4.5 }, decision: { meetsGate: false, recommendation: 'keep-off', defaultOn: false, liveReady: false, productApproved: false } };
    putJson(join(history, 'artifacts/first-product-preview/FP-P4-05/decision.json'), c1);
    putJson(join(history, 'artifacts/tf0006-evidence-upgrade/status.json'), { status: 'blocked' });
    expect(() => buildUas00AuditManifest(history, { historyReplay: true })).toThrow('UAS engineering chain');
    nodes['TF-0011'].status = 'ready';
    putJson(join(graph, 'nodes.json'), nodes);
    c1.decision.defaultOn = true;
    putJson(join(history, 'artifacts/first-product-preview/FP-P4-05/decision.json'), c1);
    expect(() => buildUas00AuditManifest(history, { historyReplay: true })).toThrow('defaultOn lock drifted');
    c1.decision.defaultOn = false;
    putJson(join(history, 'artifacts/first-product-preview/FP-P4-05/decision.json'), c1);
    expect(() => buildUas00AuditManifest(history, { historyReplay: true })).toThrow('missing evidence inventory file');
  });

  it('rejects each compared provenance dimension instead of only snapshot drift', () => {
    const manifest = readManifest();
    const cases: Array<[string, (actual: Manifest) => void]> = [
      ['manifest schema drifted', (actual) => { actual.schema = 'invalid'; }],
      ['evidence inventory drifted', (actual) => { actual.evidenceInventorySha256 = '0'.repeat(64); }],
      ['executable evidence drifted', (actual) => { actual.environment.executables = []; }],
      ['Task Forest evidence drifted', (actual) => { actual.taskForest.tf0011.progress = 1; }],
      ['frozen product boundaries drifted', (actual) => { actual.frozenBoundaries.defaultOn = true; }],
    ];
    for (const [message, mutate] of cases) {
      const actual = structuredClone(manifest);
      mutate(actual);
      expect(compareUas00AuditManifest(manifest, actual)).toEqual({ ok: false, errors: [message] });
    }
  });

  it('executes the CLI guard through the actual script entrypoint', () => {
    expect(() => execFileSync(process.execPath, [join(root, 'scripts/uas-00-evidence-freeze.mjs')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })).toThrow('Explicit historical replay');
  });
});

// The SHA256SUMS-sealed July record is historical evidence, not acceptance of this checkout.
describe('TF-0011 UAS-00 historical evidence freeze', () => {
  const manifest = readManifest();

  it('binds the historical dirty baseline and executable provenance', () => {
    expect(manifest.schema).toBe('unified-agent-system/uas-00-audit-manifest/v1');
    expect(manifest.evidenceClass).toBe('dirty-engineering-baseline-not-release');
    expect(manifest.releaseEligible).toBe(false);
    expect(manifest.repository.dirty).toBe(true);
    expect(manifest.repository.headSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(manifest.repository.trackedDiffSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.repository.stagedDiffSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.repository.untrackedFileCount).toBeGreaterThan(0);
    expect(manifest.environment.executables.map(({ id }: { id: string }) => id)).toEqual([
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
    const surfaces = manifest.authorityMatrix.map(({ surface }: { surface: string }) => surface);
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
