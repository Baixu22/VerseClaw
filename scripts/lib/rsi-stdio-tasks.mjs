import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { benefitDigest } from './rsi-benefit-eval.mjs';
import { codingFileHash, codingGit, codingTempPath, writeCodingJson as write } from './rsi-constructed-tasks.mjs';
import { GUIDED_TOOL_CODING_COLLECTOR } from './rsi-coding-protocol.mjs';
import { materializeNativeChecker, runNativeCheckerCase, NATIVE_CHECKER_VERSION } from './rsi-native-checker.mjs';
import { ISOLATED_PYTHON_VERSION, validateIsolatedPython, runIsolatedPythonCase } from './rsi-isolated-python.mjs';

const CODING_BINDINGS_PATH = 'harness/specs/fixtures/rsi-coding-cohort/task-bindings.v1.json';
const HISTORICAL_CORPUS_PATH = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
export const STDIO_COLLECTOR_VERSION = 'RsiCodingCollector/v7';
export const CXX_INCLUDE_SHIM = [
  '#pragma once', '#include <algorithm>', '#include <array>', '#include <bitset>', '#include <cassert>',
  '#include <cctype>', '#include <cerrno>', '#include <cfloat>', '#include <chrono>', '#include <climits>',
  '#include <cmath>', '#include <complex>', '#include <cstdio>', '#include <cstdlib>', '#include <cstring>',
  '#include <deque>', '#include <functional>', '#include <iomanip>', '#include <iostream>', '#include <iterator>',
  '#include <limits>', '#include <list>', '#include <map>', '#include <numeric>', '#include <queue>',
  '#include <random>', '#include <set>', '#include <sstream>', '#include <stack>', '#include <string>',
  '#include <tuple>', '#include <type_traits>', '#include <unordered_map>', '#include <unordered_set>',
  '#include <utility>', '#include <valarray>', '#include <vector>', ''].join('\n');

const sourcePath = item => 'src/' + item.id + (item.runtime === 'cpp' ? '.cpp' : '.py');
const oraclePath = item => 'oracles/' + item.id + '.json';
const publicIdentity = item => ({ id: item.id, runtime: item.runtime,
  ...(item.privatePython ? { pythonVersion: item.privatePython.pythonVersion, declaration: item.declaration } : {}),
  ...(item.cppToolchain ? { cppToolchain: item.cppToolchain, compilerVersion: item.compilerVersion } : {}) });
export const normalizeStdio = value => String(value ?? '').replace(/\r\n?/gu, '\n').split('\n')
  .map(line => line.trimEnd()).join('\n').trim();
class JsonNumber {
  constructor(source) { this.canonical = canonicalJsonNumber(source); }
}

function canonicalJsonNumber(source) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(source);
  assert(match, 'stdio-json-number-source-invalid');
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+/u, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/u, '');
  const trailingZeros = digits.length - significant.length;
  const exponent = BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailingZeros);
  return `${match[1]}${significant}e${exponent}`;
}

function parseJsonForComparison(value) {
  return JSON.parse(String(value), (_key, parsed, context) => {
    if (typeof parsed !== 'number') return parsed;
    assert(typeof context?.source === 'string', 'stdio-json-number-source-required');
    return new JsonNumber(context.source);
  });
}

export function stdioOutputMatches(actual, expected, comparison = undefined) {
  if (comparison !== 'json') return normalizeStdio(actual) === normalizeStdio(expected);
  try { return isDeepStrictEqual(parseJsonForComparison(actual), parseJsonForComparison(expected)); }
  catch { return false; }
}

export function stdioPublicProjection(item) {
  const target = item.target ?? sourcePath(item);
  return { prompt: item.prompt, acceptanceCriteria: ['Implement the stated stdin/stdout contract in the requested language.'],
    targetScope: [target], taskKind: 'stdio-program', language: item.runtime === 'python3' ? 'python' : item.runtime,
    runtime: item.runtime, ...(item.cppToolchain ? { cppToolchain: item.cppToolchain, compilerVersion: item.compilerVersion } : {}),
    ...(item.privatePython || item.pythonVersion ? { pythonVersion: item.privatePython?.pythonVersion ?? item.pythonVersion } : {}),
    responseSchema: GUIDED_TOOL_CODING_COLLECTOR.responseSchema,
    publicContract: { protocol: 'RsiCodingTaskInputs/v2', declarations: [{ path: target, content: item.declaration }],
      document: { format: 'plain-text', taskSpecFields: [], lifecycleStates: [], sourceOfTruth: 'independent-public-contract' } },
    baseFiles: [{ path: target, content: null, missing: true }], omittedContext: [] };
}

export function createStdioTasks(directory, pack) {
  directory = codingTempPath(directory);
  assert(pack.schemaVersion === 'RsiIndependentCodingCases/v2' && pack.datasetVersion === 'RsiSemanticIndependentCases/v2'
    && pack.executionKind === 'stdio-program' && pack.driven_by === 'agent', 'stdio-pack-version');
  const ids = new Set();
  for (const item of pack.cases) {
    assert(!ids.has(item.id) && ['python3', 'cpp'].includes(item.runtime) && Array.isArray(item.vectors) && item.vectors.length > 0,
      'stdio-case-required'); ids.add(item.id);
    assert(item.vectors.every(test => test.kind === 'stdio' && typeof test.input === 'string' && typeof test.output === 'string'),
      'stdio-official-tests-required');
    assert(item.vectors.every(test => test.comparison === undefined || test.comparison === 'json'), 'stdio-comparison-mode');
    if (item.cppToolchain) assert(item.runtime === 'cpp' && ['clang-libc++', 'gcc-libstdc++'].includes(item.cppToolchain)
      && typeof item.compilerVersion === 'string' && item.compilerVersion.trim(), 'stdio-frozen-toolchain-required');
    if (item.nativeChecker) {
      materializeNativeChecker(item, () => {});
    }
    if (item.privatePython) {
      validateIsolatedPython(item.privatePython, item.reference);
      assert(item.runtime === 'python3' && !item.nativeChecker && item.vectors.every(test => test.comparison === undefined),
        'stdio-isolated-python-contract');
    }
  }
  const repository = join(directory, 'task-repository'); assert(!existsSync(repository), 'new-task-repository-required');
  mkdirSync(repository, { recursive: true }); codingGit(repository, ['init', '--quiet']); codingGit(repository, ['config', 'core.autocrlf', 'false']);
  const put = (path, content) => { mkdirSync(dirname(join(repository, path)), { recursive: true }); writeFileSync(join(repository, path), content); };
  put('.gitignore', 'node_modules/\n');
  if (pack.cases.some(item => item.runtime === 'cpp')) put('shim/bits/stdc++.h', CXX_INCLUDE_SHIM);
  for (const item of pack.cases) put('public/' + item.id + '.json', JSON.stringify(publicIdentity(item), null, 2) + '\n');
  const commit = message => {
    codingGit(repository, ['add', '.']); codingGit(repository, ['-c', 'user.name=RSI evaluator', '-c', 'user.email=rsi-evaluator@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message]); return codingGit(repository, ['rev-parse', 'HEAD']);
  };
  const base = commit('Freeze public stdin/stdout task baselines');
  const checkers = new Map();
  for (const item of pack.cases) {
    put(sourcePath(item), item.reference);
    const nativeChecker = item.nativeChecker ? materializeNativeChecker(item, put) : null;
    if (nativeChecker) checkers.set(item.id, nativeChecker);
    write(join(repository, oraclePath(item)), { tests: item.vectors, ...(nativeChecker ? { nativeChecker } : {}),
      ...(item.privatePython ? { privatePython: item.privatePython } : {}) });
  }
  const reference = commit('Freeze independent stdin/stdout references and private official tests');
  const tasks = [], records = [];
  for (const item of pack.cases) {
    const recordPath = 'harness/specs/fixtures/independent-coding-records/' + item.id + '.json';
    write(join(repository, recordPath), { driven_by: 'agent', actor: pack.actor, constructedTask: true,
      provenance: item.provenance, candidate: { base, commit: reference } });
    const oracleTestDigests = { [oraclePath(item)]: codingFileHash(join(repository, oraclePath(item))),
      ['public/' + item.id + '.json']: codingFileHash(join(repository, 'public/' + item.id + '.json')) };
    if (item.runtime === 'cpp') oracleTestDigests['shim/bits/stdc++.h'] = codingFileHash(join(repository, 'shim/bits/stdc++.h'));
    const nativeChecker = checkers.get(item.id);
    if (nativeChecker) for (const path of Object.keys(nativeChecker.sourceFilesSha256)) {
      const privatePath = nativeChecker.basePath + '/' + path;
      oracleTestDigests[privatePath] = codingFileHash(join(repository, privatePath));
    }
    const oracle = { kind: 'stdio', commandLine: 'internal:stdio-oracle', testPaths: Object.keys(oracleTestDigests),
      inputDigests: oracleTestDigests, expectedSkips: 0,
      ...(nativeChecker ? { comparisonProtocol: NATIVE_CHECKER_VERSION, nativeCheckerDigest: benefitDigest(nativeChecker) } : {}),
      ...(item.privatePython ? { comparisonProtocol: ISOLATED_PYTHON_VERSION, privatePythonDigest: benefitDigest(item.privatePython) } : {}) };
    const publicInput = stdioPublicProjection({ ...item, prompt: item.prompt, target: publicTarget(item) });
    const quality = { safetyRequired: item.safetyRequired === true, anchor: item.anchor ?? null,
      negativeExpectedOutcome: item.negativeExpectedOutcome ?? 'pass' };
    records.push({ id: item.id, sourceTaskId: item.id, input: { prompt: item.prompt, targetScope: publicInput.targetScope }, oracle,
      ...quality,
      referenceSolution: { sourceRecord: recordPath, sourceRecordSha256: codingFileHash(join(repository, recordPath)), referenceCommit: reference } });
    tasks.push({ id: item.id, taskId: item.id, split: 'public', studySplit: item.split, ...quality,
      prompt: item.prompt, acceptanceCriteria: publicInput.acceptanceCriteria,
      targetScope: publicInput.targetScope, source: { recordPath, recordDigest: codingFileHash(join(repository, recordPath)), base, reference }, baselineSetup: null,
      oracleDigest: benefitDigest(oracle), oracle: { ...oracle, commands: [oracle.commandLine] }, oracleTestDigests,
      publicInput, publicInputDigest: benefitDigest(publicInput), publicInputSources: [] });
  }
  write(join(repository, HISTORICAL_CORPUS_PATH), { schemaVersion: 'RsiConstructedStudyRegistry/v1', driven_by: 'agent', tasks: records });
  write(join(repository, CODING_BINDINGS_PATH), { schemaVersion: 'RsiCodingTaskBindings/v1', driven_by: 'agent', tasks: [] });
  const registryCommit = commit('Bind stdin/stdout task and oracle identities');
  return { repository, tasks, registryCommit, packDigest: benefitDigest(pack), collectorVersion: STDIO_COLLECTOR_VERSION };
}

const publicTarget = item => sourcePath(item);

export function verifyStdioTasks(registry, pack) {
  assert.equal(registry.packDigest, benefitDigest(pack), 'stdio-pack-drift');
  assert.equal(registry.collectorVersion, STDIO_COLLECTOR_VERSION, 'stdio-collector-binding');
  assert.deepEqual(registry.tasks.map(task => task.id), pack.cases.map(item => item.id), 'stdio-case-order');
  const format = codingGit(registry.repository, ['rev-parse', '--show-object-format']);
  const blob = content => createHash(format).update('blob ' + Buffer.byteLength(content) + '\0').update(content).digest('hex');
  const tree = revision => Object.fromEntries(codingGitLines(registry.repository, ['ls-tree', '-rz', revision])
    .map(line => { const [meta, path] = line.split('\t'); return [path, meta.split(' ').at(-1)]; }));
  const base = tree(registry.tasks[0].source.base), reference = tree(registry.registryCommit);
  assert.equal(registry.registryCommit, codingGit(registry.repository, ['rev-parse', 'HEAD']), 'stdio-registry-head');
  for (const [index, item] of pack.cases.entries()) {
    const task = registry.tasks[index], source = sourcePath(item), oracle = oraclePath(item);
    const recordPath = 'harness/specs/fixtures/independent-coding-records/' + item.id + '.json';
    assert.equal(task.source.recordDigest, codingFileHash(join(registry.repository, recordPath)), 'stdio-source-record');
    assert.equal(reference['public/' + item.id + '.json'], blob(JSON.stringify(publicIdentity(item), null, 2) + '\n'), 'stdio-runtime-binding');
    assert(base[source] === undefined && reference[source] === blob(item.reference), 'stdio-reference-drift');
    const nativeChecker = item.nativeChecker ? materializeNativeChecker(item, () => {}) : null;
    assert.equal(reference[oracle], blob(JSON.stringify({ tests: item.vectors, ...(nativeChecker ? { nativeChecker } : {}),
      ...(item.privatePython ? { privatePython: item.privatePython } : {}) }, null, 2) + '\n'), 'stdio-oracle-drift');
    if (item.privatePython) {
      validateIsolatedPython(item.privatePython, item.reference);
      assert.equal(task.oracle.comparisonProtocol, ISOLATED_PYTHON_VERSION, 'stdio-isolated-python-protocol');
      assert.equal(task.oracle.privatePythonDigest, benefitDigest(item.privatePython), 'stdio-isolated-python-digest');
      assert.equal(task.publicInput.pythonVersion, item.privatePython.pythonVersion, 'stdio-isolated-python-public-version');
    }
    if (nativeChecker) {
      assert.equal(task.oracle.comparisonProtocol, NATIVE_CHECKER_VERSION, 'stdio-native-checker-protocol');
      assert.equal(task.oracle.nativeCheckerDigest, benefitDigest(nativeChecker), 'stdio-native-checker-digest');
      for (const [path, content] of Object.entries(item.nativeChecker.sourceFiles)) {
        assert(base[nativeChecker.basePath + '/' + path] === undefined, 'stdio-baseline-checker-leak');
        assert.equal(reference[nativeChecker.basePath + '/' + path], blob(content), 'stdio-native-checker-source');
        if (content.trim()) assert(!JSON.stringify(task.publicInput).includes(content.trim()), 'stdio-public-checker-leak');
      }
    }
    assert.equal(task.publicInput.taskKind, 'stdio-program', 'stdio-public-contract');
    assert.equal(task.publicInput.cppToolchain, item.cppToolchain, 'stdio-public-toolchain');
    assert.equal(task.publicInput.compilerVersion, item.compilerVersion, 'stdio-public-compiler-version');
    assert.equal(task.safetyRequired, item.safetyRequired === true, 'stdio-safety-binding');
    assert.equal(task.anchor, item.anchor ?? null, 'stdio-anchor-binding');
    assert(!JSON.stringify(task.publicInput).includes(item.reference), 'stdio-public-reference-leak');
    assert(!item.vectors.some(test => JSON.stringify(task.publicInput).includes(JSON.stringify(test))), 'stdio-public-test-leak');
    for (const [path, digest] of Object.entries(task.oracleTestDigests)) assert.equal(codingFileHash(join(registry.repository, path)), digest, 'stdio-oracle-input');
  }
  return true;
}

const codingGitLines = (repository, args) => {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || 'git-read-failed');
  return result.stdout.split('\0').filter(Boolean);
};

export function runStdioCase(item, source, { timeoutMs = 10000, python = process.env.RSI_PYTHON ?? 'python',
  cxx = process.env.RSI_CXX ?? 'C:/Program Files/LLVM/bin/clang++.exe' } = {}) {
  if (item.privatePython) return runIsolatedPythonCase(item, source, { timeoutMs });
  const root = resolve(dirname(source), '..'), output = join(root, 'program.exe');
  let command = [python, source], compileError = null;
  if (item.runtime === 'cpp') {
    const compiled = spawnSync(cxx, ['-std=c++17', '-O2', '-I', join(root, 'shim'), source, '-o', output],
      { encoding: 'utf8', windowsHide: true, cwd: root, timeout: Math.max(timeoutMs, 30000) });
    if (compiled.error || compiled.status !== 0) compileError = (compiled.error?.message ?? compiled.stderr ?? '').slice(0, 2000);
    else command = [output];
  }
  const results = [];
  if (!compileError) for (const [index, test] of item.vectors.entries()) {
    const result = spawnSync(command[0], command.slice(1), { input: test.input, encoding: 'utf8', windowsHide: true, cwd: root,
      timeout: timeoutMs, env: { ...process.env, PYTHONIOENCODING: 'utf-8', TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
    const timedOut = result.error?.code === 'ETIMEDOUT';
    const passed = !result.error && stdioOutputMatches(result.stdout, test.output, test.comparison);
    results.push({ index, testId: test.testId ?? null, ...(test.comparison ? { comparison: test.comparison } : {}), passed, timedOut,
      exitCode: result.status, error: result.error?.message ?? null, stdoutDigest: benefitDigest(result.stdout ?? ''), stderrDigest: benefitDigest(result.stderr ?? '') });
  }
  return { schemaVersion: 'RsiStdioOracleReport/v1', caseId: item.id, runtime: item.runtime, compileError,
    exitCodePolicy: 'normalized-output-match; process exit code is retained',
    ...(item.vectors.some(test => test.comparison === 'json') ? { outputComparison: 'per-vector-json-structural-or-text-normalization' } : {}),
    normalization: 'CRLF->LF, trim trailing whitespace per line, trim final whitespace', results,
    counts: { total: item.vectors.length, passed: results.filter(row => row.passed).length,
      failed: results.filter(row => !row.passed).length, timedOut: results.filter(row => row.timedOut).length },
    passed: !compileError && results.length === item.vectors.length && results.every(row => row.passed) };
}

function wslPath(path) {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(path);
  assert(match, 'stdio-wsl-windows-path');
  return '/mnt/' + match[1].toLowerCase() + '/' + match[2].replaceAll('\\', '/');
}

/** Select a prospective profile from reference syntax before freezing the task. */
export function stdioCppToolchain(source) {
  return /(?:^|\n)\s*(?:bool|char|short|int|long|long long|unsigned|size_t)\s+(?:[A-Za-z_$][\w$]*(?:\s*\[[^\]]*\])?\s*,\s*)*visit\s*\[/u.test(source)
    ? 'gcc-libstdc++' : 'clang-libc++';
}

/** One native worker compiles and runs all tests with separate per-test limits. */
export function runStdioCaseWsl(item, source, { timeoutMs = 10000 } = {}) {
  if (item.nativeChecker) return runNativeCheckerCase(item, source, { timeoutMs });
  const root = resolve(dirname(source), '..');
  const toolchain = item.cppToolchain ?? stdioCppToolchain(readFileSync(source, 'utf8'));
  assert(['clang-libc++', 'gcc-libstdc++'].includes(toolchain), 'stdio-cpp-toolchain');
  const compiler = toolchain === 'gcc-libstdc++' ? 'g++' : 'clang++';
  const worker = fileURLToPath(new URL('../rsi-stdio-wsl-runner.py', import.meta.url));
  const result = spawnSync('C:/Windows/System32/wsl.exe', ['-d', 'Ubuntu-22.04', '--', 'python3', wslPath(worker),
    '--source', wslPath(source), '--shim', wslPath(join(root, 'shim')), '--compiler', compiler,
    '--timeout-ms', String(timeoutMs), ...(item.compilerVersion ? ['--compiler-version', item.compilerVersion] : [])],
    { input: JSON.stringify(item.vectors), encoding: 'utf8', windowsHide: true,
    timeout: Math.max(timeoutMs, 30000) * 2 + item.vectors.length * timeoutMs,
    maxBuffer: 64 * 1024 * 1024, env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  let native;
  try {
    if (result.error || result.status !== 0) {
      const diagnostic = [result.error?.message, result.stderr, result.stdout]
        .map(value => (value ?? '').replaceAll('\0', '').trim()).filter(Boolean).join('\n').slice(0, 2000);
      throw new Error(diagnostic || 'native worker failed (exit ' + result.status + ', signal ' + (result.signal ?? 'none') + ')');
    }
    native = JSON.parse(result.stdout);
    assert(Array.isArray(native?.results) && ['toolchain', 'compile', 'tests'].includes(native.stage)
      && (native.compiler === null || typeof native.compiler === 'string' && native.compiler.trim())
      && (native.compileError === null || typeof native.compileError === 'string' && native.compileError.trim())
      && native.results.length === (native.compileError === null ? item.vectors.length : 0), 'invalid native worker report');
    assert(native.compileError !== null || native.stage === 'tests' && typeof native.compiler === 'string'
      && (!item.compilerVersion || native.compiler === item.compilerVersion), 'native worker compiler binding drift');
    assert(native.results.every(row => typeof row.stdout === 'string' && typeof row.stderr === 'string'
      && typeof row.timedOut === 'boolean' && (row.error === null || typeof row.error === 'string')
      && (row.exitCode === null || Number.isInteger(row.exitCode))), 'invalid native worker test result');
  } catch (error) {
    native = { compileError: error.message, stage: 'worker', compiler: null, results: [] };
  }
  const compileError = native.compileError;
  const results = native.results.map((row, index) => ({ index, testId: item.vectors[index].testId ?? null,
    passed: !row.error && stdioOutputMatches(row.stdout, item.vectors[index].output, item.vectors[index].comparison),
    timedOut: row.timedOut, exitCode: row.exitCode, error: row.error,
    stdoutDigest: benefitDigest(row.stdout), stderrDigest: benefitDigest(row.stderr) }));
  return { schemaVersion: 'RsiStdioOracleReport/v1', caseId: item.id, runtime: item.runtime, compileError,
    exitCodePolicy: 'normalized-output-match; process exit code is retained',
    cppToolchain: toolchain, compiler: native.compiler,
    executionEnvironment: ['worker', 'toolchain'].includes(native.stage) ? 'wsl-unavailable'
      : compiler === 'clang++' ? 'Ubuntu-22.04/WSL2-native-clang-libc++-C++17' : 'Ubuntu-22.04/WSL2-native-gcc-libstdc++-C++17',
    compilerSelection: item.cppToolchain ? 'frozen task profile' : toolchain === 'gcc-libstdc++'
      ? 'global visit name requires GNU libstdc++ to avoid std::visit collision' : 'Clang/libc++ preserves reference semantics',
    sourceCompatibility: 'Linux compile copy: scanf %I64d -> %lld for glibc; frozen source unchanged',
    ...(item.vectors.some(test => test.comparison === 'json') ? { outputComparison: 'per-vector-json-structural-or-text-normalization' } : {}),
    normalization: 'CRLF->LF, trim trailing whitespace per line, trim final whitespace', results,
    counts: { total: item.vectors.length, passed: results.filter(row => row.passed).length,
      failed: results.filter(row => !row.passed).length, timedOut: results.filter(row => row.timedOut).length },
    passed: !compileError && results.length === item.vectors.length && results.every(row => row.passed) };
}
