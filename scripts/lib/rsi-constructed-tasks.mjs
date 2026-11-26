import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { benefitDigest } from './rsi-benefit-eval.mjs';
import { FILE_WRITE_CODING_COLLECTOR, GUIDED_TOOL_CODING_COLLECTOR, PUBLIC_ERROR_CONVENTION, TERMINAL_CODING_COLLECTOR } from './rsi-coding-protocol.mjs';
import { CODING_BINDINGS_PATH, HISTORICAL_CORPUS_PATH, resolveHistoricalTask } from './rsi-live-grader.mjs';

export const codingFileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const codingGit = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
export const readCodingJson = path => JSON.parse(readFileSync(path, 'utf8'));
export function writeCodingJson(path, value) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function codingTempPath(directory) {
  const full = resolve(directory), part = relative(resolve('D:/tmp'), full);
  assert(part && !part.startsWith('..') && !part.includes(':'), 'coding-study-requires-D-tmp'); return full;
}
const target = item => 'src/' + item.name + '.mjs';
const declaration = item => 'src/' + item.name + '.d.mts';
const test = item => 'tests/unit/' + item.name + '.test.mjs';
const baseline = (item, index) => index % 2 ? `export function ${item.name}() { throw new Error('unimplemented'); }\n` : null;
const testSource = item => `import {it,expect} from 'vitest';\nimport {${item.name} as subject} from '../../${target(item)}';\nconst vectors=JSON.parse(${JSON.stringify(JSON.stringify(item.vectors))});\nfor(const [index,v] of vectors.entries()) it('contract-'+index,()=>{const args=structuredClone(v.args);if(v.throws)expect(()=>subject(...args)).toThrow();else expect(subject(...args)).toEqual(v.expected);expect(args).toEqual(v.args);});\n`;
const configSource = "export default {test:{environment:'node',include:['tests/unit/*.test.mjs'],maxWorkers:1}};\n";
function publicProjection(item, source, pack) {
  const updated = pack.schemaVersion === 'RsiIndependentCodingCases/v2';
  return { prompt: item.prompt, acceptanceCriteria: ['Implement the stated contract without input mutation or external effects.'],
    ...(updated ? { errorConvention: pack.publicErrorConvention } : {}),
    targetScope: [target(item)], taskKind: 'module-implementation', responseSchema: GUIDED_TOOL_CODING_COLLECTOR.responseSchema,
    publicContract: { protocol: updated ? 'RsiCodingTaskInputs/v2' : 'RsiCodingTaskInputs/v1', declarations: [{ path: declaration(item), content: item.declaration + '\n' }],
      document: { format: 'markdown', taskSpecFields: [], lifecycleStates: [], sourceOfTruth: 'independent-public-contract' } },
    baseFiles: [{ path: target(item), content: source, ...(source === null ? { missing: true } : {}) }], omittedContext: [] };
}

/** Evaluator-owned cases are committed before any subject request is built. */
function selectedCollector(pack, requested) {
  const legacy = pack.schemaVersion === 'RsiIndependentCodingCases/v2' ? TERMINAL_CODING_COLLECTOR.version : GUIDED_TOOL_CODING_COLLECTOR.version;
  const version = requested ?? legacy;
  assert(version === legacy || pack.schemaVersion === 'RsiIndependentCodingCases/v2' && version === FILE_WRITE_CODING_COLLECTOR.version,
    'constructed-protocol-selection');
  return version;
}
export function createConstructedTasks(root, directory, pack, collectorVersion) {
  directory = codingTempPath(directory);
  assert(['RsiIndependentCodingCases/v1', 'RsiIndependentCodingCases/v2'].includes(pack.schemaVersion) && pack.driven_by === 'agent', 'constructed-pack-version');
  if (pack.schemaVersion === 'RsiIndependentCodingCases/v2') assert.equal(pack.publicErrorConvention, PUBLIC_ERROR_CONVENTION, 'public-error-convention-required');
  const selectedVersion = selectedCollector(pack, collectorVersion);
  assert(Array.isArray(pack.cases) && pack.cases.length > 0, 'constructed-cases-required');
  const ids = new Set(), names = new Set();
  for (const item of pack.cases) {
    assert(/^[a-z][a-z0-9-]{2,100}$/u.test(item.id) && !ids.has(item.id), 'constructed-case-id'); ids.add(item.id);
    assert(/^[a-zA-Z][a-zA-Z0-9]{2,60}$/u.test(item.name) && !names.has(item.name), 'constructed-target-name'); names.add(item.name);
    assert(['validation', 'heldOut'].includes(item.split) && typeof item.prompt === 'string' && item.prompt.length > 40, 'constructed-case-contract');
    assert(typeof item.reference === 'string' && typeof item.declaration === 'string'
      && Array.isArray(item.vectors) && item.vectors.length >= 5, 'constructed-case-oracle');
    assert([null, undefined, 'positive', 'negative'].includes(item.anchor), 'constructed-anchor');
  }
  const repository = join(directory, 'task-repository'); assert(!existsSync(repository), 'new-task-repository-required');
  mkdirSync(repository, { recursive: true }); codingGit(repository, ['init', '--quiet']); codingGit(repository, ['config', 'core.autocrlf', 'false']);
  const put = (path, content) => { mkdirSync(dirname(join(repository, path)), { recursive: true }); writeFileSync(join(repository, path), content); };
  put('.gitignore', 'node_modules/\n'); put('package.json', '{"name":"rsi-independent-coding-cases","private":true,"type":"module"}\n');
  put('vitest.config.mjs', configSource);
  const starts = new Map();
  for (const [index, item] of pack.cases.entries()) {
    const source = baseline(item, index);
    starts.set(item.id, source); if (source !== null) put(target(item), source); put(declaration(item), item.declaration + '\n');
    put(test(item), testSource(item));
  }
  const commit = message => {
    codingGit(repository, ['add', '.']); codingGit(repository, ['-c', 'user.name=RSI evaluator', '-c', 'user.email=rsi-evaluator@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message]); return codingGit(repository, ['rev-parse', 'HEAD']);
  };
  const base = commit('Freeze constructed coding baselines and independent tests');
  for (const item of pack.cases) put(target(item), item.reference);
  const reference = commit('Freeze independent reference implementations');
  const tasks = [], records = [];
  for (const item of pack.cases) {
    const recordPath = 'harness/specs/fixtures/independent-coding-records/' + item.id + '.json';
    writeCodingJson(join(repository, recordPath), { driven_by: 'agent', actor: pack.actor, constructedTask: true,
      provenance: item.provenance ?? null, candidate: { base, commit: reference } });
    const oracleTestDigests = { [test(item)]: codingFileHash(join(repository, test(item))), 'vitest.config.mjs': codingFileHash(join(repository, 'vitest.config.mjs')) };
    const command = 'vitest run --config vitest.config.mjs ' + test(item);
    const oracle = { commandLine: command, testPaths: Object.keys(oracleTestDigests), inputDigests: oracleTestDigests, expectedSkips: 0 };
    const publicInput = publicProjection(item, starts.get(item.id), pack);
    records.push({ id: item.id, sourceTaskId: item.id, input: { prompt: item.prompt, targetScope: publicInput.targetScope }, oracle,
      referenceSolution: { sourceRecord: recordPath, sourceRecordSha256: codingFileHash(join(repository, recordPath)), referenceCommit: reference } });
    tasks.push({ id: item.id, taskId: item.id, split: 'public', studySplit: item.split, safetyRequired: item.safetyRequired === true,
      anchor: item.anchor ?? null, negativeExpectedOutcome: 'pass', prompt: item.prompt, acceptanceCriteria: publicInput.acceptanceCriteria,
      targetScope: publicInput.targetScope, source: { recordPath, recordDigest: codingFileHash(join(repository, recordPath)), base, reference }, baselineSetup: null,
      oracleDigest: benefitDigest(oracle), oracle: { ...oracle, commands: [command] }, oracleTestDigests,
      publicInput, publicInputDigest: benefitDigest(publicInput), publicInputSources: [] });
  }
  writeCodingJson(join(repository, HISTORICAL_CORPUS_PATH), { schemaVersion: 'RsiConstructedStudyRegistry/v1', driven_by: 'agent', tasks: records });
  writeCodingJson(join(repository, CODING_BINDINGS_PATH), { schemaVersion: 'RsiCodingTaskBindings/v1', driven_by: 'agent', tasks: [] });
  const registryCommit = commit('Bind independent task and oracle identities');
  symlinkSync(join(root, 'node_modules'), join(repository, 'node_modules'), 'junction');
  for (const task of tasks) {
    const actual = resolveHistoricalTask(repository, task.id, { codingCohort: true });
    assert.equal(actual.oracleRevision, reference, 'constructed-oracle-binding');
  }
  return { repository, tasks, registryCommit, packDigest: benefitDigest(pack),
    collectorVersion: selectedVersion };
}

/** Check the task registry against evaluator-owned source bytes, not its own seal. */
export function verifyConstructedTasks(registry, pack, expectedCollectorVersion) {
  if (pack.schemaVersion === 'RsiIndependentCodingCases/v2') assert.equal(pack.publicErrorConvention, PUBLIC_ERROR_CONVENTION, 'public-error-convention-drift');
  assert.equal(registry.packDigest, benefitDigest(pack), 'constructed-pack-drift');
  assert.equal(registry.collectorVersion, selectedCollector(pack, expectedCollectorVersion), 'constructed-protocol-binding');
  assert.deepEqual(registry.tasks.map(task => task.id), pack.cases.map(item => item.id), 'constructed-case-order');
  const repository = registry.repository, base = registry.tasks[0].source.base, reference = registry.tasks[0].source.reference;
  const format = codingGit(repository, ['rev-parse', '--show-object-format']); assert(['sha1', 'sha256'].includes(format));
  const tree = revision => Object.fromEntries(execFileSync('git', ['-C', repository, 'ls-tree', '-rz', revision], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
    .split('\0').filter(Boolean).map(line => { const [meta, path] = line.split('\t'); return [path, meta.split(' ').at(-1)]; }));
  const baseTree = tree(base), referenceTree = tree(reference);
  const blob = content => createHash(format).update('blob ' + Buffer.byteLength(content) + '\0').update(content).digest('hex');
  const sha = content => createHash('sha256').update(content).digest('hex');
  for (const [index, item] of pack.cases.entries()) {
    const task = registry.tasks[index], source = baseline(item, index), publicInput = publicProjection(item, source, pack);
    assert.equal(task.source.base, base); assert.equal(task.source.reference, reference);
    assert.equal(referenceTree[target(item)], blob(item.reference), 'constructed-reference-drift');
    assert.equal(baseTree[target(item)] ?? null, source === null ? null : blob(source), 'constructed-baseline-drift');
    for (const [path, content] of [[declaration(item), item.declaration + '\n'], [test(item), testSource(item)], ['vitest.config.mjs', configSource]]) {
      assert.equal(baseTree[path], blob(content), 'constructed-baseline-contract-drift');
      assert.equal(referenceTree[path], blob(content), 'constructed-reference-contract-drift');
    }
    const recordPath = 'harness/specs/fixtures/independent-coding-records/' + item.id + '.json';
    const record = { driven_by: 'agent', actor: pack.actor, constructedTask: true, provenance: item.provenance ?? null, candidate: { base, commit: reference } };
    const recordDigest = sha(JSON.stringify(record, null, 2) + '\n');
    assert.equal(task.source.recordPath, recordPath); assert.equal(task.source.recordDigest, recordDigest);
    assert.equal(codingFileHash(join(repository, recordPath)), recordDigest, 'constructed-source-record-drift');
    const oracleTestDigests = { [test(item)]: sha(testSource(item)), 'vitest.config.mjs': sha(configSource) };
    const command = 'vitest run --config vitest.config.mjs ' + test(item);
    const oracle = { commandLine: command, testPaths: Object.keys(oracleTestDigests), inputDigests: oracleTestDigests, expectedSkips: 0 };
    const expected = { id: item.id, taskId: item.id, split: 'public', studySplit: item.split, safetyRequired: item.safetyRequired === true,
      anchor: item.anchor ?? null, negativeExpectedOutcome: 'pass', prompt: item.prompt, acceptanceCriteria: publicInput.acceptanceCriteria,
      targetScope: publicInput.targetScope, source: { recordPath, recordDigest, base, reference }, baselineSetup: null,
      oracleDigest: benefitDigest(oracle), oracle: { ...oracle, commands: [command] }, oracleTestDigests,
      publicInput, publicInputDigest: benefitDigest(publicInput), publicInputSources: [] };
    assert.deepEqual(task, expected, 'constructed-task-binding-drift');
  }
  return true;
}
