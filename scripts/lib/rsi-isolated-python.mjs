import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benefitDigest } from './rsi-benefit-eval.mjs';
import { NATIVE_CHECKER_JAIL, NATIVE_CHECKER_PROFILE } from './rsi-native-checker.mjs';

export const ISOLATED_PYTHON_VERSION = 'RsiStdioIsolatedPython/v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const rootFile = name => fileURLToPath(new URL('../' + name, import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const safe = (root, relative) => {
  assert(typeof relative === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(relative)
    && relative.split('/').every(part => part !== '.' && part !== '..'), 'isolated-python-relative-path');
  let path = resolve(root);
  for (const part of relative.split('/')) {
    path = join(path, part);
    if (existsSync(path)) assert(!lstatSync(path).isSymbolicLink(), 'isolated-python-symlink');
  }
  return path;
};
const put = (root, path, value) => {
  path = safe(root, path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { flag: 'wx' });
};
const wsl = path => {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(resolve(path));
  assert(match, 'isolated-python-windows-path');
  return '/mnt/' + match[1].toLowerCase() + '/' + match[2].replaceAll('\\', '/');
};

export function validateIsolatedPython(descriptor, reference = null) {
  assert(descriptor?.schemaVersion === ISOLATED_PYTHON_VERSION, 'isolated-python-version');
  assert(/^Python 3\.\d+\.\d+(?:[A-Za-z0-9.+-]*)$/u.test(descriptor.pythonVersion), 'isolated-python-interpreter');
  assert(/^[a-f0-9]{64}$/u.test(descriptor.referenceSha256), 'isolated-python-reference-digest');
  assert.deepEqual(descriptor.profile, NATIVE_CHECKER_PROFILE, 'isolated-python-resource-profile');
  if (reference !== null) assert.equal(sha(reference), descriptor.referenceSha256, 'isolated-python-reference-source');
  return descriptor;
}

export function verifyIsolatedPythonEvidence(report, item, workspace) {
  validateIsolatedPython(item.privatePython);
  assert.equal(report.schemaVersion, 'RsiStdioOracleReport/v3', 'isolated-python-report-version');
  assert.equal(report.privatePythonDigest, benefitDigest(item.privatePython), 'isolated-python-descriptor-digest');
  assert.equal(report.outputComparison, ISOLATED_PYTHON_VERSION, 'isolated-python-comparison');
  assert.equal(report.caseId, item.id, 'isolated-python-case');
  const workerSha256 = sha(readFileSync(rootFile('rsi-isolated-python-worker.py')));
  const sharedWorkerSha256 = sha(readFileSync(rootFile('rsi-native-checker-worker.py')));
  if (!report.sourceMissing) {
    assert.equal(report.workerSha256, workerSha256, 'isolated-python-frozen-worker');
    assert.equal(report.sharedWorkerSha256, sharedWorkerSha256, 'isolated-python-frozen-shared-worker');
    const evidence = safe(workspace, 'stdio-python-evidence');
    const payload = read(safe(evidence, 'payload.json'));
    assert.deepEqual(payload.descriptor, item.privatePython, 'isolated-python-payload-descriptor');
    assert.deepEqual(payload.vectors, item.vectors.map((vector, index) => ({ index, testId: vector.testId ?? null,
      inputSha256: sha(vector.input), expectedSha256: sha(vector.output) })), 'isolated-python-payload-vectors');
  }
  const replay = spawnSync('python', ['-B', rootFile('rsi-isolated-python-replay.py'), '--workspace', workspace,
    '--worker-sha256', workerSha256, '--shared-worker-sha256', sharedWorkerSha256, '--report-stdin'],
  { input: JSON.stringify(report), encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16777216,
    env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', PYTHONIOENCODING: 'utf-8' } });
  assert(!replay.error && replay.status === 0, 'isolated-python-replay:' + (replay.stderr || replay.error?.message));
  assert.deepEqual(JSON.parse(replay.stdout), report, 'isolated-python-report-drift');
  return true;
}

export function runIsolatedPythonCase(item, source, { timeoutMs = 10000 } = {}) {
  validateIsolatedPython(item.privatePython);
  assert(item.runtime === 'python3' && item.vectors.every(vector => vector.comparison === undefined),
    'isolated-python-text-contract');
  assert.equal(timeoutMs, item.privatePython.profile.testTimeoutMs, 'isolated-python-frozen-timeout');
  const workspace = resolve(dirname(source), '..');
  assert.equal(resolve(source), safe(workspace, 'src/' + item.id + '.py'), 'isolated-python-target');
  const evidence = safe(workspace, 'stdio-python-evidence');
  assert(!existsSync(evidence), 'isolated-python-new-evidence-required');
  mkdirSync(evidence);
  const worker = readFileSync(rootFile('rsi-isolated-python-worker.py'));
  const shared = readFileSync(rootFile('rsi-native-checker-worker.py'));
  const workerSha256 = sha(worker), sharedWorkerSha256 = sha(shared), sourceBytes = readFileSync(source);
  put(evidence, 'worker.py', worker);
  put(evidence, 'inputs/shared-worker.py', shared);
  put(evidence, 'inputs/source.py', sourceBytes);
  const vectors = item.vectors.map((vector, index) => {
    put(evidence, 'inputs/' + index + '.in', vector.input);
    put(evidence, 'inputs/' + index + '.expected', vector.output);
    return { index, testId: vector.testId ?? null, inputSha256: sha(vector.input), expectedSha256: sha(vector.output) };
  });
  const payload = { caseId: item.id, workerSha256, sharedWorkerSha256, sourceSha256: sha(sourceBytes),
    descriptor: item.privatePython, descriptorDigest: benefitDigest(item.privatePython), vectors };
  const encoded = Buffer.from(JSON.stringify(payload));
  put(evidence, 'payload.json', encoded);
  put(evidence, 'started.json', JSON.stringify({ schemaVersion: 'RsiIsolatedPythonStarted/v1', driven_by: 'agent',
    actor: 'codex/rsi-isolated-python', caseId: item.id, workerSha256, sharedWorkerSha256,
    sourceSha256: payload.sourceSha256, payloadSha256: sha(encoded) }));
  const start = Date.now();
  const result = spawnSync('C:/Windows/System32/wsl.exe', ['-d', 'Ubuntu-22.04', '--exec', 'sudo', '-n',
    'timeout', '--kill-after=5s', '1200s', 'unshare', '--kill-child', '--mount', '--propagation', 'private',
    '--net', '--pid', '--fork', 'sh', '-c', NATIVE_CHECKER_JAIL, 'rsi', wsl(join(evidence, 'inputs')),
    wsl(evidence), wsl(join(evidence, 'worker.py'))],
  { input: encoded, encoding: 'utf8', windowsHide: true, timeout: 1215000, maxBuffer: 1048576,
    env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  put(evidence, 'runner.stdout', result.stdout ?? '');
  put(evidence, 'runner.stderr', result.stderr ?? '');
  put(evidence, 'runner-process.json', JSON.stringify({ exitCode: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
    elapsedMs: Date.now() - start, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') }));
  try {
    assert(!result.error && result.status === 0, 'isolated-python-runner-failure:' + (result.error?.message ?? result.stderr ?? result.status));
    const replay = spawnSync('python', ['-B', rootFile('rsi-isolated-python-replay.py'), '--workspace', workspace,
      '--worker-sha256', workerSha256, '--shared-worker-sha256', sharedWorkerSha256],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16777216,
      env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', PYTHONIOENCODING: 'utf-8' } });
    assert(!replay.error && replay.status === 0, 'isolated-python-replay:' + (replay.stderr || replay.error?.message));
    const report = JSON.parse(replay.stdout);
    verifyIsolatedPythonEvidence(report, item, workspace);
    return report;
  } catch (error) {
    return { schemaVersion: 'RsiStdioOracleReport/v3', caseId: item.id, runtime: 'python3', compileError: error.message,
      failureClass: 'infrastructure', passed: false, outputComparison: ISOLATED_PYTHON_VERSION,
      privatePythonDigest: benefitDigest(item.privatePython), evidenceDirectory: 'stdio-python-evidence',
      workerSha256, sharedWorkerSha256, sourceSha256: payload.sourceSha256, results: [],
      counts: { total: item.vectors.length, passed: 0, failed: 0, timedOut: 0 } };
  }
}
