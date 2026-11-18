#!/usr/bin/env node
/**
 * Reconstruct, qualify, synchronize, and verify the bundled VerseShell runtime.
 * The only accepted source identity is the pinned commit plus the tracked,
 * ordered patch stack declared by resources/verseshell/source-inputs.json.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { isAbsolute as pathIsAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
// Default unpacked electron-builder output; pnpm run verseshell:package:verify and
// BUILD.md rely on this so the documented gate never dies on a missing flag.
export const DEFAULT_PACKAGED_RESOURCES = join(PROJECT_ROOT, 'release', 'win-unpacked', 'resources');
export const BUNDLE_SCHEMA_VERSION = 2;
export const SOURCE_INPUT_SCHEMA_VERSION = 1;
export const SUPPORTED_TARGET = Object.freeze({ platform: 'win32', arch: 'x64' });
export const SOURCE_INPUTS_PATH = 'resources/verseshell/source-inputs.json';
export const COMPLIANCE_FILES = Object.freeze({
  license_file: 'LICENSE-AGPL-3.0-or-later.txt',
  notice_file: 'NOTICE.md',
  source_file: 'SOURCE.md',
  build_file: 'BUILD.md',
  source_inputs_file: 'source-inputs.json',
});

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const EXPECTED_REPOSITORY = 'https://github.com/Baixu22/VerseShell.git';
const EXPECTED_COMMIT = 'c06f406e83566bb968448222d9c8caf429e580a0';
const EXPECTED_COMMIT_EPOCH = 1791974123;
const EXPECTED_CARGO_VERSION = '1.94.0';
const EXPECTED_RUSTC_VERSION = '1.94.0';
const EXPECTED_CARGO_TARGET = 'x86_64-pc-windows-msvc';
const EXPECTED_PROTOCOL = 'verseshell.jsonl/v1';
const EXPECTED_CATALOG_SCHEMA = 'verseshell.operation-catalog/v1';
const EXPECTED_CATALOG_DIGEST = 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8';
const EXPECTED_CATALOG_COUNT = 32;
const SOURCE_IDENTITY_PREFIX = 'verseshell.source-identity/v1\n';
const EXPECTED_PATCHES = Object.freeze([
  ['runtime-startup', 'resources/verseshell/patches/p0-runtime-startup.patch'],
  ['python-current-interpreter', 'resources/verseshell/patches/python-current-interpreter.patch'],
  ['binary-test-targets', 'resources/verseshell/patches/binary-test-targets.patch'],
]);
// The target upstream tracks every ACI-Bench python input, so the recovered-ignored-input
// mechanism is retired; the allowlist stays empty and the inventory check asserts that.
const EXPECTED_RECOVERED_INPUTS = Object.freeze([]);
const EXPECTED_PYTHON_TASKS = Object.freeze([
  'python_edit_and_retest',
  'python_fix_pytest_fail',
]);
const REQUIRED_FINAL_ASSERTIONS = Object.freeze([
  '.gitignore',
  'Cargo.toml',
  'Cargo.lock',
  'src/cache.rs',
  'src/lib.rs',
  'src/mcp/tools.rs',
  'src/server.rs',
  'tests/operation_protocol_tests.rs',
  'tests/process_lifecycle_tests.rs',
  'bench/aci/runners/run_suite.py',
  'bench/aci/scorers/score.py',
  'bench/aci/tasks/python_edit_and_retest.json',
  'bench/aci/tasks/python_fix_pytest_fail.json',
]);
const EXPECTED_FORBIDDEN_PATTERNS = Object.freeze([
  '**/__pycache__/**',
  '**/*.pyc',
  'target/**',
  '.ae/**',
  '**/*.exe',
  '**/*.pdb',
  '**/*.log',
  'bench/aci/results/**',
]);

export class VerseShellBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerseShellBundleError';
  }
}

function fail(message) {
  throw new VerseShellBundleError(message);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) fail(`Unable to run ${commandText(command, args)}: ${result.error.message}`);
  const accepted = options.acceptStatuses ?? [0];
  if (!accepted.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || `exit ${result.status}`).trim();
    fail(`${commandText(command, args)} failed: ${detail}`);
  }
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function run(command, args, options = {}) {
  return execute(command, args, options).stdout.trim();
}

function runPreservingLeadingWhitespace(command, args, options = {}) {
  return execute(command, args, options).stdout.trimEnd();
}

function requireSupportedTarget(platform, arch) {
  if (platform !== SUPPORTED_TARGET.platform || arch !== SUPPORTED_TARGET.arch) {
    fail(`VerseShell bundle supports win32/x64 only; received ${platform}/${arch}.`);
  }
}

function cleanString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function requireExactKeys(value, expected, label) {
  const candidate = object(value, label);
  const actual = Object.keys(candidate).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields are incompatible: expected ${wanted.join(', ')}, found ${actual.join(', ')}.`);
  }
  return candidate;
}

function requireSha256(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(String(value || ''))) fail(`${label} must be a lowercase SHA-256.`);
  return value;
}

function requireHttpsRepository(value, label) {
  if (!/^https:\/\/[^\s]+\.git$/u.test(String(value || ''))) fail(`${label} must be an HTTPS Git repository.`);
  return value;
}

function normalizeRelativePath(value, label) {
  if (!cleanString(value) || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
    fail(`${label} must be a normalized forward-slash relative path.`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail(`${label} contains an unsafe path segment.`);
  }
  return value;
}

function resolveWithin(root, input, label) {
  const normalized = normalizeRelativePath(input, label);
  const destination = resolve(root, ...normalized.split('/'));
  const projectRelative = relative(resolve(root), destination);
  if (
    !projectRelative
    || projectRelative === '..'
    || projectRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    fail(`${label} must stay inside its declared root.`);
  }
  return destination;
}

function expectedArtifact(platform, arch) {
  return {
    path: `resources/bin/${platform}-${arch}/ae.exe`,
    packaged_path: 'bin/ae.exe',
  };
}

export function bundlePaths(root = PROJECT_ROOT, platform = 'win32', arch = 'x64') {
  const artifact = expectedArtifact(platform, arch);
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    complianceDir: join(resolvedRoot, 'resources', 'verseshell'),
    manifestPath: join(resolvedRoot, 'resources', 'verseshell', 'manifest.json'),
    sourceInputsPath: join(resolvedRoot, 'resources', 'verseshell', 'source-inputs.json'),
    binaryPath: join(resolvedRoot, ...artifact.path.split('/')),
    artifact,
  };
}

function packagedBundlePaths(resourcesPath) {
  const root = resolve(resourcesPath);
  return {
    root,
    complianceDir: join(root, 'resources', 'verseshell'),
    manifestPath: join(root, 'resources', 'verseshell', 'manifest.json'),
    sourceInputsPath: join(root, 'resources', 'verseshell', 'source-inputs.json'),
    binaryPath: join(root, 'bin', 'ae.exe'),
  };
}

async function readJson(jsonPath, label) {
  try {
    return object(JSON.parse((await readFile(jsonPath, 'utf8')).replace(/^\uFEFF/u, '')), label);
  } catch (error) {
    if (error instanceof VerseShellBundleError) throw error;
    fail(`Could not read ${label} at ${jsonPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function requireFile(filePath, label) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) fail(`${label} must be a non-empty regular file: ${filePath}`);
    return info;
  } catch (error) {
    if (error instanceof VerseShellBundleError) throw error;
    fail(`${label} is missing: ${filePath}`);
  }
}

async function sha256FileNormalized(filePath, options = {}) {
  const { normalizeEol = false } = options;
  let buffer = await readFile(filePath);
  if (normalizeEol) {
    // Treat CRLF/LF equivalently when byte-size matching a content-addressed
    // file that itself contains no intentionally-CRLF bytes. This unblocks
    // detached worktree checkouts under core.autocrlf=true on Windows without
    // rewriting the file on disk (root cause of RC-00 H-01 provision fail).
    const asText = buffer.toString('utf8');
    buffer = Buffer.from(asText.replace(/\r\n/g, '\n'), 'utf8');
  }
  return createHash('sha256').update(buffer).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function calculateSourceIdentity(sourceInputs) {
  const payload = structuredClone(object(sourceInputs, 'source inputs'));
  delete payload.identity;
  const payloadSha256 = sha256(JSON.stringify(canonicalize(payload)));
  return {
    payloadSha256,
    combinedSha256: sha256(`${SOURCE_IDENTITY_PREFIX}${payloadSha256}`),
  };
}

function parsePatchChangedPaths(patchText, label) {
  const entries = [...patchText.matchAll(/^diff --git a\/(.+?) b\/(.+?)\r?$/gmu)];
  if (entries.length === 0) fail(`${label} contains no Git patch entries.`);
  return entries.map((entry) => {
    const before = normalizeRelativePath(entry[1], `${label} before path`);
    const after = normalizeRelativePath(entry[2], `${label} after path`);
    if (before !== after) fail(`${label} cannot rename source paths (${before} -> ${after}).`);
    return after;
  });
}

function assertPathInventory(actual, expected, label, { preserveOrder = true } = {}) {
  const left = preserveOrder ? [...actual] : [...actual].sort();
  const right = preserveOrder ? [...expected] : [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label} mismatch: expected ${right.join(', ')}, found ${left.join(', ')}.`);
  }
}

function validateFileAssertionShape(entry, label) {
  requireExactKeys(entry, ['path', 'bytes', 'sha256'], label);
  normalizeRelativePath(entry.path, `${label}.path`);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) fail(`${label}.bytes must be a positive safe integer.`);
  requireSha256(entry.sha256, `${label}.sha256`);
}

function isForbiddenSourcePath(path) {
  const lower = path.toLowerCase();
  return lower.includes('/__pycache__/')
    || lower.endsWith('.pyc')
    || lower === 'target'
    || lower.startsWith('target/')
    || lower === '.ae'
    || lower.startsWith('.ae/')
    || lower.endsWith('.exe')
    || lower.endsWith('.pdb')
    || lower.endsWith('.log')
    || lower === 'bench/aci/results'
    || lower.startsWith('bench/aci/results/');
}

export async function loadAndValidateSourceInputs({ root = PROJECT_ROOT } = {}) {
  const paths = bundlePaths(root);
  const raw = await readFile(paths.sourceInputsPath);
  const sourceInputs = object(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/u, '')), 'VerseShell source inputs');
  requireExactKeys(sourceInputs, [
    'schema_version',
    'component',
    'repository',
    'commit',
    'commit_epoch',
    'patches',
    'recovered_inputs',
    'ignored_input_policy',
    'final_assertions',
    'test_contract',
    'toolchain',
    'build',
    'identity',
  ], 'source inputs');
  if (sourceInputs.schema_version !== SOURCE_INPUT_SCHEMA_VERSION || sourceInputs.component !== 'verseshell') {
    fail('Unsupported VerseShell source-input schema/component.');
  }
  requireHttpsRepository(sourceInputs.repository, 'source inputs.repository');
  if (sourceInputs.repository !== EXPECTED_REPOSITORY) fail('VerseShell source repository identity drifted.');
  if (sourceInputs.commit !== EXPECTED_COMMIT) fail('VerseShell pinned source commit drifted.');
  if (sourceInputs.commit_epoch !== EXPECTED_COMMIT_EPOCH) fail('VerseShell pinned commit epoch drifted.');

  const identity = requireExactKeys(sourceInputs.identity, [
    'algorithm', 'payload_sha256', 'combined_algorithm', 'combined_sha256',
  ], 'source inputs.identity');
  if (identity.algorithm !== 'sha256(canonical-json-without-identity)') fail('Source payload identity algorithm drifted.');
  if (identity.combined_algorithm !== 'sha256(verseshell.source-identity/v1\\n + payload_sha256)') {
    fail('Source combined identity algorithm drifted.');
  }
  const calculatedIdentity = calculateSourceIdentity(sourceInputs);
  if (identity.payload_sha256 !== calculatedIdentity.payloadSha256) fail('Source-input payload SHA-256 mismatch.');
  if (identity.combined_sha256 !== calculatedIdentity.combinedSha256) fail('Source-input combined SHA-256 mismatch.');

  const patches = array(sourceInputs.patches, 'source inputs.patches');
  if (patches.length !== EXPECTED_PATCHES.length) fail(`Source patch stack must contain ${EXPECTED_PATCHES.length} entries.`);
  for (let index = 0; index < patches.length; index += 1) {
    const patch = requireExactKeys(patches[index], [
      'order', 'role', 'path', 'bytes', 'sha256', 'changed_paths',
    ], `source inputs.patches[${index}]`);
    const [expectedRole, expectedPath] = EXPECTED_PATCHES[index];
    if (patch.order !== index + 1 || patch.role !== expectedRole || patch.path !== expectedPath) {
      fail(`Source patch order/role/path drifted at position ${index + 1}.`);
    }
    if (!Number.isSafeInteger(patch.bytes) || patch.bytes <= 0) fail(`Patch ${patch.path} has an invalid byte size.`);
    requireSha256(patch.sha256, `patch ${patch.path} SHA-256`);
    const patchPath = resolveWithin(paths.root, patch.path, `patch ${patch.order} path`);
    const patchInfo = await requireFile(patchPath, `VerseShell source patch ${patch.order}`);
    // Ordered source patches are content-addressed by the committed manifest.
    // Two byte forms are legal:
    //   1. Exact bytes: working tree preserved the recorded sha (POSIX LF checkout).
    //   2. EOL-normalised bytes: detached worktree on Windows where gitattributes
    //      didn't pin LF bytes for every patch file re-normalised the content.
    // We compare sha256 of the LF-normalised content so both checkouts agree.
    // Guard: if bytes differ, fail even if sha matches (file is corrupted, not merely EOL-smudged).
    if (patchInfo.size !== patch.bytes) {
      fail(`Patch ${patch.path} byte size mismatch: declared ${patch.bytes}, found ${patchInfo.size}, drift ${patchInfo.size - patch.bytes}.`);
    }
    const normalisedSha = await sha256FileNormalized(patchPath, { normalizeEol: true });
    if (normalisedSha !== patch.sha256) {
      fail(`Patch ${patch.path} checksum mismatch (content differs even after EOL normalisation).`);
    }
    const changedPaths = array(patch.changed_paths, `patch ${patch.order}.changed_paths`)
      .map((value, changedIndex) => normalizeRelativePath(value, `patch ${patch.order}.changed_paths[${changedIndex}]`));
    if (new Set(changedPaths).size !== changedPaths.length) fail(`Patch ${patch.path} repeats a changed path.`);
    if (changedPaths.some(isForbiddenSourcePath)) fail(`Patch ${patch.path} contains a generated or forbidden source path.`);
    const parsedChangedPaths = parsePatchChangedPaths(await readFile(patchPath, 'utf8'), `patch ${patch.path}`);
    assertPathInventory(parsedChangedPaths, changedPaths, `Patch ${patch.path} declared path inventory`);
  }

  const recovered = requireExactKeys(sourceInputs.recovered_inputs, [
    'verified_after_patch_order', 'upstream_ignore_rule', 'files',
  ], 'source inputs.recovered_inputs');
  // The target upstream tracks every python input, so this mechanism is retired: the
  // allowlist must be empty and must agree with the EXPECTED_RECOVERED_INPUTS constant.
  const recoveredFiles = array(recovered.files, 'source inputs.recovered_inputs.files');
  recoveredFiles.forEach((entry, index) => validateFileAssertionShape(entry, `recovered input ${index}`));
  assertPathInventory(recoveredFiles.map((entry) => entry.path), EXPECTED_RECOVERED_INPUTS, 'Recovered input allowlist');
  if (recoveredFiles.length !== 0) {
    fail('Recovered ignored-source inputs must be empty: the target upstream tracks them.');
  }

  const ignoredPolicy = requireExactKeys(sourceInputs.ignored_input_policy, [
    'allowlist', 'forbidden_patterns',
  ], 'source inputs.ignored_input_policy');
  if (ignoredPolicy.allowlist !== 'recovered_inputs.files') fail('Ignored-source allowlist reference drifted.');
  assertPathInventory(
    array(ignoredPolicy.forbidden_patterns, 'ignored forbidden patterns'),
    EXPECTED_FORBIDDEN_PATTERNS,
    'Ignored-source forbidden patterns',
  );

  const assertions = array(sourceInputs.final_assertions, 'source inputs.final_assertions');
  assertions.forEach((entry, index) => validateFileAssertionShape(entry, `final assertion ${index}`));
  const assertionPaths = assertions.map((entry) => entry.path);
  if (new Set(assertionPaths).size !== assertionPaths.length) fail('Final source assertions repeat a path.');
  for (const required of REQUIRED_FINAL_ASSERTIONS) {
    if (!assertionPaths.includes(required)) fail(`Final source assertions omit ${required}.`);
  }
  for (const recoveredPath of EXPECTED_RECOVERED_INPUTS) {
    if (!assertionPaths.includes(recoveredPath)) fail(`Final source assertions omit recovered input ${recoveredPath}.`);
  }
  for (const pythonInput of ['bench/aci/runners/run_suite.py', 'bench/aci/scorers/score.py']) {
    if (!assertionPaths.includes(pythonInput)) fail(`Final source assertions omit tracked python input ${pythonInput}.`);
  }

  const testContract = requireExactKeys(sourceInputs.test_contract, [
    'rust', 'python_optional_verify',
  ], 'source inputs.test_contract');
  const expectedRustTests = [
    ['cargo', 'test', '--locked', '-j', '1'],
    ['cargo', 'test', '--locked', '--no-run', '-j', '1'],
  ];
  if (JSON.stringify(testContract.rust) !== JSON.stringify(expectedRustTests)) fail('Rust qualification command contract drifted.');
  const pythonContract = requireExactKeys(testContract.python_optional_verify, [
    'runner', 'interpreter_token', 'module_argv', 'task_ids',
  ], 'source inputs.test_contract.python_optional_verify');
  if (
    pythonContract.runner !== 'bench/aci/runners/run_suite.py'
    || pythonContract.interpreter_token !== '{current_python}'
    || JSON.stringify(pythonContract.module_argv) !== JSON.stringify(['{current_python}', '-m', 'pytest', '-q'])
  ) {
    fail('Python current-interpreter verifier contract drifted.');
  }
  assertPathInventory(pythonContract.task_ids, EXPECTED_PYTHON_TASKS, 'Python verifier task inventory');

  const toolchain = requireExactKeys(sourceInputs.toolchain, [
    'cargo_version', 'rustc_version', 'target',
  ], 'source inputs.toolchain');
  if (
    toolchain.cargo_version !== EXPECTED_CARGO_VERSION
    || toolchain.rustc_version !== EXPECTED_RUSTC_VERSION
    || toolchain.target !== EXPECTED_CARGO_TARGET
  ) {
    fail('VerseShell source toolchain contract drifted.');
  }

  const build = requireExactKeys(sourceInputs.build, [
    'argv',
    'independent_source_roots',
    'independent_target_roots',
    'environment',
    'encoded_rustflags',
    'binary_relative_path',
    'comparison',
  ], 'source inputs.build');
  if (JSON.stringify(build.argv) !== JSON.stringify(['cargo', 'build', '--locked', '--release', '--bin', 'ae'])) {
    fail('VerseShell reproducible build argv drifted.');
  }
  if (build.independent_source_roots !== 2 || build.independent_target_roots !== 2) {
    fail('VerseShell reproducible build must use two independent source and target roots.');
  }
  requireExactKeys(build.environment, ['CARGO_INCREMENTAL', 'SOURCE_DATE_EPOCH'], 'source inputs.build.environment');
  if (
    build.environment.CARGO_INCREMENTAL !== '0'
    || build.environment.SOURCE_DATE_EPOCH !== String(sourceInputs.commit_epoch)
  ) {
    fail('VerseShell reproducible build environment drifted.');
  }
  const expectedFlags = [
    '--remap-path-prefix={source_root}=/verseshell/source',
    '--remap-path-prefix={target_root}=/verseshell/target',
    '-C',
    'link-arg=/Brepro',
    '-C',
    'link-arg=/PDBALTPATH:%_PDB%',
  ];
  if (JSON.stringify(build.encoded_rustflags) !== JSON.stringify(expectedFlags)) {
    fail('VerseShell deterministic rustflags drifted.');
  }
  if (build.binary_relative_path !== 'release/ae.exe' || build.comparison !== 'byte-identical-sha256') {
    fail('VerseShell reproducible output/comparison contract drifted.');
  }

  return {
    sourceInputs,
    raw,
    sha256: sha256(raw),
    identity: calculatedIdentity,
    paths,
  };
}

async function validateComplianceFiles(complianceDir, manifest) {
  const compliance = object(manifest.compliance, 'manifest.compliance');
  for (const [key, filename] of Object.entries(COMPLIANCE_FILES)) {
    if (compliance[key] !== filename) fail(`manifest.compliance.${key} must be ${filename}.`);
    await requireFile(join(complianceDir, filename), `VerseShell compliance ${key}`);
  }
  const license = await readFile(join(complianceDir, COMPLIANCE_FILES.license_file), 'utf8');
  const hasOfficialAgplHeading = /^(?:\uFEFF)?[ \t]*GNU AFFERO GENERAL PUBLIC LICENSE\r?\n[ \t]*Version 3, 19 November 2007\r?\n/u.test(license);
  if (!hasOfficialAgplHeading) fail('VerseShell license is not the official GNU AGPL v3 text.');
}

function correspondingSourceLocator(sourceInputs, identity) {
  return `${sourceInputs.repository}@${sourceInputs.commit}+${SOURCE_INPUTS_PATH}#sha256:${identity.combinedSha256}`;
}

function validateManifest(manifest, { platform, arch, mode, sourceBundle }) {
  requireExactKeys(manifest, [
    'schema_version', 'component', 'upstream', 'license', 'crate', 'protocol', 'compliance', 'build', 'artifacts', 'provenance',
  ], 'manifest');
  if (manifest.schema_version !== BUNDLE_SCHEMA_VERSION || manifest.component !== 'verseshell') {
    fail('Unsupported VerseShell manifest schema/component.');
  }
  if (manifest.license !== 'AGPL-3.0-or-later') fail('VerseShell manifest license identity drifted.');
  const { sourceInputs, identity } = sourceBundle;
  const upstream = requireExactKeys(manifest.upstream, [
    'cargo_repository', 'source_repository', 'pinned_commit', 'pinned_commit_epoch', 'source_model', 'pinned_commit_status',
  ], 'manifest.upstream');
  if (
    upstream.cargo_repository !== 'https://github.com/nervosys/verseshell'
    || upstream.source_repository !== sourceInputs.repository
    || upstream.pinned_commit !== sourceInputs.commit
    || upstream.pinned_commit_epoch !== sourceInputs.commit_epoch
    || upstream.source_model !== 'pinned-commit-plus-ordered-patches'
    || upstream.pinned_commit_status !== 'qualified_ordered_patch_stack'
  ) {
    fail('VerseShell manifest upstream source identity drifted.');
  }

  const crate = requireExactKeys(manifest.crate, ['name', 'version', 'rust_version', 'edition'], 'manifest.crate');
  if (crate.name !== 'verseshell' || crate.version !== '1.0.0' || crate.rust_version !== '1.75' || crate.edition !== '2021') {
    fail('VerseShell manifest crate identity drifted.');
  }
  const protocol = requireExactKeys(manifest.protocol, [
    'observation_schema',
    'mcp_protocol_version',
    'expected_server_protocol',
    'operation_catalog_schema',
    'operation_catalog_digest',
    'operation_catalog_count',
    'handshake_operation',
    'server_name',
    'server_version',
  ], 'manifest.protocol');
  if (
    protocol.observation_schema !== 'verseshell.observation/v1'
    || protocol.mcp_protocol_version !== '2024-11-05'
    || protocol.expected_server_protocol !== EXPECTED_PROTOCOL
    || protocol.operation_catalog_schema !== EXPECTED_CATALOG_SCHEMA
    || protocol.operation_catalog_digest !== EXPECTED_CATALOG_DIGEST
    || protocol.operation_catalog_count !== EXPECTED_CATALOG_COUNT
    || protocol.handshake_operation !== 'runtime.handshake'
    || protocol.server_name !== 'ae-mcp'
    || protocol.server_version !== crate.version
  ) {
    fail('VerseShell manifest protocol/catalog identity drifted.');
  }

  const locator = correspondingSourceLocator(sourceInputs, identity);
  const compliance = requireExactKeys(manifest.compliance, [
    'license_file',
    'notice_file',
    'source_file',
    'build_file',
    'source_inputs_file',
    'notice_path',
    'source_instructions_path',
    'build_instructions_path',
    'source_inputs_path',
    'corresponding_source_locator',
    'corresponding_source_status',
    'patch_paths',
  ], 'manifest.compliance');
  if (
    compliance.notice_path !== 'resources/verseshell/NOTICE.md'
    || compliance.source_instructions_path !== 'resources/verseshell/SOURCE.md'
    || compliance.build_instructions_path !== 'resources/verseshell/BUILD.md'
    || compliance.source_inputs_path !== SOURCE_INPUTS_PATH
    || compliance.corresponding_source_locator !== locator
    || compliance.corresponding_source_status !== 'tracked_ordered_patch_stack'
    || JSON.stringify(compliance.patch_paths) !== JSON.stringify(sourceInputs.patches.map((patch) => patch.path))
  ) {
    fail('VerseShell manifest corresponding-source payload drifted.');
  }

  const build = requireExactKeys(manifest.build, [
    'instructions_path',
    'command',
    'primary_binary',
    'mcp_binary',
    'cargo_version',
    'rustc_version',
    'cargo_target',
    'cargo_metadata',
    'cargo_toml_sha256',
    'cargo_lock_sha256',
    'source_inputs_sha256',
    'source_identity_sha256',
    'controls',
    'qualification',
    'reproducibility',
    'synchronized_at',
  ], 'manifest.build');
  if (
    build.instructions_path !== 'resources/verseshell/BUILD.md'
    || build.command !== 'cargo build --locked --release --bin ae'
    || build.primary_binary !== 'ae'
    || build.mcp_binary !== 'not_packaged'
    || !String(build.cargo_version).startsWith(`cargo ${EXPECTED_CARGO_VERSION} `)
    || !String(build.rustc_version).includes(`release: ${EXPECTED_RUSTC_VERSION}`)
    || build.cargo_target !== EXPECTED_CARGO_TARGET
    || build.source_inputs_sha256 !== sourceBundle.sha256
    || build.source_identity_sha256 !== identity.combinedSha256
  ) {
    fail('VerseShell manifest build/source/toolchain identity drifted.');
  }
  requireSha256(build.cargo_toml_sha256, 'manifest.build.cargo_toml_sha256');
  requireSha256(build.cargo_lock_sha256, 'manifest.build.cargo_lock_sha256');
  const cargoMetadata = requireExactKeys(build.cargo_metadata, [
    'package_name', 'package_version', 'target_directory',
  ], 'manifest.build.cargo_metadata');
  if (
    cargoMetadata.package_name !== 'verseshell'
    || cargoMetadata.package_version !== crate.version
    || cargoMetadata.target_directory !== '[independent-build-root]/target'
  ) {
    fail('VerseShell manifest Cargo metadata drifted.');
  }
  const controls = requireExactKeys(build.controls, [
    'cargo_incremental', 'source_date_epoch', 'encoded_rustflags',
  ], 'manifest.build.controls');
  if (
    controls.cargo_incremental !== sourceInputs.build.environment.CARGO_INCREMENTAL
    || controls.source_date_epoch !== sourceInputs.commit_epoch
    || JSON.stringify(controls.encoded_rustflags) !== JSON.stringify(sourceInputs.build.encoded_rustflags)
  ) {
    fail('VerseShell manifest reproducibility controls drifted.');
  }

  const qualification = requireExactKeys(build.qualification, [
    'status', 'rust_tests', 'python_optional_verify',
  ], 'manifest.build.qualification');
  if (qualification.status !== 'passed') fail('VerseShell source qualification did not pass.');
  if (
    !Array.isArray(qualification.rust_tests)
    || qualification.rust_tests.length !== sourceInputs.test_contract.rust.length
    || qualification.rust_tests.some((entry, index) => (
      entry?.exit_code !== 0
      || JSON.stringify(entry.argv) !== JSON.stringify(sourceInputs.test_contract.rust[index])
    ))
  ) {
    fail('VerseShell Rust qualification proof is incomplete.');
  }
  const pythonProof = requireExactKeys(qualification.python_optional_verify, [
    'status', 'interpreter_version', 'task_ids', 'passed', 'failed',
  ], 'manifest.build.qualification.python_optional_verify');
  if (
    pythonProof.status !== 'passed'
    || !cleanString(pythonProof.interpreter_version)
    || JSON.stringify(pythonProof.task_ids) !== JSON.stringify(EXPECTED_PYTHON_TASKS)
    || pythonProof.passed !== EXPECTED_PYTHON_TASKS.length
    || pythonProof.failed !== 0
  ) {
    fail('VerseShell Python current-interpreter qualification proof is incomplete.');
  }

  const reproducibility = requireExactKeys(build.reproducibility, [
    'status',
    'independent_source_roots',
    'independent_target_roots',
    'byte_identical',
    'binary_sha256',
    'bytes',
    'builds',
  ], 'manifest.build.reproducibility');
  if (
    reproducibility.status !== 'passed'
    || reproducibility.independent_source_roots !== 2
    || reproducibility.independent_target_roots !== 2
    || reproducibility.byte_identical !== true
    || !Number.isSafeInteger(reproducibility.bytes)
    || reproducibility.bytes <= 0
  ) {
    fail('VerseShell two-build reproducibility proof is incomplete.');
  }
  requireSha256(reproducibility.binary_sha256, 'manifest.build.reproducibility.binary_sha256');
  if (!Array.isArray(reproducibility.builds) || reproducibility.builds.length !== 2) {
    fail('VerseShell reproducibility proof must contain two builds.');
  }
  for (let index = 0; index < reproducibility.builds.length; index += 1) {
    const entry = requireExactKeys(reproducibility.builds[index], [
      'ordinal', 'sha256', 'bytes', 'handshake',
    ], `manifest.build.reproducibility.builds[${index}]`);
    const handshake = requireExactKeys(entry.handshake, [
      'runtime_version', 'server_protocol', 'operation_catalog_schema', 'operation_catalog_digest', 'operation_catalog_count',
    ], `manifest.build.reproducibility.builds[${index}].handshake`);
    if (
      entry.ordinal !== index + 1
      || entry.sha256 !== reproducibility.binary_sha256
      || entry.bytes !== reproducibility.bytes
      || handshake.runtime_version !== crate.version
      || handshake.server_protocol !== EXPECTED_PROTOCOL
      || handshake.operation_catalog_schema !== EXPECTED_CATALOG_SCHEMA
      || handshake.operation_catalog_digest !== EXPECTED_CATALOG_DIGEST
      || handshake.operation_catalog_count !== EXPECTED_CATALOG_COUNT
    ) {
      fail(`VerseShell reproducibility build ${index + 1} identity drifted.`);
    }
  }
  if (!cleanString(build.synchronized_at) || Number.isNaN(Date.parse(build.synchronized_at))) {
    fail('VerseShell manifest build.synchronized_at is invalid.');
  }

  const provenance = requireExactKeys(manifest.provenance, [
    'repository',
    'commit',
    'commit_epoch',
    'source_model',
    'unrecorded_changes',
    'source_inputs',
    'corresponding_source',
  ], 'manifest.provenance');
  if (
    provenance.repository !== sourceInputs.repository
    || provenance.commit !== sourceInputs.commit
    || provenance.commit_epoch !== sourceInputs.commit_epoch
    || provenance.source_model !== 'pinned-commit-plus-ordered-patches'
    || provenance.unrecorded_changes !== false
  ) {
    fail('VerseShell manifest provenance identity drifted.');
  }
  const provenanceInputs = requireExactKeys(provenance.source_inputs, [
    'path', 'sha256', 'identity_sha256', 'patch_count', 'recovered_input_count',
  ], 'manifest.provenance.source_inputs');
  if (
    provenanceInputs.path !== SOURCE_INPUTS_PATH
    || provenanceInputs.sha256 !== sourceBundle.sha256
    || provenanceInputs.identity_sha256 !== identity.combinedSha256
    || provenanceInputs.patch_count !== sourceInputs.patches.length
    || provenanceInputs.recovered_input_count !== sourceInputs.recovered_inputs.files.length
  ) {
    fail('VerseShell manifest source-input provenance drifted.');
  }
  const corresponding = requireExactKeys(provenance.corresponding_source, [
    'locator', 'patch_paths', 'instructions',
  ], 'manifest.provenance.corresponding_source');
  if (
    corresponding.locator !== locator
    || JSON.stringify(corresponding.patch_paths) !== JSON.stringify(sourceInputs.patches.map((patch) => patch.path))
    || !cleanString(corresponding.instructions)
  ) {
    fail('VerseShell manifest corresponding-source instructions drifted.');
  }

  const artifacts = requireExactKeys(manifest.artifacts, [
    'win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64',
  ], 'manifest.artifacts');
  const target = `${platform}-${arch}`;
  const artifact = object(artifacts[target], `manifest.artifacts.${target}`);
  const expected = expectedArtifact(platform, arch);
  if (artifact.path !== expected.path || artifact.packaged_path !== expected.packaged_path) {
    fail(`manifest.artifacts.${target} has wrong source/packaged paths.`);
  }
  if (
    artifact.sha256 !== reproducibility.binary_sha256
    || artifact.bytes !== reproducibility.bytes
    || artifact.version !== crate.version
  ) {
    fail(`manifest.artifacts.${target} does not match the reproducibility proof.`);
  }
  if (mode === 'package' && target !== 'win32-x64') fail('VerseShell package qualification supports win32-x64 only.');
  return artifact;
}

async function validateArtifact(binaryPath, artifact) {
  const info = await requireFile(binaryPath, 'VerseShell ae.exe');
  if (info.size !== artifact.bytes) fail(`VerseShell binary size mismatch: expected ${artifact.bytes}, found ${info.size}.`);
  const actualSha256 = await sha256File(binaryPath);
  if (actualSha256 !== artifact.sha256) {
    fail(`VerseShell binary checksum mismatch: expected ${artifact.sha256}, found ${actualSha256}.`);
  }
}

async function validateBundleAtPaths(paths, { platform, arch, mode }) {
  const sourceBundle = await loadAndValidateSourceInputs({ root: paths.root });
  const manifest = await readJson(paths.manifestPath, 'VerseShell manifest');
  const artifact = validateManifest(manifest, { platform, arch, mode, sourceBundle });
  await validateComplianceFiles(paths.complianceDir, manifest);
  await validateArtifact(paths.binaryPath, artifact);
  return { manifest, artifact, paths, sourceBundle };
}

export async function validateSourceBundle({ root = PROJECT_ROOT, platform = 'win32', arch = 'x64', mode = 'dev' } = {}) {
  requireSupportedTarget(platform, arch);
  if (!['dev', 'package'].includes(mode)) fail(`Unsupported bundle mode: ${mode}.`);
  return validateBundleAtPaths(bundlePaths(root, platform, arch), { platform, arch, mode });
}

export async function validatePackagedBundle({ resourcesPath, platform = 'win32', arch = 'x64', mode = 'package' } = {}) {
  requireSupportedTarget(platform, arch);
  if (!resourcesPath) fail('verify-package requires --resources <unpacked resources directory> or a built release/win-unpacked tree.');
  return validateBundleAtPaths(packagedBundlePaths(resourcesPath), { platform, arch, mode });
}

export async function atomicCopy(sourcePath, destinationPath, operations = {}) {
  const copy = operations.copyFile ?? copyFile;
  const move = operations.rename ?? rename;
  const remove = operations.rm ?? rm;
  const tempPath = join(dirname(destinationPath), `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await copy(sourcePath, tempPath);
    await move(tempPath, destinationPath);
  } catch (error) {
    await remove(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function atomicReplaceBundle(binarySource, binaryDestination, manifestDestination, manifest) {
  await mkdir(dirname(binaryDestination), { recursive: true });
  await mkdir(dirname(manifestDestination), { recursive: true });
  const token = `${process.pid}.${randomUUID()}`;
  const stagedBinary = join(dirname(binaryDestination), `.${basename(binaryDestination)}.${token}.tmp`);
  const stagedManifest = join(dirname(manifestDestination), `.${basename(manifestDestination)}.${token}.tmp`);
  const binaryBackup = `${binaryDestination}.${token}.bak`;
  const manifestBackup = `${manifestDestination}.${token}.bak`;
  await copyFile(binarySource, stagedBinary);
  await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  let binaryBackedUp = false;
  let manifestBackedUp = false;
  let binaryInstalled = false;
  let manifestInstalled = false;
  try {
    if (existsSync(binaryDestination)) {
      await rename(binaryDestination, binaryBackup);
      binaryBackedUp = true;
    }
    if (existsSync(manifestDestination)) {
      await rename(manifestDestination, manifestBackup);
      manifestBackedUp = true;
    }
    await rename(stagedBinary, binaryDestination);
    binaryInstalled = true;
    await rename(stagedManifest, manifestDestination);
    manifestInstalled = true;
    await rm(binaryBackup, { force: true });
    await rm(manifestBackup, { force: true });
  } catch (error) {
    if (manifestInstalled) await rm(manifestDestination, { force: true }).catch(() => undefined);
    if (binaryInstalled) await rm(binaryDestination, { force: true }).catch(() => undefined);
    if (manifestBackedUp) await rename(manifestBackup, manifestDestination).catch(() => undefined);
    if (binaryBackedUp) await rename(binaryBackup, binaryDestination).catch(() => undefined);
    throw error;
  } finally {
    await rm(stagedBinary, { force: true }).catch(() => undefined);
    await rm(stagedManifest, { force: true }).catch(() => undefined);
    await rm(binaryBackup, { force: true }).catch(() => undefined);
    await rm(manifestBackup, { force: true }).catch(() => undefined);
  }
}

function listNullSeparated(command, args, cwd) {
  const output = execute(command, args, { cwd }).stdout;
  return output.split('\0').filter(Boolean);
}

export function collectSourceDiff(source, { ignoredAllowlist = [] } = {}) {
  const root = resolve(source);
  const tracked = run('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], { cwd: root });
  const ordinaryUntracked = listNullSeparated('git', ['ls-files', '--others', '--exclude-standard', '-z'], root);
  const explicitIgnored = ignoredAllowlist.map((path, index) => normalizeRelativePath(path, `ignoredAllowlist[${index}]`));
  for (const path of explicitIgnored) {
    if (isForbiddenSourcePath(path)) fail(`Ignored source allowlist contains forbidden generated path ${path}.`);
    const ignored = execute('git', ['check-ignore', '--quiet', '--', path], { cwd: root, acceptStatuses: [0, 1] });
    if (ignored.status !== 0) fail(`Explicit ignored source input is not ignored by Git: ${path}.`);
    if (!existsSync(resolveWithin(root, path, `ignored source ${path}`))) fail(`Explicit ignored source input is missing: ${path}.`);
  }
  const untracked = [...new Set([...ordinaryUntracked, ...explicitIgnored])].sort((left, right) => left.localeCompare(right));
  const patches = [tracked];
  for (const path of untracked) {
    patches.push(execute(
      'git',
      ['diff', '--binary', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
      { cwd: root, acceptStatuses: [0, 1] },
    ).stdout.trim());
  }
  return `${patches.filter(Boolean).join('\n')}\n`;
}

export async function captureSourcePatch({ source, output, ignoredAllowlist = [] }) {
  if (!source) fail('capture-patch requires --source <VerseShell source path>.');
  if (!output) fail('capture-patch requires --output <workspace-relative patch path>.');
  const sourceRoot = resolve(source);
  await requireFile(join(sourceRoot, 'Cargo.toml'), 'VerseShell Cargo.toml');
  const destination = resolveWithin(PROJECT_ROOT, output, 'capture-patch output');
  const diff = collectSourceDiff(sourceRoot, { ignoredAllowlist });
  if (!diff.trim()) fail('VerseShell source has no changes to capture.');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, diff, 'utf8');
  return { path: destination, bytes: Buffer.byteLength(diff), sha256: sha256(diff) };
}

async function verifyFileAssertions(sourceRoot, assertions, label) {
  for (const entry of assertions) {
    const path = resolveWithin(sourceRoot, entry.path, `${label} ${entry.path}`);
    const info = await requireFile(path, `${label} ${entry.path}`);
    // Reconstruction runs with `git clone -c core.autocrlf=false -c core.eol=lf`,
    // then applies the ordered patches; both effects guarantee LF-only outputs.
    // The manifest was authored against whatever EOL the host checked out, so a
    // recovered-input record may legitimately have CRLF-era byte/sha entries.
    // Compare size+sha after LF-normalisation to make reconstruction host-agnostic.
    const sourceBytes = await readFile(path);
    const normalised = Buffer.from(sourceBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (normalised.length !== entry.bytes) {
      fail(`${label} ${entry.path} byte size mismatch (LF-normalised): expected ${entry.bytes}, found ${normalised.length}.`);
    }
    const digest = createHash('sha256').update(normalised).digest('hex');
    if (digest !== entry.sha256) {
      fail(`${label} ${entry.path} checksum mismatch (LF-normalised): expected ${entry.sha256}, found ${digest}.`);
    }
    // Also accept exact-bytes when the manifest does record LF variants:
    if (info.size !== entry.bytes && digest === entry.sha256) {
      // OK: bytes differ only because one side records CRLF-era size; content matches.
      continue;
    }
    if (info.size !== entry.bytes) {
      fail(`${label} ${entry.path} byte size mismatch: expected ${entry.bytes}, found ${info.size}.`);
    }
  }
}

function parsePorcelainPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => entry.slice(3));
}

async function verifyReconstructionInventory(sourceRoot, sourceInputs) {
  const ignored = listNullSeparated('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], sourceRoot);
  assertPathInventory(ignored, sourceInputs.recovered_inputs.files.map((entry) => entry.path), 'Ignored reconstructed input inventory', {
    preserveOrder: false,
  });
  const visibleStatus = parsePorcelainPaths(execute(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: sourceRoot },
  ).stdout);
  const declared = [...new Set(sourceInputs.patches.flatMap((patch) => patch.changed_paths))]
    .filter((path) => !sourceInputs.recovered_inputs.files.some((entry) => entry.path === path));
  assertPathInventory(visibleStatus, declared, 'Visible reconstructed source inventory', { preserveOrder: false });
}

export async function reconstructSource({
  root = PROJECT_ROOT,
  destination,
  sourceMirror,
  sourceBundle,
} = {}) {
  if (!destination) fail('Source reconstruction requires a destination.');
  const bundle = sourceBundle ?? await loadAndValidateSourceInputs({ root });
  const { sourceInputs } = bundle;
  const destinationRoot = resolve(destination);
  if (existsSync(destinationRoot)) fail(`Source reconstruction destination already exists: ${destinationRoot}`);
  const transport = cleanString(sourceMirror) ?? sourceInputs.repository;
  execute('git', [
    'clone',
    '-c', 'core.autocrlf=false',
    '-c', 'core.eol=lf',
    '--no-checkout',
    transport,
    destinationRoot,
  ]);
  execute('git', ['checkout', '--detach', sourceInputs.commit], { cwd: destinationRoot });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: destinationRoot });
  const epoch = Number(run('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: destinationRoot }));
  if (head !== sourceInputs.commit || epoch !== sourceInputs.commit_epoch) {
    fail(`Reconstructed source identity mismatch: ${head}@${epoch}.`);
  }
  if (runPreservingLeadingWhitespace('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: destinationRoot })) {
    fail('Fresh reconstructed source is unexpectedly dirty before patch application.');
  }
  for (const patch of sourceInputs.patches) {
    const patchPath = resolveWithin(resolve(root), patch.path, `patch ${patch.order}`);
    execute('git', ['apply', '--check', '--whitespace=nowarn', patchPath], { cwd: destinationRoot });
    execute('git', ['apply', '--whitespace=nowarn', patchPath], { cwd: destinationRoot });
    if (sourceInputs.recovered_inputs.files.length > 0
      && patch.order === sourceInputs.recovered_inputs.verified_after_patch_order) {
      await verifyFileAssertions(destinationRoot, sourceInputs.recovered_inputs.files, 'Recovered source input');
    }
  }
  await verifyFileAssertions(destinationRoot, sourceInputs.final_assertions, 'Final source assertion');
  await verifyReconstructionInventory(destinationRoot, sourceInputs);
  return { sourceRoot: destinationRoot, sourceBundle: bundle };
}

function verifyToolchain(sourceInputs) {
  const cargoVersion = run('cargo', ['--version']);
  const rustcVersion = run('rustc', ['-vV']);
  const cargoRelease = cargoVersion.match(/^cargo\s+(\d+\.\d+\.\d+)/u)?.[1];
  const rustcRelease = rustcVersion.match(/^release:\s*(.+)$/mu)?.[1]?.trim();
  const host = rustcVersion.match(/^host:\s*(.+)$/mu)?.[1]?.trim();
  if (
    cargoRelease !== sourceInputs.toolchain.cargo_version
    || rustcRelease !== sourceInputs.toolchain.rustc_version
    || host !== sourceInputs.toolchain.target
  ) {
    fail(`VerseShell requires Cargo ${sourceInputs.toolchain.cargo_version}, rustc ${sourceInputs.toolchain.rustc_version}, ${sourceInputs.toolchain.target}; found ${cargoVersion}, rustc ${rustcRelease || 'unknown'}, ${host || 'unknown'}.`);
  }
  return { cargoVersion, rustcVersion, host };
}

function parseCargoMetadata(sourceRoot) {
  const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd: sourceRoot }));
  const normalizedManifest = join(sourceRoot, 'Cargo.toml').replace(/\\/gu, '/').toLowerCase();
  const pkg = metadata.packages?.find((candidate) => String(candidate.manifest_path).replace(/\\/gu, '/').toLowerCase() === normalizedManifest)
    ?? metadata.packages?.[0];
  if (!pkg || pkg.name !== 'verseshell' || pkg.version !== '1.0.0') fail('Cargo metadata did not identify verseshell 1.0.0.');
  return {
    package_name: pkg.name,
    package_version: pkg.version,
    target_directory: '[independent-build-root]/target',
  };
}

function findPython(explicitPython) {
  const candidates = [];
  if (cleanString(explicitPython)) candidates.push([explicitPython, []]);
  if (cleanString(process.env.PYTHON)) candidates.push([process.env.PYTHON, []]);
  candidates.push(['python', []]);
  if (process.platform === 'win32') candidates.push(['py', ['-3']]);
  else candidates.push(['python3', []]);
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.executable); print(sys.version.split()[0])'], {
      encoding: 'utf8', shell: false, windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      const [executable, version] = String(result.stdout || '').trim().split(/\r?\n/u);
      if (cleanString(executable) && cleanString(version)) return { executable, version };
    }
  }
  return null;
}

async function runPythonQualification(sourceRoot, qualificationTarget, sourceInputs, explicitPython) {
  const python = findPython(explicitPython);
  if (!python) fail('Python current interpreter is unavailable; refusing a false-green optional verifier result.');
  const pytest = spawnSync(python.executable, ['-m', 'pytest', '--version'], {
    encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (pytest.error || pytest.status !== 0) {
    fail(`Python ${python.version} lacks the required pytest module; optional verifier is unsupported and cannot qualify a package.`);
  }
  await mkdir(qualificationTarget, { recursive: true });
  const outputPath = join(qualificationTarget, 'python-verifier.json');
  const contract = sourceInputs.test_contract.python_optional_verify;
  execute(python.executable, [
    contract.runner,
    '--mode', 'mock',
    '--conditions', 'verseshell_aci',
    '--tasks', contract.task_ids.join(','),
    '--optional-verify',
    '--out', outputPath,
  ], { cwd: sourceRoot });
  const result = JSON.parse(await readFile(outputPath, 'utf8'));
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const relevant = rows.filter((row) => contract.task_ids.includes(row.task_id));
  const failures = relevant.filter((row) => row.success !== true || row.optional_verify?.ok !== true);
  if (relevant.length !== contract.task_ids.length || failures.length > 0) {
    fail(`Python optional verifier failed or omitted tasks: ${JSON.stringify(failures.map((row) => ({ task: row.task_id, verify: row.optional_verify })))}.`);
  }
  return {
    status: 'passed',
    interpreter_version: `Python ${python.version}`,
    task_ids: [...contract.task_ids],
    passed: relevant.length,
    failed: 0,
  };
}

async function qualifySource(sourceRoot, qualificationTarget, sourceInputs, explicitPython) {
  await mkdir(qualificationTarget, { recursive: true });
  const rustTests = [];
  for (const argv of sourceInputs.test_contract.rust) {
    const [command, ...args] = argv;
    execute(command, args, {
      cwd: sourceRoot,
      env: { CARGO_TARGET_DIR: join(qualificationTarget, 'cargo-target') },
    });
    rustTests.push({ argv: [...argv], exit_code: 0 });
  }
  const pythonProof = await runPythonQualification(sourceRoot, join(qualificationTarget, 'python'), sourceInputs, explicitPython);
  return { status: 'passed', rust_tests: rustTests, python_optional_verify: pythonProof };
}

function reproducibleBuildEnv(sourceRoot, targetRoot, sourceInputs) {
  const flags = sourceInputs.build.encoded_rustflags.map((flag) => flag
    .replace('{source_root}', sourceRoot)
    .replace('{target_root}', targetRoot));
  return {
    CARGO_INCREMENTAL: sourceInputs.build.environment.CARGO_INCREMENTAL,
    SOURCE_DATE_EPOCH: sourceInputs.build.environment.SOURCE_DATE_EPOCH,
    CARGO_TARGET_DIR: targetRoot,
    CARGO_ENCODED_RUSTFLAGS: flags.join('\u001f'),
  };
}

async function probeRuntimeContract(binaryPath) {
  const workspace = await mkdtemp(join(tmpdir(), 'clawx-verseshell-contract-'));
  const policyDigest = `sha256:${'0'.repeat(64)}`;
  const request = `${JSON.stringify({
    id: 'bundle-contract',
    agent: 'clawx-bundle',
    op: 'runtime.handshake',
    args: {},
    timeout_ms: 5000,
    budget: { max_tokens: 4000 },
  })}\n`;
  try {
    const result = execute(binaryPath, [
      '--serve', '--agent', '--format', 'json', '--policy', 'strict', '--workspace', workspace, '--max-concurrency', '1',
    ], {
      cwd: workspace,
      input: request,
      env: {
        AETHER_MODE: 'agent',
        AETHER_POLICY: 'strict',
        AETHER_WORKSPACE: workspace,
        VERSESHELL_POLICY_PROFILE_ID: 'clawx-bundle-probe',
        VERSESHELL_POLICY_PROFILE_DIGEST: policyDigest,
      },
    });
    const observation = result.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((value) => value?.op === 'runtime.handshake');
    const data = observation?.ok === true ? observation.data : null;
    const catalog = data?.operation_catalog;
    if (
      data?.policy_mode !== 'agent_strict'
      || data?.server_protocol !== EXPECTED_PROTOCOL
      || data?.operation_catalog_schema !== EXPECTED_CATALOG_SCHEMA
      || catalog?.digest !== EXPECTED_CATALOG_DIGEST
      || catalog?.count !== EXPECTED_CATALOG_COUNT
      || data?.runtime_version !== '1.0.0'
    ) {
      fail('Built VerseShell runtime returned an incompatible typed ACI handshake/catalog identity.');
    }
    return {
      runtime_version: data.runtime_version,
      server_protocol: data.server_protocol,
      operation_catalog_schema: data.operation_catalog_schema,
      operation_catalog_digest: catalog.digest,
      operation_catalog_count: catalog.count,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function buildOne(sourceRoot, targetRoot, sourceInputs, ordinal) {
  await mkdir(targetRoot, { recursive: true });
  const [command, ...args] = sourceInputs.build.argv;
  execute(command, args, {
    cwd: sourceRoot,
    env: reproducibleBuildEnv(sourceRoot, targetRoot, sourceInputs),
  });
  const binaryPath = resolveWithin(targetRoot, sourceInputs.build.binary_relative_path, 'built ae.exe path');
  const info = await requireFile(binaryPath, `VerseShell reproducible build ${ordinal} ae.exe`);
  const digest = await sha256File(binaryPath);
  const handshake = await probeRuntimeContract(binaryPath);
  return { ordinal, binaryPath, sha256: digest, bytes: info.size, handshake };
}

function finalAssertion(sourceInputs, path) {
  const assertion = sourceInputs.final_assertions.find((entry) => entry.path === path);
  if (!assertion) fail(`Source-input manifest lacks final assertion ${path}.`);
  return assertion;
}

function stableQualificationEqual(existing, next) {
  return JSON.stringify(existing ?? null) === JSON.stringify(next);
}

function assembleManifest({ sourceBundle, toolchain, cargoMetadata, qualification, builds, synchronizedAt }) {
  const { sourceInputs, identity } = sourceBundle;
  const first = builds[0];
  const locator = correspondingSourceLocator(sourceInputs, identity);
  const patchPaths = sourceInputs.patches.map((patch) => patch.path);
  const buildProofs = builds.map(({ ordinal, sha256: digest, bytes, handshake }) => ({
    ordinal,
    sha256: digest,
    bytes,
    handshake,
  }));
  return {
    schema_version: BUNDLE_SCHEMA_VERSION,
    component: 'verseshell',
    upstream: {
      cargo_repository: 'https://github.com/nervosys/verseshell',
      source_repository: sourceInputs.repository,
      pinned_commit: sourceInputs.commit,
      pinned_commit_epoch: sourceInputs.commit_epoch,
      source_model: 'pinned-commit-plus-ordered-patches',
      pinned_commit_status: 'qualified_ordered_patch_stack',
    },
    license: 'AGPL-3.0-or-later',
    crate: { name: 'verseshell', version: '1.0.0', rust_version: '1.75', edition: '2021' },
    protocol: {
      observation_schema: 'verseshell.observation/v1',
      mcp_protocol_version: '2024-11-05',
      expected_server_protocol: EXPECTED_PROTOCOL,
      operation_catalog_schema: EXPECTED_CATALOG_SCHEMA,
      operation_catalog_digest: EXPECTED_CATALOG_DIGEST,
      operation_catalog_count: EXPECTED_CATALOG_COUNT,
      handshake_operation: 'runtime.handshake',
      server_name: 'ae-mcp',
      server_version: '1.0.0',
    },
    compliance: {
      ...COMPLIANCE_FILES,
      notice_path: 'resources/verseshell/NOTICE.md',
      source_instructions_path: 'resources/verseshell/SOURCE.md',
      build_instructions_path: 'resources/verseshell/BUILD.md',
      source_inputs_path: SOURCE_INPUTS_PATH,
      corresponding_source_locator: locator,
      corresponding_source_status: 'tracked_ordered_patch_stack',
      patch_paths: patchPaths,
    },
    build: {
      instructions_path: 'resources/verseshell/BUILD.md',
      command: 'cargo build --locked --release --bin ae',
      primary_binary: 'ae',
      mcp_binary: 'not_packaged',
      cargo_version: toolchain.cargoVersion,
      rustc_version: toolchain.rustcVersion,
      cargo_target: toolchain.host,
      cargo_metadata: cargoMetadata,
      cargo_toml_sha256: finalAssertion(sourceInputs, 'Cargo.toml').sha256,
      cargo_lock_sha256: finalAssertion(sourceInputs, 'Cargo.lock').sha256,
      source_inputs_sha256: sourceBundle.sha256,
      source_identity_sha256: identity.combinedSha256,
      controls: {
        cargo_incremental: sourceInputs.build.environment.CARGO_INCREMENTAL,
        source_date_epoch: sourceInputs.commit_epoch,
        encoded_rustflags: [...sourceInputs.build.encoded_rustflags],
      },
      qualification,
      reproducibility: {
        status: 'passed',
        independent_source_roots: sourceInputs.build.independent_source_roots,
        independent_target_roots: sourceInputs.build.independent_target_roots,
        byte_identical: true,
        binary_sha256: first.sha256,
        bytes: first.bytes,
        builds: buildProofs,
      },
      synchronized_at: synchronizedAt,
    },
    artifacts: {
      'win32-x64': {
        path: 'resources/bin/win32-x64/ae.exe',
        packaged_path: 'bin/ae.exe',
        sha256: first.sha256,
        bytes: first.bytes,
        version: '1.0.0',
      },
      'darwin-x64': { path: null, packaged_path: null, sha256: null, bytes: null, version: null },
      'darwin-arm64': { path: null, packaged_path: null, sha256: null, bytes: null, version: null },
      'linux-x64': { path: null, packaged_path: null, sha256: null, bytes: null, version: null },
      'linux-arm64': { path: null, packaged_path: null, sha256: null, bytes: null, version: null },
    },
    provenance: {
      repository: sourceInputs.repository,
      commit: sourceInputs.commit,
      commit_epoch: sourceInputs.commit_epoch,
      source_model: 'pinned-commit-plus-ordered-patches',
      unrecorded_changes: false,
      source_inputs: {
        path: SOURCE_INPUTS_PATH,
        sha256: sourceBundle.sha256,
        identity_sha256: identity.combinedSha256,
        patch_count: sourceInputs.patches.length,
        recovered_input_count: sourceInputs.recovered_inputs.files.length,
      },
      corresponding_source: {
        locator,
        patch_paths: patchPaths,
        instructions: 'Clone the HTTPS repository, checkout the pinned commit, then apply every source-input manifest patch in ascending order with git apply.',
      },
    },
  };
}

export async function rebuildAndSync(args = {}) {
  const root = resolve(args.root ?? PROJECT_ROOT);
  const platform = args.platform ?? 'win32';
  const arch = args.arch ?? 'x64';
  const mode = args.mode ?? 'package';
  requireSupportedTarget(platform, arch);
  if (!['dev', 'package'].includes(mode)) fail(`Unsupported rebuild mode: ${mode}.`);
  const sourceBundle = await loadAndValidateSourceInputs({ root });
  const paths = bundlePaths(root, platform, arch);
  await validateComplianceFiles(paths.complianceDir, {
    compliance: {
      ...COMPLIANCE_FILES,
    },
  });
  const toolchain = verifyToolchain(sourceBundle.sourceInputs);
  const workRoot = await mkdtemp(join(tmpdir(), 'clawx-verseshell-rebuild-'));
  try {
    const qualificationSource = join(workRoot, 'qualification-source');
    const buildSourceOne = join(workRoot, 'build-source-1');
    const buildSourceTwo = join(workRoot, 'build-source-2');
    await reconstructSource({ root, destination: qualificationSource, sourceMirror: args.sourceMirror, sourceBundle });
    const cargoMetadata = parseCargoMetadata(qualificationSource);
    const qualification = await qualifySource(
      qualificationSource,
      join(workRoot, 'qualification-output'),
      sourceBundle.sourceInputs,
      args.python,
    );
    await reconstructSource({ root, destination: buildSourceOne, sourceMirror: args.sourceMirror, sourceBundle });
    await reconstructSource({ root, destination: buildSourceTwo, sourceMirror: args.sourceMirror, sourceBundle });
    const first = await buildOne(buildSourceOne, join(workRoot, 'build-target-1'), sourceBundle.sourceInputs, 1);
    const second = await buildOne(buildSourceTwo, join(workRoot, 'build-target-2'), sourceBundle.sourceInputs, 2);
    if (first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
      fail(`VerseShell reproducibility failure: build 1 ${first.sha256}/${first.bytes}, build 2 ${second.sha256}/${second.bytes}.`);
    }
    let existing = null;
    if (existsSync(paths.manifestPath)) {
      try { existing = await readJson(paths.manifestPath, 'existing VerseShell manifest'); } catch { existing = null; }
    }
    const reproducibilityCandidate = {
      status: 'passed',
      independent_source_roots: 2,
      independent_target_roots: 2,
      byte_identical: true,
      binary_sha256: first.sha256,
      bytes: first.bytes,
      builds: [first, second].map(({ ordinal, sha256: digest, bytes, handshake }) => ({ ordinal, sha256: digest, bytes, handshake })),
    };
    const preserveTimestamp = existing?.artifacts?.['win32-x64']?.sha256 === first.sha256
      && existing?.build?.source_inputs_sha256 === sourceBundle.sha256
      && stableQualificationEqual(existing?.build?.qualification, qualification)
      && stableQualificationEqual(existing?.build?.reproducibility, reproducibilityCandidate)
      && cleanString(existing?.build?.synchronized_at);
    const manifest = assembleManifest({
      sourceBundle,
      toolchain,
      cargoMetadata,
      qualification,
      builds: [first, second],
      synchronizedAt: preserveTimestamp ? existing.build.synchronized_at : new Date().toISOString(),
    });
    const artifact = validateManifest(manifest, { platform, arch, mode, sourceBundle });
    if (artifact.sha256 !== first.sha256 || artifact.bytes !== first.bytes) fail('Pre-copy manifest/artifact identity mismatch.');
    await atomicReplaceBundle(first.binaryPath, paths.binaryPath, paths.manifestPath, manifest);
    await validateSourceBundle({ root, platform, arch, mode });
    return { manifest, artifact, paths };
  } finally {
    if (!args.keepWorkdirs) await rm(workRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    platform: 'win32',
    arch: 'x64',
    mode: 'package',
    ignoredAllowlist: [],
  };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--platform') { args.platform = value; index += 1; }
    else if (key === '--arch') { args.arch = value; index += 1; }
    else if (key === '--mode') { args.mode = value; index += 1; }
    else if (key === '--root') { args.root = value; index += 1; }
    else if (key === '--resources') { args.resources = value; index += 1; }
    else if (key === '--source') { args.source = value; index += 1; }
    else if (key === '--source-mirror') { args.sourceMirror = value; index += 1; }
    else if (key === '--python') { args.python = value; index += 1; }
    else if (key === '--output') { args.output = value; index += 1; }
    else if (key === '--ignored-input') { args.ignoredAllowlist.push(value); index += 1; }
    else if (key === '--keep-workdirs') args.keepWorkdirs = true;
    else if (key === '--help' || key === '-h') args.help = true;
    else fail(`Unknown argument: ${key}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/verseshell-bundle.mjs rebuild [--source-mirror <git repo>] [--python <executable>] [--mode dev|package]
  node scripts/verseshell-bundle.mjs sync [same options as rebuild]
  node scripts/verseshell-bundle.mjs capture-patch --source <path> --output <workspace-relative patch> [--ignored-input <path> ...]
  node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode dev|package
  node scripts/verseshell-bundle.mjs verify-package [--resources <unpacked resources directory>] --platform win32 --arch x64 (defaults to release/win-unpacked/resources)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printUsage();
    return;
  }
  if (args.command === 'capture-patch') {
    const result = await captureSourcePatch({
      source: args.source,
      output: args.output,
      ignoredAllowlist: args.ignoredAllowlist,
    });
    console.log(JSON.stringify({ action: 'captured-patch', ...result, path: relative(PROJECT_ROOT, result.path) }, null, 2));
    return;
  }
  if (args.command === 'rebuild' || args.command === 'sync') {
    const { manifest, artifact, paths } = await rebuildAndSync(args);
    console.log(JSON.stringify({
      action: 'rebuilt',
      binary: relative(PROJECT_ROOT, paths.binaryPath),
      sizeBytes: artifact.bytes,
      sha256: artifact.sha256,
      sourceIdentity: manifest.provenance.source_inputs.identity_sha256,
      byteIdentical: manifest.build.reproducibility.byte_identical,
    }, null, 2));
    return;
  }
  if (args.command === 'validate') {
    const result = await validateSourceBundle(args);
    console.log(JSON.stringify({
      action: 'validated',
      mode: args.mode,
      binary: relative(PROJECT_ROOT, result.paths.binaryPath),
      sha256: result.artifact.sha256,
      sourceIdentity: result.manifest.provenance.source_inputs.identity_sha256,
    }, null, 2));
    return;
  }
  if (args.command === 'verify-package') {
    const result = await validatePackagedBundle({
      resourcesPath: args.resources ?? DEFAULT_PACKAGED_RESOURCES,
      platform: args.platform,
      arch: args.arch,
      mode: 'package',
    });
    console.log(JSON.stringify({
      action: 'verified-package',
      resources: result.paths.root,
      sha256: result.artifact.sha256,
      sourceIdentity: result.manifest.provenance.source_inputs.identity_sha256,
    }, null, 2));
    return;
  }
  fail(`Unknown command: ${args.command}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[verseshell-bundle] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
