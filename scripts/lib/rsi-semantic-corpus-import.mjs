import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { benefitDigest } from './rsi-benefit-eval.mjs';
import { PUBLIC_ERROR_CONVENTION } from './rsi-coding-protocol.mjs';

export const SEMANTIC_IMPORT_REQUIRED_FAMILIES_PER_SPLIT = 3132;
export const SEMANTIC_IMPORT_SPLITS = Object.freeze(['validation', 'heldOut']);
const SHA256 = /^[a-f0-9]{64}$/u, REVISION = /^[a-f0-9]{7,64}$/u;
const LANGUAGES = new Set(['javascript', 'python', 'cpp', 'java']);
const RUNNER_KINDS = new Set(['function-vectors', 'stdio-program']);
const TEST_KINDS = new Set(['function', 'stdio']);
const VISIBILITIES = new Set(['public', 'private']);
const PRIVATE_DATA = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:OPENAI|ANTHROPIC|SILICONFLOW)_API_KEY\s*=/u,
];

const hash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : stableStringify(value)).digest('hex');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function semanticCorpusDigest(value) {
  return hash(value);
}

function fail(code, detail = '') {
  assert.fail(detail ? code + ': ' + detail : code);
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeNumberLike(value) {
  assert(typeof value === 'string' || typeof value === 'number', 'semantic-corpus-upstream-id');
  const text = String(value);
  assert(text.length > 0 && text.length <= 512, 'semantic-corpus-upstream-id');
  return text;
}

function pollution(value, location) {
  for (const pattern of PRIVATE_DATA) if (pattern.test(value)) fail('semantic-corpus-private-data', location);
}

const SOURCE_ADAPTERS = Object.freeze({
  'apps-jsonl': { input: 'JSONL', schema: 'APPS row: question, solutions[], input_output{inputs,outputs}, id, url', language: 'python', runner: 'python-stdin-stdout' },
  'codecontests-json': { input: 'JSON', schema: 'CodeContests row: description, solutions[], public/private/generated tests', language: 'python/cpp/java', runner: '<language>-stdin-stdout' },
  'canonical-json': { input: 'JSON', schema: 'RsiSemanticCorpusInputRecord/v1[]', language: 'canonical', runner: 'canonical' },
});

function sourceIdentityKey(record) {
  return record.sourceIdentity ?? record.relativeId ?? record.upstreamId;
}

function normalizeReferenceShape(reference) {
  if (reference.language === 'javascript') {
    const file = ts.createSourceFile('reference.mjs', reference.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), tokens = [];
    assert(file.parseDiagnostics.length === 0, 'semantic-corpus-reference-syntax');
    function visit(node) {
      if (ts.isIdentifier(node)) {
        const member = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
        const declared = ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent) || ts.isFunctionDeclaration(node.parent);
        tokens.push(member ? 'member:' + node.text : declared ? 'declared-name' : 'identifier');
      } else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node)) tokens.push('literal');
      else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)) tokens.push('literal');
      else tokens.push(node.kind);
      if (!ts.isStringLiteral(node) && !ts.isNumericLiteral(node) && !ts.isRegularExpressionLiteral(node)
        && !ts.isNoSubstitutionTemplateLiteral(node)) node.getChildren(file).forEach(visit);
    }
    visit(file); return hash(tokens.join(':'));
  }
  const names = new Map(), keywords = new Set(['def', 'class', 'return', 'if', 'else', 'elif', 'for', 'while', 'in',
    'not', 'and', 'or', 'is', 'None', 'True', 'False', 'try', 'except', 'finally', 'with', 'as', 'import', 'from',
    'pass', 'raise', 'lambda', 'yield', 'async', 'await', 'break', 'continue', 'int', 'str', 'list', 'dict', 'set', 'len', 'range']);
  return hash(reference.source.replace(/#[^\n]*/gu, '').replace(/\b(?:def|class)\s+[A-Za-z_][A-Za-z0-9_]*/gu, match => match.split(/\s+/u)[0] + ' <name>').match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\sA-Za-z0-9_]/gu)?.map(token => {
    if (/^\d/u.test(token) || /^["']/u.test(token)) return '<literal>';
    if (!/^[A-Za-z_]/u.test(token) || keywords.has(token)) return token;
    if (!names.has(token)) names.set(token, names.size);
    return 'name:' + names.get(token);
  }).join('') ?? '');
}

function appsFunctionWrapper(name) {
  assert(typeof name === 'string' && /^[A-Za-z_]\w*$/u.test(name), 'semantic-corpus-apps-function-name');
  return `\n\nif __name__ == "__main__":\n`
    + `    _rsi_entry = globals()[${JSON.stringify(name)}]\n`
    + '    import json, sys\n    print(json.dumps(_rsi_entry(*json.load(sys.stdin)), allow_nan=False))\n';
}

export function referenceShape(reference, appsFunctionName = undefined) {
  if (appsFunctionName === undefined) return normalizeReferenceShape(reference);
  const wrapper = appsFunctionWrapper(appsFunctionName);
  assert(reference.language === 'python' && reference.source.endsWith(wrapper), 'semantic-corpus-apps-reference-wrapper');
  return normalizeReferenceShape({ ...reference, source: reference.source.slice(0, -wrapper.length) });
}

function validateSource(source) {
  assert(source && typeof source === 'object', 'semantic-corpus-source-required');
  for (const field of ['sourceId', 'repository', 'datasetVersion', 'revision', 'fileSha256']) assert(nonemptyString(source[field]), 'semantic-corpus-source-' + field);
  assert(REVISION.test(source.revision), 'semantic-corpus-source-revision');
  assert(SHA256.test(source.fileSha256), 'semantic-corpus-source-file-sha256');
  assert(source.license && nonemptyString(source.license.spdx) && SHA256.test(source.license.sha256 ?? ''), 'semantic-corpus-source-license');
  assert(LANGUAGES.has(source.language), 'semantic-corpus-source-language');
  assert(source.runner && RUNNER_KINDS.has(source.runner.kind) && nonemptyString(source.runner.adapter), 'semantic-corpus-source-runner');
  pollution(source.repository, 'source.repository');
  return source;
}

function validateRecord(record, source) {
  assert(record && typeof record === 'object', 'semantic-corpus-record-required');
  record.upstreamId = safeNumberLike(record.upstreamId);
  assert(nonemptyString(record.split) && SEMANTIC_IMPORT_SPLITS.includes(record.split), 'semantic-corpus-record-split');
  assert(nonemptyString(record.prompt) && record.prompt.length >= 40 && record.prompt.length <= 200000, 'semantic-corpus-record-prompt');
  assert(record.reference && LANGUAGES.has(record.reference.language) && nonemptyString(record.reference.source), 'semantic-corpus-reference-required');
  assert(record.reference.language === source.language || source.runner.adapter === 'multi-language-stdin-stdout', 'semantic-corpus-source-language-mismatch');
  assert(record.reference.source.length <= 2_000_000, 'semantic-corpus-reference-too-large');
  pollution(record.prompt, 'prompt'); pollution(record.reference.source, 'reference');
  assert(Array.isArray(record.tests) && record.tests.length > 0 && record.tests.length <= 10_000, 'semantic-corpus-tests-required');
  record.tests.forEach((test, index) => {
    assert(test && TEST_KINDS.has(test.kind) && VISIBILITIES.has(test.visibility), 'semantic-corpus-test-kind');
    assert(Object.hasOwn(test, 'input'), 'semantic-corpus-test-input');
    assert(Object.hasOwn(test, 'output'), 'semantic-corpus-test-output');
    pollution(stableStringify(test.input), 'tests[' + index + '].input'); pollution(stableStringify(test.output), 'tests[' + index + '].output');
    if (source.runner.kind === 'function-vectors') assert(test.kind === 'function' && nonemptyString(test.fnName), 'semantic-corpus-function-vector-required');
  });
  if (source.runner.kind === 'function-vectors') assert(record.publicContract?.declaration, 'semantic-corpus-public-contract-required');
  return record;
}

function reviewedFamilies(records, families, representativeOnly = false) {
  if (families === undefined || families === null) {
    const grouped = new Map();
    for (const record of records) {
      const identity = sourceIdentityKey(record);
      if (!grouped.has(identity)) grouped.set(identity, []);
      grouped.get(identity).push(record.upstreamId);
    }
    return { complete: false, rows: [...grouped].map(([identity, upstreamIds]) => ({
      familyId: 'auto-' + hash(identity).slice(0, 20), upstreamIds,
      basis: 'Automatic sourceIdentity grouping; semantic family review required before formal admission.',
    })) };
  }
  assert(Array.isArray(families) && families.length > 0, 'semantic-corpus-families-required');
  const assigned = new Set(), recordIds = new Set(records.map(record => record.upstreamId));
  const rows = families.map(family => {
    assert(family && nonemptyString(family.familyId) && nonemptyString(family.basis), 'semantic-corpus-family-review');
    assert(Array.isArray(family.upstreamIds) && family.upstreamIds.length > 0, 'semantic-corpus-family-members');
    const upstreamIds = [...new Set(family.upstreamIds.map(safeNumberLike))].sort();
    assert(upstreamIds.length === family.upstreamIds.length, 'semantic-corpus-family-duplicate-member');
    for (const id of upstreamIds) {
      if (!representativeOnly) assert(recordIds.has(id), 'semantic-corpus-family-unknown-member');
      if (!recordIds.has(id)) continue;
      assert(!assigned.has(id), 'semantic-corpus-family-overlap');
      assigned.add(id);
    }
    pollution(family.basis, 'family.basis');
    return { familyId: family.familyId, upstreamIds, basis: family.basis };
  });
  if (!representativeOnly) assert(assigned.size === recordIds.size, 'semantic-corpus-family-coverage-incomplete');
  else assert([...recordIds].every(id => assigned.has(id)), 'semantic-corpus-family-coverage-incomplete');
  assert(new Set(rows.map(row => row.familyId)).size === rows.length, 'semantic-corpus-family-id-duplicate');
  return { complete: true, rows };
}

function normalizeTest(test, recordDigest, index) {
  return {
    testId: test.testId ?? recordDigest.slice(0, 12) + '-test-' + index,
    kind: test.kind,
    visibility: test.visibility,
    ...(test.fnName ? { fnName: test.fnName } : {}),
    input: test.input,
    output: test.output,
    ...(test.comparison ? { comparison: test.comparison } : {}),
    provenance: { sourceRecordDigest: recordDigest, field: test.provenanceField ?? 'tests', index, official: true },
  };
}

function taskFromFamily({ source, family, members, split, base }) {
  const representative = [...members].sort((left, right) => left.upstreamId.localeCompare(right.upstreamId))[0];
  const recordDigest = hash(representative.upstreamRecord ?? representative);
  const tests = representative.tests.map((test, index) => normalizeTest(test, recordDigest, index));
  const testDigest = hash(tests);
  const referenceDigest = hash(representative.reference.source);
  const implementationShape = normalizeReferenceShape(representative.reference);
  assert(tests.length > 0 && referenceDigest && implementationShape, 'semantic-corpus-oracle-required');
  const publicInput = stableValue({
    prompt: representative.prompt,
    acceptanceCriteria: representative.acceptanceCriteria ?? [],
    errorConvention: representative.errorConvention ?? null,
    taskKind: representative.taskKind ?? source.runner.kind,
    language: representative.reference.language,
    interface: representative.publicContract ?? { kind: source.runner.kind, adapter: source.runner.adapter },
    sourceIdentity: sourceIdentityKey(representative),
  });
  const provenance = {
    schemaVersion: 'RsiSemanticSourceProvenance/v1',
    sourceId: source.sourceId,
    repository: source.repository,
    revision: source.revision,
    sourceFileSha256: source.fileSha256,
    datasetVersion: source.datasetVersion,
    license: source.license,
    upstreamIds: family.upstreamIds,
    sourceIdentities: family.sourceIdentities ?? [],
    relativeUpstreamId: representative.relativeId ?? representative.upstreamId,
    selectedUpstreamId: representative.upstreamId,
    sourceRecordDigest: recordDigest,
    ...(representative.sourceIdentityEvidence ? { sourceIdentityEvidence: representative.sourceIdentityEvidence } : {}),
    referenceDigest,
    testDigest,
    implementationShape,
    familyReview: {
      schemaVersion: 'RsiSemanticFamilyReview/v1', driven_by: 'agent', actor: base.actor,
      realHumanEvidence: false, familyId: family.familyId, sourceIds: family.upstreamIds,
      sourceIdentities: family.sourceIdentities ?? [],
      basis: family.basis, completeWithinImport: base.familyReviewComplete,
    },
  };
  return stableValue({
    id: (source.sourceId + '-' + family.familyId).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
      .slice(0, 72) + '-' + hash([source.sourceId, family.familyId]).slice(0, 10),
    split,
    familyId: family.familyId,
    publicInput,
    oracle: { reference: { ...representative.reference, sha256: referenceDigest }, tests, sha256: testDigest },
    safetyRequired: representative.safetyRequired === true, anchor: representative.anchor ?? null, provenance,
  });
}

export function importSemanticCorpus({ source, records, families, actor = 'codex/rsi-semantic-corpus-import', requiredFamiliesPerSplit = 0,
  acceptedRecordDigests = null, enforceDistinctImplementation = true, representativeOnly = false }) {
  validateSource(source);
  assert(nonemptyString(actor), 'semantic-corpus-actor');
  assert(Array.isArray(records), 'semantic-corpus-records-required');
  if (acceptedRecordDigests !== null) assert(acceptedRecordDigests instanceof Set && acceptedRecordDigests.size > 0, 'semantic-corpus-accepted-record-digests');
  const seen = new Set();
  for (const record of records) {
    validateRecord(record, source);
    assert(!seen.has(record.upstreamId), 'semantic-corpus-duplicate-upstream-id'); seen.add(record.upstreamId);
  }
  const rejectedRecordDigests = acceptedRecordDigests === null ? [] : records.map(record => hash(record.upstreamRecord ?? record))
    .filter(digest => !acceptedRecordDigests.has(digest));
  if (acceptedRecordDigests !== null) assert(rejectedRecordDigests.length === 0, 'semantic-corpus-accepted-record-digest-drift: ' + rejectedRecordDigests.length + ' records');
  const groupReview = reviewedFamilies(records, families, representativeOnly), byId = new Map(records.map(record => [record.upstreamId, record]));
  const familySplits = new Map(), sourceIdentities = new Map(), familyShapes = new Map();
  const tasks = groupReview.rows.map(family => {
    const members = family.upstreamIds.map(id => byId.get(id)).filter(Boolean);
    assert(members.length > 0, 'semantic-corpus-family-representative-required');
    const split = members[0].split;
    assert(members.every(record => record.split === split), 'semantic-corpus-family-split-mismatch');
    assert(!familySplits.has(family.familyId), 'semantic-corpus-family-id-duplicate'); familySplits.set(family.familyId, split);
    for (const record of members) {
      const identity = sourceIdentityKey(record);
      assert(!sourceIdentities.has(identity) || sourceIdentities.get(identity) === family.familyId, 'semantic-corpus-source-identity-split');
      sourceIdentities.set(identity, family.familyId);
    }
    const observedIdentities = [...new Set(members.map(sourceIdentityKey).filter(nonemptyString))].sort();
    const task = taskFromFamily({ source, family: { ...family, sourceIdentities: observedIdentities }, members, split,
      base: { actor, familyReviewComplete: groupReview.complete } });
    const shape = task.provenance.implementationShape;
    if (enforceDistinctImplementation) assert(!familyShapes.has(shape), 'semantic-corpus-renamed-or-data-variant: ' + family.familyId + ' overlaps ' + familyShapes.get(shape));
    familyShapes.set(shape, family.familyId);
    return task;
  }).sort((left, right) => left.id.localeCompare(right.id));
  const counts = Object.fromEntries(SEMANTIC_IMPORT_SPLITS.map(split => [split, tasks.filter(task => task.split === split).length]));
  const gaps = [];
  if (!groupReview.complete) gaps.push('reviewed family manifest missing; automatic groups are candidate-only');
  if (source.runner.kind === 'stdio-program') gaps.push(source.language + ' runner adapter required before native replay');
  if (source.runner.kind === 'function-vectors') gaps.push('function-vector execution requires JavaScript/harness calibration');
  if (requiredFamiliesPerSplit > 0) for (const split of SEMANTIC_IMPORT_SPLITS) if (counts[split] < requiredFamiliesPerSplit) gaps.push(split + ': ' + counts[split] + '/' + requiredFamiliesPerSplit + ' independent families');
  const formalPopulationReady = gaps.length === 0;
  const formalAdmissionGaps = gaps.filter(gap => !gap.includes('runner adapter required') && !gap.includes('execution requires'));
  const familyPopulationReady = formalAdmissionGaps.length === 0;
  return stableValue({
    schemaVersion: 'RsiPublicSemanticCorpus/v1',
    datasetVersion: 'RsiPublicSemanticCases/v1',
    driven_by: 'agent',
    actor,
    realHumanEvidence: false,
    source,
    inferenceUnit: 'reviewed-upstream-family',
    counts: { records: records.length, families: groupReview.rows.length, tasks: tasks.length, bySplit: counts },
    requirements: { requiredFamiliesPerSplit, requiredFamiliesTotal: requiredFamiliesPerSplit * 2,
      completeFamilyReviewRequired: true, sourceHashRevisionTestsAndReferenceRequired: true, acceptedRecordDigests: acceptedRecordDigests?.size ?? null },
    acceptedRecordDigests: [...(acceptedRecordDigests ?? [])].sort(),
    adapter: SOURCE_ADAPTERS[source.inputFormat ?? 'canonical-json'],
    recordDigests: records.map(record => hash(record.upstreamRecord ?? record)).sort(),
    formalPopulationReady,
    familyPopulationReady,
    gaps,
    tasks,
  });
}

export function freezeSemanticIndependentCasesV2(result, { publicErrorConvention = PUBLIC_ERROR_CONVENTION } = {}) {
  assert(result.schemaVersion === 'RsiPublicSemanticCorpus/v1', 'semantic-corpus-v2-source-version');
  assert(result.familyPopulationReady, 'semantic-corpus-v2-family-review-required');
  assert(result.source.runner.kind === 'function-vectors', 'semantic-corpus-v2-function-vectors-only');
  assert(result.source.language === 'javascript', 'semantic-corpus-v2-javascript-only');
  const cases = result.tasks.map(task => {
    const reference = task.oracle.reference.source;
    const name = reference.match(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u)?.[1];
    const declaration = task.publicInput.interface?.declaration;
    assert(name && declaration, 'semantic-corpus-v2-public-contract');
    const vectors = task.oracle.tests.map(test => {
      assert(test.kind === 'function' && Array.isArray(test.input), 'semantic-corpus-v2-function-vector');
      return { args: test.input, ...(test.throws ? { throws: true } : { expected: test.output }) };
    });
    assert(vectors.length >= 5, 'semantic-corpus-v2-five-private-vectors');
    const prompt = task.publicInput.prompt, contractDigest = benefitDigest({
      prompt: prompt.replaceAll(name, '<entry>').replace(/\s+/gu, ' ').trim().toLowerCase(),
      declaration: declaration.replaceAll(name, '<entry>').replace(/\s+/gu, ' ').trim(),
    });
    const sourceId = task.provenance.sourceId + '/' + task.provenance.selectedUpstreamId;
    return stableValue({ id: task.id, name, split: task.split, independenceGroup: task.familyId, prompt, declaration,
      reference, vectors, safetyRequired: task.safetyRequired, anchor: task.anchor,
      provenance: { ...task.provenance, sourceId, upstreamIds: task.provenance.upstreamIds,
        familyReview: { schemaVersion: 'RsiSemanticFamilyReview/v1', driven_by: 'agent', actor: result.actor, realHumanEvidence: false,
          basis: task.provenance.familyReview.basis, sourceId, familyId: task.familyId, contractDigest,
          referenceDigest: benefitDigest(reference), privateOracleDigest: benefitDigest(vectors) } } });
  });
  return stableValue({ schemaVersion: 'RsiIndependentCodingCases/v2', datasetVersion: 'RsiSemanticIndependentCases/v2',
    driven_by: 'agent', actor: result.actor, realHumanEvidence: false,
    purpose: 'Deterministic public-corpus freeze for independently reviewed JavaScript function-vector families.',
    inferenceUnit: 'independent-contract-group', publicErrorConvention, cases });
}

/** Keep the complete program contract, while leaving solution and tests in the oracle. */
export function freezeSemanticStdioCasesV2(result, admission) {
  assert(result.schemaVersion === 'RsiPublicSemanticCorpus/v1' && result.familyPopulationReady
    && result.source.runner.kind === 'stdio-program' && result.tasks.every(task => task.oracle.tests.every(test => test.kind === 'stdio')),
  'semantic-corpus-v2-stdio-required');
  assert.equal(admission?.schemaVersion, 'RsiCodeContestsAdmission/v1', 'semantic-stdio-admission-required');
  const selected = [...admission.splits.validation, ...admission.splits.heldOut], tasks = new Map(result.tasks.map(task => [task.familyId, task]));
  const cases = selected.map(selection => {
    const task = tasks.get(selection.familyId);
    assert(task && task.provenance.selectedUpstreamId === selection.representative && task.split === selection.split,
      'semantic-stdio-admission-identity');
    assert.equal(task.publicInput.language, selection.runtime === 'python3' ? 'python' : selection.runtime, 'semantic-stdio-admission-runtime');
    const contract = task.publicInput.interface, adapted = contract?.adapter === 'python-json-function-stdin-stdout';
    const vectors = task.oracle.tests, prompt = task.publicInput.prompt;
    if (adapted) assert(selection.runtime === 'python3' && vectors.every(test => test.comparison === 'json'), 'semantic-corpus-apps-function-contract');
    const reference = task.oracle.reference.source + (adapted ? appsFunctionWrapper(contract.functionName) : '');
    assert(reference && vectors.length > 0, 'semantic-corpus-v2-stdio-oracle');
    const name = selection.runtime, declaration = adapted
      ? `Define the Python 3 function ${contract.functionName}. Read one JSON array of positional arguments from stdin, call the function, and print its result as one JSON value on stdout.\n`
      : 'Write a complete program that reads standard input and writes the required answer to standard output.\n';
    const contractDigest = benefitDigest({ prompt: prompt.replace(/\s+/gu, ' ').trim().toLowerCase(), language: selection.runtime });
    const sourceId = task.provenance.sourceId + '/' + task.provenance.selectedUpstreamId;
    return stableValue({ id: task.id, name, runtime: selection.runtime, split: task.split, familyId: task.familyId,
      independenceGroup: task.familyId, prompt, declaration, reference, vectors, safetyRequired: false, anchor: null,
      provenance: { ...task.provenance, sourceId, ...(adapted ? { appsFunctionName: contract.functionName } : {}), familyReview: { schemaVersion: 'RsiSemanticFamilyReview/v1',
        driven_by: 'agent', actor: result.actor, realHumanEvidence: false, basis: task.provenance.familyReview.basis,
    sourceId, familyId: task.familyId, runtime: selection.runtime, contractDigest, referenceDigest: benefitDigest(reference),
        privateOracleDigest: benefitDigest(vectors) } } });
  });
  return stableValue({ schemaVersion: 'RsiIndependentCodingCases/v2', datasetVersion: 'RsiSemanticIndependentCases/v2',
    driven_by: 'agent', actor: result.actor, realHumanEvidence: false, executionKind: 'stdio-program',
    usage: 'prospective-measurement',
    admission, source: result.source, purpose: 'Independently reviewed stdin/stdout program families with reference-admitted official tests.',
    inferenceUnit: 'independent-contract-group', cases });
}

/**
 * Freeze a deterministic family split without claiming runtime admission.
 * Ordering is over complete reviewed families, never individual records.
 */
export function freezeCodeContestsFamilySplits({ familyReview, index, requiredFamiliesPerSplit, seed, runtime = null }) {
  assert(familyReview?.schemaVersion === 'RsiSemanticFamilyReview/v1' && familyReview.completeWithinImport === true,
    'codecontests-family-review-required');
  assert(Array.isArray(index) && index.length > 0, 'codecontests-family-index-required');
  assert(Number.isSafeInteger(requiredFamiliesPerSplit) && requiredFamiliesPerSplit > 0, 'codecontests-family-split-size');
  assert(nonemptyString(seed), 'codecontests-family-split-seed');
  const canonicalIndex = [...index].sort((left, right) => String(left.upstreamId).localeCompare(String(right.upstreamId)));
  const canonicalReview = { ...familyReview, families: [...familyReview.families].sort((left, right) => left.familyId.localeCompare(right.familyId)) };
  const byId = new Map(canonicalIndex.map(row => [row.upstreamId, row]));
  assert.equal(byId.size, canonicalIndex.length, 'codecontests-family-index-duplicate-id');
  const members = new Map();
  for (const family of canonicalReview.families) {
    assert(!members.has(family.familyId), 'codecontests-family-id-duplicate');
    assert(Array.isArray(family.upstreamIds) && family.upstreamIds.length > 0, 'codecontests-family-members');
    members.set(family.familyId, [...family.upstreamIds].sort());
  }
  const seen = new Set();
  for (const family of canonicalReview.families) for (const id of family.upstreamIds) {
    assert(!seen.has(id), 'codecontests-family-member-overlap'); seen.add(id);
    assert(byId.has(id), 'codecontests-family-member-unknown');
  }
  assert.equal(seen.size, canonicalIndex.length, 'codecontests-family-record-coverage');
  const eligible = [...members].flatMap(([familyId, upstreamIds]) => {
    const rows = upstreamIds.map(id => byId.get(id));
    if (!rows.every(row => row.shard.startsWith('data/train-'))) return [];
    if (runtime && !rows.some(row => row.runtime === runtime)) return [];
    const representative = rows.find(row => row.runtime === runtime) ?? [...rows].sort((left, right) => left.upstreamId.localeCompare(right.upstreamId))[0];
    return [{ familyId, upstreamIds, representative: representative.upstreamId, runtime: representative.runtime,
      rank: hash({ seed, familyId }) }];
  }).sort((left, right) => left.rank.localeCompare(right.rank) || left.familyId.localeCompare(right.familyId));
  const requiredTotal = requiredFamiliesPerSplit * 2;
  assert(eligible.length >= requiredTotal, 'codecontests-family-split-insufficient');
  const selected = eligible.slice(0, requiredTotal), splits = {
    validation: selected.slice(0, requiredFamiliesPerSplit).map(row => ({ ...row, split: 'validation' })),
    heldOut: selected.slice(requiredFamiliesPerSplit).map(row => ({ ...row, split: 'heldOut' })),
  };
  assert.equal(new Set(selected.map(row => row.familyId)).size, requiredTotal, 'codecontests-family-split-overlap');
  return stableValue({ schemaVersion: 'RsiCodeContestsSplitFreeze/v1', driven_by: 'agent', realHumanEvidence: false,
    method: 'Complete train family, optional runtime requires a member with that runtime; ascending sha256(seed,familyId); first 2N.',
    seed, runtime, requiredFamiliesPerSplit, requiredFamiliesTotal: requiredTotal,
    sourceIdentity: { familyReviewDigest: hash(canonicalReview), indexDigest: hash(canonicalIndex) },
    counts: { eligibleFamilies: eligible.length, selectedFamilies: selected.length, excludedFamilies: eligible.length - requiredTotal },
    splits, exclusions: { familyIdsDigest: hash(eligible.slice(requiredTotal).map(row => row.familyId)) } });
}
function codeContestsEligibleFamilies({ familyReview, index, runtime, seed }) {
  const canonicalIndex = [...index].sort((left, right) => String(left.upstreamId).localeCompare(String(right.upstreamId)));
  const canonicalReview = { ...familyReview, families: [...familyReview.families].sort((left, right) => left.familyId.localeCompare(right.familyId)) };
  const byId = new Map(canonicalIndex.map(row => [row.upstreamId, row]));
  assert.equal(byId.size, canonicalIndex.length, 'codecontests-family-index-duplicate-id');
  const wanted = runtime === null || runtime === undefined ? null : (Array.isArray(runtime) ? runtime : [runtime]);
  const seen = new Set(), families = [];
  for (const family of canonicalReview.families) {
    const upstreamIds = [...family.upstreamIds].sort();
    for (const id of upstreamIds) {
      assert(!seen.has(id), 'codecontests-family-member-overlap'); seen.add(id);
      assert(byId.has(id), 'codecontests-family-member-unknown');
    }
    const rows = upstreamIds.map(id => byId.get(id));
    if (!rows.every(row => row.shard.startsWith('data/train-'))) continue;
    const representative = wanted ? wanted.flatMap(rt => rows.filter(row => row.runtime === rt).sort((left, right) => left.upstreamId.localeCompare(right.upstreamId)))[0] : rows[0];
    if (!representative) continue;
    families.push({ familyId: family.familyId, upstreamIds, representative: representative.upstreamId, runtime: representative.runtime,
      rank: hash({ seed, familyId: family.familyId }) });
  }
  assert.equal(seen.size, canonicalIndex.length, 'codecontests-family-record-coverage');
  return { canonicalIndex, canonicalReview, families: families.sort((left, right) => left.rank.localeCompare(right.rank) || left.familyId.localeCompare(right.familyId)) };
}

export function selectCodeContestsAdmittedSplits({ familyReview, index, audit, requiredFamiliesPerSplit, seed, runtime = null, prompts = null, shapes = null, minimumTests = 5 }) {
  assert(familyReview?.schemaVersion === 'RsiSemanticFamilyReview/v1' && familyReview.completeWithinImport === true,
    'codecontests-family-review-required');
  assert(Number.isSafeInteger(requiredFamiliesPerSplit) && requiredFamiliesPerSplit > 0, 'codecontests-family-split-size');
  assert(nonemptyString(seed), 'codecontests-family-split-seed');
  assert(Array.isArray(audit), 'codecontests-family-audit-required');
  const canonicalIndex = [...index].sort((left, right) => String(left.upstreamId).localeCompare(String(right.upstreamId)));
  const canonicalReview = { ...familyReview, families: [...familyReview.families].sort((left, right) => left.familyId.localeCompare(right.familyId)) };
  const canonicalAudit = [...audit].sort((left, right) => left.familyId.localeCompare(right.familyId));
  const status = new Map();
  for (const row of canonicalAudit) {
    assert(row && nonemptyString(row.familyId) && ['passed', 'mismatch'].includes(row.status), 'codecontests-family-audit-row');
    assert(!status.has(row.familyId), 'codecontests-family-audit-duplicate'); status.set(row.familyId, row.status);
  }
  const { families } = codeContestsEligibleFamilies({ familyReview: canonicalReview, index: canonicalIndex, runtime, seed });
  for (const family of families) assert(status.has(family.familyId), 'codecontests-family-audit-coverage');
  assert.equal(status.size, families.length, 'codecontests-family-audit-coverage');
  const requiredTotal = requiredFamiliesPerSplit * 2;
  const admitted = families.filter(family => status.get(family.familyId) === 'passed');
  const rejectedPrompts = prompts ? admitted.filter(family => typeof prompts.get(family.familyId) !== 'string'
    || prompts.get(family.familyId).trim().length < 40 || prompts.get(family.familyId).length > 200000) : [];
  const promptExcluded = new Set(rejectedPrompts.map(row => row.familyId));
  const insufficientTests = admitted.filter(family => (status.get(family.familyId) === 'passed'
    && canonicalAudit.find(row => row.familyId === family.familyId)?.tests < minimumTests));
  const insufficientTestIds = new Set(insufficientTests.map(row => row.familyId));
  const seenShapes = new Set(), duplicateFamilies = [];
  const eligibleAdmitted = admitted.filter(family => {
    if (promptExcluded.has(family.familyId) || insufficientTestIds.has(family.familyId)) return false;
    if (shapes && seenShapes.has(shapes.get(family.familyId))) { duplicateFamilies.push(family.familyId); return false; }
    if (shapes) seenShapes.add(shapes.get(family.familyId));
    return true;
  });
  assert(eligibleAdmitted.length >= requiredTotal, 'codecontests-family-admitted-insufficient');
  const selected = eligibleAdmitted.slice(0, requiredTotal);
  return stableValue({ schemaVersion: 'RsiCodeContestsAdmission/v1', driven_by: 'agent', realHumanEvidence: false,
    method: 'One pre-registered rank over the full train family pool; first 2N families whose complete selected official-test audit passed.',
    seed, runtime, requiredFamiliesPerSplit, requiredFamiliesTotal: requiredTotal,
    sourceIdentity: { familyReviewDigest: hash(canonicalReview), indexDigest: hash(canonicalIndex),
      auditDigest: hash(canonicalAudit.map(row => ({ familyId: row.familyId, status: row.status }))),
      ...(prompts ? { promptPolicy: 'trimmed prompt length 40..200000; excluded before selection', excludedPromptFamilies: rejectedPrompts.map(row => ({ familyId: row.familyId, representative: row.representative })) } : {}) },
    counts: { eligibleFamilies: families.length, auditedFamilies: canonicalAudit.length, admittedFamilies: admitted.length,
      rejectedFamilies: families.length - admitted.length, selectedFamilies: selected.length,
      excludedAdmittedFamilies: admitted.length - requiredTotal, excludedPromptFamilies: rejectedPrompts.length,
      excludedDuplicateFamilies: duplicateFamilies.length, excludedInsufficientTestFamilies: insufficientTests.length,
      minimumOfficialTests: minimumTests },
    splits: { validation: selected.slice(0, requiredFamiliesPerSplit).map(row => ({ ...row, split: 'validation' })),
      heldOut: selected.slice(requiredFamiliesPerSplit).map(row => ({ ...row, split: 'heldOut' })) },
    exclusions: { rejectedDigest: hash(families.filter(family => status.get(family.familyId) !== 'passed').map(row => row.familyId)),
      remainingDigest: hash(eligibleAdmitted.slice(requiredTotal).map(row => row.familyId)) } });
}

function functionStdioTests(io, inputOutput) {
  assert(typeof io.fn_name === 'string' && /^[A-Za-z_]\w*$/u.test(io.fn_name), 'semantic-corpus-apps-function-name');
  assert(Array.isArray(io.inputs) && Array.isArray(io.outputs) && io.inputs.length > 0 && io.inputs.length === io.outputs.length,
    'semantic-corpus-tests-required');
  assert(io.inputs.every(Array.isArray) && io.outputs.every(output => Array.isArray(output) && output.length === 1),
    'semantic-corpus-apps-function-vector-shape');
  const { inputs, outputs } = JSON.parse(inputOutput, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    assert(typeof context?.source === 'string', 'semantic-corpus-apps-json-number-source-required');
    return JSON.rawJSON(context.source);
  });
  return inputs.map((input, testIndex) => ({ kind: 'stdio', visibility: 'private',
    input: JSON.stringify(input), output: JSON.stringify(outputs[testIndex][0]),
    comparison: 'json', provenanceField: 'input_output' }));
}

function stdioText(value, adapter, source) {
  if (typeof value === 'string') return value;
  assert(adapter === 'newline-lines' && Array.isArray(value) && value.every(line => typeof line === 'string'),
    `semantic-corpus-${source}-stdio-strings-required`);
  return value.join('\n');
}

export function parseAppsJsonl(text, { split = 'validation', functionAdapter = 'reject', stdioAdapter = 'strings' } = {}) {
  assert(['reject', 'json-stdio'].includes(functionAdapter), 'semantic-corpus-apps-function-adapter');
  assert(['strings', 'newline-lines'].includes(stdioAdapter), 'semantic-corpus-apps-stdio-adapter');
  const records = [], rejected = [];
  for (const [index, line] of String(text).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (error) { rejected.push({ line: index + 1, code: 'invalid-json', message: error.message }); continue; }
    try {
      const solutions = JSON.parse(row.solutions ?? '[]');
      const io = JSON.parse(row.input_output ?? '{}');
      if (!Array.isArray(solutions) || solutions.length === 0) fail('semantic-corpus-reference-required');
      if (io.fn_name) {
        if (functionAdapter !== 'json-stdio') fail('semantic-corpus-apps-function-runner-required');
        const tests = functionStdioTests(io, row.input_output);
        assert(nonemptyString(row.question) && nonemptyString(row.url), 'semantic-corpus-record-required');
        const reference = solutions.find(nonemptyString);
        assert(reference, 'semantic-corpus-reference-required');
        const upstreamId = safeNumberLike(row.problem_id ?? row.id);
        records.push({ relativeId: upstreamId, upstreamId, sourceIdentity: new URL(row.url).href, split, prompt: row.question,
          reference: { language: 'python', runtime: 'python3', source: reference },
          tests,
          publicContract: { kind: 'stdio', adapter: 'python-json-function-stdin-stdout', functionName: io.fn_name },
          acceptanceCriteria: [`Implement ${io.fn_name} and satisfy the official APPS function tests through the JSON stdin/stdout adapter.`],
          taskKind: 'stdio-program', upstreamRecord: row });
        continue;
      }
      if (!Array.isArray(io.inputs) || !Array.isArray(io.outputs) || io.inputs.length === 0 || io.inputs.length !== io.outputs.length) fail('semantic-corpus-tests-required');
      const tests = io.inputs.map((input, testIndex) => ({ kind: 'stdio', visibility: 'public',
        input: stdioText(input, stdioAdapter, 'apps'), output: stdioText(io.outputs[testIndex], stdioAdapter, 'apps'),
        provenanceField: 'input_output' }));
      assert(nonemptyString(row.question) && nonemptyString(row.url), 'semantic-corpus-record-required');
      const upstreamId = safeNumberLike(row.problem_id ?? row.id);
      records.push({
        relativeId: upstreamId, upstreamId, sourceIdentity: new URL(row.url).href, split, prompt: row.question,
        reference: { language: 'python', source: solutions[0] }, tests,
        publicContract: { kind: 'stdio', adapter: 'python-stdin-stdout',
          ...(stdioAdapter === 'newline-lines' ? { vectorAdapter: stdioAdapter } : {}) },
        acceptanceCriteria: ['The official APPS stdin/stdout tests must pass.'], taskKind: 'stdio-program',
        upstreamRecord: row,
      });
    } catch (error) { rejected.push({ line: index + 1, upstreamId: String(row.problem_id ?? row.id), code: error.message }); }
  }
  return { records, rejected };
}

export function parseCodeContestsJson(text, { split = 'validation' } = {}) {
  const parsed = JSON.parse(text), rows = Array.isArray(parsed) ? parsed : parsed.records ?? parsed;
  assert(Array.isArray(rows), 'semantic-corpus-codecontests-records');
  const records = [], rejected = [];
  rows.forEach((row, index) => {
    try {
      records.push(canonicalizeCodeContestsRow(row, { split }));
    } catch (error) { rejected.push({ line: index + 1, code: error.message }); }
  });
  return { records, rejected };
}

/** Convert one pinned TACO row without dropping records for missing origin URLs. */
export function tacoSourceIdentity(row, { revision, shard, rowIndex } = {}) {
  assert(REVISION.test(revision ?? ''), 'semantic-corpus-taco-revision');
  assert(nonemptyString(shard) && !shard.includes('..') && !shard.startsWith('/') && !shard.includes('\\'),
    'semantic-corpus-taco-shard');
  assert(Number.isSafeInteger(rowIndex) && rowIndex >= 0, 'semantic-corpus-taco-row-index');
  if (nonemptyString(row.url)) {
    const url = new URL(row.url);
    assert(['http:', 'https:'].includes(url.protocol), 'semantic-corpus-taco-origin-url');
    return { sourceIdentity: url.href, sourceIdentityEvidence: 'upstream-url' };
  }
  if (nonemptyString(row.name) && nonemptyString(row.source)) {
    const source = row.source.normalize('NFKC').trim().toLowerCase();
    const name = row.name.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
    return { sourceIdentity: `taco-origin:${source}:${name}`, sourceIdentityEvidence: 'source-name' };
  }
  return { sourceIdentity: `taco-record:${revision}:${shard}#${rowIndex}`, sourceIdentityEvidence: 'pinned-row' };
}

export function canonicalizeTacoRow(row, { revision, shard, rowIndex, split = 'validation', functionAdapter = 'reject', stdioAdapter = 'strings' } = {}) {
  assert(['reject', 'json-stdio'].includes(functionAdapter), 'semantic-corpus-taco-function-adapter');
  assert(['strings', 'newline-lines'].includes(stdioAdapter), 'semantic-corpus-taco-stdio-adapter');
  assert(row && nonemptyString(row.question), 'semantic-corpus-taco-question');
  const origin = tacoSourceIdentity(row, { revision, shard, rowIndex });
  const solutions = typeof row.solutions === 'string' ? JSON.parse(row.solutions) : row.solutions;
  const io = typeof row.input_output === 'string' ? JSON.parse(row.input_output) : row.input_output;
  assert(Array.isArray(solutions) && solutions.some(nonemptyString), 'semantic-corpus-reference-required');
  assert(io && (!io.fn_name || functionAdapter === 'json-stdio') && Array.isArray(io.inputs) && Array.isArray(io.outputs) && io.inputs.length > 0
    && io.inputs.length === io.outputs.length, 'semantic-corpus-tests-required');
  let tests, publicContract, acceptanceCriteria;
  if (io.fn_name) {
    assert(typeof row.input_output === 'string', 'semantic-corpus-taco-function-serialized-io-required');
    tests = functionStdioTests(io, row.input_output);
    publicContract = { kind: 'stdio', adapter: 'python-json-function-stdin-stdout', functionName: io.fn_name };
    acceptanceCriteria = [`Implement ${io.fn_name} and satisfy the source TACO function tests through the JSON stdin/stdout adapter.`];
  } else {
    tests = io.inputs.map((input, index) => ({ kind: 'stdio', visibility: 'private',
      input: stdioText(input, stdioAdapter, 'taco'), output: stdioText(io.outputs[index], stdioAdapter, 'taco'),
      provenanceField: 'input_output' }));
    publicContract = { kind: 'stdio', adapter: 'python-stdin-stdout',
      ...(stdioAdapter === 'newline-lines' ? { vectorAdapter: stdioAdapter } : {}) };
    acceptanceCriteria = ['Implement the stated stdin/stdout contract in Python 3.'];
  }
  const upstreamId = `taco:${shard}#${rowIndex}`;
  const { sourceIdentity, sourceIdentityEvidence } = origin;
  return {
    relativeId: upstreamId, upstreamId, sourceIdentity, split, prompt: row.question,
    reference: { language: 'python', runtime: 'python3', source: solutions.find(nonemptyString) },
    tests, publicContract, acceptanceCriteria, taskKind: 'stdio-program',
    sourceIdentityEvidence,
    upstreamRecord: { revision, shard, rowIndex, source: row.source ?? null, name: row.name ?? null, url: row.url ?? null,
      question: row.question, solutions,
      input_output: io.fn_name || stdioAdapter === 'newline-lines' ? row.input_output : io, sourceIdentityEvidence },
  };
}

/**
 * Convert an already-extracted CodeContests row into the canonical import shape.
 * Parquet decoding stays outside this module so the committed converter has no native dependency.
 */
export function canonicalizeCodeContestsRow(row, { split = 'validation', relativeId = null, shard = null, rowIndex = null } = {}) {
  assert(row && nonemptyString(row.description), 'semantic-corpus-codecontests-description');
  const sourceSolutions = row.solutions ?? {}, correct = Array.isArray(sourceSolutions) ? sourceSolutions
    : (sourceSolutions.solution ?? []).map((source, index) => ({ solution: source, language: (sourceSolutions.language ?? [])[index] }));
  const runtimes = { 3: ['python', 'python3'], python3: ['python', 'python3'],
    2: ['cpp', 'cpp'], cpp: ['cpp', 'cpp'], 4: ['java', 'java'], java: ['java', 'java'],
    javascript: ['javascript', 'node'], 1: ['python', 'python2'], python: ['python', 'python2'] };
  const priority = ['python3', 'cpp', 'java', 'node', 'python2'];
  const preferred = priority.flatMap(runtime => correct.filter(solution =>
    runtimes[String(solution.language).toLowerCase()]?.[1] === runtime && nonemptyString(solution.solution)))[0];
  assert(preferred && nonemptyString(preferred.solution), 'semantic-corpus-reference-required');
  assert(preferred.solution.length <= 2_000_000, 'semantic-corpus-reference-too-large');
  const [language, runtime] = runtimes[String(preferred.language).toLowerCase()];
  const tests = [];
  for (const [field, visibility] of [['public_tests', 'public'], ['private_tests', 'private'], ['generated_tests', 'private']]) {
    const suite = row[field] ?? {}, inputs = suite.input ?? [], outputs = suite.output ?? [];
    assert(inputs.length === outputs.length, 'semantic-corpus-codecontests-test-pair');
    for (const [index, input] of inputs.entries()) tests.push({ kind: 'stdio', visibility, input, output: outputs[index], provenanceField: field });
  }
  assert(tests.length > 0, 'semantic-corpus-tests-required');
  const identity = row.cf_contest_id && row.cf_index ? 'codeforces:' + row.cf_contest_id + ':' + row.cf_index
    : 'codecontests:' + hash([row.name, row.description]).slice(0, 24);
  const upstreamId = row.cf_contest_id && row.cf_index ? 'cf-' + row.cf_contest_id + '-' + row.cf_index : 'cc-' + hash(row).slice(0, 20);
  return { relativeId: relativeId ?? upstreamId, upstreamId, sourceIdentity: identity, split, prompt: row.description,
    reference: { language, runtime, source: preferred.solution }, tests,
    publicContract: { kind: 'stdio', adapter: runtime + '-stdin-stdout' }, acceptanceCriteria: ['The official contest I/O tests must pass.'],
    taskKind: 'stdio-program',
    provenance: { shard, rowIndex, sourceRowSha256: row.sourceRowSha256 ?? null,
      upstreamName: row.name ?? null, cfContestId: row.cf_contest_id ?? null, cfIndex: row.cf_index ?? null } };
}

/** Seal an extracted shard list into one canonical record file plus a conversion receipt. */
/** Group exact and near-duplicate prompts into reviewable whole families. */
export function buildCodeContestsFamilyReview({ index, prompts = null }) {
  assert(Array.isArray(index) && index.length > 0, 'codecontests-family-index-required');
  const normalized = row => String(row.prompt ?? '').normalize('NFKC').replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim().toLowerCase();
  const groups = new Map(), ids = new Set();
  for (const row of index) {
    assert(row && nonemptyString(row.upstreamId) && nonemptyString(row.promptDigest), 'codecontests-family-index-row');
    assert(!ids.has(row.upstreamId), 'codecontests-family-duplicate-id'); ids.add(row.upstreamId);
    const prompt = prompts ? prompts[row.upstreamId] : null;
    const key = prompt ? hash(normalized({ prompt })) : row.promptDigest;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ upstreamId: row.upstreamId, sourceIdentity: row.sourceIdentity, title: row.title ?? null, shard: row.shard,
      rowIndex: row.rowIndex, sourceRowSha256: row.sourceRowSha256, runtime: row.runtime, promptDigest: row.promptDigest,
      referenceDigest: row.referenceDigest, testsDigest: row.testsDigest });
  }
  const families = [...groups].map(([key, members]) => {
    const promptDigests = [...new Set(members.map(member => member.promptDigest))].sort();
    return { familyId: 'codecontests-' + key.slice(0, 24), upstreamIds: members.map(member => member.upstreamId).sort(),
      basis: promptDigests.length > 1
        ? 'Exact normalized prompt text; the upstream records retain multiple prompt digests and are reviewed as one variant family.'
        : 'Exact normalized prompt text with one upstream prompt digest.',
      review: { mode: prompts ? 'normalized-prompt' : 'prompt-digest', basisSize: members.length, promptDigests } };
  }).sort((left, right) => left.familyId.localeCompare(right.familyId));
  return { schemaVersion: 'RsiSemanticFamilyReview/v1', driven_by: 'agent', actor: 'codex/rsi-codecontests-family-review',
    realHumanEvidence: false, method: prompts ? 'NFKC + whitespace-normalized exact prompt text' : 'upstream prompt digest',
    completeWithinImport: true, counts: { records: index.length, families: families.length,
      variantFamilies: families.filter(family => family.upstreamIds.length > 1).length }, families };
}
export function buildCodeContestsCanonicalCorpus({ shards, split = 'validation' }) {
  assert(Array.isArray(shards) && shards.length > 0, 'semantic-corpus-shards-required');
  const records = [], rejected = [], seen = new Set(), shardReceipts = [];
  const ids = new Set();
  for (const shard of shards) {
    assert(shard && typeof shard.name === 'string' && SHA256.test(shard.sha256 ?? '') && Array.isArray(shard.rows), 'semantic-corpus-shard');
    assert(!ids.has(shard.sha256), 'semantic-corpus-duplicate-shard');
    ids.add(shard.sha256);
    let accepted = 0;
    for (const [index, row] of shard.rows.entries()) {
      try {
        const record = canonicalizeCodeContestsRow(row, { split, shard: shard.name, rowIndex: index });
        assert(!seen.has(record.upstreamId), 'semantic-corpus-duplicate-upstream-id');
        seen.add(record.upstreamId); records.push(record); accepted += 1;
      } catch (error) { rejected.push({ shard: shard.name, rowIndex: index, code: error.message }); }
    }
    shardReceipts.push({ name: shard.name, sha256: shard.sha256, bytes: shard.bytes ?? null, rows: shard.rows.length, accepted, rejected: shard.rows.length - accepted });
  }
  records.sort((left, right) => left.upstreamId.localeCompare(right.upstreamId));
  return { schemaVersion: 'RsiSemanticCanonicalCorpus/v1', driven_by: 'agent', actor: 'codex/rsi-semantic-corpus-convert',
    realHumanEvidence: false, split, shards: shardReceipts, records, rejected,
    counts: { rows: shardReceipts.reduce((sum, shard) => sum + shard.rows, 0), accepted: records.length, rejected: rejected.length } };
}
function loadJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  assert(!existsSync(path), 'semantic-corpus-output-exists'); writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function runSemanticCorpusImport(argv = process.argv.slice(2)) {
  const args = parseArgs({ args: argv, allowPositionals: true, options: { input: { type: 'string' }, source: { type: 'string' },
    families: { type: 'string' }, output: { type: 'string' }, split: { type: 'string' }, actor: { type: 'string' },
    'function-adapter': { type: 'string' }, 'stdio-adapter': { type: 'string' }, 'require-formal': { type: 'boolean', default: false }, 'accepted-digests': { type: 'string' }, 'skip-shape-distinct': { type: 'boolean', default: false }, 'v2-output': { type: 'string' } } });
  assert(args.positionals[0] === 'apps-jsonl' || args.positionals[0] === 'codecontests-json' || args.positionals[0] === 'canonical-json', 'semantic-corpus-import-command');
  assert(args.values.input && args.values.source && args.values.output, 'semantic-corpus-input-source-output-required');
  assert(args.values['function-adapter'] === undefined || args.positionals[0] === 'apps-jsonl', 'semantic-corpus-apps-function-adapter');
  assert(args.values['stdio-adapter'] === undefined || args.positionals[0] === 'apps-jsonl', 'semantic-corpus-apps-stdio-adapter');
  const inputBytes = readFileSync(args.values.input), text = inputBytes.toString('utf8'), source = loadJson(args.values.source);
  assert(source.fileSha256 === hash(inputBytes), 'semantic-corpus-source-file-sha256');
  let parsed;
  if (args.positionals[0] === 'apps-jsonl') parsed = parseAppsJsonl(text, { split: args.values.split ?? 'validation',
    functionAdapter: args.values['function-adapter'], stdioAdapter: args.values['stdio-adapter'] });
  else if (args.positionals[0] === 'codecontests-json') parsed = parseCodeContestsJson(text, { split: args.values.split ?? 'validation' });
  else { const input = JSON.parse(text); parsed = { records: input.records ?? input, rejected: input.rejected ?? [] }; }
  const families = args.values.families ? loadJson(args.values.families) : undefined;
  const acceptedRecordDigests = args.values['accepted-digests'] ? new Set(loadJson(args.values['accepted-digests'])) : null;
  const result = importSemanticCorpus({ source, records: parsed.records, families, actor: args.values.actor, acceptedRecordDigests,
    enforceDistinctImplementation: !args.values['skip-shape-distinct'],
    requiredFamiliesPerSplit: args.values['require-formal'] ? SEMANTIC_IMPORT_REQUIRED_FAMILIES_PER_SPLIT : 0 });
  const adapter = SOURCE_ADAPTERS[args.positionals[0]];
  result.source.inputFormat = args.positionals[0];
  result.adapter = adapter;
  if (args.values['function-adapter'] === 'json-stdio') result.source.functionAdapter = 'json-stdio';
  if (args.values['stdio-adapter'] === 'newline-lines') result.source.stdioAdapter = 'newline-lines';
  result.rejectedInputs = parsed.rejected;
  writeJson(args.values.output, result);
  if (args.values['v2-output']) writeJson(args.values['v2-output'], freezeSemanticIndependentCasesV2(result));
  return { output: args.values.output, counts: result.counts, formalPopulationReady: result.formalPopulationReady, gaps: result.gaps };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(runSemanticCorpusImport())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
