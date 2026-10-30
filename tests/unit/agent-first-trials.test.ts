// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactPath, classifyTrial, loadTrialAdapters, validateTrialManifest, verifyTrialAcceptance } from '../../scripts/lib/agent-first-trials.mjs';
import { loadCorpus, sha256 } from '../../scripts/lib/agent-first-task-corpus.mjs';

const root = process.cwd();
const { corpus, registry } = loadCorpus(root);
const profile = registry.registeredProfiles.find((value: { id: string }) => value.id === 'agent-first-system-profile');
const adapters = loadTrialAdapters(root);

function manifest() {
  const environment = { node: process.version, platform: process.platform, arch: process.arch, osRelease: 'fixture', cpuCount: 8, totalMemoryBytes: 8 * 1024 ** 3, freeMemoryBytes: 4 * 1024 ** 3, diskFreeBytes: 8 * 1024 ** 3 };
  const bindings = { 'fixture-only': 'sha256:' + '0'.repeat(64) };
  return {
    schemaVersion: 'AgentFirstTrialManifest/v1', driven_by: 'agent', actor: 'fixture-planner', runId: 'fixture-run',
    source: { candidate: { dirty: false }, bindings }, suiteId: corpus.suiteId, profileId: profile.id,
    trials: corpus.tasks.flatMap((task: { id: string }) => ['baseline', 'treatment'].flatMap((arm) => [1, 2, 3].map((repeat) => ({ taskId: task.id, arm, repeat, trialId: `${task.id}-${arm}-${repeat}` })))),
    k: 3, arms: ['baseline', 'treatment'], graders: profile.graderIds, adapters, toolsDigest: sha256(JSON.stringify(bindings)), environment,
    envelope: { ...profile.resourceEnvelope, cpuCeiling: environment.cpuCount, memoryMbCeiling: 4096, processCeiling: 64, timeoutMs: 900000, maxOutputBytes: 16 * 1024 ** 2,
      concurrency: 1, retries: 0, network: 'loopback-only', enforcement: 'wall/output/RSS/process monitored; native CPU/RSS hard caps not installed' },
    claims: { liveProvider: false, realHuman: false, rsiImprovement: false, productLocksChanged: false },
  };
}

describe('Agent First trial binding and failure attribution', () => {
  it('accepts the complete frozen 24-task, two-arm, k=3 protocol', () => {
    expect(() => validateTrialManifest(manifest(), corpus, profile, adapters)).not.toThrow();
    expect(manifest().trials).toHaveLength(144);
  });

  it('rejects omitted trials, repeated trials, grader/adapter/resource drift and fabricated claims', () => {
    const mutations: Array<(value: ReturnType<typeof manifest>) => void> = [
      (m) => { m.trials.pop(); },
      (m) => { m.trials[1] = m.trials[0]; },
      (m) => { m.trials[0].repeat = 9; },
      (m) => { m.graders = ['unknown']; },
      (m) => { m.adapters = {}; },
      (m) => { m.envelope.retries = 1; },
      (m) => { m.envelope.memoryMbCeiling *= 2; },
      (m) => { m.environment.diskFreeBytes = 0; },
      (m) => { m.source.candidate.dirty = true; },
      (m) => { m.claims.realHuman = true; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(manifest()); mutate(value);
      expect(() => validateTrialManifest(value, corpus, profile, adapters)).toThrow();
    }
  });

  it('keeps task, grader, infrastructure and actual agent failures separate', () => {
    const worker = { isolation: { emptyWorkspaceAtStart: true, gitHistoryAtStart: false } };
    const state = { isolation: { noGitMetadata: true, historyVisible: false }, cleanup: { gatewayPortClosed: true } };
    const execution = { exitCode: 0, timedOut: false, budgetExceeded: null, cleanup: { processTree: 'empty' } };
    const grades = [{ verdict: 'pass' }, { verdict: 'pass' }];
    expect(classifyTrial(worker, grades, state, execution)).toEqual({ outcome: 'pass', failureClass: null });
    expect(classifyTrial(worker, grades, state, { ...execution, timedOut: true })).toEqual({ outcome: 'timeout', failureClass: 'infrastructure' });
    expect(classifyTrial({ ...worker, error: { failureClass: 'task' } }, grades, state, execution)).toEqual({ outcome: 'fail', failureClass: 'task' });
    expect(classifyTrial(worker, [{ verdict: 'unknown' }, { verdict: 'pass' }], state, execution)).toEqual({ outcome: 'fail', failureClass: 'grader' });
    expect(classifyTrial(worker, [{ verdict: 'fail' }, { verdict: 'pass' }], state, execution)).toEqual({ outcome: 'fail', failureClass: 'agent' });
    expect(classifyTrial(worker, grades, { ...state, isolation: { noGitMetadata: true, historyVisible: true } }, execution).failureClass).toBe('infrastructure');
  });

  it('bounds artifacts to their run, keeping raw evidence hashes reproducible', () => {
    mkdirSync('D:/tmp', { recursive: true });
    const dir = mkdtempSync('D:/tmp/agent-first-artifact-test-');
    const path = artifactPath(dir, 'record.json');
    writeFileSync(path, '{"evidenceKind":"deterministic-test"}\n');
    expect(sha256(readFileSync(path))).toBe(sha256(readFileSync(join(dir, 'record.json'))));
    expect(() => artifactPath(dir, '../outside.json')).toThrow();
    expect(() => artifactPath(dir, root)).toThrow();
  });

  it('replays the tracked trial acceptance summary and rejects a changed claim', () => {
    const acceptance = 'harness/specs/fixtures/agent-first-system/trials/acceptance.json';
    expect(verifyTrialAcceptance(acceptance, { root })).toMatchObject({ complete: true, taskId: 'TF-0592', recordedTrials: 144, controls: 10, rawVerified: false });
    const fixture = mkdtempSync('D:/tmp/agent-first-acceptance-test-');
    cpSync(join(root, 'harness/specs/fixtures/agent-first-system/trials'), fixture, { recursive: true });
    const target = join(fixture, 'acceptance.json'), value = JSON.parse(readFileSync(target, 'utf8'));
    value.expected.outcomes.pass = 143;
    writeFileSync(target, JSON.stringify(value));
    expect(() => verifyTrialAcceptance(target, { root })).toThrow('trial outcomes differ');
  });
});
