import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type SourceRef = { path: string; symbol: string };
type Entrypoint = SourceRef & { layer: string };
type Identity = {
  kind: string;
  identifier: string;
  owner: string;
  source: SourceRef;
  prohibitedUse: string;
};
type Action = {
  id: string;
  label: string;
  currentStatus: 'implemented' | 'partial';
  visibleBehavior: string;
  prerequisites: string[];
  effects: string[];
  inherits: string[];
  doesNotInherit: string[];
  successReceipt: string;
  failureStates: Record<'known' | 'unknown' | 'unsupported' | 'refused', string>;
  recovery: string;
  entrypoints: Entrypoint[];
  knownGap?: string;
};
type ActionContract = {
  schema: string;
  driven_by: string;
  actor: string;
  task: string;
  identities: Identity[];
  actions: Action[];
  ownerBoundaries: { id: string; statement: string; source: string }[];
  currentKnownGaps: { id: string; nextNode: string }[];
  limitations: string[];
  controlPlane: {
    modelShellLifecycleAuthority: false;
    operations: { action: string; human: string; host: SourceRef; model: 'unsupported' }[];
  };
};
type NegativeScenario = {
  id: string;
  family: string;
  setup: string;
  expected: string;
  failureAxis: string;
  owner: string;
  status: 'known_gap' | 'unmeasured' | 'covered';
  evidence: string[];
  nextNode: string;
};
type NegativeIndex = {
  schema: string;
  driven_by: string;
  actor: string;
  fixture: Record<string, unknown>;
  requiredFamilies: string[];
  statusLegend: Record<string, string>;
  cases: NegativeScenario[];
};
type Baseline = {
  schema: string;
  driven_by: string;
  actor: string;
  task: string;
  candidate: {
    sourceCommit: string;
    baseCommit: string;
    branch: string;
    evidenceCandidateCommit?: string;
    cleanCandidateObserved?: boolean;
  };
  environment: Record<string, string>;
  sourceInputs: { path: string; sha256: string }[];
  measurementContract: {
    minimumPairedScenarios: number;
    criticalFactFidelityPercent: number;
    nextStepAccuracyPercent: number;
    falseCompletionCount: number;
    netCostOrInputTokenReductionPercentMin: number;
    p95LatencyRatioMax: number;
    safetyRegressions: number;
  };
  baselineFindings: { id: string; classification: string; summary: string }[];
  unmeasured: string[];
  cleanup: { startedProcesses: boolean; startedBrowser: boolean; recoveryRequired: boolean; notes: string };
};

const root = process.cwd();
const fixtureDir = 'harness/specs/fixtures/long-session-development/a1';
const readJson = <T,>(relativePath: string): T => JSON.parse(
  readFileSync(path.join(root, relativePath), 'utf8'),
) as T;
const contract = readJson<ActionContract>(path.join(fixtureDir, 'action-and-inheritance-contract.json'));
const negative = readJson<NegativeIndex>(path.join(fixtureDir, 'negative-scenario-index.json'));
const baseline = readJson<Baseline>(path.join(fixtureDir, 'current-baseline.json'));

function expectSourceRef(ref: SourceRef, label: string): void {
  const absolute = path.join(root, ref.path);
  expect(existsSync(absolute), `${label}: missing source ${ref.path}`).toBe(true);
  expect(readFileSync(absolute, 'utf8').includes(ref.symbol), `${label}: missing symbol ${ref.symbol}`).toBe(true);
}

describe('long-session A1 action and identity contract', () => {
  it('keeps the baseline agent-driven and explicitly scoped to TF-0548', () => {
    expect(contract.schema).toBe('clawx.long-session.action-contract/v1');
    expect(contract.driven_by).toBe('agent');
    expect(contract.actor).toMatch(/^codex/);
    expect(contract.task).toBe('TF-0548');
    expect(contract.limitations.join(' ')).toMatch(/No real-human evidence is claimed/);
  });

  it('distinguishes every identity used by the long-session lane', () => {
    const expectedKinds = [
      'Workspace',
      'Project',
      'Assistant',
      'SessionKey',
      'PhysicalSession',
      'NativeThread',
      'Turn',
      'Run',
      'Task',
      'Resource',
    ];
    const kinds = contract.identities.map((identity) => identity.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(expect.arrayContaining(expectedKinds));
    for (const identity of contract.identities) {
      expect(identity.owner.trim().length).toBeGreaterThan(0);
      expect(identity.prohibitedUse.trim().length).toBeGreaterThan(0);
      expectSourceRef(identity.source, identity.kind);
    }
    const project = contract.identities.find((identity) => identity.kind === 'Project');
    expect(project?.owner).toMatch(/compatibility projection/i);
    expect(project?.prohibitedUse).toMatch(/second Project store/i);
    const task = contract.identities.find((identity) => identity.kind === 'Task');
    expect(task?.owner).toBe('Task Ledger');
  });

  it('covers the nine distinct lifecycle actions with positive and negative contracts', () => {
    const expectedActions = [
      'abort',
      'session_stop',
      'archive',
      'restore',
      'reset',
      'delete',
      'fork',
      'handoff',
      'schedule_pause',
    ];
    expect(contract.actions.map((action) => action.id)).toEqual(expectedActions);
    expect(new Set(contract.actions.map((action) => action.id)).size).toBe(expectedActions.length);
    for (const action of contract.actions) {
      expect(action.currentStatus).toMatch(/^(implemented|partial)$/);
      expect(action.visibleBehavior.trim().length).toBeGreaterThan(0);
      expect(action.prerequisites.length).toBeGreaterThan(0);
      expect(action.effects.length).toBeGreaterThan(0);
      expect(action.inherits.length).toBeGreaterThan(0);
      expect(action.doesNotInherit.length).toBeGreaterThan(0);
      expect(action.successReceipt.trim().length).toBeGreaterThan(0);
      expect(action.recovery.trim().length).toBeGreaterThan(0);
      expect(Object.keys(action.failureStates).sort()).toEqual(['known', 'refused', 'unknown', 'unsupported']);
      expect(new Set(action.entrypoints.map((entrypoint) => entrypoint.layer)).size).toBeGreaterThan(1);
      for (const entrypoint of action.entrypoints) {
        expectSourceRef(entrypoint, `${action.id}/${entrypoint.layer}`);
      }
    }
    const archive = contract.actions.find((action) => action.id === 'archive');
    const restore = contract.actions.find((action) => action.id === 'restore');
    expect(archive?.currentStatus).toBe('partial');
    expect(archive?.failureStates.unknown).toMatch(/no typed operation receipt or lifecycle fence/i);
    expect(archive?.knownGap).toBe('archive-active-run-not-fenced');
    expect(restore?.currentStatus).toBe('partial');
    expect(restore?.knownGap).toBe('restore-index-removed-before-transcript-rename');
  });

  it('keeps owner boundaries non-duplicative', () => {
    const boundaryIds = contract.ownerBoundaries.map((boundary) => boundary.id);
    expect(new Set(boundaryIds).size).toBe(boundaryIds.length);
    expect(boundaryIds).toEqual(expect.arrayContaining([
      'workspace-project-separate',
      'task-ledger-only',
      'session-not-lineage',
      'main-owned-transport',
      'single-resource-owners',
      'handoff-does-not-transfer-goals',
      'completion-facts-are-separate',
    ]));
    for (const boundary of contract.ownerBoundaries) {
      expect(boundary.statement.trim().length).toBeGreaterThan(0);
      const sourcePath = boundary.source.split('#')[0];
      expect(existsSync(path.join(root, sourcePath))).toBe(true);
    }
    expect(contract.currentKnownGaps.map((gap) => gap.id)).toEqual(expect.arrayContaining([
      'archive-active-run-not-fenced',
      'restore-index-removed-before-transcript-rename',
    ]));
  });

  it('fixes the negative matrix for archive, completion, generation, backend, authorization, scope and restart faults', () => {
    expect(negative.schema).toBe('clawx.long-session.negative-scenario-index/v1');
    expect(negative.driven_by).toBe('agent');
    expect(negative.actor).toMatch(/^codex/);
    expect(negative.fixture).toMatchObject({
      kind: 'isolated-agent-fixture',
      workspaceId: expect.any(String),
      sessionKey: expect.any(String),
      runId: expect.any(String),
      taskNodeId: expect.any(String),
    });
    const families = new Set(negative.cases.map((scenario) => scenario.family));
    for (const family of negative.requiredFamilies) expect(families.has(family)).toBe(true);
    expect(new Set(negative.cases.map((scenario) => scenario.id)).size).toBe(negative.cases.length);
    for (const scenario of negative.cases) {
      expect(['known_gap', 'unmeasured', 'covered']).toContain(scenario.status);
      expect(scenario.setup.trim().length).toBeGreaterThan(0);
      expect(scenario.expected.trim().length).toBeGreaterThan(0);
      expect(scenario.failureAxis.trim().length).toBeGreaterThan(0);
      expect(scenario.owner.trim().length).toBeGreaterThan(0);
      expect(scenario.nextNode).toMatch(/^TF-\d{4}$/);
      for (const evidence of scenario.evidence) {
        expect(existsSync(path.join(root, evidence.split('#')[0]))).toBe(true);
      }
    }
    expect(negative.cases.filter((scenario) => scenario.status === 'unmeasured').length).toBeGreaterThan(0);
    expect(negative.cases.filter((scenario) => scenario.status === 'known_gap').length).toBeGreaterThanOrEqual(3);
  });

  it('pins the current baseline and D2 evaluation budget', () => {
    expect(baseline.schema).toBe('clawx.long-session.current-baseline/v1');
    expect(baseline.driven_by).toBe('agent');
    expect(baseline.actor).toMatch(/^codex/);
    expect(baseline.task).toBe('TF-0548');
    expect(baseline.candidate.sourceCommit).toBe('5d26c6ab12aa5729439cda0031ea4df5c9de0e74');
    expect(baseline.candidate.baseCommit).toBe('3d6891d761fc78962859393e623cc19d8b3c20e2');
    expect(baseline.candidate.branch).toBe('codex/long-session-implementation-20261023-r2');
    expect(baseline.environment.platform).toBe('win32');
    expect(baseline.environment.codegraph).toMatch(/navigation only/i);
    expect(baseline.measurementContract).toMatchObject({
      minimumPairedScenarios: 30,
      criticalFactFidelityPercent: 100,
      nextStepAccuracyPercent: 95,
      falseCompletionCount: 0,
      netCostOrInputTokenReductionPercentMin: 15,
      p95LatencyRatioMax: 1.1,
      safetyRegressions: 0,
    });
    expect(baseline.baselineFindings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      'archive-active-run-not-fenced',
      'restore-index-removed-before-transcript-rename',
    ]));
    expect(baseline.unmeasured.length).toBeGreaterThan(0);
    expect(baseline.cleanup).toMatchObject({
      startedProcesses: false,
      startedBrowser: false,
      recoveryRequired: false,
    });
    for (const input of baseline.sourceInputs) {
      expect(existsSync(path.join(root, input.path))).toBe(true);
      expect(input.sha256).toMatch(/^[a-f0-9]{64}$/);
      const bytes = execFileSync('git', ['show', `${baseline.candidate.sourceCommit}:${input.path}`], { cwd: root, windowsHide: true });
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(input.sha256);
    }
  });

  it('records human, host and model initiators without a second shell lifecycle authority', () => {
    expect(contract.controlPlane.modelShellLifecycleAuthority).toBe(false);
    expect(contract.controlPlane.operations.map(op => op.action)).toEqual(['resume', 'fork', 'archive', 'delete', 'worktree', 'handoff']);
    for (const operation of contract.controlPlane.operations) {
      expect(operation.human.length).toBeGreaterThan(0);
      expect(operation.model).toBe('unsupported');
      expectSourceRef(operation.host, operation.action);
    }
    const tools = readFileSync(path.join(root, 'openclaw_runtime/src/agents/tools/sessions-spawn-tool.ts'), 'utf8');
    expect(tools).toContain('createSessionsSpawnTool');
    expect(contract.limitations.join(' ')).toContain('Shell execution is not a lifecycle API');
  });

  it('keeps product semantics linked to the executable action contract', () => {
    const docs = readFileSync(path.join(root, 'docs/clawx-product-semantics.md'), 'utf8');
    expect(docs).toContain('## Session lifecycle action boundary');
    expect(docs).toContain('long-session-development/a1/action-and-inheritance-contract.json');
    for (const phrase of [
      'Turn/run abort',
      'Session stop',
      'Archive',
      'Restore',
      'Reset',
      'Delete',
      'Fork',
      'Handoff',
      'Schedule pause',
    ]) {
      expect(docs).toContain(phrase);
    }
  });
});
