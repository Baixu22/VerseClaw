import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pairedEffect, evaluatePromotion } from './paired-ablation.mjs';
import { gradeCodeProbe } from './project-rag-code-oracle.mjs';

export const RAG_LOCALES = ['en', 'zh', 'ja', 'ru'];
export const RAG_SPLITS = ['calibration', 'validation', 'held-out'];
export const RAG_ARMS = ['off', 'page', 'full'];
export const RAG_INTENTS = ['fact', 'configuration', 'procedure', 'diagnosis', 'ownership', 'research'];
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const distinct = (rows, label) => { assert.equal(new Set(rows).size, rows.length, `duplicate ${label}`); };
const inside = (child, parent) => { const rel = relative(parent, child); return rel === '' || (!isAbsolute(rel) && !rel.startsWith('..')); };

export function safeCorpusFile(root, name) {
  assert(typeof name === 'string' && name && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some(p => !p || p === '.' || p === '..'), 'invalid corpus path');
  const target = resolve(root, name);
  assert(inside(target, realpathSync(root)), 'corpus path escaped root');
  assert(!lstatSync(target).isSymbolicLink() && inside(realpathSync(target), realpathSync(root)), 'linked corpus input');
  return target;
}

export function spanText(raw, locator) {
  assert(locator.coordinateSpace === 'raw-source-utf8-v1', 'wrong coordinate space');
  assert(Number.isSafeInteger(locator.startByte) && Number.isSafeInteger(locator.endByteExclusive)
    && locator.startByte >= 0 && locator.endByteExclusive > locator.startByte && locator.endByteExclusive <= raw.length, 'invalid source range');
  const decoder = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });
  decoder.decode(raw.subarray(0, locator.startByte));
  const quote = decoder.decode(raw.subarray(locator.startByte, locator.endByteExclusive));
  const line = offset => 1 + raw.subarray(0, offset).filter(byte => byte === 10).length;
  assert.equal(locator.startLine, line(locator.startByte), 'start line drift');
  assert.equal(locator.endLine, line(locator.endByteExclusive - 1), 'end line drift');
  return quote;
}

/** Version release pins are supplied by the evaluator, outside the model pack. */
export function loadFrozenRagCorpus(root, expectedFreezeDigest) {
  assert(/^sha256:[a-f0-9]{64}$/.test(expectedFreezeDigest), 'missing external freeze digest');
  root = realpathSync(root);
  const freezeBytes = readFileSync(join(root, 'freeze.json'));
  assert.equal(sha256(freezeBytes), expectedFreezeDigest, 'freeze manifest changed');
  const freeze = JSON.parse(freezeBytes.toString('utf8'));
  assert.equal(freeze.schema, 'ProjectRagCorpusFreeze/v1');
  assert.equal(freeze.driven_by, 'agent');
  distinct(freeze.files.map(row => row.path), 'frozen file');
  for (const file of freeze.files) {
    const raw = readFileSync(safeCorpusFile(root, file.path));
    assert.equal(sha256(raw), file.digest, `frozen input changed: ${file.path}`);
    assert.equal(raw.length, file.bytes, `frozen size changed: ${file.path}`);
  }
  const enrolled = new Set(freeze.files.map(x => x.path));
  for (const name of ['corpus.json', 'queries.json', 'tasks.json', 'trial-plan.json', 'promotion-policy.json', 'baseline.json', 'oracle/query-gold.json', 'oracle/task-gold.json', 'oracle/negative-cases.json']) assert(enrolled.has(name), `missing frozen contract: ${name}`);
  const corpus = readJson(join(root, 'corpus.json')), queries = readJson(join(root, 'queries.json'));
  const tasks = readJson(join(root, 'tasks.json')), plan = readJson(join(root, 'trial-plan.json'));
  const gold = readJson(join(root, 'oracle/query-gold.json')), taskGold = readJson(join(root, 'oracle/task-gold.json'));
  const negatives = readJson(join(root, 'oracle/negative-cases.json')), policy = readJson(join(root, 'promotion-policy.json'));
  const baseline = readJson(join(root, 'baseline.json'));
  assert.equal(corpus.schema, 'ProjectRagCorpus/v1');
  assert.equal(corpus.sources.length, corpus.sourceCount ?? 40); assert.equal(corpus.families.length, 30);
  assert.equal(queries.length, 240); assert.equal(tasks.length, 60); assert.equal(plan.slots.length, 540);
  distinct(corpus.sources.map(s => s.id), 'source id'); distinct(corpus.families.map(f => f.id), 'family id');
  distinct(queries.map(q => q.id), 'query id'); distinct(tasks.map(t => t.id), 'task id'); distinct(plan.slots.map(s => s.id), 'slot id');
  const sourceMap = new Map(corpus.sources.map(s => [s.id, s]));
  const originSplits = new Map();
  for (const source of corpus.sources) {
    assert(enrolled.has(source.path), 'source not enrolled');
    assert(RAG_SPLITS.includes(source.split));
    const originKey = `${source.origin.repository}:${source.origin.path}`;
    if (originSplits.has(originKey)) assert.equal(originSplits.get(originKey), source.split, 'origin family crossed split');
    originSplits.set(originKey, source.split);
    const raw = readFileSync(safeCorpusFile(root, source.path));
    assert.equal(source.ref.sourceDigest, sha256(raw));
    assert.equal(source.ref.revision, source.ownerRevision);
    assert.equal(source.ref.authorityId, 'memory-wiki');
    assert.equal(source.ref.namespaceId, corpus.owner.namespaceId);
    const original = raw.subarray(source.origin.startByte, source.origin.endByteExclusive);
    assert.equal(sha256(original), source.origin.digest, 'original repository bytes changed');
  }
  for (const split of RAG_SPLITS) {
    const selected = queries.filter(q => q.split === split);
    assert.equal(selected.length, 80, `query count for ${split}`);
    for (const locale of RAG_LOCALES) assert.equal(selected.filter(q => q.locale === locale).length, 20, `language count ${split}/${locale}`);
    if (['project-rag-v3', 'project-rag-v4'].includes(corpus.id)) assert.deepEqual([...new Set(selected.map(q => q.intent))].sort(), [...RAG_INTENTS].sort(), `intent coverage ${split}`);
  }
  assert.deepEqual([...new Set(queries.map(q => q.intent))].sort(), [...RAG_INTENTS].sort());
  for (const family of corpus.families) {
    const rows = queries.filter(q => q.familyId === family.id);
    assert.equal(rows.length, 8); assert(rows.every(q => q.split === family.split), 'family query split drift');
    for (const locale of RAG_LOCALES) assert.equal(rows.filter(q => q.locale === locale).length, 2);
    assert(family.sourceIds.every(id => sourceMap.get(id)?.familyId === family.id), 'family owner source drift');
  }
  for (const query of queries) {
    assert(RAG_LOCALES.includes(query.locale) && query.question.trim().length > 10 && query.authorship.driven_by === 'agent');
    assert(!Object.hasOwn(query, 'expected') && !Object.hasOwn(query, 'gold') && !Object.hasOwn(query, 'answer'), 'query request leaks oracle');
    const row = gold.find(g => g.queryId === query.id); assert(row && row.facts.length > 0, 'missing query oracle');
    for (const fact of row.facts) {
      assert.equal(fact.schema, 'SourceSpanGold/v1'); assert.equal(fact.authorship.driven_by, 'agent');
      const source = sourceMap.get(fact.sourceId); assert(source && source.familyId === query.familyId);
      const { locator, ...ref } = fact.sourceRef;
      assert(isDeepStrictEqual(ref, source.ref), 'gold owner version drift');
      assert.equal(spanText(readFileSync(safeCorpusFile(root, source.path)), locator), fact.quote, 'gold quote drift');
      if (['project-rag-v3', 'project-rag-v4'].includes(corpus.id)) assert(fact.support?.startByte >= locator.startByte && fact.support.endByteExclusive <= locator.endByteExclusive && fact.support.endByteExclusive > fact.support.startByte, 'gold support outside witnessed range');
    }
  }
  assert.equal(gold.length, 240); assert.equal(taskGold.length, 60);
  for (const profile of ['local', 'quality', 'research']) {
    const cohort = tasks.filter(t => t.profile === profile); assert.equal(cohort.length, 20);
    if (corpus.id !== 'project-rag-v1') assert.equal(new Set(cohort.map(t => t.familyId)).size, 20, 'task variants are not independent within a profile');
  }
  for (const task of tasks) {
    const oracle = taskGold.find(t => t.taskId === task.id); assert(oracle && oracle.facts.length === task.requiredFields.length, 'task oracle drift');
    for (const fact of oracle.facts) {
      const source = sourceMap.get(fact.sourceId); assert(source && source.familyId === task.familyId, 'task fact source drift');
      const { locator, ...ref } = fact.sourceRef;
      assert(isDeepStrictEqual(ref, source.ref), 'task gold owner version drift');
      assert.equal(spanText(readFileSync(safeCorpusFile(root, source.path)), locator), fact.quote, 'task gold quote drift');
    }
    assert.equal(task.kind, { local: corpus.id === 'project-rag-v1' ? 'configuration-repair' : 'code-repair', quality: 'diagnostic-report', research: 'cross-source-research' }[task.profile]);
    if (task.kind === 'code-repair') {
      assert(oracle.code && enrolled.has(task.code.programPath), 'code task program or oracle missing');
      assert.equal(sha256(Buffer.from(oracle.code.referenceSource)), oracle.code.referenceDigest, 'reference code drift');
      assert(oracle.code.expected.length > 0 && oracle.code.cases.length === oracle.code.expected.length, 'code probes missing');
    }
    assert(task.profile !== 'research' || new Set(oracle.facts.map(f => f.sourceId)).size >= 2, 'research source coverage missing');
    if (['project-rag-v3', 'project-rag-v4'].includes(corpus.id) && task.kind !== 'code-repair') assert(task.scenario?.instruction && oracle.analysis && Object.keys(oracle.analysis).length >= 4, 'task reasoning scenario missing');
    assert.equal(task.scope.workspaceId, corpus.owner.workspaceId);
    assert(!Object.hasOwn(task, 'expectedValues') && task.input.values && Object.values(task.input.values).every(v => v === null), 'task input leaks gold');
    for (const repeat of [1, 2, 3]) {
      const slots = plan.slots.filter(s => s.taskId === task.id && s.repeat === repeat);
      assert.deepEqual(slots.map(s => s.arm).sort(), [...RAG_ARMS].sort());
      assert(slots.every(s => s.status === 'not-run' && s.profile === task.profile && s.envelopeDigest === sha256(jsonBytes(policy.profiles[task.profile].taskEnvelope))), 'trial envelope mismatch');
    }
  }
  assert.equal(negatives.length, 64); distinct(negatives.map(n => n.id), 'negative id');
  assert.deepEqual([...new Set(negatives.map(n => n.kind))].sort(), ['acl', 'scope', 'revoked', 'expired', 'deleted', 'revision', 'digest', 'namespace', 'policy', 'sensitive', 'cancelled', 'range', 'conflict', 'empty', 'no-answer', 'prompt-injection'].sort());
  assert.equal(policy.schema, 'ProjectRagPromotionPolicy/v1');
  assert.equal(policy.retrieval.minimumNdcg5Gain, 0.05); assert.equal(policy.rerank.minimumNdcg5Gain, 0.03);
  assert.equal(policy.tasks.local.minimumSuccessGain, 0.05); assert.equal(policy.tasks.quality.maximumCostIncrease, 0.1);
  assert.equal(policy.tasks.research.minimumSuccessGain, 0.1); assert.equal(policy.tasks.research.maximumCostIncrease, 0.25);
  assert.equal(policy.platform.soakHours, 72);
  assert.equal(baseline.schema, 'ProjectRagBaseline/v1');
  assert(baseline.page.semanticEnabled && baseline.page.continuationMaxLines === 800 && baseline.page.scanMaxChars === 96000);
  assert(baseline.sharedSafetyAcrossArms && baseline.sharedProviderAcrossArms && baseline.sharedEnvelopeAcrossArms);
  return { root, freezeDigest: expectedFreezeDigest, corpus, queries, tasks, plan, gold, taskGold, negatives, policy, baseline };
}

/** Only one request and same-split source material enter an inference workspace. */
export function materializeRagTask(bundle, taskId, workspace, receiptDirectory, namespaceForVault, options = {}) {
  const task = bundle.tasks.find(t => t.id === taskId); assert(task, 'unknown task');
  if (task.split === 'held-out') assert(options.heldOutRelease?.corpusDigest === bundle.freezeDigest
    && /^[a-f0-9]{40}$/.test(options.heldOutRelease.cleanCandidate) && options.heldOutRelease.calibrationFrozen === true
    && /^sha256:[a-f0-9]{64}$/.test(options.heldOutRelease.calibrationReceiptDigest), 'held-out is sealed');
  workspace = resolve(workspace); receiptDirectory = resolve(receiptDirectory);
  assert(!existsSync(workspace) && !inside(workspace, bundle.root) && !inside(receiptDirectory, workspace)
    && !inside(workspace, receiptDirectory), 'participant and oracle roots must be separate');
  mkdirSync(workspace, { recursive: true }); mkdirSync(receiptDirectory, { recursive: true });
  const selected = bundle.corpus.sources.filter(s => s.split === task.split);
  const vault = join(workspace, 'knowledge'), namespaceId = namespaceForVault(vault);
  assert(typeof namespaceId === 'string' && /^memory-wiki:[a-f0-9]{64}$/.test(namespaceId), 'owner namespace missing');
  const seed = options.anonymizationSeed ?? randomBytes(32).toString('hex');
  assert(typeof seed === 'string' && seed.length >= 32, 'anonymization seed too short');
  const opaque = (kind, id) => `${kind}-${sha256(`${seed}:${kind}:${id}`).slice(7, 31)}`;
  const sources = selected.map(source => {
    const participantId = opaque('source', source.id), subjectId = `concepts/${participantId}.md`;
    const name = `knowledge/${subjectId}`, target = join(workspace, name);
    mkdirSync(resolve(target, '..'), { recursive: true });
    const bytes = readFileSync(safeCorpusFile(bundle.root, source.path)); writeFileSync(target, bytes);
    return { id: source.id, participantId, path: name, digest: sha256(bytes), ref: { ...source.ref, namespaceId, subjectId } };
  }).sort((a, b) => a.participantId.localeCompare(b.participantId));
  const files = [...sources.map(s => ({ path: s.path, digest: s.digest }))];
  if (task.kind === 'code-repair') {
    const bytes = readFileSync(safeCorpusFile(bundle.root, task.code.programPath));
    assert.equal(sha256(bytes), task.code.starterDigest);
    writeFileSync(join(workspace, task.outputPath), bytes); files.push({ path: task.outputPath, digest: sha256(bytes) });
  }
  const participantTaskId = opaque('request', taskId), input = structuredClone(task.input);
  input.untouched.requestId = participantTaskId;
  const request = { id: participantTaskId, kind: task.kind, locale: task.locale, profile: task.profile,
    instruction: task.instruction, delivery: task.delivery, requiredFields: task.requiredFields, input,
    outputPath: task.kind === 'code-repair' ? task.outputPath : 'reports/result.json',
    ...(task.proofPath ? { proofPath: task.proofPath } : {}), ...(task.code ? { code: { symbol: task.code.symbol, originPath: task.code.originPath } } : {}),
    ...(task.scenario ? { scenario: { ...task.scenario, ...(task.profile === 'research' ? {
      objective: 'Compare the proposed integration actions with all admitted source contracts and the stated resource constraints.',
    } : {}) } } : {}),
    outputSchema: { ...task.outputSchema, taskId: participantTaskId,
      ...(task.outputSchema.proof ? { proof: { ...task.outputSchema.proof, taskId: participantTaskId } } : {}) },
    scope: { workspaceId: task.scope.workspaceId, principalId: task.scope.principalId },
    sourceReferences: sources.map(s => ({ id: s.participantId, path: s.path, sourceRef: s.ref })) };
  writeFileSync(join(workspace, 'request.json'), jsonBytes(request)); files.push({ path: 'request.json', digest: sha256(jsonBytes(request)) });
  const receipt = { schema: 'ProjectRagParticipantMaterialization/v1', actor: 'corpus-materializer', driven_by: 'agent',
    corpusDigest: bundle.freezeDigest, taskId, participantTaskId, outputPath: request.outputPath,
    untouched: input.untouched, workspace, namespaceId, files, sources,
    oracleRoots: [join(bundle.root, 'oracle')], oracleExposed: false, generatedAt: new Date().toISOString() };
  const receiptPath = join(receiptDirectory, `${taskId}.materialization.json`);
  assert(!existsSync(receiptPath), 'materialization receipt already exists'); writeFileSync(receiptPath, jsonBytes(receipt));
  const onDisk = [];
  function walk(dir) { for (const name of readdirSync(dir)) { const full = join(dir, name); assert(!lstatSync(full).isSymbolicLink(), 'linked participant file'); if (lstatSync(full).isDirectory()) walk(full); else onDisk.push(relative(workspace, full).replaceAll('\\', '/')); } }
  walk(workspace); assert.deepEqual(onDisk.sort(), files.map(f => f.path).sort(), 'unapproved participant file');
  return { workspace, receiptPath, receipt };
}

function checkTaskCitations(facts, citations, workspace, binding) {
  assert(Array.isArray(citations) && citations.length === facts.length, 'one source citation per required field is mandatory');
  distinct(citations.map(c => c.field), 'citation field');
  for (const fact of facts) {
    const citation = citations.find(c => c.field === fact.field), source = binding.sources.find(s => s.id === fact.sourceId);
    assert(source && citation?.sourceId === source.participantId, 'citation owner identity changed');
    const { locator, ...ref } = citation.sourceRef ?? {};
    assert(isDeepStrictEqual(ref, source.ref), 'citation owner version changed');
    const raw = readFileSync(safeCorpusFile(workspace, source.path));
    assert.equal(spanText(raw, locator), citation.quote, 'quote does not match owner bytes');
    const support = fact.support ?? fact.sourceRef.locator;
    assert(locator.startByte <= support.startByte && locator.endByteExclusive >= support.endByteExclusive, 'citation omits required supporting bytes');
    assert(citation.quote.length <= Math.max(8000, fact.quote.length), 'unbounded citation range');
  }
}

function normalizedAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = structuredClone(value);
  if (Array.isArray(result.predictions)) result.predictions.sort((a, b) => String(a.probeId).localeCompare(String(b.probeId)));
  if (Array.isArray(result.evidenceGaps)) result.evidenceGaps.sort();
  if (Array.isArray(result.rejectedPlans)) {
    for (const plan of result.rejectedPlans) if (Array.isArray(plan.violatedConstraints)) plan.violatedConstraints.sort();
    result.rejectedPlans.sort((a, b) => String(a.planId).localeCompare(String(b.planId)));
  }
  return result;
}

/** Answer matching is separate from complete file/task success. No keyword grade. */
export function gradeRagTaskArtifact(bundle, taskId, workspace, materializationReceipt) {
  const task = bundle.tasks.find(t => t.id === taskId), oracle = bundle.taskGold.find(t => t.taskId === taskId);
  assert(task && oracle, 'unknown task oracle');
  const binding = readJson(materializationReceipt);
  assert(!inside(realpathSync(materializationReceipt), realpathSync(workspace)), 'receipt exposed inside participant workspace');
  assert.equal(binding.taskId, taskId); assert.equal(binding.corpusDigest, bundle.freezeDigest);
  assert.equal(realpathSync(workspace), realpathSync(binding.workspace)); assert.equal(binding.oracleExposed, false);
  const issues = [];
  const publicRequest = readJson(safeCorpusFile(workspace, 'request.json'));
  assert.equal(sha256(jsonBytes(publicRequest)), binding.files.find(f => f.path === 'request.json')?.digest, 'participant request changed');
  assert.equal(publicRequest.id, binding.participantTaskId);
  assert.equal(binding.sources.length, bundle.corpus.sources.filter(s => s.split === task.split).length, 'materialization source set changed');
  for (const source of binding.sources) {
    try {
      if (sha256(readFileSync(safeCorpusFile(workspace, source.path))) !== source.digest) issues.push({ kind: 'owner-currentness', reason: `owner source changed: ${source.id}` });
    } catch (error) { issues.push({ kind: 'owner-currentness', reason: String(error) }); }
  }
  let artifact, artifactDigest;
  if (task.kind === 'code-repair') {
    let behaviorMatch = false, codeCaseCount = 0;
    try {
      assert.equal(oracle.code.platform, process.platform, 'code oracle platform not evaluated');
      const bytes = readFileSync(safeCorpusFile(workspace, binding.outputPath));
      artifactDigest = sha256(bytes);
      const code = new TextDecoder('utf8', { fatal: true }).decode(bytes);
      const probe = gradeCodeProbe(code, oracle.code); behaviorMatch = probe.passed; codeCaseCount = probe.caseCount;
      if (!probe.passed) issues.push({ kind: 'code-behavior', reason: 'independent runtime probes rejected the repair' });
      const proof = readJson(safeCorpusFile(workspace, task.proofPath));
      if (proof.schema !== 'ProjectRagTaskOutput/v1' || proof.taskId !== binding.participantTaskId || proof.kind !== task.kind
        || !isDeepStrictEqual(proof.untouched, binding.untouched) || !isDeepStrictEqual(proof.unknowns, [])) issues.push({ kind: 'proof', reason: 'proof identity or preserved contract changed' });
      checkTaskCitations(oracle.facts, proof.citations, workspace, binding);
    } catch (error) { issues.push({ kind: 'code-oracle', reason: String(error) }); }
    return { schema: 'ProjectRagTaskGrade/v1', actor: 'independent-repository-oracle', driven_by: 'agent', taskId, corpusDigest: bundle.freezeDigest,
      query_result_match: null, behavior_match: behaviorMatch, passed: issues.length === 0, artifactDigest: artifactDigest ?? null,
      codeCaseCount, issues, gradingMode: 'real-source-repair-and-pinned-runtime-probes' };
  }
  try {
    const output = safeCorpusFile(workspace, binding.outputPath), bytes = readFileSync(output);
    artifactDigest = sha256(bytes);
    assert(bytes.length > 0 && bytes.length <= 65536, 'invalid artifact size');
    const parsed = JSON.parse(bytes.toString('utf8'));
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'artifact must be an object');
    artifact = parsed;
  } catch (error) { issues.push({ kind: 'artifact', reason: String(error) }); }
  let queryResultMatch = false;
  if (artifact) {
    const values = Object.fromEntries(oracle.facts.map(f => [f.field, f.value]));
    queryResultMatch = isDeepStrictEqual(artifact.values, values);
    if (!queryResultMatch) issues.push({ kind: 'values', reason: 'structured values differ from the independent oracle' });
    if (artifact.schema !== 'ProjectRagTaskOutput/v1' || artifact.taskId !== binding.participantTaskId || artifact.kind !== task.kind
      || !isDeepStrictEqual(artifact.untouched, binding.untouched) || !isDeepStrictEqual(artifact.unknowns, [])) issues.push({ kind: 'task-contract', reason: 'output identity, preserved fields or unknowns differ' });
    if (oracle.analysis && !isDeepStrictEqual(normalizedAnalysis(artifact.analysis), normalizedAnalysis(oracle.analysis))) issues.push({ kind: 'analysis', reason: 'causal diagnosis, verification predictions or proposal tradeoffs differ from source contracts' });
    try { checkTaskCitations(oracle.facts, artifact.citations, workspace, binding); }
    catch (error) { issues.push({ kind: 'citation', reason: String(error) }); }
  }
  return { schema: 'ProjectRagTaskGrade/v1', actor: 'independent-repository-oracle', driven_by: 'agent', taskId,
    corpusDigest: bundle.freezeDigest, query_result_match: queryResultMatch, passed: issues.length === 0,
    artifactDigest: artifactDigest ?? null, issues, gradingMode: 'file-contract-and-version-bound-source-spans' };
}

/** Full task promotion waits for all 540 runs and all cost stages. */
export function evaluateRagTaskPromotion(bundle, runs, evidence) {
  const ids = new Set(); const reasons = [];
  for (const run of runs) { assert(bundle.plan.slots.some(s => s.id === run.slotId), 'unregistered run slot'); assert(!ids.has(run.slotId), 'duplicate run slot'); ids.add(run.slotId); }
  if (ids.size !== 540 || runs.some(r => !['pass', 'fail'].includes(r.outcome) || (r.outcome === 'fail' ? r.failureClass !== 'agent' : Boolean(r.failureClass)))) reasons.push('complete-540-slot-cohort-missing');
  if (runs.some(r => r.corpusDigest !== bundle.freezeDigest || !/^sha256:[a-f0-9]{64}$/.test(r.experimentBindingDigest)
    || (r.grade?.artifactDigest === null ? r.outcome !== 'fail' : !/^sha256:[a-f0-9]{64}$/.test(r.grade?.artifactDigest)))) reasons.push('run-oracle-or-experiment-binding-missing');
  if (new Set(runs.map(r => r.experimentBindingDigest)).size !== 1) reasons.push('experiment-binding-drift');
  if (runs.some(r => r.grade?.taskId !== bundle.plan.slots.find(s => s.id === r.slotId)?.taskId || r.grade?.corpusDigest !== bundle.freezeDigest
    || r.grade?.schema !== 'ProjectRagTaskGrade/v1' || r.grade.driven_by !== 'agent' || !r.grade.actor
    || !Array.isArray(r.grade.issues) || (!r.grade.passed && r.grade.issues.length === 0)
    || typeof r.grade?.passed !== 'boolean' || (r.outcome === 'pass') !== r.grade.passed)) reasons.push('task-grade-binding-drift');
  const requiredCostStages = ['embedding', 'rerank', 'planning', 'generation', 'tools'];
  if (runs.some(r => !r.costs || requiredCostStages.some(stage => !Number.isFinite(r.costs[stage]) || r.costs[stage] < 0)
    || !isDeepStrictEqual(Object.keys(r.costs).sort(), [...requiredCostStages].sort())
    || r.usageUnknown !== false || !Number.isFinite(r.unknownReserveUsd) || r.unknownReserveUsd < 0)) reasons.push('complete-measured-costs-missing');
  let safetyFailed = false;
  try {
    assert(evidence?.directory && evidence.experimentDigest && evidence.safetyDigest && evidence.attemptDigests, 'external evidence pins missing');
    const experimentBytes = readFileSync(safeCorpusFile(evidence.directory, 'experiment.json'));
    const experiment = JSON.parse(experimentBytes.toString('utf8'));
    const verified = bindRagExperiment(bundle, experiment.binding);
    assert(isDeepStrictEqual(verified, experiment), 'experiment receipt drift');
    assert.equal(experiment.digest, evidence.experimentDigest, 'external experiment pin drift');
    assert(runs.every(r => r.experimentBindingDigest === experiment.digest), 'run experiment drift');
    const safetyBytes = readFileSync(safeCorpusFile(evidence.directory, 'safety.json'));
    assert.equal(sha256(safetyBytes), evidence.safetyDigest, 'external safety pin drift');
    const safety = JSON.parse(safetyBytes.toString('utf8'));
    assert.equal(safety.schema, 'ProjectRagSafetyReceipt/v1'); assert.equal(safety.driven_by, 'agent');
    assert.equal(safety.corpusDigest, bundle.freezeDigest); assert.equal(safety.experimentBindingDigest, experiment.digest);
    assert.equal(safety.results.length, bundle.negatives.length * RAG_ARMS.length, 'incomplete safety cohort');
    distinct(safety.results.map(r => `${r.caseId}/${r.arm}`), 'safety case arm');
    for (const item of safety.results) {
      const expected = bundle.negatives.find(n => n.id === item.caseId);
      assert(expected && RAG_ARMS.includes(item.arm) && typeof item.actual === 'string' && /^sha256:[a-f0-9]{64}$/.test(item.observationDigest), 'missing safety observation');
      assert(Object.keys(bundle.policy.safety).every(key => Number.isSafeInteger(item.metrics?.[key]) && item.metrics[key] >= 0), 'missing measured safety metrics');
      safetyFailed ||= item.actual !== expected.expected || Object.entries(bundle.policy.safety).some(([key, maximum]) => item.metrics[key] > maximum);
    }
    for (const run of runs) {
      const name = `attempts/${sha256(run.slotId).slice(7)}.json`;
      const bytes = readFileSync(safeCorpusFile(evidence.directory, name));
      assert.equal(sha256(bytes), evidence.attemptDigests[run.slotId], 'attempt receipt changed');
      const attempt = JSON.parse(bytes.toString('utf8'));
      assert.equal(attempt.schema, 'ProjectRagAttemptReceipt/v1'); assert.equal(attempt.driven_by, 'agent');
      for (const key of ['slotId', 'corpusDigest', 'experimentBindingDigest', 'outcome', 'failureClass', 'grade', 'costs', 'usageUnknown', 'unknownReserveUsd', 'actualBudget']) assert(isDeepStrictEqual(attempt[key], run[key]), `attempt ${key} drift`);
      assert.equal(attempt.gradeDigest, sha256(jsonBytes(run.grade)), 'independent grade digest drift');
      assert(/^sha256:[a-f0-9]{64}$/.test(attempt.capture?.rawDigest), 'missing raw attempt capture');
      assert(['delivered', 'invalid', 'missing'].includes(attempt.capture.status), 'missing artifact disposition');
      assert(run.outcome !== 'pass' || attempt.capture.status === 'delivered', 'successful task output not delivered');
      assert(run.grade.artifactDigest !== null || attempt.capture.status === 'missing', 'missing output not captured');
      assert(run.grade.artifactDigest === null || run.grade.artifactDigest === attempt.capture.rawDigest, 'artifact capture drift');
      assert(Number.isFinite(Date.parse(attempt.startedAt)) && Date.parse(attempt.startedAt) >= Date.parse(experiment.binding.frozenAt)
        && Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt), 'attempt predates binding');
      assert(['totalTokens', 'modelCalls', 'elapsedMs'].every(key => Number.isSafeInteger(attempt.actualBudget?.[key]) && attempt.actualBudget[key] >= 0), 'actual task budget missing');
    }
  } catch (error) { reasons.push(`verified-execution-evidence-missing: ${error.message}`); }
  if (reasons.length) return { schema: 'ProjectRagPromotionVerdict/v1', status: 'insufficient-evidence', reasons, runCount: runs.length, expectedRuns: 540 };
  const verdicts = [];
  for (const profile of ['local', 'quality', 'research']) {
    const subset = runs.filter(r => bundle.plan.slots.find(s => s.id === r.slotId).profile === profile);
    const arm = name => subset.filter(r => bundle.plan.slots.find(s => s.id === r.slotId).arm === name).map(r => {
      const slot = bundle.plan.slots.find(s => s.id === r.slotId);
      return { ...r, caseId: slot.taskId, repeat: slot.repeat, success: r.grade.passed,
        costUsd: Object.values(r.costs).reduce((n, v) => n + v, 0) + r.unknownReserveUsd };
    });
    const page = arm('page'), full = arm('full');
    const threshold = bundle.policy.tasks[profile];
    const effect = pairedEffect(page, full, { metric: 'success', k: 3, minCases: 20, minimumEffect: threshold.minimumSuccessGain });
    const mean = rows => rows.reduce((n, r) => n + r.costUsd, 0) / rows.length;
    const baseCost = mean(page), fullCost = mean(full);
    const zeroBaselineWithinEnvelope = baseCost === 0 && fullCost <= threshold.zeroBaselineAbsoluteUsd;
    const increase = baseCost > 0 ? (fullCost - baseCost) / baseCost : zeroBaselineWithinEnvelope ? 0 : Infinity;
    const envelope = bundle.policy.profiles[profile].taskEnvelope;
    const exceededEnvelope = [...page, ...full, ...arm('off')].some(r => r.costUsd > envelope.maximumTotalUsd
      || r.actualBudget.totalTokens > envelope.maxTotalTokens || r.actualBudget.modelCalls > envelope.maxModelCalls || r.actualBudget.elapsedMs > envelope.deadlineMs);
    const promotion = evaluatePromotion({ minimumImprovement: threshold.minimumSuccessGain, costIncreaseMaximum: threshold.maximumCostIncrease,
      meanDiff: effect.meanDiff, ci95: effect.ci95, costIncrease: increase,
      integrityViolated: safetyFailed || exceededEnvelope || subset.some(r => r.safetyViolation === true), sampleSufficient: effect.pairCount === 20
        && effect.droppedPairCount === 0 && effect.excludedPartialPairs.length === 0, unstable: false });
    verdicts.push({ profile, effect, promotion, costs: { baselineUsd: baseCost, treatmentUsd: fullCost, relativeIncrease: Number.isFinite(increase) ? increase : null,
      zeroBaselineWithinEnvelope, zeroBaselineEnvelopeUsd: threshold.zeroBaselineAbsoluteUsd } });
  }
  return { schema: 'ProjectRagPromotionVerdict/v1', status: verdicts.every(v => v.promotion.status === 'promote') ? 'promote' : 'hold', runCount: 540, verdicts };
}

/** Freeze shared provider and safety metadata before the first inference slot. */
export function bindRagExperiment(bundle, input) {
  assert.equal(input.corpusDigest, bundle.freezeDigest);
  assert(/^[a-f0-9]{40}$/.test(input.cleanCandidate), 'clean candidate missing');
  assert(/^sha256:[a-f0-9]{64}$/.test(input.ownerSafetyDigest), 'owner safety binding missing');
  assert(input.provider?.instanceId && input.provider.modelRevision && input.provider.usageParserRevision
    && input.provider.rateSheetRevision && input.provider.capabilityReceiptDigest, 'provider/model/usage/rate binding missing');
  assert(/^sha256:[a-f0-9]{64}$/.test(input.provider.capabilityReceiptDigest), 'provider capability receipt missing');
  assert(input.generationSettings && typeof input.generationSettings === 'object' && !Array.isArray(input.generationSettings)
    && Object.keys(input.generationSettings).length > 0, 'generation settings missing');
  const endpoint = new URL(input.provider.endpointOrigin);
  assert(!endpoint.username && !endpoint.password && !endpoint.search && endpoint.origin === input.provider.endpointOrigin, 'endpoint metadata contains credentials or parameters');
  const text = JSON.stringify(input.provider);
  assert(!/"(?:apiKey|authorization|password|secret|token)"\s*:/i.test(text), 'raw credentials in provider binding');
  assert.equal(input.arms.length, 3); distinct(input.arms.map(a => a.arm), 'experiment arm');
  for (const arm of input.arms) {
    assert(RAG_ARMS.includes(arm.arm));
    assert.equal(arm.providerDigest, sha256(jsonBytes(input.provider)), 'provider differs across arms');
    assert.equal(arm.ownerSafetyDigest, input.ownerSafetyDigest, 'safety differs across arms');
    assert.equal(arm.generationSettingsDigest, sha256(jsonBytes(input.generationSettings)), 'generation differs across arms');
    for (const profile of ['local', 'quality', 'research']) assert.equal(arm.envelopes[profile], sha256(jsonBytes(bundle.policy.profiles[profile].taskEnvelope)), 'arm budget drift');
    if (arm.arm === 'page') assert.equal(arm.semanticEnabled, true, 'page semantic baseline weakened');
    if (arm.arm === 'off') assert.equal(arm.backgroundRetrieval, false);
  }
  const binding = { schema: 'ProjectRagExperimentBinding/v1', actor: 'experiment-binding-owner', driven_by: 'agent',
    corpusDigest: bundle.freezeDigest, cleanCandidate: input.cleanCandidate, provider: input.provider,
    ownerSafetyDigest: input.ownerSafetyDigest, arms: input.arms, generationSettings: input.generationSettings,
    frozenAt: input.frozenAt ?? new Date().toISOString(), status: 'frozen-metadata', executedSlots: 0 };
  assert(Number.isFinite(Date.parse(binding.frozenAt)), 'invalid binding freeze time');
  return { binding, digest: sha256(jsonBytes(binding)) };
}
