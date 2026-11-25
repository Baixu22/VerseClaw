// @vitest-environment node
import { RAG_QUERY_EVALUATOR_VERSION } from '../../scripts/lib/project-rag-query-grade.mjs';
import { describe, expect, it } from 'vitest';
import { RAG_SOAK_MINIMUM_MS, readProjectRagAcceptance, validateRagSoak, validateRagSoakProbe } from '../../scripts/lib/project-rag-acceptance.mjs';
import { runRagCommand } from '../../scripts/lib/project-rag-process.mjs';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

function sourceFixture(root: string) {
  const source = join(root, 'source'); mkdirSync(source);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'codex/fixture'); writeFileSync(join(source, 'fixture.txt'), 'agent fixture\n'); git('add', 'fixture.txt');
  git('-c', 'user.name=AgentFixture', '-c', 'user.email=agent-fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=' + join(root, 'no-hooks'), 'commit', '-m', 'agent fixture');
  return { source, candidate: git('rev-parse', 'HEAD') };
}

describe('RAG acceptance preserves actual duration and failed evidence', () => {
  it('supports an explicit Windows scope while preserving the full-platform contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rag-windows-scope-')), candidate = 'a'.repeat(40);
    try {
      const bytes = JSON.stringify({ actor: 'agent-unit-fixture', driven_by: 'agent', candidate,
        target: 'win32-x64', status: 'passed', portable: true, sqlite: true, fts: true, sdk: true });
      writeFileSync(join(directory, 'windows.json'), bytes);
      const manifest = { schema: 'ProjectRagAcceptanceManifest/v1', candidate,
        platforms: [{ target: 'win32-x64', path: 'windows.json', sha256: createHash('sha256').update(bytes).digest('hex') }] };
      const windows = readProjectRagAcceptance(directory, { ...manifest, qualificationScope: 'windows-only' });
      expect(windows.qualificationScope).toBe('windows-only'); expect(windows.requiredPlatforms).toEqual(['win32-x64']);
      expect(windows.deferredPlatforms).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']
        .map(target => ({ target, status: 'deferred' })));
      expect(windows.reasons.some(reason => /^(darwin|linux)/.test(reason))).toBe(false);
      expect(windows.reasons).toContain('full-executor-verifier-pending');
      expect(windows.reasons).toContain('soak-not-completed'); expect(windows.reasons).toContain('portable:capacity-incomplete');
      expect(windows.status).toBe('NO_GO');
      for (const qualificationScope of [undefined, 'all-platforms']) {
        const full = readProjectRagAcceptance(directory, { ...manifest, qualificationScope });
        expect(full.qualificationScope).toBe('all-platforms'); expect(full.requiredPlatforms).toHaveLength(5);
        expect(full.deferredPlatforms).toEqual([]); expect(full.reasons.some(reason => reason.startsWith('linux-arm64:'))).toBe(true);
      }
      const absent = readProjectRagAcceptance(directory, { ...manifest, qualificationScope: 'windows-only', platforms: [] });
      expect(absent.reasons).toContain('win32-x64:native-proof-incomplete');
      for (const qualificationScope of ['win', '', null])
        expect(() => readProjectRagAcceptance(directory, { ...manifest, qualificationScope })).toThrow('qualification scope');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('requires all supplied candidate identities to match the frozen manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rag-candidate-identities-'));
    const candidate = 'a'.repeat(40), previous = 'b'.repeat(40);
    const variants: Array<{ candidate?: string | { commit: string }; candidateCommit?: string; valid: boolean }> = [
      { candidate, valid: true },
      { candidate: { commit: candidate }, candidateCommit: candidate, valid: true },
      { candidateCommit: candidate, valid: true },
      { candidate: previous, candidateCommit: candidate, valid: false },
      { candidate: { commit: previous }, candidateCommit: candidate, valid: false },
      { candidate, candidateCommit: previous, valid: false },
    ];
    try {
      for (const { valid, ...identities } of variants) {
        const bytes = JSON.stringify({ schema: 'ProjectRagCapabilityEvidence/v1', actor: 'agent-unit-fixture',
          driven_by: 'agent', ...identities, status: 'passed', wiringVerified: true, failurePathsVerified: true, checks: [] });
        writeFileSync(join(directory, 'node.json'), bytes);
        const result = readProjectRagAcceptance(directory, { schema: 'ProjectRagAcceptanceManifest/v1', candidate,
          nodes: [{ id: 'RAG-01', path: 'node.json', sha256: createHash('sha256').update(bytes).digest('hex') }] });
        expect(result.reasons.includes('RAG-01:candidate-mismatch')).toBe(!valid);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
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
  it.each(['exit', 'timeout', 'missing', 'malformed', 'identity', 'policy', 'source', 'start'])(
    'retains completed queries and the failing arm on %s', (mode) => {
      const root = mkdtempSync(join(tmpdir(), 'rag-partial-query-'));
      try {
        const { source, candidate } = sourceFixture(root), corpusRoot = resolve('harness/specs/fixtures/project-rag/v4');
        const bundle = loadFrozenRagCorpus(corpusRoot, release.freezeDigest), policy = defaultRetrievalPolicy('local');
        const failedQuery = bundle.queries[mode === 'start' ? 0 : 1].id, failedArm = mode === 'start' ? 'page' : 'full';
        const adapter = join(root, 'adapter.mjs'), output = join(root, 'run');
        writeFileSync(adapter, `import { writeFileSync } from 'node:fs';
const env = process.env, mode = ${JSON.stringify(mode)};
const fail = env.RAG_QUERY_ID === ${JSON.stringify(failedQuery)} && env.RAG_QUERY_ARM === 'full';
if (fail && mode === 'exit') process.exit(7);
if (fail && mode === 'timeout') { setInterval(() => {}, 1000); }
else if (fail && mode === 'missing') {}
else if (fail && mode === 'malformed') writeFileSync(env.RAG_QUERY_REPORT, '{');
else {
  if (fail && mode === 'source') writeFileSync('dirty.txt', 'agent fixture');
  writeFileSync(env.RAG_QUERY_REPORT, JSON.stringify({ candidate: fail && mode === 'identity' ? 'b'.repeat(40) : env.RAG_QUERY_CANDIDATE,
    queryId: env.RAG_QUERY_ID, arm: env.RAG_QUERY_ARM, profile: env.RAG_QUERY_PROFILE,
    ownerPinsVerified: true, safetyViolations: 0, results: [],
    plan: { policyDigest: fail && mode === 'policy' ? 'sha256:' + 'b'.repeat(64) : ${JSON.stringify(retrievalPolicyDigest(policy))} } }));
}
`);
        const plan = { schema: 'ProjectRagQueryExecutionPlan/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, sourceRoot: source, candidate, corpusRoot,
          corpusDigest: bundle.freezeDigest, profile: 'local', candidatePolicy: policy,
          argv: mode === 'start' ? [join(root, 'absent.exe')] : [process.execPath, adapter],
          adapterInputs: [{ path: adapter, digest: sha256(readFileSync(adapter)) }],
          heldOutRelease: { corpusDigest: bundle.freezeDigest, cleanCandidate: candidate,
            calibrationFrozen: true, calibrationReceiptDigest: 'sha256:' + 'a'.repeat(64) } };
        const planFile = join(root, 'plan.json'); writeFileSync(planFile, jsonBytes(plan));
        const result = spawnSync(process.execPath, [resolve('openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
          resolve('scripts/knowledge-rag-query-runner.ts'), planFile, output], { cwd: resolve('.'), encoding: 'utf8',
          windowsHide: true, timeout: 20000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=384' } });
        expect(result.status, result.stderr).toBe(1);
        const receipt = JSON.parse(readFileSync(join(output, 'queries.json'), 'utf8'));
        expect(receipt).toMatchObject({ candidate, corpusDigest: bundle.freezeDigest, complete: false,
          expectedQueries: 240, completedQueries: mode === 'start' ? 0 : 1,
          partialQuery: { queryId: failedQuery }, failure: { queryId: failedQuery, arm: failedArm } });
        expect(receipt.failure.reason).toBeTruthy();
        expect(receipt.queries).toHaveLength(mode === 'start' ? 0 : 1);
        if (mode !== 'start') {
          expect(receipt.queries[0]).toMatchObject({ queryId: bundle.queries[0].id,
            page: { rawDigest: expect.any(String) }, full: { rawDigest: expect.any(String) } });
          expect(receipt.partialQuery.page.rawDigest).toBe(sha256(readFileSync(join(output, failedQuery + '-page.raw.json'))));
        }
        const command = JSON.parse(readFileSync(join(output, `${failedQuery}-${failedArm}.command.json`), 'utf8'));
        if (mode === 'exit') expect(command.exitCode).toBe(7);
        if (mode === 'timeout') expect(command.timedOut).toBe(true);
        if (mode === 'start') { expect(command).toMatchObject({ exitCode: null, timedOut: null }); expect(command.error).toBeTruthy(); }
        expect(existsSync(join(output, bundle.queries[2].id + '-page.log'))).toBe(false);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }, 30000);
  it('preserves a partial agent-driven cohort and returns a failing process exit', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-partial-driver-'));
    try {
      const { source, candidate } = sourceFixture(root), corpusRoot = resolve('harness/specs/fixtures/project-rag/v4');
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
