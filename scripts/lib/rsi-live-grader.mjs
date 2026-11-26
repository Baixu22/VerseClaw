import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sha256File } from '../rsi-tf0604-baseline.mjs';
import { stdioPublicProjection } from './rsi-stdio-tasks.mjs';
import { NATIVE_CHECKER_VERSION, verifyNativeCheckerEvidence } from './rsi-native-checker.mjs';
import { ISOLATED_PYTHON_VERSION, verifyIsolatedPythonEvidence } from './rsi-isolated-python.mjs';

export const HISTORICAL_CORPUS_PATH = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
export const CODING_BINDINGS_PATH = 'harness/specs/fixtures/rsi-coding-cohort/task-bindings.v1.json';
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const TEMP_ROOT = resolve('D:/tmp');

const SENSITIVE_ENV = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE)/iu;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileDigest = sha256File;
const rawDigest = (value) => digest(JSON.stringify(value));
const slash = (value) => value.replaceAll('\\', '/');

function assertWithin(base, target, label) {
  const rel = relative(resolve(base), resolve(target));
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside ${base}`);
}

function assertTempPath(target, label) {
  assertWithin(TEMP_ROOT, target, label);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value)) throw new Error('edit path must be relative');
  const normalized = slash(value).replace(/^\.\//u, '');
  const parts = normalized.split('/');
  if (!normalized || parts.includes('..') || parts.includes('') || parts.some((part) => /^[A-Za-z]:$/u.test(part))) {
    throw new Error(`invalid edit path: ${value}`);
  }
  if (parts.includes('.git') || parts.includes('node_modules')) throw new Error(`reserved edit path: ${value}`);
  return normalized;
}

function sanitizedEnvironment(homeDirectory) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !SENSITIVE_ENV.test(key)));
  env.TEMP = TEMP_ROOT;
  env.TMP = TEMP_ROOT;
  env.TMPDIR = slash(TEMP_ROOT);
  env.NO_COLOR = '1';
  env.pnpm_config_verify_deps_before_run = 'warn';
  delete env.NODE_OPTIONS;
  if (homeDirectory) {
    for (const path of [homeDirectory, join(homeDirectory, 'AppData/Roaming'), join(homeDirectory, 'AppData/Local')]) mkdirSync(path, { recursive: true });
    Object.assign(env, { HOME: homeDirectory, USERPROFILE: homeDirectory,
      APPDATA: join(homeDirectory, 'AppData/Roaming'), LOCALAPPDATA: join(homeDirectory, 'AppData/Local') });
  }
  return env;
}

const commitExistsCache = new Set();
const gitBlobCache = new Map();
function gitObjectExists(root, revision) {
  const key = `${resolve(root)}\0${revision}`;
  if (commitExistsCache.has(key)) return true;
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${revision}^{commit}`], { stdio: 'ignore', windowsHide: true, timeout: 120000 });
    commitExistsCache.add(key);
    return true;
  } catch {
    return false;
  }
}

function gitBlob(root, revision, path) {
  const key = `${resolve(root)}\0${revision}\0${path}`;
  if (!gitBlobCache.has(key)) gitBlobCache.set(key, execFileSync('git', ['-C', root, 'show', `${revision}:${path}`], { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 }));
  return gitBlobCache.get(key);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function resolveHistoricalTask(root, taskId, { codingCohort = false } = {}) {
  if (!root || !taskId) throw new Error('root and taskId are required');
  const corpus = readJson(join(root, HISTORICAL_CORPUS_PATH));
  const task = corpus.tasks?.find((entry) => entry.id === taskId || entry.sourceTaskId === taskId);
  if (!task) throw new Error(`historical task not found: ${taskId}`);
  const recordPath = task.referenceSolution?.sourceRecord;
  if (!recordPath) throw new Error(`source record missing for ${task.id}`);
  const absoluteRecordPath = resolve(root, recordPath);
  assertWithin(root, absoluteRecordPath, 'source record');
  const recordBytes = readFileSync(absoluteRecordPath);
  if (sha256File(absoluteRecordPath) !== task.referenceSolution.sourceRecordSha256) throw new Error(`source record digest mismatch for ${task.id}`);
  const record = JSON.parse(recordBytes.toString('utf8'));
  const base = record.candidate?.base;
  const ref = record.candidate?.commit;
  if (!base || !ref) throw new Error(`base/reference revision missing for ${task.id}`);
  if (task.referenceSolution.referenceCommit && task.referenceSolution.referenceCommit !== ref) throw new Error(`reference revision mismatch for ${task.id}`);
  if (!gitObjectExists(root, base)) throw new Error(`git object missing for ${task.id}: ${base}`);
  if (!gitObjectExists(root, ref)) throw new Error(`git object missing for ${task.id}: ${ref}`);
  const oracleTestDigests = {};
  for (const testPath of task.oracle?.testPaths ?? []) {
    const path = safeRelativePath(testPath);
    try {
      oracleTestDigests[path] = digest(gitBlob(root, ref, path));
    } catch {
      throw new Error(`reference oracle test missing for ${task.id}: ${path}`);
    }
  }
  let redefinition = {};
  if (codingCohort) {
    const bindings = readJson(join(root, CODING_BINDINGS_PATH));
    if (bindings.schemaVersion !== 'RsiCodingTaskBindings/v1' || bindings.driven_by !== 'agent') throw new Error('invalid coding bindings');
    const binding = bindings.tasks.find((entry) => entry.id === task.id);
    if (binding) {
      if (binding.base !== base || binding.reference !== ref || binding.sourceRecord !== recordPath
        || binding.sourceRecordSha256 !== task.referenceSolution.sourceRecordSha256) throw new Error('coding binding source drift');
      if (!binding.removePaths?.length || !binding.targetScope?.length || typeof binding.prompt !== 'string') throw new Error('invalid reconstruction definition');
      for (const entry of binding.removePaths) {
        const path = safeRelativePath(entry.path);
        if (!binding.targetScope.includes(path) || task.oracle.testPaths.includes(path)
          || /(?:^|\/)(?:tests|harness|docs)\/|\.test\./u.test(path)) throw new Error('invalid reconstruction target');
        if (digest(gitBlob(root, base, path)) !== entry.sha256) throw new Error('reconstruction base blob drift');
      }
      redefinition = { version: binding.version, input: { ...task.input, prompt: binding.prompt, targetScope: binding.targetScope },
        baselineSetup: { kind: 'implementation-reconstruction', removePaths: binding.removePaths } };
    }
  }
  const result = {
    ...task,
    ...redefinition,
    base,
    ref,
    baseCommit: base,
    referenceCommit: ref,
    sourceRecordData: record,
    oracleDigest: rawDigest(task.oracle),
    inputDigest: task.oracle.inputDigests,
    oracleRevision: ref,
    oracleTestDigests,
  };
  if (result.oracle?.kind === 'stdio') {
    const target = (result.input?.targetScope ?? result.targetScope)[0], cpp = target.endsWith('.cpp');
    const identityPath = 'public/' + result.id + '.json';
    const identity = result.oracle.testPaths.includes(identityPath) ? JSON.parse(gitBlob(root, ref, identityPath).toString('utf8')) : {};
    result.publicInput = stdioPublicProjection({ prompt: result.input.prompt, target, runtime: cpp ? 'cpp' : 'python3',
      cppToolchain: identity.cppToolchain, compilerVersion: identity.compilerVersion,
      pythonVersion: identity.pythonVersion,
      declaration: identity.declaration ?? 'Write a complete program that reads standard input and writes the required answer to standard output.\n' });
  }
  return result;
}

function normalizedEdits(edits) {
  if (!edits) return [];
  if (Array.isArray(edits)) {
    return edits.map((edit) => {
      if (!edit || typeof edit.path !== 'string') throw new Error('each edit requires path and content');
      return { path: edit.path, content: edit.content };
    });
  }
  return Object.entries(edits).map(([path, content]) => ({ path, content }));
}

function editMatchesScope(path, task) {
  const scope = (task.input?.targetScope ?? []).map((entry) => slash(entry).replace(/^\.\//u, ''));
  return scope.some((entry) => entry.endsWith('/') ? path.startsWith(entry) : path === entry);
}

function assertNoSymlinkChain(root, relativePath) {
  const parts = relativePath.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink path rejected: ${relativePath}`);
  }
  const target = join(root, relativePath);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`symlink path rejected: ${relativePath}`);
  return target;
}

function applyEdits(workspace, task, edits) {
  const oraclePaths = new Set((task.oracle?.testPaths ?? []).map(slash));
  const applied = [];
  for (const edit of normalizedEdits(edits)) {
    const path = safeRelativePath(edit.path);
    if (oraclePaths.has(path)) throw new Error(`edit targets hidden oracle: ${path}`);
    if (!editMatchesScope(path, task)) throw new Error(`edit outside task targetScope: ${path}`);
    if (typeof edit.content !== 'string' && !(edit.content instanceof Uint8Array)) throw new Error(`edit content missing: ${path}`);
    const target = assertNoSymlinkChain(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, edit.content);
    applied.push(path);
  }
  return applied;
}

async function extractRevision(root, revision, workspace) {
  await new Promise((resolveArchive, rejectArchive) => {
    const env = sanitizedEnvironment();
    const git = spawn('git', ['-C', root, 'archive', '--format=tar', revision], { env, windowsHide: true });
    const tar = spawn('tar', ['-xf', '-', '-C', workspace], { env, windowsHide: true });
    let gitCode = null;
    let tarCode = null;
    let stderr = '';
    const finish = () => {
      if (gitCode === null || tarCode === null) return;
      if (gitCode === 0 && tarCode === 0) resolveArchive();
      else rejectArchive(new Error(`git archive extraction failed (git=${gitCode}, tar=${tarCode}): ${stderr.trim()}`));
    };
    git.stdout.pipe(tar.stdin);
    git.stderr.on('data', (chunk) => { stderr += chunk; });
    tar.stderr.on('data', (chunk) => { stderr += chunk; });
    git.on('error', rejectArchive);
    tar.on('error', rejectArchive);
    git.on('close', (code) => { gitCode = code; finish(); });
    tar.on('close', (code) => { tarCode = code; finish(); });
  });
}

function restoreOracles(workspace, root, task) {
  const restored = [];
  for (const testPath of task.oracle?.testPaths ?? []) {
    const path = safeRelativePath(testPath);
    const expected = task.oracleTestDigests?.[path] ?? task.oracle.inputDigests?.[path];
    if (!expected) throw new Error(`frozen input digest missing for oracle: ${path}`);
    const bytes = task.oracleRevision ? gitBlob(root, task.oracleRevision, path) : readFileSync(assertNoSymlinkChain(root, path));
    if (digest(bytes) !== expected) throw new Error(`frozen oracle digest mismatch: ${path}`);
    const target = assertNoSymlinkChain(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    restored.push(path);
  }
  return restored;
}

export async function prepareGradeWorkspace({ root, task, workspace, revision, edits } = {}) {
  if (!root || !task || !workspace || !revision) throw new Error('root, task, workspace and revision are required');
  if (task.oracle?.kind === 'stdio') return prepareStdioGradeWorkspace({ root, task, workspace, revision, edits });
  assertTempPath(workspace, 'grade workspace');
  if (existsSync(workspace)) throw new Error(`grade workspace already exists: ${workspace}`);
  if (!gitObjectExists(root, revision)) throw new Error(`git object missing: ${revision}`);
  mkdirSync(dirname(resolve(workspace)), { recursive: true });
  mkdirSync(workspace);
  await extractRevision(root, revision, workspace);
  if (task.baselineSetup && revision === task.base) {
    for (const entry of task.baselineSetup.removePaths) {
      const path = safeRelativePath(entry.path);
      if (!editMatchesScope(path, task) || task.oracle.testPaths.includes(path)) throw new Error('invalid reconstruction target');
      const target = assertNoSymlinkChain(workspace, path);
      if (digest(readFileSync(target)) !== entry.sha256) throw new Error('reconstruction base blob drift');
      unlinkSync(target);
    }
  }
  const applied = applyEdits(workspace, task, edits);
  const oracleFiles = restoreOracles(workspace, root, task);
  return { workspace: resolve(workspace), revision, edits: applied, oracleFiles };
}

/** Extract only this stdio task's public identity, optional subject and frozen oracle. */
export async function prepareStdioGradeWorkspace({ root, task, workspace, revision, edits } = {}) {
  if (!root || !task || !workspace || !revision) throw new Error('root, task, workspace and revision are required');
  assertTempPath(workspace, 'grade workspace');
  if (task.oracle?.kind !== 'stdio') throw new Error('stdio task required');
  if (existsSync(workspace)) throw new Error(`grade workspace already exists: ${workspace}`);
  mkdirSync(workspace, { recursive: true });
  for (const path of task.oracle.testPaths) {
    const relativePath = safeRelativePath(path), bytes = gitBlob(root, task.oracleRevision, relativePath);
    if (digest(bytes) !== task.oracleTestDigests[relativePath]) throw new Error(`frozen oracle digest mismatch: ${relativePath}`);
    const target = assertNoSymlinkChain(workspace, relativePath);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  const targetPath = task.input.targetScope[0];
  if (revision === task.ref) {
    const bytes = gitBlob(root, task.ref, targetPath);
    const target = assertNoSymlinkChain(workspace, targetPath);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  const applied = applyEdits(workspace, task, edits);
  return { workspace: resolve(workspace), revision, edits: applied,
    oracleFiles: task.oracle.testPaths.map(safeRelativePath) };
}

function commandLines(task) {
  if ((task.publicInput ?? task.input)?.taskKind === 'stdio-program' || task.oracle?.kind === 'stdio') return ['internal:stdio-oracle'];
  const values = task.oracle?.commandLines ?? (task.oracle?.commandLine ? [task.oracle.commandLine] : []);
  if (!values.length || values.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('registered oracle commands missing');
  return values;
}

function resolveRegisteredStdioCommand(task, root, workspace) {
  const input = task.publicInput ?? task.input;
  if (input?.taskKind !== 'stdio-program' || !['python3', 'cpp'].includes(input.runtime)) throw new Error('invalid stdio oracle contract');
  const script = join(root, 'scripts/lib/rsi-stdio-oracle.mjs');
  if (!existsSync(script)) throw new Error('stdio grader missing');
  return { kind: 'command', cwd: workspace, argv: [process.execPath, script, '--case-id', task.id, '--workspace', workspace],
    usesRootDeps: false };
}

function splitCommand(command) {
  const tokens = [];
  let token = '';
  let quote = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/u.test(char)) {
      if (token) { tokens.push(token); token = ''; }
    } else token += char;
  }
  if (quote) throw new Error(`unterminated quote in registered command: ${command}`);
  if (token) tokens.push(token);
  return tokens;
}

function vitestMain(root) {
  const requireFromRoot = createRequire(join(root, 'package.json'));
  return join(dirname(requireFromRoot.resolve('vitest/package.json')), 'vitest.mjs');
}

function resolveRegisteredCommand(command, { root, workspace }) {
  let match = command.match(/^pnpm\s+exec\s+vitest\s+run\s+(.+)$/u);
  if (match) return { kind: 'vitest', cwd: workspace, argv: [process.execPath, vitestMain(root), 'run', ...splitCommand(match[1])], usesRootDeps: true };
  match = command.match(/^vitest\s+run\s+(.+)$/u);
  if (match) return { kind: 'vitest', cwd: workspace, argv: [process.execPath, vitestMain(root), 'run', ...splitCommand(match[1])], usesRootDeps: true };
  match = command.match(/^pnpm\s+--dir\s+openclaw_runtime\s+exec\s+node\s+scripts\/run-vitest\.mjs\s+(.+)$/u);
  if (match) {
    const runtime = join(workspace, 'openclaw_runtime');
    return { kind: 'vitest', cwd: runtime, argv: [process.execPath, join(runtime, 'scripts/run-vitest.mjs'), ...splitCommand(match[1])], usesRootDeps: true, usesRuntimeDeps: true };
  }
  match = command.match(/^openclaw_runtime:\s*run-vitest\s+(.+)$/u);
  if (match) {
    const runtime = join(workspace, 'openclaw_runtime');
    return { kind: 'vitest', cwd: runtime, argv: [process.execPath, join(runtime, 'scripts/run-vitest.mjs'), 'run', ...splitCommand(match[1])], usesRootDeps: true, usesRuntimeDeps: true };
  }
  if (!/^node scripts\/[\w.-]+\.mjs(?:\s|$)/u.test(command) || /[;&|<>`$]/u.test(command)) throw new Error('unregistered oracle command');
  return { kind: 'command', cwd: workspace, argv: [process.execPath, ...splitCommand(command).slice(1)], usesRootDeps: false };
}

function directoryLink(source, target) {
  if (!existsSync(source)) throw new Error(`dependency directory missing: ${source}`);
  if (existsSync(target)) throw new Error(`dependency target already exists: ${target}`);
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}

function findPnpmPackage(root, packageName) {
  const bases = [join(root, 'openclaw_runtime', 'node_modules', '.pnpm'), join(root, 'node_modules', '.pnpm')];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith(`${packageName}@`)) continue;
      const candidate = join(base, entry, 'node_modules', packageName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const ORACLE_SUPPORT_PACKAGES = [
  { packageName: 'markdown-it', importerPrefix: 'openclaw_runtime/packages/markdown-core/' },
];

function linkOracleSupportPackages(root, workspace, supportRoot) {
  const links = [];
  for (const { packageName, importerPrefix } of ORACLE_SUPPORT_PACKAGES) {
    const importerRoot = join(workspace, importerPrefix);
    if (!existsSync(importerRoot)) continue;
    const source = supportRoot ? join(resolve(supportRoot), 'node_modules', packageName) : findPnpmPackage(root, packageName);
    if (!source) throw new Error(`oracle support package missing: ${packageName}`);
    if (supportRoot) {
      const declared = readJson(join(importerRoot, 'package.json')).dependencies?.[packageName];
      const installed = readJson(join(source, 'package.json')).version;
      if (declared !== installed) throw new Error(`oracle support version mismatch: ${packageName} declared=${declared} installed=${installed}`);
    }
    const target = join(importerRoot, 'node_modules', packageName);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    directoryLink(source, target);
    links.push(target);
  }
  return links;
}

export function classifyMissingModuleFailure(diagnostics = []) {
  const entries = Array.isArray(diagnostics) ? diagnostics.filter((entry) => entry?.kind === 'missing-module') : [];
  if (entries.length === 0) return { failureClass: 'assertion', inTargetScope: false, diagnostics: [] };
  return {
    failureClass: entries.some((entry) => entry.inTargetScope !== true) ? 'infrastructure' : 'target-module-absent',
    inTargetScope: entries.every((entry) => entry.inTargetScope === true),
    diagnostics: entries,
  };
}
export function linkGraderDependencies(root, workspace, descriptors, supportRoot) {
  const links = [];
  try {
    if (descriptors.some((entry) => entry.usesRootDeps)) {
      const target = join(workspace, 'node_modules');
      directoryLink(join(root, 'node_modules'), target);
      links.push(target);
    }
    if (descriptors.some((entry) => entry.usesRuntimeDeps)) {
      const target = join(workspace, 'openclaw_runtime', 'node_modules');
      if (existsSync(target)) throw new Error(`dependency target already exists: ${target}`);
      const candidates = [join(root, 'openclaw_runtime', 'node_modules'), join(root, 'node_modules')].filter((source) => existsSync(source));
      if (candidates.length === 0) throw new Error('runtime dependency directory missing');
      mkdirSync(dirname(target), { recursive: true });
      directoryLink(candidates[0], target);
      links.push(target);
    }
    links.push(...linkOracleSupportPackages(root, workspace, supportRoot));
    return links;
  } catch (error) {
    for (const target of links.reverse()) removeOwnedDirectoryLink(target);
    throw error;
  }
}
function removeOwnedDirectoryLink(target) {
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink()) rmdirSync(target);
}

function runProcess(argv, { cwd, timeoutMs, stdoutPath, stderrPath }) {
  const stdoutFd = openSync(stdoutPath, 'wx');
  const stderrFd = openSync(stderrPath, 'wx');
  try {
    const started = performance.now();
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: sanitizedEnvironment(join(dirname(stdoutPath), 'home')),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    writeFileSync(stdoutFd, result.stdout ?? '');
    writeFileSync(stderrFd, result.stderr ?? '');
    return { exitCode: result.status, signal: result.signal, timedOut: result.error?.code === 'ETIMEDOUT',
      error: result.error ?? null, errorCode: result.error?.code ?? null, elapsedMs: Math.round(performance.now() - started) };
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
}

function parseReport(path) {
  if (!existsSync(path)) return null;
  try { return readJson(path); } catch { return null; }
}

function parseStdioReport(path, task, workspace) {
  const report = parseReport(path);
  const valid = ['RsiStdioOracleReport/v1', 'RsiStdioOracleReport/v2', 'RsiStdioOracleReport/v3'].includes(report?.schemaVersion) && report.caseId === task.id
    && Array.isArray(report.results) && report.results.every(row => typeof row?.passed === 'boolean')
    && typeof report.passed === 'boolean'
    && ['total', 'passed', 'failed', 'timedOut'].every(field => Number.isInteger(report.counts?.[field]) && report.counts[field] >= 0);
  if (!valid) return null;
  const native = task.oracle.comparisonProtocol === NATIVE_CHECKER_VERSION;
  const isolatedPython = task.oracle.comparisonProtocol === ISOLATED_PYTHON_VERSION;
  if (report.schemaVersion !== (native ? 'RsiStdioOracleReport/v2' : isolatedPython ? 'RsiStdioOracleReport/v3' : 'RsiStdioOracleReport/v1')) return null;
  if (isolatedPython) {
    if (report.outputComparison !== ISOLATED_PYTHON_VERSION || report.privatePythonDigest !== task.oracle.privatePythonDigest) return null;
    if (report.failureClass === 'infrastructure' && report.passed !== false) return null;
    if (report.failureClass !== 'infrastructure') {
      try {
        const oracle = readJson(join(workspace, 'oracles', task.id + '.json'));
        verifyIsolatedPythonEvidence(report, { id: task.id, vectors: oracle.tests, privatePython: oracle.privatePython }, workspace);
      } catch { return null; }
    }
  }
  if (native) {
    if (report.outputComparison !== NATIVE_CHECKER_VERSION || report.nativeCheckerDigest !== task.oracle.nativeCheckerDigest) return null;
    if (!report.sourceMissing && report.failureClass !== 'infrastructure') {
      if (report.workerReportVersion !== 'RsiNativeCheckerWorker/v2') return null;
      try {
        const privateOracle = readJson(join(workspace, 'oracles', task.id + '.json'));
        verifyNativeCheckerEvidence(report, { id: task.id, vectors: privateOracle.tests, nativeChecker: privateOracle.nativeChecker }, workspace);
      } catch { return null; }
    }
  }
  return report;
}

function oracleState(root, workspace, task) {
  const files = {};
  for (const testPath of task.oracle?.testPaths ?? []) {
    const path = safeRelativePath(testPath);
    const expected = task.oracleTestDigests?.[path] ?? task.oracle.inputDigests?.[path];
    if (!expected) throw new Error(`frozen input digest missing for oracle: ${path}`);
    files[path] = {
      expected,
      root: task.oracleRevision ? digest(gitBlob(root, task.oracleRevision, path)) : fileDigest(assertNoSymlinkChain(root, path)),
      workspace: fileDigest(assertNoSymlinkChain(workspace, path)),
    };
  }
  const state = { task: rawDigest(task.oracle), files };
  return { ...state, combined: rawDigest(state) };
}

function stdioOracleState(workspace, task) {
  const privateFileDigest = [NATIVE_CHECKER_VERSION, ISOLATED_PYTHON_VERSION].includes(task.oracle.comparisonProtocol)
    ? path => digest(readFileSync(path)) : fileDigest;
  const files = Object.fromEntries(task.oracle.testPaths.map(path => [path,
    { expected: task.oracleTestDigests[path], root: task.oracleTestDigests[path], workspace: privateFileDigest(assertNoSymlinkChain(workspace, path)) }]));
  const state = { task: rawDigest(task.oracle), files };
  return { ...state, combined: rawDigest(state) };
}

export function missingModuleDiagnostics(report, workspace, task) {
  const diagnostics = [];
  const scope = (task.input?.targetScope ?? []).map((entry) => slash(entry).replace(/^\.\//u, ''));
  const canonical = (path) => path.replace(/\.(?:c|m)?[jt]sx?$/u, '');
  const scopeMatches = (missingPath) => {
    const target = canonical(missingPath);
    return scope.some((entry) => {
      const wanted = canonical(entry);
      return target === wanted || target.startsWith(`${wanted}/`);
    });
  };
  const record = (message, importer) => {
    if (typeof message !== 'string') return;
    const matched = message.match(/Failed to resolve import ["']([^"']+)["']/u)
      ?? message.match(/Cannot find module ["']([^"']+)["']/u)
      ?? message.match(/Cannot find package ["']([^"']+)["']/u);
    if (!matched) return;
    let missingPath = matched[1];
    if (missingPath.startsWith('.') && importer) missingPath = slash(join(dirname(importer), missingPath));
    missingPath = slash(missingPath).replace(/^\.\//u, '');
    const diagnostic = { kind: 'missing-module', missingPath, importer, inTargetScope: scopeMatches(missingPath) };
    if (!diagnostics.some((entry) => entry.missingPath === diagnostic.missingPath && entry.importer === diagnostic.importer)) diagnostics.push(diagnostic);
  };
  for (const result of report?.testResults ?? []) {
    const importer = result.name && isAbsolute(result.name) ? slash(relative(workspace, result.name)) : null;
    record(result.message, importer);
    for (const assertion of result.assertionResults ?? []) {
      for (const message of assertion.failureMessages ?? []) record(message, importer);
    }
  }
  return diagnostics;
}
function aggregates(executions) {
  return executions.reduce((counts, execution) => {
    if (execution.kind !== 'vitest' || !execution.report) return counts;
    counts.numTotalTests += Number(execution.report.numTotalTests ?? 0);
    counts.numPassedTests += Number(execution.report.numPassedTests ?? 0);
    counts.numFailedTests += Number(execution.report.numFailedTests ?? 0);
    counts.numPendingTests += Number(execution.report.numPendingTests ?? 0);
    return counts;
  }, { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0 });
}

export async function runLiveTaskOracles({ root, task, workspace, outDir, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, supportRoot } = {}) {
  if (!root || !task || !workspace || !outDir) throw new Error('root, task, workspace and outDir are required');
  assertTempPath(workspace, 'grade workspace');
  assertTempPath(outDir, 'grader output');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer');
  mkdirSync(outDir, { recursive: true });
  if (existsSync(join(outDir, 'run-report.json'))) throw new Error(`grader output already exists: ${outDir}`);

  const commands = commandLines(task);
  const descriptors = commands.map((command) => ({ command, ...(command === 'internal:stdio-oracle'
    ? resolveRegisteredStdioCommand(task, supportRoot ?? root, workspace) : resolveRegisteredCommand(command, { root, workspace })) }));
  if (descriptors.some((descriptor) => descriptor.kind === 'vitest')) {
    for (const descriptor of descriptors) descriptor.usesRuntimeDeps = true;
  }
  const before = task.oracle?.kind === 'stdio' ? stdioOracleState(workspace, task) : oracleState(root, workspace, task);
  if (task.oracle?.kind === 'stdio') for (const row of Object.values(before.files)) assert.equal(row.workspace, row.expected, 'stdio-oracle-digest');
  if (Object.values(before.files).some((entry) => entry.root !== entry.expected || entry.workspace !== entry.expected)) throw new Error('frozen-oracle-input-drift');
  const executions = [];
  const diagnostics = [];
  let ownedLinks = [];
  try {
    ownedLinks = linkGraderDependencies(root, workspace, descriptors, supportRoot);
    for (const [index, descriptor] of descriptors.entries()) {
      const stem = String(index + 1).padStart(2, '0');
      const stdoutPath = join(outDir, `${stem}-stdout.log`);
      const stderrPath = join(outDir, `${stem}-stderr.log`);
      const reportPath = join(outDir, `${stem}-vitest-report.json`);
      const stdioReportPath = join(workspace, 'stdio-report.json');
      const argv = descriptor.kind === 'vitest' ? [...descriptor.argv, '--reporter=json', `--outputFile=${reportPath}`] : descriptor.argv;
      const result = runProcess(argv, { cwd: descriptor.cwd, timeoutMs, stdoutPath, stderrPath });
      const report = descriptor.kind === 'vitest' ? parseReport(reportPath) : descriptor.command === 'internal:stdio-oracle'
        ? parseStdioReport(stdioReportPath, task, workspace) : { kind: 'command', exitCode: result.exitCode,
          stdoutDigest: fileDigest(stdoutPath), stderrDigest: fileDigest(stderrPath) };
      executions.push({
        command: descriptor.command,
        actualArgv: argv,
        kind: descriptor.kind,
        cwd: descriptor.cwd,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        signal: result.signal,
        error: result.error ? result.error.message : null,
        errorCode: result.errorCode,
        elapsedMs: result.elapsedMs,
        report,
        reportPath: descriptor.kind === 'vitest' ? reportPath : descriptor.command === 'internal:stdio-oracle' ? stdioReportPath : null,
        stdoutPath,
        stderrPath,
      });
      diagnostics.push(...missingModuleDiagnostics(report, workspace, task));
      if (descriptor.kind === 'vitest' && !report) diagnostics.push({ kind: 'vitest-report-missing', command: descriptor.command });
      if (descriptor.command === 'internal:stdio-oracle' && !report) diagnostics.push({ kind: 'stdio-report-missing-or-invalid',
        command: descriptor.command, message: stdioReportPath });
    }
  } finally {
    for (const target of ownedLinks.reverse()) removeOwnedDirectoryLink(target);
  }

  let after;
  try { after = task.oracle?.kind === 'stdio' ? stdioOracleState(workspace, task) : oracleState(root, workspace, task); }
  catch (error) {
    diagnostics.push({ kind: 'oracle-hash-after-error', message: error.message });
    after = { task: null, files: {}, combined: null };
  }
  const oracleUnchanged = before.combined === after.combined;
  if (!oracleUnchanged) diagnostics.push({ kind: 'oracle-drift' });
  const counts = aggregates(executions.filter(execution => execution.command !== 'internal:stdio-oracle'));
  for (const execution of executions) if (execution.command === 'internal:stdio-oracle' && execution.report) {
    counts.numTotalTests += execution.report.counts?.total ?? 0;
    counts.numPassedTests += execution.report.counts?.passed ?? 0;
    counts.numFailedTests += execution.report.counts?.failed ?? 0;
  }
  const validTests = (execution) => {
    if (execution.command === 'internal:stdio-oracle') return ['RsiStdioOracleReport/v1', 'RsiStdioOracleReport/v2', 'RsiStdioOracleReport/v3'].includes(execution.report?.schemaVersion)
      && execution.report.passed === true && execution.report.results?.length > 0
      && execution.report.results.every(row => row.passed === true);
    if (execution.kind !== 'vitest') return true;
    const report = execution.report;
    const assertions = report?.testResults?.flatMap((suite) => suite.assertionResults ?? []) ?? [];
    const passed = assertions.filter((entry) => entry.status === 'passed').length;
    return report?.success === true && assertions.length > 0 && assertions.length === report.numTotalTests
      && passed === assertions.length && report.numPassedTests === passed && report.numFailedTests === 0
      && report.numPendingTests === 0 && (report.numSkippedTests ?? 0) === 0 && (report.numTodoTests ?? 0) === 0;
  };
  const passed = oracleUnchanged
    && executions.length === commands.length
    && executions.every((execution) => execution.exitCode === 0 && !execution.timedOut && execution.error === null)
    && executions.every(validTests);
  const missingFailure = classifyMissingModuleFailure(diagnostics);
  const executionInfrastructure = diagnostics.some((entry) => ['vitest-report-missing', 'stdio-report-missing-or-invalid', 'oracle-hash-after-error'].includes(entry.kind))
    || executions.some((execution) => execution.timedOut || execution.error !== null);
  const failureClass = passed ? null
    : !oracleUnchanged ? 'oracle-input-drift'
      : executions.some(execution => execution.command === 'internal:stdio-oracle' && execution.report?.sourceMissing) ? 'target-module-absent'
      : executions.some(execution => execution.command === 'internal:stdio-oracle' && (execution.report?.failureClass === 'infrastructure'
        || !['RsiStdioOracleReport/v2', 'RsiStdioOracleReport/v3'].includes(execution.report?.schemaVersion) && (execution.report?.executionEnvironment === 'wsl-unavailable'
        || execution.report?.compileError || execution.report?.results?.some(row => row.timedOut)))) ? 'infrastructure'
      : missingFailure.failureClass === 'infrastructure' || executionInfrastructure ? 'infrastructure'
        : missingFailure.failureClass === 'target-module-absent' ? 'target-module-absent'
          : 'assertion';

  const report = {
    schemaVersion: 'RsiLiveTaskGrader/v1',
    driven_by: 'agent',
    actor: 'codex/rsi-live-grader',
    taskId: task.id,
    commands,
    executions,
    ...counts,
    passed,
    failureClass,
    timeoutMs,
    oracleHashBefore: before.combined,
    oracleHashAfter: after.combined,
    oracleUnchanged,
    inputDigests: task.oracle.inputDigests,
    oracleRevision: task.oracleRevision ?? null,
    oracleTestDigests: task.oracleTestDigests ?? null,
    ...(task.baselineSetup ? { baselineSetup: task.baselineSetup } : {}),
    ...(supportRoot ? { supportPackages: ORACLE_SUPPORT_PACKAGES.filter(({ importerPrefix }) => existsSync(join(workspace, importerPrefix)))
      .map(({ packageName, importerPrefix }) => ({ name: packageName,
        declaredVersion: readJson(join(workspace, importerPrefix, 'package.json')).dependencies?.[packageName],
        resolvedVersion: readJson(join(supportRoot, 'node_modules', packageName, 'package.json')).version })) } : {}),
    diagnostics,
    workspace: resolve(workspace),
  };
  const reportPath = join(outDir, 'run-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return { ...report, outDir: resolve(outDir), reportPath };
}
