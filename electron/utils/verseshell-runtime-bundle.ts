import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isVerseShellRuntimeRequestedByRollout } from './verseshell-runtime-request';

export const VERSESHELL_DEV_OVERRIDE_FLAG = 'CLAWX_VERSESHELL_DEV_OVERRIDE';
export const VERSESHELL_DEV_OVERRIDE_PATH = 'CLAWX_VERSESHELL_DEV_AE_PATH';

const SCHEMA_VERSION = 2;
const COMPLIANCE_FILES = {
  license_file: 'LICENSE-AGPL-3.0-or-later.txt',
  notice_file: 'NOTICE.md',
  source_file: 'SOURCE.md',
  build_file: 'BUILD.md',
  source_inputs_file: 'source-inputs.json',
} as const;

const EXPECTED_SOURCE_INPUTS_SHA256 = 'a2b3fd6c05cae9a664304ab7e0f5ff851ac357071a8415b5bee7c5aee5e876bd';
const EXPECTED_SOURCE_IDENTITY_SHA256 = 'daa0b1720efaa89356f9ceed608a9f5bd200970a96f6ab2abec8a67cd101c8f8';
const EXPECTED_SOURCE_REPOSITORY = 'https://github.com/Baixu22/VerseShell.git';
const EXPECTED_SOURCE_COMMIT = 'c3983694407a9ddb23505e05fad4a9eae653b283';
const EXPECTED_SOURCE_COMMIT_EPOCH = 1785123525;
const EXPECTED_PATCHES = [
  ['resources/verseshell/patches/uas-05-process-lifecycle.patch', 106755, 'cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098'],
  ['resources/verseshell/patches/p0-runtime-startup.patch', 1645, '17214efd7bf09e009256eb149c84a84e8fe85afcd467968ac2a6e472fbdb5aba'],
  ['resources/verseshell/patches/aci-bench-source-inputs.patch', 32135, '0eb7c902e4b0b75d3617e2129f66694c01f9c4f657fcb140272ff8abbba5dffe'],
  ['resources/verseshell/patches/python-current-interpreter.patch', 2444, 'ccc4a92220dd3ca47a142ded6c3734749918f3d86b5014f1e5444ffd53bc0922'],
] as const;
const EXPECTED_RECOVERED_PATHS = [
  'bench/aci/runners/run_suite.py',
  'bench/aci/scorers/score.py',
  'bench/aci/fixtures/python_edit_and_retest/greet.py',
  'bench/aci/fixtures/python_edit_and_retest/GOLDEN/greet.py',
  'bench/aci/fixtures/python_edit_and_retest/tests/test_greet.py',
  'bench/aci/fixtures/python_fix_pytest_fail/mathlib.py',
  'bench/aci/fixtures/python_fix_pytest_fail/GOLDEN/mathlib.py',
  'bench/aci/fixtures/python_fix_pytest_fail/tests/test_math.py',
] as const;

interface VerseShellArtifact {
  path: string;
  packaged_path: string;
  sha256: string;
  bytes: number;
  version: string;
}

interface VerseShellSourcePatch {
  order: number;
  role: string;
  path: string;
  bytes: number;
  sha256: string;
  changed_paths: string[];
}

interface VerseShellSourceInputs {
  schema_version: number;
  component: string;
  repository: string;
  commit: string;
  commit_epoch: number;
  patches: VerseShellSourcePatch[];
  recovered_inputs: {
    verified_after_patch_order: number;
    upstream_ignore_rule: string;
    files: Array<{ path: string; bytes: number; sha256: string }>;
  };
  identity: {
    algorithm: string;
    payload_sha256: string;
    combined_algorithm: string;
    combined_sha256: string;
  };
}

interface VerseShellManifest {
  schema_version: number;
  component: string;
  crate: { name: string; version: string; rust_version: string; edition: string };
  protocol: {
    observation_schema: string;
    mcp_protocol_version: string;
    expected_server_protocol: string;
    operation_catalog_schema: string;
    operation_catalog_digest: string;
    operation_catalog_count: number;
    handshake_operation: string;
    server_name: string;
    server_version: string;
  };
  provenance: {
    repository: string;
    commit: string;
    commit_epoch: number;
    source_model: string;
    unrecorded_changes: boolean;
    source_inputs: {
      path: string;
      sha256: string;
      identity_sha256: string;
      patch_count: number;
      recovered_input_count: number;
    };
    corresponding_source: { locator: string; patch_paths: string[]; instructions: string };
  };
  build: {
    cargo_version: string;
    rustc_version: string;
    cargo_target: string;
    source_inputs_sha256: string;
    source_identity_sha256: string;
    controls: { cargo_incremental: string; source_date_epoch: number; encoded_rustflags: string[] };
    qualification: {
      status: string;
      rust_tests: Array<{ argv: string[]; exit_code: number }>;
      python_optional_verify: { status: string; interpreter_version: string; task_ids: string[]; passed: number; failed: number };
    };
    reproducibility: {
      status: string;
      independent_source_roots: number;
      independent_target_roots: number;
      byte_identical: boolean;
      binary_sha256: string;
      bytes: number;
      builds: Array<{
        ordinal: number;
        sha256: string;
        bytes: number;
        handshake: {
          runtime_version: string;
          server_protocol: string;
          operation_catalog_schema: string;
          operation_catalog_digest: string;
          operation_catalog_count: number;
        };
      }>;
    };
  };
  compliance: Record<string, unknown>;
  artifacts: Record<string, VerseShellArtifact | null>;
}

export interface VerseShellRuntimeProvenance {
  verified: boolean;
  source: 'packaged-bundle' | 'development-bundle' | 'development-override';
  manifestPath: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  version: string | null;
  protocolVersion: string | null;
  operationCatalogDigest: string | null;
  operationCatalogCount: number | null;
  observationSchema: string | null;
  repository: string | null;
  commit: string | null;
  commitEpoch: number | null;
  sourceIdentitySha256: string | null;
  unrecordedChanges: boolean | null;
}

export interface ResolvedVerseShellRuntime {
  executablePath: string;
  provenance: VerseShellRuntimeProvenance;
}

/** Build the immutable Gateway contract. Unverified overrides intentionally lack typed-ACI identity. */
export function buildVerseShellRuntimeEnv(
  runtime: ResolvedVerseShellRuntime,
): Record<string, string> {
  const provenance = runtime.provenance;
  const env: Record<string, string> = {
    VERSESHELL_AE_PATH: runtime.executablePath,
    VERSESHELL_RUNTIME_PROVENANCE: provenance.verified ? 'verified' : 'unverified-dev-override',
  };
  if (!provenance.verified) return env;
  if (
    !provenance.sha256
    || !provenance.version
    || !provenance.protocolVersion
    || !provenance.operationCatalogDigest
    || !Number.isSafeInteger(provenance.operationCatalogCount)
    || (provenance.operationCatalogCount ?? 0) <= 0
  ) {
    throw new Error('Verified VerseShell runtime provenance is missing an immutable typed-ACI contract field.');
  }
  return {
    ...env,
    VERSESHELL_AE_SHA256: provenance.sha256,
    VERSESHELL_RUNTIME_VERSION: provenance.version,
    VERSESHELL_SERVER_PROTOCOL: provenance.protocolVersion,
    VERSESHELL_OPERATION_CATALOG_DIGEST: provenance.operationCatalogDigest,
    VERSESHELL_OPERATION_CATALOG_COUNT: String(provenance.operationCatalogCount),
  };
}

export interface ResolveVerseShellRuntimeOptions {
  isPackaged: boolean;
  resourcesPath?: string;
  cwd?: string;
  platform?: NodeJS.Platform | string;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: typeof readFile;
  stat?: typeof stat;
  hashFile?: (filePath: string) => Promise<string>;
}

export interface ResolveVerseShellRuntimeForLaunchOptions extends ResolveVerseShellRuntimeOptions {
  rolloutConfig?: unknown;
  devOverrideRequested?: boolean;
  resolveRuntime?: (options: ResolveVerseShellRuntimeOptions) => Promise<ResolvedVerseShellRuntime>;
}

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateTarget(platform: string, arch: string): void {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(`VerseShell bundled runtime supports win32/x64 only; received ${platform}/${arch}.`);
  }
}

async function defaultHashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function parseManifest(raw: string, manifestPath: string): VerseShellManifest {
  let manifest: VerseShellManifest;
  try {
    manifest = JSON.parse(raw) as VerseShellManifest;
  } catch (error) {
    throw new Error(
      `Invalid VerseShell manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  requireObject(manifest, 'VerseShell manifest');
  requireObject(manifest.crate, 'VerseShell manifest.crate');
  requireObject(manifest.protocol, 'VerseShell manifest.protocol');
  requireObject(manifest.provenance, 'VerseShell manifest.provenance');
  requireObject(manifest.build, 'VerseShell manifest.build');
  requireObject(manifest.compliance, 'VerseShell manifest.compliance');
  requireObject(manifest.artifacts, 'VerseShell manifest.artifacts');
  return manifest;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [
      key,
      canonicalize((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

function sourceIdentity(sourceInputs: VerseShellSourceInputs): { payload: string; combined: string } {
  const { identity: _identity, ...payload } = sourceInputs as unknown as Record<string, unknown>;
  const payloadSha = createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
  const combinedSha = createHash('sha256').update(`verseshell.source-identity/v1\n${payloadSha}`).digest('hex');
  return { payload: payloadSha, combined: combinedSha };
}

function parseSourceInputs(raw: string, sourceInputsPath: string): VerseShellSourceInputs {
  let sourceInputs: VerseShellSourceInputs;
  try {
    sourceInputs = JSON.parse(raw) as VerseShellSourceInputs;
  } catch (error) {
    throw new Error(`Invalid VerseShell source-input manifest at ${sourceInputsPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  requireObject(sourceInputs, 'VerseShell source inputs');
  if (
    sourceInputs.schema_version !== 1
    || sourceInputs.component !== 'verseshell'
    || sourceInputs.repository !== EXPECTED_SOURCE_REPOSITORY
    || sourceInputs.commit !== EXPECTED_SOURCE_COMMIT
    || sourceInputs.commit_epoch !== EXPECTED_SOURCE_COMMIT_EPOCH
  ) {
    throw new Error('VerseShell source-input repository/commit identity is incompatible.');
  }
  const identity = sourceIdentity(sourceInputs);
  if (
    sourceInputs.identity?.algorithm !== 'sha256(canonical-json-without-identity)'
    || sourceInputs.identity?.combined_algorithm !== 'sha256(verseshell.source-identity/v1\\n + payload_sha256)'
    || sourceInputs.identity?.payload_sha256 !== identity.payload
    || sourceInputs.identity?.combined_sha256 !== identity.combined
    || identity.combined !== EXPECTED_SOURCE_IDENTITY_SHA256
  ) {
    throw new Error('VerseShell source-input identity digest is incompatible.');
  }
  if (!Array.isArray(sourceInputs.patches) || sourceInputs.patches.length !== EXPECTED_PATCHES.length) {
    throw new Error('VerseShell source-input patch stack is incomplete.');
  }
  for (let index = 0; index < EXPECTED_PATCHES.length; index += 1) {
    const patch = sourceInputs.patches[index];
    const [path, bytes, sha256] = EXPECTED_PATCHES[index];
    if (patch?.order !== index + 1 || patch.path !== path || patch.bytes !== bytes || patch.sha256 !== sha256) {
      throw new Error(`VerseShell source-input patch ${index + 1} identity drifted.`);
    }
  }
  const recoveredPaths = sourceInputs.recovered_inputs?.files?.map((entry) => entry.path) ?? [];
  if (
    sourceInputs.recovered_inputs?.verified_after_patch_order !== 3
    || sourceInputs.recovered_inputs?.upstream_ignore_rule !== '*.py'
    || JSON.stringify(recoveredPaths) !== JSON.stringify(EXPECTED_RECOVERED_PATHS)
  ) {
    throw new Error('VerseShell recovered ignored-source inventory drifted.');
  }
  return sourceInputs;
}

async function validateSourceInputs(
  sourceInputsPath: string,
  complianceDir: string,
  raw: string,
  io: Pick<Required<ResolveVerseShellRuntimeOptions>, 'stat' | 'hashFile'>,
): Promise<{ sourceInputs: VerseShellSourceInputs; sha256: string }> {
  const sourceInputs = parseSourceInputs(raw, sourceInputsPath);
  const sourceDigest = createHash('sha256').update(raw).digest('hex');
  if (sourceDigest !== EXPECTED_SOURCE_INPUTS_SHA256) {
    throw new Error(`VerseShell source-input manifest checksum mismatch: expected ${EXPECTED_SOURCE_INPUTS_SHA256}, found ${sourceDigest}.`);
  }
  for (const [index, [relativePath, bytes, sha256]] of EXPECTED_PATCHES.entries()) {
    const patchPath = join(complianceDir, relativePath.replace('resources/verseshell/', ''));
    const info = await io.stat(patchPath).catch(() => null);
    if (!info?.isFile() || info.size !== bytes) {
      throw new Error(`VerseShell source patch ${index + 1} is missing or has the wrong size: ${patchPath}`);
    }
    const actual = await io.hashFile(patchPath);
    if (actual !== sha256) throw new Error(`VerseShell source patch ${index + 1} checksum mismatch: expected ${sha256}, found ${actual}.`);
  }
  return { sourceInputs, sha256: sourceDigest };
}

function validateManifest(
  manifest: VerseShellManifest,
  sourceInputsSha256: string,
  platform: string,
  arch: string,
): VerseShellArtifact {
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.component !== 'verseshell') {
    throw new Error('VerseShell manifest schema/component is unsupported.');
  }
  if (
    manifest.crate.name !== 'verseshell'
    || manifest.crate.version !== '1.0.0'
    || manifest.crate.rust_version !== '1.75'
    || manifest.crate.edition !== '2021'
  ) {
    throw new Error('VerseShell manifest crate identity is invalid.');
  }
  const target = `${platform}-${arch}`;
  const artifact = manifest.artifacts[target];
  if (!artifact) throw new Error(`VerseShell manifest has no artifact for ${target}.`);
  requireObject(artifact, `VerseShell manifest.artifacts.${target}`);
  if (artifact.path !== 'resources/bin/win32-x64/ae.exe' || artifact.packaged_path !== 'bin/ae.exe') {
    throw new Error('VerseShell manifest artifact paths are invalid.');
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    throw new Error('VerseShell manifest artifact size/SHA-256 is invalid.');
  }
  if (artifact.version !== manifest.crate.version) throw new Error('VerseShell manifest artifact/crate version mismatch.');
  if (
    manifest.protocol.observation_schema !== 'verseshell.observation/v1'
    || manifest.protocol.mcp_protocol_version !== '2024-11-05'
    || manifest.protocol.expected_server_protocol !== 'verseshell.jsonl/v1'
    || manifest.protocol.operation_catalog_schema !== 'verseshell.operation-catalog/v1'
    || manifest.protocol.operation_catalog_digest !== 'sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7'
    || manifest.protocol.operation_catalog_count !== 31
    || manifest.protocol.handshake_operation !== 'runtime.handshake'
    || manifest.protocol.server_version !== manifest.crate.version
  ) {
    throw new Error('VerseShell manifest version/protocol/catalog metadata is incompatible.');
  }
  if (
    !nonBlank(manifest.build.cargo_version)
    || !manifest.build.cargo_version.startsWith('cargo 1.94.0 ')
    || !nonBlank(manifest.build.rustc_version)
    || !manifest.build.rustc_version.includes('release: 1.94.0')
    || manifest.build.cargo_target !== 'x86_64-pc-windows-msvc'
    || manifest.build.source_inputs_sha256 !== sourceInputsSha256
    || manifest.build.source_identity_sha256 !== EXPECTED_SOURCE_IDENTITY_SHA256
  ) {
    throw new Error('VerseShell manifest build/source/toolchain metadata is incompatible.');
  }
  const expectedLocator = `${EXPECTED_SOURCE_REPOSITORY}@${EXPECTED_SOURCE_COMMIT}+resources/verseshell/source-inputs.json#sha256:${EXPECTED_SOURCE_IDENTITY_SHA256}`;
  if (
    manifest.provenance.repository !== EXPECTED_SOURCE_REPOSITORY
    || manifest.provenance.commit !== EXPECTED_SOURCE_COMMIT
    || manifest.provenance.commit_epoch !== EXPECTED_SOURCE_COMMIT_EPOCH
    || manifest.provenance.source_model !== 'pinned-commit-plus-ordered-patches'
    || manifest.provenance.unrecorded_changes !== false
    || manifest.provenance.source_inputs?.path !== 'resources/verseshell/source-inputs.json'
    || manifest.provenance.source_inputs?.sha256 !== sourceInputsSha256
    || manifest.provenance.source_inputs?.identity_sha256 !== EXPECTED_SOURCE_IDENTITY_SHA256
    || manifest.provenance.corresponding_source?.locator !== expectedLocator
    || manifest.compliance.corresponding_source_locator !== expectedLocator
    || manifest.compliance.source_inputs_path !== 'resources/verseshell/source-inputs.json'
  ) {
    throw new Error('VerseShell manifest source provenance/corresponding-source locator is incomplete.');
  }
  for (const [key, filename] of Object.entries(COMPLIANCE_FILES)) {
    if (manifest.compliance[key] !== filename) throw new Error(`VerseShell manifest compliance.${key} must be ${filename}.`);
  }
  if (
    manifest.build.controls?.cargo_incremental !== '0'
    || manifest.build.controls?.source_date_epoch !== EXPECTED_SOURCE_COMMIT_EPOCH
    || JSON.stringify(manifest.build.controls?.encoded_rustflags) !== JSON.stringify([
      '--remap-path-prefix={source_root}=/verseshell/source',
      '--remap-path-prefix={target_root}=/verseshell/target',
      '-C', 'link-arg=/Brepro', '-C', 'link-arg=/PDBALTPATH:%_PDB%',
    ])
  ) {
    throw new Error('VerseShell manifest deterministic build controls are incomplete.');
  }
  if (
    manifest.build.qualification?.status !== 'passed'
    || manifest.build.qualification.rust_tests?.length !== 2
    || manifest.build.qualification.rust_tests.some((entry) => entry.exit_code !== 0)
    || manifest.build.qualification.python_optional_verify?.status !== 'passed'
    || manifest.build.qualification.python_optional_verify.passed !== 2
    || manifest.build.qualification.python_optional_verify.failed !== 0
  ) {
    throw new Error('VerseShell source qualification proof is incomplete.');
  }
  const reproducibility = manifest.build.reproducibility;
  if (
    reproducibility?.status !== 'passed'
    || reproducibility.independent_source_roots !== 2
    || reproducibility.independent_target_roots !== 2
    || reproducibility.byte_identical !== true
    || reproducibility.builds?.length !== 2
    || reproducibility.builds.some((entry) => entry.sha256 !== reproducibility.binary_sha256 || entry.bytes !== reproducibility.bytes)
    || artifact.sha256 !== reproducibility.binary_sha256
    || artifact.bytes !== reproducibility.bytes
  ) {
    throw new Error('VerseShell two-build reproducibility proof is incomplete.');
  }
  return artifact;
}

async function verifyBundle(
  executablePath: string,
  manifestPath: string,
  complianceDir: string,
  platform: string,
  arch: string,
  io: Pick<Required<ResolveVerseShellRuntimeOptions>, 'readFile' | 'stat' | 'hashFile'>,
  source: 'packaged-bundle' | 'development-bundle',
): Promise<ResolvedVerseShellRuntime> {
  const manifest = parseManifest(await io.readFile(manifestPath, 'utf8'), manifestPath);
  const sourceInputsPath = join(complianceDir, COMPLIANCE_FILES.source_inputs_file);
  const sourceInputs = await validateSourceInputs(
    sourceInputsPath,
    complianceDir,
    await io.readFile(sourceInputsPath, 'utf8'),
    io,
  );
  const artifact = validateManifest(manifest, sourceInputs.sha256, platform, arch);

  for (const [key, filename] of Object.entries(COMPLIANCE_FILES)) {
    const compliancePath = join(complianceDir, filename);
    const info = await io.stat(compliancePath).catch(() => null);
    if (!info?.isFile() || info.size <= 0) {
      throw new Error(`VerseShell compliance ${key} file is missing: ${compliancePath}`);
    }
  }

  const binaryInfo = await io.stat(executablePath).catch(() => null);
  if (!binaryInfo?.isFile()) throw new Error(`VerseShell runtime is missing: ${executablePath}`);
  if (binaryInfo.size !== artifact.bytes) {
    throw new Error(
      `VerseShell runtime size mismatch at ${executablePath}: expected ${artifact.bytes}, found ${binaryInfo.size}.`,
    );
  }
  const actualSha256 = await io.hashFile(executablePath);
  if (actualSha256 !== artifact.sha256) {
    throw new Error(
      `VerseShell runtime checksum mismatch at ${executablePath}: expected ${artifact.sha256}, found ${actualSha256}.`,
    );
  }

  return {
    executablePath,
    provenance: {
      verified: true,
      source,
      manifestPath,
      sha256: actualSha256,
      sizeBytes: binaryInfo.size,
      version: artifact.version,
      protocolVersion: manifest.protocol.expected_server_protocol,
      operationCatalogDigest: manifest.protocol.operation_catalog_digest,
      operationCatalogCount: manifest.protocol.operation_catalog_count,
      observationSchema: manifest.protocol.observation_schema,
      repository: manifest.provenance.repository,
      commit: manifest.provenance.commit,
       commitEpoch: manifest.provenance.commit_epoch,
       sourceIdentitySha256: manifest.provenance.source_inputs.identity_sha256,
       unrecordedChanges: manifest.provenance.unrecorded_changes,
    },
  };
}

/**
 * Resolve an `ae.exe` that has either passed bundle verification or was selected
 * by the explicit development-only escape hatch.
 *
 * Packaged mode is fail-closed and never inspects PATH. Development overrides
 * require both CLAWX_VERSESHELL_DEV_OVERRIDE=1 and CLAWX_VERSESHELL_DEV_AE_PATH.
 */
export async function resolveVerseShellRuntimeBundle(
  options: ResolveVerseShellRuntimeOptions,
): Promise<ResolvedVerseShellRuntime> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const io = {
    readFile: options.readFile ?? readFile,
    stat: options.stat ?? stat,
    hashFile: options.hashFile ?? defaultHashFile,
  };

  validateTarget(platform, arch);

  const overrideEnabled = enabled(env[VERSESHELL_DEV_OVERRIDE_FLAG]);
  const overridePath = env[VERSESHELL_DEV_OVERRIDE_PATH]?.trim();
  if (overrideEnabled || nonBlank(overridePath)) {
    if (options.isPackaged) {
      throw new Error('VerseShell development override is forbidden in packaged mode.');
    }
    if (!overrideEnabled || !nonBlank(overridePath)) {
      throw new Error(
        `VerseShell development override requires both ${VERSESHELL_DEV_OVERRIDE_FLAG}=1 and ${VERSESHELL_DEV_OVERRIDE_PATH}=<absolute ae.exe path>.`,
      );
    }
    if (!isAbsolute(overridePath)) {
      throw new Error(`${VERSESHELL_DEV_OVERRIDE_PATH} must be an absolute path.`);
    }
    const overrideInfo = await io.stat(overridePath).catch(() => null);
    if (!overrideInfo?.isFile() || overrideInfo.size <= 0) {
      throw new Error(`VerseShell development override is missing: ${overridePath}`);
    }
    return {
      executablePath: resolve(overridePath),
      provenance: {
        verified: false,
        source: 'development-override',
        manifestPath: null,
        sha256: null,
        sizeBytes: overrideInfo.size,
        version: null,
        protocolVersion: null,
        operationCatalogDigest: null,
        operationCatalogCount: null,
        observationSchema: null,
        repository: null,
        commit: null,
        commitEpoch: null,
        sourceIdentitySha256: null,
        unrecordedChanges: null,
      },
    };
  }

  if (options.isPackaged) {
    if (!nonBlank(options.resourcesPath)) throw new Error('Packaged VerseShell resolution requires resourcesPath.');
    const root = resolve(options.resourcesPath);
    return verifyBundle(
      join(root, 'bin', 'ae.exe'),
      join(root, 'resources', 'verseshell', 'manifest.json'),
      join(root, 'resources', 'verseshell'),
      platform,
      arch,
      io,
      'packaged-bundle',
    );
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  return verifyBundle(
    join(cwd, 'resources', 'bin', `${platform}-${arch}`, 'ae.exe'),
    join(cwd, 'resources', 'verseshell', 'manifest.json'),
    join(cwd, 'resources', 'verseshell'),
    platform,
    arch,
    io,
    'development-bundle',
  );
}

/** Resolve only when the launch target bundles VerseShell or an explicit rollout needs it. */
export async function resolveVerseShellRuntimeForLaunch(
  options: ResolveVerseShellRuntimeForLaunchOptions,
): Promise<ResolvedVerseShellRuntime | null> {
  const { rolloutConfig, devOverrideRequested = false, resolveRuntime, ...runtimeOptions } = options;
  const platform = runtimeOptions.platform ?? process.platform;
  const arch = runtimeOptions.arch ?? process.arch;
  const bundledTarget = runtimeOptions.isPackaged && platform === 'win32' && arch === 'x64';
  const rolloutRequested = isVerseShellRuntimeRequestedByRollout(
    rolloutConfig,
    runtimeOptions.env ?? process.env,
  );
  if (!bundledTarget && !devOverrideRequested && !rolloutRequested) return null;
  return await (resolveRuntime ?? resolveVerseShellRuntimeBundle)(runtimeOptions);
}
