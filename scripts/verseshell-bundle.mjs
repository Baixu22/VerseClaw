#!/usr/bin/env node
/**
 * Build, synchronize, and verify the Task14 VerseShell resource manifest.
 * Exactly one binary is owned by this script: win32-x64/ae.exe.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
export const BUNDLE_SCHEMA_VERSION = 1;
export const SUPPORTED_TARGET = Object.freeze({ platform: 'win32', arch: 'x64' });
export const COMPLIANCE_FILES = Object.freeze({
  license_file: 'LICENSE-AGPL-3.0-or-later.txt',
  notice_file: 'NOTICE.md',
  source_file: 'SOURCE.md',
  build_file: 'BUILD.md',
});

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

function run(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) fail(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return (result.stdout || '').trim();
}

function runPreservingLeadingWhitespace(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) fail(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return (result.stdout || '').trimEnd();
}

function runDiff(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) fail(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return (result.stdout || '').trim();
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

function expectedArtifact(platform, arch) {
  return {
    path: `resources/bin/${platform}-${arch}/ae.exe`,
    packaged_path: 'bin/ae.exe',
  };
}

function resolveProjectPath(input, label) {
  const destination = resolve(PROJECT_ROOT, input);
  const projectRelative = relative(PROJECT_ROOT, destination);
  if (
    !projectRelative
    || projectRelative === '..'
    || projectRelative.startsWith('../')
    || projectRelative.startsWith('..\\')
  ) {
    fail(`${label} must stay inside the ClawX workspace.`);
  }
  return destination;
}

export function bundlePaths(root = PROJECT_ROOT, platform = 'win32', arch = 'x64') {
  const artifact = expectedArtifact(platform, arch);
  return {
    root: resolve(root),
    complianceDir: join(resolve(root), 'resources', 'verseshell'),
    manifestPath: join(resolve(root), 'resources', 'verseshell', 'manifest.json'),
    binaryPath: join(resolve(root), artifact.path),
    artifact,
  };
}

function packagedBundlePaths(resourcesPath) {
  return {
    complianceDir: join(resolve(resourcesPath), 'resources', 'verseshell'),
    manifestPath: join(resolve(resourcesPath), 'resources', 'verseshell', 'manifest.json'),
    binaryPath: join(resolve(resourcesPath), 'bin', 'ae.exe'),
  };
}

async function readJson(jsonPath, label) {
  try {
    return object(JSON.parse(await readFile(jsonPath, 'utf8')), label);
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

async function validateComplianceFiles(complianceDir, manifest) {
  const compliance = object(manifest.compliance, 'manifest.compliance');
  for (const [key, filename] of Object.entries(COMPLIANCE_FILES)) {
    if (compliance[key] !== filename) fail(`manifest.compliance.${key} must be ${filename}.`);
    await requireFile(join(complianceDir, filename), `VerseShell compliance ${key}`);
  }
  const license = await readFile(join(complianceDir, COMPLIANCE_FILES.license_file), 'utf8');
  // The canonical FSF text centers its first two title lines with leading spaces.
  // Permit only that presentation whitespace (and an optional UTF-8 BOM), never an arbitrary preamble.
  const hasOfficialAgplHeading = /^(?:\uFEFF)?[ \t]*GNU AFFERO GENERAL PUBLIC LICENSE\r?\n[ \t]*Version 3, 19 November 2007\r?\n/.test(license);
  if (!hasOfficialAgplHeading) {
    fail('VerseShell license is not the official GNU AGPL v3 text.');
  }
}

function validateManifest(manifest, { platform, arch, mode }) {
  if (manifest.schema_version !== BUNDLE_SCHEMA_VERSION || manifest.component !== 'verseshell') {
    fail('Unsupported VerseShell manifest schema/component.');
  }
  const crate = object(manifest.crate, 'manifest.crate');
  if (crate.name !== 'verseshell' || !cleanString(crate.version) || crate.rust_version !== '1.75') {
    fail('manifest.crate identity/version/rust_version is invalid.');
  }
  const upstream = object(manifest.upstream, 'manifest.upstream');
  if (!cleanString(upstream.source_repository) || upstream.pinned_commit !== manifest.provenance?.commit) {
    fail('manifest.upstream must identify the same source repository/commit as provenance.');
  }
  const protocol = object(manifest.protocol, 'manifest.protocol');
  if (
    protocol.observation_schema !== 'verseshell.observation/v1'
    || !cleanString(protocol.mcp_protocol_version)
    || protocol.expected_server_protocol !== 'verseshell.jsonl/v1'
    || protocol.operation_catalog_schema !== 'verseshell.operation-catalog/v1'
    || !/^sha256:[a-f0-9]{64}$/.test(String(protocol.operation_catalog_digest || ''))
    || !Number.isSafeInteger(protocol.operation_catalog_count)
    || protocol.operation_catalog_count <= 0
    || protocol.server_version !== crate.version
  ) {
    fail('manifest.protocol metadata is incompatible.');
  }
  const build = object(manifest.build, 'manifest.build');
  if (
    build.command !== 'cargo build --release --bin ae'
    || !cleanString(build.cargo_version)
    || !cleanString(build.rustc_version)
    || build.cargo_target !== 'x86_64-pc-windows-msvc'
  ) {
    fail('manifest.build metadata is incomplete or targets the wrong toolchain.');
  }
  const provenance = object(manifest.provenance, 'manifest.provenance');
  if (!cleanString(provenance.repository) || !/^[a-f0-9]{40}$/i.test(String(provenance.commit || ''))) {
    fail('manifest.provenance repository/full commit is required.');
  }
  if (typeof provenance.dirty !== 'boolean') fail('manifest.provenance.dirty must be boolean.');
  const input = object(provenance.build_input, 'manifest.provenance.build_input');
  if (!Array.isArray(input.status_porcelain) || !/^[a-f0-9]{64}$/.test(String(input.diff_sha256 || ''))) {
    fail('manifest.provenance.build_input must record git status and diff SHA-256.');
  }
  const corresponding = object(provenance.corresponding_source, 'manifest.provenance.corresponding_source');
  const compliance = object(manifest.compliance, 'manifest.compliance');
  if (compliance.corresponding_source_locator !== corresponding.locator) {
    fail('manifest compliance and provenance corresponding-source locators must match.');
  }
  if (mode === 'package' && !cleanString(corresponding.locator)) {
    fail('Package validation requires a corresponding-source locator.');
  }
  if (provenance.dirty) {
    const override = object(provenance.dirty_build_override, 'manifest.provenance.dirty_build_override');
    if (override.approved !== true) fail('Dirty build lacks explicit provenance override approval.');
    if (mode === 'package' && (!cleanString(corresponding.locator) || !cleanString(corresponding.patch_instructions))) {
      fail('Dirty package build requires corresponding source and patch/source-snapshot instructions.');
    }
    if (mode === 'package' && !cleanString(compliance.corresponding_source_path)) {
      fail('Dirty package build requires a corresponding-source patch path.');
    }
  }
  const artifacts = object(manifest.artifacts, 'manifest.artifacts');
  const target = `${platform}-${arch}`;
  const artifact = object(artifacts[target], `manifest.artifacts.${target}`);
  const expected = expectedArtifact(platform, arch);
  if (artifact.path !== expected.path || artifact.packaged_path !== expected.packaged_path) {
    fail(`manifest.artifacts.${target} has wrong source/packaged paths.`);
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
    fail(`manifest.artifacts.${target} size/checksum is invalid.`);
  }
  if (artifact.version !== crate.version) fail(`manifest.artifacts.${target} version must match crate.version.`);
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

async function validateCorrespondingSource(root, manifest) {
  if (manifest.provenance?.dirty !== true) return;
  const relativePatch = cleanString(manifest.compliance?.corresponding_source_path);
  if (!relativePatch) fail('Dirty VerseShell bundle is missing its corresponding-source patch path.');
  const patchPath = resolve(root, relativePatch);
  await requireFile(patchPath, 'VerseShell corresponding-source patch');
  const actualSha256 = await sha256File(patchPath);
  if (actualSha256 !== manifest.provenance.build_input.diff_sha256) {
    fail(`VerseShell corresponding-source patch checksum mismatch: expected ${manifest.provenance.build_input.diff_sha256}, found ${actualSha256}.`);
  }
}

export async function validateSourceBundle({ root = PROJECT_ROOT, platform = 'win32', arch = 'x64', mode = 'dev' } = {}) {
  requireSupportedTarget(platform, arch);
  if (!['dev', 'package'].includes(mode)) fail(`Unsupported bundle mode: ${mode}.`);
  const paths = bundlePaths(root, platform, arch);
  const manifest = await readJson(paths.manifestPath, 'VerseShell manifest');
  const artifact = validateManifest(manifest, { platform, arch, mode });
  await validateComplianceFiles(paths.complianceDir, manifest);
  await validateCorrespondingSource(paths.root, manifest);
  await validateArtifact(paths.binaryPath, artifact);
  return { manifest, artifact, paths };
}

export async function validatePackagedBundle({ resourcesPath, platform = 'win32', arch = 'x64', mode = 'package' } = {}) {
  requireSupportedTarget(platform, arch);
  if (!resourcesPath) fail('verify-package requires --resources <unpacked resources directory>.');
  const paths = packagedBundlePaths(resourcesPath);
  const manifest = await readJson(paths.manifestPath, 'packaged VerseShell manifest');
  const artifact = validateManifest(manifest, { platform, arch, mode });
  await validateComplianceFiles(paths.complianceDir, manifest);
  await validateCorrespondingSource(resolve(resourcesPath), manifest);
  await validateArtifact(paths.binaryPath, artifact);
  return { manifest, artifact, paths };
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

async function atomicWriteJson(destinationPath, payload) {
  const tempPath = join(dirname(destinationPath), `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tempPath, destinationPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function hashOptionalFile(filePath) {
  return existsSync(filePath) ? sha256File(filePath) : null;
}

function parseCargoMetadata(source) {
  const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: source }));
  const manifestPath = join(source, 'Cargo.toml').replace(/\\/g, '/');
  const pkg = metadata.packages?.find((candidate) => String(candidate.manifest_path).replace(/\\/g, '/') === manifestPath)
    ?? metadata.packages?.[0];
  if (!pkg || pkg.name !== 'verseshell' || !cleanString(pkg.version)) fail('cargo metadata did not identify verseshell.');
  return {
    package_name: pkg.name,
    package_version: pkg.version,
    target_directory: '[build-source]/target',
  };
}

export function collectSourceDiff(source) {
  const tracked = run('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], { cwd: source });
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: source })
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const patches = [tracked];
  for (const path of untracked) {
    patches.push(runDiff(
      'git',
      ['diff', '--binary', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
      { cwd: source },
    ));
  }
  return `${patches.filter(Boolean).join('\n')}\n`;
}

export async function captureSourcePatch({ source, output }) {
  if (!source) fail('capture-patch requires --source <VerseShell source path>.');
  if (!output) fail('capture-patch requires --output <workspace-relative patch path>.');
  const sourceRoot = resolve(source);
  await requireFile(join(sourceRoot, 'Cargo.toml'), 'VerseShell Cargo.toml');
  const destination = resolveProjectPath(output, 'capture-patch output');
  const diff = collectSourceDiff(sourceRoot);
  if (!diff.trim()) fail('VerseShell source has no changes to capture.');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, diff, 'utf8');
  return {
    path: destination,
    bytes: Buffer.byteLength(diff),
    sha256: sha256(diff),
  };
}

function sourceProvenance(source, args) {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: source });
  const repository = run('git', ['remote', 'get-url', 'origin'], { cwd: source });
  const status = runPreservingLeadingWhitespace(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: source },
  );
  const statusPorcelain = status ? status.split(/\r?\n/).filter(Boolean) : [];
  const dirty = statusPorcelain.length > 0;
  const diff = collectSourceDiff(source);
  const sourceSnapshot = cleanString(args.sourceSnapshot);
  const patchInstructions = cleanString(args.patchInstructions);
  if (args.mode === 'package' && dirty) {
    if (!args.allowDirtyProvenance) {
      fail('Refusing dirty package build. Pass --allow-dirty-provenance with --source-snapshot and --patch-instructions.');
    }
    if (!sourceSnapshot || !patchInstructions) {
      fail('Dirty package build requires --source-snapshot and --patch-instructions.');
    }
  }
  return {
    repository,
    commit,
    dirty,
    build_input: {
      source_directory: '[build-source]',
      status_porcelain: statusPorcelain,
      diff_sha256: sha256(diff),
      dirty_entry_count: statusPorcelain.length,
    },
    corresponding_source: {
      locator: sourceSnapshot ?? (dirty ? null : `${repository}@${commit}`),
      patch_instructions: patchInstructions,
    },
    dirty_build_override: {
      approved: dirty ? Boolean(args.allowDirtyProvenance) : false,
      source_snapshot: sourceSnapshot,
      patch_instructions: patchInstructions,
    },
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
    const result = spawnSync(
      binaryPath,
      ['--serve', '--agent', '--format', 'json', '--policy', 'strict', '--workspace', workspace, '--max-concurrency', '1'],
      {
        cwd: workspace,
        encoding: 'utf8',
        input: request,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          AETHER_MODE: 'agent',
          AETHER_POLICY: 'strict',
          AETHER_WORKSPACE: workspace,
          VERSESHELL_POLICY_PROFILE_ID: 'clawx-bundle-probe',
          VERSESHELL_POLICY_PROFILE_DIGEST: policyDigest,
        },
      },
    );
    if (result.error || result.status !== 0) {
      fail(`Built VerseShell runtime handshake failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
    }
    const observation = String(result.stdout || '')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .find((value) => value?.op === 'runtime.handshake');
    const data = observation?.ok === true ? observation.data : null;
    const catalog = data?.operation_catalog;
    if (
      data?.policy_mode !== 'agent_strict'
      || data?.server_protocol !== 'verseshell.jsonl/v1'
      || data?.operation_catalog_schema !== 'verseshell.operation-catalog/v1'
      || !/^sha256:[a-f0-9]{64}$/.test(String(catalog?.digest || ''))
      || !Number.isSafeInteger(catalog?.count)
      || catalog.count <= 0
    ) {
      fail('Built VerseShell runtime returned an incompatible typed ACI handshake.');
    }
    return {
      runtimeVersion: data.runtime_version,
      serverProtocol: data.server_protocol,
      operationCatalogSchema: data.operation_catalog_schema,
      operationCatalogDigest: catalog.digest,
      operationCatalogCount: catalog.count,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function buildAndSync(args) {
  requireSupportedTarget(args.platform, args.arch);
  if (!args.source) fail('sync requires --source <VerseShell source path>.');
  if (!['dev', 'package'].includes(args.mode)) fail('sync --mode must be dev or package.');
  const source = resolve(args.source);
  await requireFile(join(source, 'Cargo.toml'), 'VerseShell Cargo.toml');
  const existing = await readJson(bundlePaths().manifestPath, 'Task14 VerseShell manifest');
  const provenance = sourceProvenance(source, args);
  const sourcePatch = cleanString(args.sourcePatch);
  if (provenance.dirty && args.mode === 'package' && !sourcePatch) {
    fail('Dirty package build requires --source-patch <workspace-relative patch path>.');
  }
  if (provenance.dirty && sourcePatch) {
    const patchPath = resolveProjectPath(sourcePatch, 'source patch');
    await requireFile(patchPath, 'VerseShell corresponding-source patch');
    const patchSha256 = await sha256File(patchPath);
    if (patchSha256 !== provenance.build_input.diff_sha256) {
      fail(`Corresponding-source patch does not match the build input diff: expected ${provenance.build_input.diff_sha256}, found ${patchSha256}.`);
    }
  }
  const cargoVersion = run('cargo', ['--version'], { cwd: source });
  const rustcVersion = run('rustc', ['-vV'], { cwd: source });
  const cargoTarget = (rustcVersion.match(/^host:\s*(.+)$/m) || [])[1]?.trim();
  if (cargoTarget !== 'x86_64-pc-windows-msvc') fail(`rustc reports incompatible target ${cargoTarget || 'unknown'}.`);
  const cargoMetadata = parseCargoMetadata(source);
  if (cargoMetadata.package_version !== existing.crate?.version) {
    fail(`Cargo version ${cargoMetadata.package_version} does not match Task14 manifest ${existing.crate?.version}.`);
  }

  // Compilation precedes destination mutation. Failed builds preserve the prior bundle.
  run('cargo', ['build', '--release', '--bin', 'ae'], { cwd: source });
  const sourceBinary = join(source, 'target', 'release', 'ae.exe');
  await requireFile(sourceBinary, 'built VerseShell ae.exe');
  const runtimeContract = await probeRuntimeContract(sourceBinary);
  if (runtimeContract.runtimeVersion !== cargoMetadata.package_version) {
    fail(`Runtime handshake version ${runtimeContract.runtimeVersion} does not match Cargo ${cargoMetadata.package_version}.`);
  }
  const paths = bundlePaths(PROJECT_ROOT, args.platform, args.arch);
  await atomicCopy(sourceBinary, paths.binaryPath);
  const artifactInfo = await stat(paths.binaryPath);
  const artifactSha256 = await sha256File(paths.binaryPath);
  const artifact = {
    path: paths.artifact.path,
    packaged_path: paths.artifact.packaged_path,
    sha256: artifactSha256,
    bytes: artifactInfo.size,
    version: cargoMetadata.package_version,
  };
  const manifest = {
    ...existing,
    schema_version: BUNDLE_SCHEMA_VERSION,
    component: 'verseshell',
    upstream: {
      ...(existing.upstream ?? {}),
      source_repository: provenance.repository,
      pinned_commit: provenance.commit,
      pinned_commit_status: provenance.dirty ? 'dirty_build_input_recorded' : 'clean_build_input',
    },
    protocol: {
      ...(existing.protocol ?? {}),
      expected_server_protocol: runtimeContract.serverProtocol,
      operation_catalog_schema: runtimeContract.operationCatalogSchema,
      operation_catalog_digest: runtimeContract.operationCatalogDigest,
      operation_catalog_count: runtimeContract.operationCatalogCount,
      server_version: runtimeContract.runtimeVersion,
    },
    build: {
      ...(existing.build ?? {}),
      instructions_path: 'resources/verseshell/BUILD.md',
      command: 'cargo build --release --bin ae',
      primary_binary: 'ae',
      mcp_binary: 'not_packaged',
      cargo_version: cargoVersion,
      rustc_version: rustcVersion,
      cargo_target: cargoTarget,
      cargo_metadata: cargoMetadata,
      cargo_toml_sha256: await hashOptionalFile(join(source, 'Cargo.toml')),
      cargo_lock_sha256: await hashOptionalFile(join(source, 'Cargo.lock')),
      synchronized_at: new Date().toISOString(),
    },
    provenance,
    compliance: {
      ...(existing.compliance ?? {}),
      ...COMPLIANCE_FILES,
      notice_path: 'resources/verseshell/NOTICE.md',
      source_instructions_path: 'resources/verseshell/SOURCE.md',
      build_instructions_path: 'resources/verseshell/BUILD.md',
      corresponding_source_locator: provenance.corresponding_source.locator,
      corresponding_source_path: provenance.dirty ? sourcePatch : null,
      corresponding_source_status: provenance.dirty
        ? 'dirty_corresponding_source_recorded'
        : 'identified_by_repository_and_commit',
    },
    artifacts: {
      ...(existing.artifacts ?? {}),
      [`${args.platform}-${args.arch}`]: artifact,
    },
  };
  await validateComplianceFiles(paths.complianceDir, manifest);
  await atomicWriteJson(paths.manifestPath, manifest);
  await validateSourceBundle({ root: PROJECT_ROOT, platform: args.platform, arch: args.arch, mode: args.mode });
  return { manifest, artifact, paths };
}

function parseArgs(argv) {
  const args = { platform: 'win32', arch: 'x64', mode: 'dev', source: null, resources: null, output: null, sourcePatch: null, sourceSnapshot: null, patchInstructions: null, allowDirtyProvenance: false };
  const [command, ...rest] = argv;
  if (!command || ['--help', '-h'].includes(command)) return { command: 'help', ...args };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--allow-dirty-provenance') { args.allowDirtyProvenance = true; continue; }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${token}.`);
    index += 1;
    if (token === '--source') args.source = value;
    else if (token === '--resources') args.resources = value;
    else if (token === '--output') args.output = value;
    else if (token === '--source-patch') args.sourcePatch = value;
    else if (token === '--platform') args.platform = value;
    else if (token === '--arch') args.arch = value;
    else if (token === '--mode') args.mode = value;
    else if (token === '--source-snapshot') args.sourceSnapshot = value;
    else if (token === '--patch-instructions') args.patchInstructions = value;
    else fail(`Unknown argument: ${token}.`);
  }
  return { command, ...args };
}

function printUsage() {
  console.log(`Usage:
  node scripts/verseshell-bundle.mjs capture-patch --source <path> --output <workspace-relative patch path>
  node scripts/verseshell-bundle.mjs sync --source <path> --platform win32 --arch x64 --mode dev|package [--allow-dirty-provenance --source-patch <workspace-relative path> --source-snapshot <locator> --patch-instructions <instruction>]
  node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode dev|package
  node scripts/verseshell-bundle.mjs verify-package --resources <unpacked resources directory> --platform win32 --arch x64`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') return printUsage();
  if (args.command === 'capture-patch') {
    const captured = await captureSourcePatch(args);
    console.log(JSON.stringify({ action: 'captured-patch', patch: relative(PROJECT_ROOT, captured.path), bytes: captured.bytes, sha256: captured.sha256 }, null, 2));
    return;
  }
  if (args.command === 'sync') {
    const { manifest, artifact, paths } = await buildAndSync(args);
    console.log(JSON.stringify({ action: 'synced', binary: relative(PROJECT_ROOT, paths.binaryPath), sizeBytes: artifact.bytes, sha256: artifact.sha256, dirty: manifest.provenance.dirty, commit: manifest.provenance.commit }, null, 2));
    return;
  }
  if (args.command === 'validate') {
    const { artifact, paths } = await validateSourceBundle(args);
    console.log(JSON.stringify({ action: 'validated', manifest: relative(PROJECT_ROOT, paths.manifestPath), sha256: artifact.sha256 }, null, 2));
    return;
  }
  if (args.command === 'verify-package') {
    const { artifact, paths } = await validatePackagedBundle({ ...args, resourcesPath: args.resources });
    console.log(JSON.stringify({ action: 'verified-package', manifest: paths.manifestPath, sha256: artifact.sha256 }, null, 2));
    return;
  }
  fail(`Unknown command: ${args.command}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[verseshell-bundle] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
