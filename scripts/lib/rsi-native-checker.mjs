import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { benefitDigest } from './rsi-benefit-eval.mjs';

export const NATIVE_CHECKER_VERSION = 'RsiStdioNativeChecker/v1';
export const NATIVE_CHECKER_PROFILE = Object.freeze({
  compilerFlags: Object.freeze(['-O2', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-result']),
  compileTimeoutMs: 60000, testTimeoutMs: 10000, fileLimitBytes: 16777216,
  addressSpaceBytes: 1073741824, familyTimeoutMs: 1200000,
});
const sha = value => createHash('sha256').update(value).digest('hex');
const relativePath = value => {
  assert(typeof value === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(value)
    && value.split('/').every(part => part !== '.' && part !== '..'), 'native-checker-relative-path');
  return value;
};
const safeFile = (root, path) => {
  path = relativePath(path);
  let current = resolve(root);
  for (const part of path.split('/')) {
    current = join(current, part);
    try { assert(!lstatSync(current).isSymbolicLink(), 'native-checker-symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
};
const put = (root, path, bytes) => {
  const target = safeFile(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
};

export function validateNativeChecker(checker, reference = null) {
  assert(checker?.schemaVersion === NATIVE_CHECKER_VERSION, 'native-checker-version');
  assert(typeof checker.compilerVersion === 'string' && checker.compilerVersion.trim(), 'native-checker-compiler');
  assert(typeof checker.sourceRevision === 'string' && checker.sourceRevision.trim(), 'native-checker-source-revision');
  assert.deepEqual(checker.profile, NATIVE_CHECKER_PROFILE, 'native-checker-resource-profile');
  assert(Array.isArray(checker.includeDirs) && Array.isArray(checker.referenceIncludeDirs), 'native-checker-include-directories');
  relativePath(checker.entryPath);
  for (const path of [...checker.includeDirs, ...checker.referenceIncludeDirs]) relativePath(path);
  const names = Object.keys(checker.sourceFilesSha256);
  assert(names.length > 0 && names.includes(checker.entryPath), 'native-checker-entry-source');
  names.forEach(relativePath);
  assert(names.every(path => /^[a-f0-9]{64}$/u.test(checker.sourceFilesSha256[path])), 'native-checker-source-digest');
  assert(/^[a-f0-9]{64}$/u.test(checker.referenceSha256), 'native-checker-reference-digest');
  if (reference !== null) assert.equal(sha(reference), checker.referenceSha256, 'native-checker-reference-source');
  if (checker.sourceFiles) {
    assert.deepEqual(Object.keys(checker.sourceFiles).sort(), names.sort(), 'native-checker-source-coverage');
    let total = 0;
    for (const [path, content] of Object.entries(checker.sourceFiles)) {
      assert(typeof content === 'string' && Buffer.byteLength(content) <= 4194304, 'native-checker-source-size');
      total += Buffer.byteLength(content);
      assert.equal(sha(content), checker.sourceFilesSha256[path], 'native-checker-source-drift:' + path);
    }
    assert(total <= 16777216, 'native-checker-bundle-size');
  } else relativePath(checker.basePath);
  return checker;
}

export function materializeNativeChecker(item, writeFile) {
  const checker = validateNativeChecker(item.nativeChecker, item.reference);
  assert(checker.sourceFiles, 'native-checker-inline-source-required');
  assert(item.runtime === 'cpp' && item.cppToolchain === 'gcc-libstdc++'
    && item.compilerVersion === checker.compilerVersion, 'native-checker-subject-toolchain');
  assert(item.vectors.every(vector => vector.comparison === undefined), 'native-checker-comparison-exclusive');
  relativePath(item.id);
  const basePath = 'checkers/' + item.id;
  for (const [path, content] of Object.entries(checker.sourceFiles)) writeFile(basePath + '/' + path, content);
  const { sourceFiles: _sourceFiles, ...manifest } = checker;
  return { ...manifest, basePath };
}

const JAIL = 'set -eu\n'
  + 'root=$(mktemp -d /tmp/rsi-native-checker.XXXXXXXX)\n'
  + 'trap \'cd /; umount -R "$root"; rmdir "$root"\' EXIT\n'
  + 'mount -t tmpfs -o size=256m tmpfs "$root"\n'
  + 'mkdir -p "$root/usr" "$root/tmp" "$root/dev" "$root/proc" "$root/payload" "$root/out" "$root/work"\n'
  + 'chmod 1777 "$root/tmp"\n'
  + 'mount --bind /usr "$root/usr"; mount -o remount,bind,ro "$root/usr"\n'
  + 'mount -t proc proc "$root/proc"\n'
  + 'for dir in bin lib lib64 sbin; do ln -s "usr/$dir" "$root/$dir"; done\n'
  + 'touch "$root/dev/null"; mount --bind /dev/null "$root/dev/null"\n'
  + 'mount --bind "$1" "$root/payload"; mount -o remount,bind,ro "$root/payload"\n'
  + 'mount --bind "$2" "$root/out"\n'
  + 'cp -- "$3" "$root/work/worker.py"; chmod 0555 "$root/work/worker.py"\n'
  + 'cd "$root"; chroot . /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/tmp LC_ALL=C.UTF-8 /usr/bin/python3 /work/worker.py\n';
export const NATIVE_CHECKER_JAIL = JAIL;
const wslPath = path => {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(resolve(path));
  assert(match, 'native-checker-windows-path');
  return '/mnt/' + match[1].toLowerCase() + '/' + match[2].replaceAll('\\', '/');
};
const completed = (result, codes = [0]) => result && result.error === null && result.timedOut === false
  && Number.isInteger(result.exitCode) && codes.includes(result.exitCode);

function deriveReport(raw, item, workerSha256) {
  assert(['RsiNativeCheckerWorker/v1', 'RsiNativeCheckerWorker/v2'].includes(raw?.schemaVersion) && raw.caseId === item.id
    && raw.workerSha256 === workerSha256 && raw.checkerDigest === benefitDigest(item.nativeChecker)
    && raw.driven_by === 'agent' && raw.modelRequests === 0 && Array.isArray(raw.results), 'native-checker-worker-binding');
  assert(/^[a-f0-9]{64}$/u.test(raw.sourceSha256), 'native-checker-subject-digest');
  assert([null, 'assertion', 'infrastructure'].includes(raw.failureClass), 'native-checker-failure-class');
  assert(raw.profile && raw.compiler === item.nativeChecker.compilerVersion, 'native-checker-worker-compiler');
  assert.deepEqual(raw.profile, NATIVE_CHECKER_PROFILE, 'native-checker-worker-profile');
  assert(raw.results.length <= item.vectors.length, 'native-checker-worker-coverage');
  assert(raw.compileError === null || typeof raw.compileError === 'string', 'native-checker-compile-result');
  if (raw.compileError === null) assert(completed(raw.compiles?.subject) && completed(raw.compiles?.checker)
    && raw.binarySha256?.['subject.binary'] && raw.binarySha256?.['checker.binary'], 'native-checker-incomplete-compilation');
  const results = raw.results.map((row, index) => {
    const vector = item.vectors[index];
    assert(row.index === index && row.testId === (vector.testId ?? null)
      && row.inputSha256 === sha(vector.input) && row.expectedSha256 === sha(vector.output),
    'native-checker-vector-binding');
    assert(row.subject && /^[a-f0-9]{64}$/u.test(row.subject.stdoutSha256)
      && /^[a-f0-9]{64}$/u.test(row.subject.stderrSha256), 'native-checker-subject-result');
    const passed = completed(row.subject) && completed(row.checker);
    assert.equal(row.passed, passed, 'native-checker-verdict-drift');
    return { index, testId: vector.testId ?? null, passed, timedOut: row.subject.timedOut,
      exitCode: row.subject.exitCode, error: row.subject.error,
      stdoutDigest: row.subject.stdoutSha256, stderrDigest: row.subject.stderrSha256,
      checker: row.checker ?? null };
  });
  if (raw.failureClass !== 'infrastructure') {
    assert.equal(raw.results.length, raw.compileError === null ? item.vectors.length : 0, 'native-checker-settled-coverage');
    assert.equal(raw.failureClass, raw.compileError === null && results.every(row => row.passed) ? null : 'assertion',
      'native-checker-failure-class-drift');
  }
  return { schemaVersion: 'RsiStdioOracleReport/v2', caseId: item.id, runtime: 'cpp',
    compileError: raw.compileError, failureClass: raw.failureClass,
    cppToolchain: 'gcc-libstdc++', compiler: raw.compiler,
    executionEnvironment: 'Ubuntu-22.04/WSL2-isolated-native-checker-C++17',
    exitCodePolicy: 'completed-program-and-official-checker-exit-zero',
    outputComparison: NATIVE_CHECKER_VERSION, normalization: 'none; native checker owns output semantics',
    ...(raw.schemaVersion === 'RsiNativeCheckerWorker/v2' ? { workerReportVersion: raw.schemaVersion } : {}),
    nativeCheckerDigest: raw.checkerDigest, workerSha256, sourceSha256: raw.sourceSha256,
    evidenceDirectory: 'native-checker-evidence', results,
    counts: { total: item.vectors.length, passed: results.filter(row => row.passed).length,
      failed: results.filter(row => !row.passed).length, timedOut: results.filter(row => row.timedOut).length },
    passed: raw.failureClass === null && raw.compileError === null
      && results.length === item.vectors.length && results.every(row => row.passed) };
}

export function verifyNativeCheckerEvidence(report, item, workspace) {
  validateNativeChecker(item.nativeChecker);
  const evidence = safeFile(workspace, 'native-checker-evidence');
  const bytes = path => readFileSync(safeFile(evidence, path));
  const payload = JSON.parse(bytes('payload.json').toString('utf8'));
  const started = JSON.parse(bytes('started.json').toString('utf8'));
  assert(started.schemaVersion === 'RsiNativeCheckerStarted/v1' && started.driven_by === 'agent'
    && started.caseId === item.id && payload.caseId === item.id, 'native-checker-started-binding');
  assert.equal(sha(bytes('payload.json')), started.payloadSha256, 'native-checker-payload-drift');
  assert.equal(started.workerSha256, sha(bytes('worker.py')), 'native-checker-worker-source-drift');
  assert.equal(payload.workerSha256, started.workerSha256, 'native-checker-payload-worker-drift');
  assert.equal(started.sourceSha256, payload.sourceSha256, 'native-checker-started-source-drift');
  assert.equal(payload.sourceSha256, sha(bytes('inputs/source.cpp')), 'native-checker-subject-source-drift');
  assert.equal(payload.sourceSha256, sha(readFileSync(safeFile(workspace, 'src/' + item.id + '.cpp'))),
    'native-checker-subject-source-drift');
  assert.deepEqual(payload.checker, item.nativeChecker, 'native-checker-manifest-drift');
  assert.equal(payload.checkerDigest, benefitDigest(item.nativeChecker), 'native-checker-payload-checker-drift');
  assert.deepEqual(payload.vectors, item.vectors.map((vector, index) => ({ index, testId: vector.testId ?? null,
    inputSha256: sha(vector.input), expectedSha256: sha(vector.output) })), 'native-checker-payload-vectors-drift');
  const runner = JSON.parse(bytes('runner-process.json').toString('utf8'));
  assert(runner.exitCode === 0 && runner.signal === null && runner.error === null, 'native-checker-runner-process');
  for (const stream of ['stdout', 'stderr'])
    assert.equal(sha(bytes('runner.' + stream)), runner[stream + 'Sha256'], 'native-checker-runner-log-drift');
  for (const [path, expected] of Object.entries(item.nativeChecker.sourceFilesSha256)) {
    assert.equal(sha(readFileSync(safeFile(workspace, item.nativeChecker.basePath + '/' + path))), expected, 'native-checker-oracle-source-drift');
    assert.equal(sha(readFileSync(safeFile(evidence, 'inputs/bundle/' + path))), expected, 'native-checker-compiled-source-drift');
  }
  const raw = JSON.parse(bytes('worker-report.json').toString('utf8'));
  assert.equal(raw.sourceSha256, payload.sourceSha256, 'native-checker-executed-source-drift');
  const operations = [raw.compiles?.subject, raw.compiles?.checker,
    ...raw.results.flatMap(row => [row.subject, row.checker])].filter(Boolean);
  assert(Object.keys(raw.compiles ?? {}).every(role => ['subject', 'checker'].includes(role)), 'native-checker-compilation-role');
  for (const operation of Object.values(raw.compiles ?? {}))
    assert.equal(operation.timeoutMs, NATIVE_CHECKER_PROFILE.compileTimeoutMs, 'native-checker-compile-timeout-drift');
  for (const row of raw.results) for (const operation of [row.subject, row.checker].filter(Boolean))
    assert.equal(operation.timeoutMs, NATIVE_CHECKER_PROFILE.testTimeoutMs, 'native-checker-test-timeout-drift');
  if (raw.schemaVersion === 'RsiNativeCheckerWorker/v2') {
    const includes = dirs => dirs.flatMap(path => ['-I', '/bundle/' + relativePath(path)]);
    const checker = item.nativeChecker, reference = payload.sourceSha256 === checker.referenceSha256;
    const commands = {
      subject: ['g++', ...NATIVE_CHECKER_PROFILE.compilerFlags,
        ...includes(reference ? [...checker.includeDirs, ...checker.referenceIncludeDirs] : []), '/work/source.cpp', '-o', '/tmp/subject'],
      checker: ['g++', ...NATIVE_CHECKER_PROFILE.compilerFlags, ...includes(checker.includeDirs),
        '/bundle/' + checker.entryPath, '-o', '/tmp/checker'],
    };
    for (const [role, operation] of Object.entries(raw.compiles ?? {}))
      assert.deepEqual(operation.command, commands[role], 'native-checker-compile-command-drift');
    for (const row of raw.results) {
      assert.deepEqual(row.subject.command, ['/program'], 'native-checker-subject-command-drift');
      if (row.checker) assert.deepEqual(row.checker.command,
        ['/tmp/checker', '/private/input', '/private/actual', '/private/expected'], 'native-checker-checker-command-drift');
    }
  }
  if (raw.schemaVersion === 'RsiNativeCheckerWorker/v2') for (const operation of operations) {
    const launchBytes = bytes(relativePath(operation.launch));
    assert.equal(sha(launchBytes), operation.launchSha256, 'native-checker-launch-record-drift');
    const records = launchBytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const launched = records[0]?.stage === 'started' && records[0].uid === 65534 && records[0].gid === 65534
      && records[0].namespacePid === 1 && isDeepStrictEqual(records[0].command, operation.command);
    assert.equal(operation.launched, launched, 'native-checker-launch-state-drift');
    if (operation.error === null) {
      assert(launched && operation.wrapperExitCode === 0 && records.length === 2 && records[1].stage === 'completed'
        && Number.isInteger(records[1].exitCode),
        'native-checker-incomplete-launch');
      assert.equal(operation.exitCode, records[1].exitCode, 'native-checker-program-exit-drift');
    }
  }
  for (const operation of operations) for (const stream of ['stdout', 'stderr']) {
    assert(typeof operation.timedOut === 'boolean' && (operation.error === null || typeof operation.error === 'string')
      && (operation.exitCode === null || Number.isInteger(operation.exitCode))
      && Number.isInteger(operation.timeoutMs) && operation.timeoutMs > 0, 'native-checker-process-record');
    const path = relativePath(operation[stream]);
    assert.equal(sha(readFileSync(safeFile(evidence, path))), operation[stream + 'Sha256'], 'native-checker-raw-log-drift');
  }
  for (const [index, vector] of item.vectors.entries()) {
    for (const [name, value] of [['in', vector.input], ['expected', vector.output]])
      assert.equal(sha(readFileSync(join(evidence, 'inputs/' + index + '.' + name))), sha(value), 'native-checker-private-vector-drift');
  }
  for (const [name, expected] of Object.entries(raw.binarySha256 ?? {}))
    assert.equal(sha(readFileSync(safeFile(evidence, name))), expected, 'native-checker-binary-drift');
  assert.deepEqual(report, deriveReport(raw, item, started.workerSha256), 'native-checker-report-drift');
  return true;
}

export function runNativeCheckerCase(item, source, { timeoutMs = 10000 } = {}) {
  validateNativeChecker(item.nativeChecker);
  assert.equal(timeoutMs, item.nativeChecker.profile.testTimeoutMs, 'native-checker-frozen-timeout');
  const workspace = resolve(dirname(source), '..'), evidence = join(workspace, 'native-checker-evidence');
  assert.equal(resolve(source), safeFile(workspace, 'src/' + item.id + '.cpp'), 'native-checker-subject-path');
  assert(!existsSync(evidence), 'native-checker-new-evidence-required');
  mkdirSync(evidence);
  const worker = fileURLToPath(new URL('../rsi-native-checker-worker.py', import.meta.url));
  const workerSha256 = sha(readFileSync(worker));
  put(evidence, 'worker.py', readFileSync(worker));
  const sourceBytes = readFileSync(source);
  put(evidence, 'inputs/source.cpp', sourceBytes);
  for (const [path, expected] of Object.entries(item.nativeChecker.sourceFilesSha256)) {
    const bytes = readFileSync(safeFile(workspace, item.nativeChecker.basePath + '/' + path));
    assert.equal(sha(bytes), expected, 'native-checker-source-drift');
    put(evidence, 'inputs/bundle/' + path, bytes);
  }
  const vectors = item.vectors.map((vector, index) => {
    put(evidence, 'inputs/' + index + '.in', vector.input);
    put(evidence, 'inputs/' + index + '.expected', vector.output);
    return { index, testId: vector.testId ?? null, inputSha256: sha(vector.input), expectedSha256: sha(vector.output) };
  });
  const payload = { caseId: item.id, workerSha256, sourceSha256: sha(sourceBytes), checker: item.nativeChecker,
    checkerDigest: benefitDigest(item.nativeChecker), vectors };
  const encoded = Buffer.from(JSON.stringify(payload));
  put(evidence, 'payload.json', encoded);
  put(evidence, 'started.json', JSON.stringify({ schemaVersion: 'RsiNativeCheckerStarted/v1',
    caseId: item.id, driven_by: 'agent', actor: 'codex/rsi-native-checker',
    workerSha256, payloadSha256: sha(encoded), sourceSha256: payload.sourceSha256 }));
  const startedAt = Date.now();
  const result = spawnSync('C:/Windows/System32/wsl.exe', ['-d', 'Ubuntu-22.04', '--exec', 'sudo', '-n',
    'timeout', '--kill-after=5s', '1200s', 'unshare', '--kill-child', '--mount', '--propagation', 'private',
    '--net', '--pid', '--fork', 'sh', '-c', JAIL, 'rsi', wslPath(join(evidence, 'inputs')), wslPath(evidence), wslPath(join(evidence, 'worker.py'))],
  { input: encoded, encoding: 'utf8', windowsHide: true, timeout: 1215000, maxBuffer: 1048576,
    env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  put(evidence, 'runner.stdout', result.stdout ?? '');
  put(evidence, 'runner.stderr', result.stderr ?? '');
  put(evidence, 'runner-process.json', JSON.stringify({ exitCode: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
    elapsedMs: Date.now() - startedAt, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') }));
  try {
    assert(!result.error && result.status === 0, 'native-checker-runner-failure:' + (result.error?.message ?? result.stderr ?? result.status));
    const raw = JSON.parse(readFileSync(join(evidence, 'worker-report.json'), 'utf8'));
    assert.equal(raw.schemaVersion, 'RsiNativeCheckerWorker/v2', 'native-checker-current-worker-protocol');
    const report = deriveReport(raw, item, workerSha256);
    verifyNativeCheckerEvidence(report, item, workspace);
    return report;
  } catch (error) {
    return { schemaVersion: 'RsiStdioOracleReport/v2', caseId: item.id, runtime: 'cpp', passed: false,
      compileError: error.message, failureClass: 'infrastructure', nativeCheckerDigest: benefitDigest(item.nativeChecker),
      outputComparison: NATIVE_CHECKER_VERSION, evidenceDirectory: 'native-checker-evidence', workerSha256,
      sourceSha256: payload.sourceSha256, workerReportSha256: existsSync(join(evidence, 'worker-report.json'))
        ? sha(readFileSync(join(evidence, 'worker-report.json'))) : null,
      results: [], counts: { total: item.vectors.length, passed: 0, failed: 0, timedOut: 0 } };
  }
}
