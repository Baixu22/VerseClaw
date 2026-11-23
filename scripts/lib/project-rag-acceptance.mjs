import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { verifyOfflineRagPolicyPackage } from './project-rag-promotion.mjs';
import { defaultRetrievalPolicy, evaluateOfflineRetrievalPromotion } from '../../openclaw_runtime/src/knowledge/retrieval/policy.ts';
import { loadFrozenRagCorpus, evaluateRagTaskPromotion } from './project-rag-corpus.mjs';
import release from '../../harness/specs/fixtures/project-rag/release-v4.json' with { type: 'json' };
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE_REPORT_SCHEMA, validateReportEvidence } from './agent-engineering-acceptance.mjs';

export const RAG_SOAK_MINIMUM_MS = 72 * 60 * 60 * 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function readBoundEvidence(root, input) {
  if (!input || typeof input.path !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Missing evidence pin');
  const file = realpathSync(resolve(root, input.path)), base = realpathSync(root);
  const subpath = relative(base, file);
  if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith('..' + sep)) throw new Error('Evidence escaped its sealed directory');
  if (statSync(file).size > 64 * 1024 * 1024) throw new Error('Evidence exceeds the bounded readback limit');
  const bytes = readFileSync(file);
  if (hash(bytes) !== input.sha256) throw new Error('Evidence bytes changed: ' + input.path);
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

export function validateRagSoak(report) {
  const errors = [];
  if (report?.schema !== 'ProjectRagSoak/v1' || report.driven_by !== 'agent' || report.status !== 'completed')
    errors.push('soak-not-completed');
  if (!Array.isArray(report?.samples) || report.samples.length < 2) return [...errors, 'missing-soak-samples'];
  const samples = report.samples;
  if (!Number.isFinite(report.activeElapsedMs) || report.activeElapsedMs < RAG_SOAK_MINIMUM_MS
    || samples.at(-1).monotonicElapsedMs - samples[0].monotonicElapsedMs < RAG_SOAK_MINIMUM_MS)
    errors.push('actual-72-hour-duration-missing');
  const times = samples.map(sample => Date.parse(sample.recordedAt));
  const probeDigests = new Set();
  if (times.some(time => !Number.isFinite(time)) || times.at(-1) - times[0] < RAG_SOAK_MINIMUM_MS)
    errors.push('wall-time-does-not-cover-72-hours');
  for (const [index, sample] of samples.entries()) {
    if (sample.sequence !== index || probeDigests.has(sample.probeDigest)) errors.push(`reused-soak-probe:${index}`);
    probeDigests.add(sample.probeDigest);
    if (!Number.isFinite(sample.monotonicElapsedMs) || sample.monotonicElapsedMs < 0
      || sample.candidate !== report.candidate || sample.status !== 'passed' || sample.lostJobs !== 0
      || sample.duplicatePublications !== 0 || sample.revocationLeaks !== 0 || sample.pendingJobs !== 0
      || typeof sample.probeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(sample.probeDigest)) errors.push(`invalid-soak-sample:${index}`);
    if (index && (sample.monotonicElapsedMs <= samples[index - 1].monotonicElapsedMs
      || sample.monotonicElapsedMs - samples[index - 1].monotonicElapsedMs > report.maximumGapMs
      || times[index] <= times[index - 1] || times[index] - times[index - 1] > report.maximumGapMs)) errors.push(`soak-observation-gap:${index}`);
  }
  if (!Number.isFinite(report.maximumGapMs) || report.maximumGapMs > 10 * 60 * 1000 || report.maximumGapMs <= 0)
    errors.push('invalid-soak-gap-policy');
  return [...new Set(errors)];
}

export function validateRagSoakProbe(probe) {
  const steps = ['explicitEnable', 'nativeWorkerPublished', 'editReplaced', 'restartRestoredSqliteSelection',
    'sourceIdentityStable', 'changedGenerationRejected', 'aclRejected', 'deleteAndCleanupComplete'];
  return probe?.schema === 'ProjectRagSoakProbe/v1' && probe.driven_by === 'agent' && probe.status === 'passed'
    && Number.isSafeInteger(probe.executedAt) && probe.executedAt > 0
    && ['lostJobs', 'duplicatePublications', 'revocationLeaks', 'pendingJobs'].every(key => probe[key] === 0)
    && steps.every(step => probe.steps?.[step] === true) && Array.isArray(probe.errors) && probe.errors.length === 0
    ? [] : ['lifecycle-proof-incomplete'];
}

/** All evidence is read from sealed files and must bind the same clean product candidate. */
export function readProjectRagAcceptance(directory, manifest) {
  const reasons = [];
  if (manifest?.schema !== 'ProjectRagAcceptanceManifest/v1' || !/^[a-f0-9]{40}$/.test(manifest.candidate))
    throw new Error('Invalid RAG acceptance manifest');
  const expectedNodes = Array.from({ length: 18 }, (_, index) => `RAG-${String(index + 1).padStart(2, '0')}`);
  if (!Array.isArray(manifest.nodes) || manifest.nodes.length !== 18
    || new Set(manifest.nodes.map(node => node.id)).size !== 18) reasons.push('incomplete-node-inventory');
  const read = (pin, label) => {
    try {
      const value = readBoundEvidence(directory, pin);
      if (value.candidate !== manifest.candidate && value.candidate?.commit !== manifest.candidate
        && value.candidateCommit !== manifest.candidate) reasons.push(`${label}:candidate-mismatch`);
      const engineeringActor = label === 'engineering' && value.schema === ACCEPTANCE_REPORT_SCHEMA
        && value.role === 'verifier' && typeof value.actor === 'string' && value.actor.length > 0;
      if (value.driven_by !== 'agent' && !engineeringActor) reasons.push(`${label}:actor-provenance-missing`);
      return value;
    } catch (error) { reasons.push(`${label}:${error.message}`); return null; }
  };
  for (const id of expectedNodes) {
    const pin = manifest.nodes?.find(node => node.id === id);
    const evidence = read(pin, id);
    if (!evidence || evidence.status !== 'passed' || evidence.wiringVerified !== true || evidence.failurePathsVerified !== true)
      reasons.push(`${id}:capability-proof-incomplete`);
    if (!Array.isArray(evidence?.checks) || !evidence.checks.length) reasons.push(`${id}:disk-backed-checks-missing`);
    for (const [index, check] of (evidence?.checks ?? []).entries()) {
      const checked = read(check, `${id}-check-${index}`);
      if (!checked || !['passed', 'pass'].includes(checked.status) || !Number.isFinite(checked.executedAt))
        reasons.push(`${id}:check-not-executed`);
    }
  }
  const soak = read(manifest.soak, 'soak');
  reasons.push(...validateRagSoak(soak));
  for (const [index, sample] of (soak?.samples ?? []).entries()) {
    const probe = read({ path: sample.probeFile, sha256: sample.probeDigest }, `soak-probe-${index}`);
    reasons.push(...validateRagSoakProbe(probe).map(reason => `soak-probe-${index}:${reason}`));
    const recordedAt = Date.parse(sample.recordedAt);
    if (!probe || probe.executedAt > recordedAt || recordedAt - probe.executedAt > soak.maximumGapMs)
      reasons.push(`soak-probe-${index}:execution-time-mismatch`);
  }
  const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];
  for (const target of targets) {
    const platform = read(manifest.platforms?.find(row => row.target === target), target);
    if (!platform || platform.target !== target || platform.status !== 'passed' || platform.portable !== true
      || platform.sqlite !== true || platform.fts !== true || platform.sdk !== true) reasons.push(`${target}:native-proof-incomplete`);
  }
  for (const [mode, rows] of [['portable', 20000], ['ann', 100000]]) {
    const capacity = read(manifest.capacity?.find(row => row.mode === mode), mode);
    if (!capacity || capacity.mode !== mode || !Number.isSafeInteger(capacity.rows)
      || capacity.rows < rows || !['passed', 'pass'].includes(capacity.status)
      || capacity.schema !== 'ProjectRagVectorCapacity/v1' || capacity.dirtyDevelopmentProbe !== false
      || capacity.capability?.available !== true || capacity.restart?.status !== 'pass'
      || !Number.isFinite(capacity.query?.recallAt20) || capacity.query.recallAt20 < 0.98
      || !Number.isFinite(capacity.query?.warmP95Ms) || capacity.query.warmP95Ms > (mode === 'portable' ? 900 : 2500)
      || !Array.isArray(capacity.query?.timingsMs) || capacity.query.timingsMs.length !== 31)
      reasons.push(`${mode}:capacity-incomplete`);
  }
  for (const profile of ['local', 'quality', 'research']) {
    try {
      const pin = manifest.policyPackages?.find(row => row.profile === profile);
      readBoundEvidence(directory, pin);
      const file = realpathSync(resolve(directory, pin.path));
      const verified = verifyOfflineRagPolicyPackage(dirname(file), 'sha256:' + pin.sha256, basename(file));
      const result = verified.evaluation;
      if (result.candidateCommit !== manifest.candidate || result.profile !== profile)
        reasons.push(`${profile}:evaluation-candidate-or-profile-mismatch`);
      reasons.push(...evaluateOfflineRetrievalPromotion(verified.candidate, defaultRetrievalPolicy(profile), result)
        .map(reason => `${profile}:${reason}`));
    } catch (error) { reasons.push(`${profile}:${error.message}`); }
  }
  const execution = read(manifest.taskExecutions, 'task-executions');
  if (execution) {
    try {
      const bundle = loadFrozenRagCorpus(fileURLToPath(new URL('../../harness/specs/fixtures/project-rag/v4', import.meta.url)), release.freezeDigest);
      const evidenceDirectory = realpathSync(resolve(directory, execution.evidenceDirectory));
      const relativeDirectory = relative(realpathSync(directory), evidenceDirectory);
      if (isAbsolute(relativeDirectory) || relativeDirectory === '..' || relativeDirectory.startsWith('..' + sep)) throw new Error('Task evidence escaped sealed root');
      const experiment = JSON.parse(readFileSync(resolve(evidenceDirectory, 'experiment.json'), 'utf8'));
      if (experiment.binding.cleanCandidate !== manifest.candidate) throw new Error('Task experiment candidate mismatch');
      const promotion = evaluateRagTaskPromotion(bundle, execution.runs, { directory: evidenceDirectory,
        experimentDigest: execution.experimentDigest, safetyDigest: execution.safetyDigest, attemptDigests: execution.attemptDigests });
      if (promotion.status !== 'promote') reasons.push('task-cohort-promotion-not-proven');
    } catch (error) { reasons.push(`task-executions:${error.message}`); }
  }
  const formal = read(manifest.engineering, 'engineering');
  if (!formal || formal.engineeringAcceptedByAgent !== true || formal.result !== 'pass'
    || formal.consistency?.identicalGateContracts !== true) reasons.push('full-executor-verifier-pending');
  if (formal) {
    try {
      const plan = readBoundEvidence(directory, manifest.engineeringManifest);
      const output = realpathSync(resolve(directory, manifest.engineeringDirectory));
      const subpath = relative(realpathSync(directory), output);
      if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith('..' + sep)) throw new Error('Engineering evidence escaped sealed root');
      reasons.push(...validateReportEvidence(plan, formal, output, { label: 'RAG-engineering', expectedRole: 'verifier' }));
    } catch (error) { reasons.push(`engineering:${error.message}`); }
  }
  return { schema: 'ProjectRagAcceptance/v1', actor: 'codex/project-rag-independent-readback', driven_by: 'agent',
    candidate: manifest.candidate, status: reasons.length ? 'NO_GO' : 'passed', reasons: [...new Set(reasons)],
    realHumanEvidence: false, productPublished: false };
}
