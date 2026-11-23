// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RAG_SOAK_MINIMUM_MS, validateRagSoak, validateRagSoakProbe } from '../../scripts/lib/project-rag-acceptance.mjs';
import { runRagCommand } from '../../scripts/lib/project-rag-process.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadFrozenRagCorpus, jsonBytes, sha256 } from '../../scripts/lib/project-rag-corpus.mjs';
import { defaultRetrievalPolicy, retrievalPolicyDigest } from '../../openclaw_runtime/src/knowledge/retrieval/policy';
import release from '../../harness/specs/fixtures/project-rag/release-v4.json';

function report() {
  const candidate = 'a'.repeat(40), start = Date.parse('2026-01-01T00:00:00Z');
  return { schema: 'ProjectRagSoak/v1', driven_by: 'agent', candidate, status: 'completed',
    activeElapsedMs: RAG_SOAK_MINIMUM_MS, maximumGapMs: 600000,
    samples: Array.from({ length: RAG_SOAK_MINIMUM_MS / 600000 + 1 }, (_, sequence) => ({
      candidate, status: 'passed', sequence, monotonicElapsedMs: sequence * 600000,
      recordedAt: new Date(start + sequence * 600000).toISOString(), probeDigest: createHash('sha256').update(String(sequence)).digest('hex'),
      lostJobs: 0, duplicatePublications: 0, revocationLeaks: 0, pendingJobs: 0,
    })) };
}

describe('RAG acceptance preserves actual duration and failed evidence', () => {
  it('requires continuous 72-hour wall and monotonic observations', () => {
    expect(validateRagSoak(report())).toEqual([]);
    const short = report(); short.activeElapsedMs = 1000;
    expect(validateRagSoak(short)).toContain('actual-72-hour-duration-missing');
    const missing = report(); missing.samples.splice(12, 1);
    expect(validateRagSoak(missing)).toContain('soak-observation-gap:12');
  });
  it('keeps candidate drift, revocation leaks and failed states disqualifying', () => {
    const drift = report(); drift.samples[1].candidate = 'c'.repeat(40);
    expect(validateRagSoak(drift)).toContain('invalid-soak-sample:1');
    const leaked = report(); leaked.samples[2].revocationLeaks = 1;
    expect(validateRagSoak(leaked)).toContain('invalid-soak-sample:2');
    const failed = report(); failed.status = 'failed';
    expect(validateRagSoak(failed)).toContain('soak-not-completed');
    const replayed = report(); replayed.samples[1].probeDigest = replayed.samples[0].probeDigest;
    expect(validateRagSoak(replayed)).toContain('reused-soak-probe:1');
  });
  it('rejects failed lifecycle steps and errors despite a passed wrapper status', () => {
    const probe = { schema: 'ProjectRagSoakProbe/v1', driven_by: 'agent', status: 'passed', executedAt: Date.now(),
      lostJobs: 0, duplicatePublications: 0, revocationLeaks: 0, pendingJobs: 0, errors: [],
      steps: { explicitEnable: true, nativeWorkerPublished: true, editReplaced: true, restartRestoredSqliteSelection: true,
        sourceIdentityStable: true, changedGenerationRejected: true, aclRejected: true, deleteAndCleanupComplete: true } };
    expect(validateRagSoakProbe(probe)).toEqual([]);
    for (const step of Object.keys(probe.steps))
      expect(validateRagSoakProbe({ ...probe, steps: { ...probe.steps, [step]: false } })).toContain('lifecycle-proof-incomplete');
    expect(validateRagSoakProbe({ ...probe, errors: ['unexpected cancellation failure'] })).toContain('lifecycle-proof-incomplete');
  });
  it('terminates its owned command when the fixed deadline expires', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-owned-process-'));
    try {
      const result = await runRagCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
        cwd: root, log: join(root, 'run.log'), timeoutMs: 150, env: process.env,
      });
      expect(result.timedOut).toBe(true);
      expect(result.durationMs).toBeLessThan(6000);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves a partial agent-driven cohort and returns a failing process exit', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-partial-driver-'));
    try {
      const source = join(root, 'source'); mkdirSync(source);
      const git = (...args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
      git('init', '-b', 'codex/fixture'); writeFileSync(join(source, 'fixture.txt'), 'agent fixture\n'); git('add', 'fixture.txt');
      git('-c', 'user.name=AgentFixture', '-c', 'user.email=agent-fixture@example.invalid', '-c', 'commit.gpgsign=false',
        '-c', 'core.hooksPath=' + join(root, 'no-hooks'), 'commit', '-m', 'agent fixture');
      const candidate = git('rev-parse', 'HEAD'), corpusRoot = resolve('harness/specs/fixtures/project-rag/v4');
      const bundle = loadFrozenRagCorpus(corpusRoot, release.freezeDigest), pin = 'sha256:' + 'a'.repeat(64);
      const provider = { instanceId: 'agent-mock', modelRevision: 'mock-v1', usageParserRevision: 'mock-v1', rateSheetRevision: 'mock-v1',
        capabilityReceiptDigest: pin, endpointOrigin: 'https://example.invalid' }, generationSettings = { temperature: 0 };
      const candidatePolicies = Object.fromEntries(['local', 'quality', 'research'].map(profile => [profile, defaultRetrievalPolicy(profile as 'local')]));
      const policyDigests = Object.fromEntries(Object.entries(candidatePolicies).map(([profile, value]) => [profile, retrievalPolicyDigest(value)]));
      const adapter = join(root, 'empty-adapter.mjs'); writeFileSync(adapter, '// Agent-driven missing-result fixture; no model requests.\n');
      const plan = { schema: 'ProjectRagTaskExecutionPlan/v1', sourceRoot: source, corpusRoot, participantRoot: join(root, 'participants'),
        adapterArgv: [process.execPath, adapter], adapterInputs: [{ path: adapter, digest: sha256(readFileSync(adapter)) }], candidatePolicies,
        experiment: { corpusDigest: bundle.freezeDigest, cleanCandidate: candidate, ownerSafetyDigest: pin, provider, generationSettings,
          arms: ['off', 'page', 'full'].map(arm => ({ arm, providerDigest: sha256(jsonBytes(provider)), ownerSafetyDigest: pin,
            generationSettingsDigest: sha256(jsonBytes(generationSettings)), semanticEnabled: true, backgroundRetrieval: false,
            envelopes: Object.fromEntries(['local', 'quality', 'research'].map(profile => [profile, sha256(jsonBytes(bundle.policy.profiles[profile].taskEnvelope))])),
            ...(arm === 'full' ? { policyDigests } : {}) })) } };
      const planFile = join(root, 'plan.json'); writeFileSync(planFile, jsonBytes(plan));
      const result = spawnSync(process.execPath, [resolve('openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
        resolve('scripts/knowledge-rag-task-runner.ts'), planFile, join(root, 'attempts')],
        { cwd: resolve('.'), encoding: 'utf8', windowsHide: true, timeout: 30000,
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' } });
      expect(result.status, result.stderr).toBe(1);
      const receipt = JSON.parse(readFileSync(join(root, 'attempts/task-executions.json'), 'utf8'));
      expect(receipt.complete).toBe(false); expect(receipt.runs).toHaveLength(1);
      expect(receipt.runs[0].failureClass).toBeTruthy();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 40000);
});
