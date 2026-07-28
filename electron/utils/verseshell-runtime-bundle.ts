import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isVerseShellRuntimeRequestedByRollout } from './verseshell-runtime-request';

export const VERSESHELL_DEV_OVERRIDE_FLAG = 'CLAWX_VERSESHELL_DEV_OVERRIDE';
export const VERSESHELL_DEV_OVERRIDE_PATH = 'CLAWX_VERSESHELL_DEV_AE_PATH';

const SCHEMA_VERSION = 1;
const COMPLIANCE_FILES = {
  license_file: 'LICENSE-AGPL-3.0-or-later.txt',
  notice_file: 'NOTICE.md',
  source_file: 'SOURCE.md',
  build_file: 'BUILD.md',
} as const;

interface VerseShellArtifact {
  path: string;
  packaged_path: string;
  sha256: string;
  bytes: number;
  version: string;
}

interface VerseShellManifest {
  schema_version: number;
  component: string;
  crate: { name: string; version: string; rust_version: string };
  protocol: {
    observation_schema: string;
    mcp_protocol_version: string;
    expected_server_protocol: string;
    operation_catalog_schema: string;
    operation_catalog_digest: string;
    operation_catalog_count: number;
    server_name: string;
    server_version: string;
  };
  provenance: {
    repository: string;
    commit: string;
    dirty: boolean;
    corresponding_source: { locator: string | null; patch_instructions: string | null };
  };
  build: { cargo_version: string; rustc_version: string; cargo_target: string };
  compliance: Record<keyof typeof COMPLIANCE_FILES, string> & {
    corresponding_source_locator: string | null;
  };
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
  dirty: boolean | null;
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

function validateManifest(
  manifest: VerseShellManifest,
  platform: string,
  arch: string,
): VerseShellArtifact {
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.component !== 'verseshell') {
    throw new Error('VerseShell manifest schema/component is unsupported.');
  }
  if (manifest.crate.name !== 'verseshell' || !nonBlank(manifest.crate.version)) {
    throw new Error('VerseShell manifest crate identity is invalid.');
  }

  const target = `${platform}-${arch}`;
  const artifact = manifest.artifacts[target];
  if (!artifact) throw new Error(`VerseShell manifest has no artifact for ${target}.`);
  requireObject(artifact, `VerseShell manifest.artifacts.${target}`);
  if (
    artifact.path !== 'resources/bin/win32-x64/ae.exe'
    || artifact.packaged_path !== 'bin/ae.exe'
  ) {
    throw new Error('VerseShell manifest artifact paths are invalid.');
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
    throw new Error('VerseShell manifest artifact size is invalid.');
  }
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    throw new Error('VerseShell manifest artifact SHA-256 is invalid.');
  }
  if (artifact.version !== manifest.crate.version) {
    throw new Error('VerseShell manifest artifact/crate version mismatch.');
  }
  if (
    manifest.protocol.observation_schema !== 'verseshell.observation/v1'
    || !nonBlank(manifest.protocol.mcp_protocol_version)
    || manifest.protocol.expected_server_protocol !== 'verseshell.jsonl/v1'
    || manifest.protocol.operation_catalog_schema !== 'verseshell.operation-catalog/v1'
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.protocol.operation_catalog_digest)
    || !Number.isSafeInteger(manifest.protocol.operation_catalog_count)
    || manifest.protocol.operation_catalog_count <= 0
    || manifest.protocol.server_version !== manifest.crate.version
  ) {
    throw new Error('VerseShell manifest version/protocol metadata is incomplete or incompatible.');
  }
  if (
    !nonBlank(manifest.build.cargo_version)
    || !nonBlank(manifest.build.rustc_version)
    || manifest.build.cargo_target !== 'x86_64-pc-windows-msvc'
  ) {
    throw new Error('VerseShell manifest build target metadata is incomplete or incompatible.');
  }
  if (
    !nonBlank(manifest.provenance.repository)
    || !/^[a-f0-9]{40}$/i.test(manifest.provenance.commit)
    || !nonBlank(manifest.provenance.corresponding_source?.locator)
    || manifest.compliance.corresponding_source_locator !== manifest.provenance.corresponding_source.locator
  ) {
    throw new Error('VerseShell manifest source provenance/corresponding-source locator is incomplete.');
  }
  if (manifest.provenance.dirty && !nonBlank(manifest.provenance.corresponding_source.patch_instructions)) {
    throw new Error('Dirty VerseShell manifest lacks patch/source-snapshot instructions.');
  }
  for (const [key, filename] of Object.entries(COMPLIANCE_FILES)) {
    if (manifest.compliance[key as keyof typeof COMPLIANCE_FILES] !== filename) {
      throw new Error(`VerseShell manifest compliance.${key} must be ${filename}.`);
    }
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
  const artifact = validateManifest(manifest, platform, arch);

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
      dirty: manifest.provenance.dirty,
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
        dirty: null,
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
