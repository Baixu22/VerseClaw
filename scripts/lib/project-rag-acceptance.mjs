import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { verifyOfflineRagPolicyPackage } from './project-rag-promotion.mjs';
import { defaultRetrievalPolicy, evaluateOfflineRetrievalPromotion } from '../../openclaw_runtime/src/knowledge/retrieval/policy.ts';
import { loadFrozenRagCorpus, evaluateRagTaskPromotion } from './project-rag-corpus.mjs';
import release from '../../harness/specs/fixtures/project-rag/release-v4.json' with { type: 'json' };
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE_REPORT_SCHEMA, validateReportEvidence } from './agent-engineering-acceptance.mjs';
import { verifyKnowledgeAdaptationPackage } from './project-rag-adaptation-readback.mjs';
import { createEmbeddingSpace } from '../../openclaw_runtime/src/knowledge/retrieval/embedding-space.ts';
import { loadCapacityInput } from './project-rag-capacity-input.ts';
import { isDeepStrictEqual } from 'node:util';

export const RAG_SOAK_MINIMUM_MS = 72 * 60 * 60 * 1000;
export const RAG_CAPACITY_MODELS = Object.freeze({ 768: 'google/embeddinggemma-300m', 4096: 'Qwen/Qwen3-VL-Embedding-8B' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateRagCapacity(capacity, mode, dimensions) {
  const reasons = [], minimum = mode === 'portable' ? 20000 : 100000;
  if (!capacity || capacity.mode !== mode || !Number.isSafeInteger(capacity.rows) || capacity.rows < minimum
    || !['passed', 'pass'].includes(capacity.status) || capacity.schema !== 'ProjectRagVectorCapacity/v1'
    || capacity.dirtyDevelopmentProbe !== false || capacity.capability?.available !== true || capacity.restart?.status !== 'pass'
    || !Number.isFinite(capacity.query?.recallAt20) || capacity.query.recallAt20 < 0.98
    || !Number.isFinite(capacity.query?.warmP95Ms) || capacity.query.warmP95Ms > (mode === 'portable' ? 900 : 2500)
    || !Array.isArray(capacity.query?.timingsMs) || capacity.query.timingsMs.length !== 31
    || capacity.query.timingsMs.some(ms => !Number.isFinite(ms) || ms < 0)) reasons.push('capacity-incomplete');
  const measured = capacity?.query;
  if (!Array.isArray(measured?.eachRecall) || measured.eachRecall.length !== 31
    || measured.eachRecall.some(value => !Number.isFinite(value) || value < 0 || value > 1)) reasons.push('capacity-raw-measurement-missing');
  else if (Math.abs(measured.eachRecall.reduce((sum, value) => sum + value, 0) / 31 - measured.recallAt20) > 1e-12)
    reasons.push('capacity-recall-summary-mismatch');
  if (Array.isArray(measured?.timingsMs) && measured.timingsMs.length === 31) {
    const warm = measured.timingsMs.slice(1).sort((a, b) => a - b);
    if (warm[Math.ceil(warm.length * 0.95) - 1] !== measured.warmP95Ms) reasons.push('capacity-latency-summary-mismatch');
  }
  try {
    const space = createEmbeddingSpace(capacity.input.space);
    if (capacity.dimensions !== dimensions || space.dimensions !== dimensions || space.spaceId !== capacity.input.space.spaceId
      || space.model !== RAG_CAPACITY_MODELS[dimensions] || space.normalization !== 'l2' || capacity.input.provenance !== 'real-model-output'
      || capacity.input.verifiedProviderResponses !== true || capacity.fixture !== null
      || !/^sha256:[a-f0-9]{64}$/.test(capacity.input.manifestDigest) || !/^sha256:[a-f0-9]{64}$/.test(capacity.input.corpusDigest))
      reasons.push('real-model-capacity-missing');
  } catch { reasons.push('real-model-capacity-missing'); }
  return reasons;
}

async function verifyCapacityInputs(directory, pin, report) {
  const input = readBoundEvidence(directory, pin);
  if ('sha256:' + pin.sha256 !== report.input.manifestDigest || input.candidate !== report.candidate
    || input.corpusDigest !== report.input.corpusDigest || input.space?.spaceId !== report.input.space.spaceId
    || input.provenance !== 'real-model-output' || input.count !== report.rows) throw new Error('Capacity input identity mismatch');
  const file = realpathSync(resolve(directory, pin.path));
  if (!Array.isArray(report.sourceInputs) || !report.sourceInputs.length) throw new Error('Capacity original source/response pins missing');
  const verified = await loadCapacityInput(file, report.candidate);
  if (verified.digest !== report.input.manifestDigest || !isDeepStrictEqual(verified.space, report.input.space))
    throw new Error('Capacity complete space identity mismatch');
  for await (const _row of verified.rows()) { /* Revalidate every vector, source range and provider output. */ }
  const sorted = pins => [...pins].map(pin => ({ path: pin.path, digest: pin.digest })).sort((a, b) => a.path.localeCompare(b.path));
  if (!isDeepStrictEqual(sorted(verified.evidencePins.values()), sorted(report.sourceInputs)))
    throw new Error('Capacity original source/response inventory mismatch');
}

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
export async function readProjectRagAcceptance(directory, manifest) {
  const reasons = [];
  if (manifest?.schema !== 'ProjectRagAcceptanceManifest/v1' || !/^[a-f0-9]{40}$/.test(manifest.candidate))
    throw new Error('Invalid RAG acceptance manifest');
  const qualificationScope = manifest.qualificationScope === undefined ? 'all-platforms' : manifest.qualificationScope;
  if (!['all-platforms', 'windows-only'].includes(qualificationScope)) throw new Error('Invalid RAG qualification scope');
  const allTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];
  const targets = qualificationScope === 'windows-only' ? ['win32-x64'] : allTargets;
  const expectedNodes = [...Array.from({ length: 18 }, (_, index) => `RAG-${String(index + 1).padStart(2, '0')}`), 'RAG-A1'];
  if (!Array.isArray(manifest.nodes) || manifest.nodes.length !== expectedNodes.length
    || new Set(manifest.nodes.map(node => node.id)).size !== expectedNodes.length) reasons.push('incomplete-node-inventory');
  const read = (pin, label) => {
    try {
      const value = readBoundEvidence(directory, pin);
      const candidateIds = [typeof value.candidate === 'object' ? value.candidate?.commit : value.candidate,
        value.candidateCommit].filter(candidate => candidate !== undefined);
      if (!candidateIds.length || candidateIds.some(candidate => candidate !== manifest.candidate))
        reasons.push(`${label}:candidate-mismatch`);
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
  for (const target of targets) {
    const platform = read(manifest.platforms?.find(row => row.target === target), target);
    if (!platform || platform.target !== target || platform.status !== 'passed' || platform.portable !== true
      || platform.sqlite !== true || platform.fts !== true || platform.sdk !== true) reasons.push(`${target}:native-proof-incomplete`);
  }
  for (const mode of ['portable', 'ann']) for (const dimensions of [768, 4096]) {
    const candidates = manifest.capacity?.filter(row => row.mode === mode && row.dimensions === dimensions) ?? [];
    if (candidates.length !== 1) reasons.push(`${mode}-${dimensions}:capacity-matrix-incomplete`);
    const capacity = read(candidates[0], `${mode}-${dimensions}`);
    const failures = validateRagCapacity(capacity, mode, dimensions);
    reasons.push(...failures.map(reason => `${mode}-${dimensions}:${reason}`));
    if (failures.includes('capacity-incomplete')) reasons.push(`${mode}:capacity-incomplete`);
    if (!failures.length) try { await verifyCapacityInputs(directory, candidates[0].input, capacity); }
    catch (error) { reasons.push(`${mode}-${dimensions}:${error.message}`); }
  }
  const policies = new Map();
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
      policies.set(profile, result);
    } catch (error) { reasons.push(`${profile}:${error.message}`); }
  }
  let adaptation;
  try {
    const profile = manifest.adaptationProfile ?? 'research';
    const policy = policies.get(profile);
    if (!policy) throw new Error('Matching qualified policy missing');
    adaptation = verifyKnowledgeAdaptationPackage(directory, manifest.adaptation, manifest.candidate, policy.candidateDigest,
      profile, policy.baselineDigest);
    if (adaptation.status !== 'qualified') reasons.push(...adaptation.reasons);
  } catch (error) { reasons.push('actual-knowledge-adaptation:' + error.message); }
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
    knowledgeAdaptation: adaptation ? { status: adaptation.status, snapshotDigest: adaptation.snapshotDigest,
      origin: adaptation.origin, evaluatorVersion: adaptation.evaluatorVersion, slices: adaptation.slices } : { status: 'missing' },
    qualificationScope, requiredPlatforms: targets,
    deferredPlatforms: allTargets.filter(target => !targets.includes(target)).map(target => ({ target, status: 'deferred' })),
    realHumanEvidence: false, productPublished: false };
}
