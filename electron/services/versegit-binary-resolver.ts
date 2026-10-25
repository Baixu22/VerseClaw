import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const VG_SIDECAR_PACKAGE_SCHEMA = 'clawx.versegit.sidecar-package/v1' as const;
export const VG_SIDECAR_SUPPORTED_PROFILE = 'M1' as const;

export type VerseGitSidecarManifest = {
  schema: typeof VG_SIDECAR_PACKAGE_SCHEMA;
  packageId: string;
  driven_by: 'agent';
  actor: string;
  source: {
    repository: string;
    commit: string;
    tree: string;
    archiveSha256: string;
    archiveBytes: number;
    sourceInputsDigest: string;
    effectivePatchSet: string[];
  };
  build: {
    profile: 'release';
    command: string[];
    recipeDigest: string;
    sourceDateEpoch: number;
    lockfileSha256: string;
    toolchain: { cargo: string; rustc: string };
    independentBuildRoots: number;
    byteIdentical: boolean;
    buildHashes: { a: string; b: string };
    semanticIdentityEqual: boolean;
  };
  artifact: {
    devPath: string;
    packagedPath: string;
    sha256: string;
    bytes: number;
    format: 'pe32+';
    platform: 'win32';
    arch: 'x64';
    version: string;
  };
  provider: {
    capabilitiesSchema: string;
    capabilitiesSha256: string;
    capabilitiesBytes: number;
    contractVersion: string;
    contractDigest: string;
    schemaVersions: number[];
    ledgerSchemaVersion: number;
    goldenDigest: string;
  };
  profiles: string[];
  license: { spdx: string; path: string; sha256: string };
  retention: Record<string, unknown>;
};

export type VerseGitSidecarResolution =
  | {
      ok: true;
      code: 'verified';
      manifestPath: string;
      binaryPath: string;
      packageRoot: string;
      manifest: VerseGitSidecarManifest;
      version: string;
      capabilities: Record<string, unknown>;
    }
  | {
      ok: false;
      code:
        | 'artifact_missing'
        | 'schema_unsupported'
        | 'profile_unauthorized'
        | 'platform_or_arch_mismatch'
        | 'artifact_mismatch'
        | 'identity_mismatch';
      issues: string[];
      manifestPath: string | null;
      binaryPath: string | null;
    };

type Runner = (binaryPath: string, args: readonly string[]) => Buffer;

export type ResolveVerseGitSidecarOptions = {
  appPath?: string;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  profile?: string;
  manifestPath?: string;
  binaryPath?: string;
  runner?: Runner;
};

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value: unknown): string {
  return sha(stableJson(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reject(code: Exclude<VerseGitSidecarResolution, { ok: true }>['code'], issues: string[], manifestPath: string | null, binaryPath: string | null): VerseGitSidecarResolution {
  return { ok: false, code, issues, manifestPath, binaryPath };
}

function defaultRunner(): Runner {
  return (binaryPath, args) => {
    const result = spawnSync(binaryPath, [...args], {
      cwd: dirname(binaryPath),
      encoding: 'buffer',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`sidecar probe failed: ${result.error?.message ?? `exit ${String(result.status)}`}`);
    }
    return Buffer.from(result.stdout);
  };
}

function chooseManifestPath(options: ResolveVerseGitSidecarOptions): string | null {
  if (options.manifestPath) return resolve(options.manifestPath);
  const appPath = resolve(options.appPath ?? process.cwd());
  const development = join(appPath, 'resources', 'versegit', 'manifest.json');
  if (existsSync(development)) return development;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'resources', 'versegit', 'manifest.json');
    if (existsSync(packaged)) return packaged;
  }
  return development;
}

function deriveBinaryPath(options: ResolveVerseGitSidecarOptions, manifestPath: string, manifest: VerseGitSidecarManifest): string {
  if (options.binaryPath) return resolve(options.binaryPath);
  const resourcesRoot = resolve(manifestPath, '..', '..', '..');
  const packaged = join(resourcesRoot, manifest.artifact.packagedPath);
  if (existsSync(packaged)) return packaged;
  return join(resolve(options.appPath ?? process.cwd()), manifest.artifact.devPath);
}

/** Resolve and verify the digest-pinned VerseGit sidecar without mutable checkout fallback. */
export function resolveVerseGitSidecar(options: ResolveVerseGitSidecarOptions = {}): VerseGitSidecarResolution {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const profile = options.profile ?? VG_SIDECAR_SUPPORTED_PROFILE;
  const manifestPath = chooseManifestPath(options);
  if (!manifestPath) return reject('artifact_missing', ['sidecar manifest path is unavailable'], null, null);
  if (!existsSync(manifestPath)) return reject('artifact_missing', ['sidecar manifest is missing'], manifestPath, null);
  let manifest: VerseGitSidecarManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VerseGitSidecarManifest;
  } catch (error) {
    return reject('schema_unsupported', [`sidecar manifest is not valid JSON: ${String(error).slice(0, 160)}`], manifestPath, null);
  }
  if (manifest.schema !== VG_SIDECAR_PACKAGE_SCHEMA) {
    return reject('schema_unsupported', [`unsupported sidecar schema: ${String(manifest.schema)}`], manifestPath, null);
  }
  if (!Array.isArray(manifest.profiles) || !manifest.profiles.includes(profile)) {
    return reject('profile_unauthorized', [`profile ${profile} is not packaged`], manifestPath, null);
  }
  if (manifest.artifact.platform !== platform || manifest.artifact.arch !== arch) {
    return reject('platform_or_arch_mismatch', [`package target ${manifest.artifact.platform}-${manifest.artifact.arch} differs from ${platform}-${arch}`], manifestPath, null);
  }

  const binaryPath = deriveBinaryPath(options, manifestPath, manifest);
  if (!existsSync(binaryPath)) return reject('artifact_missing', ['sidecar binary is missing'], manifestPath, binaryPath);
  const issues: string[] = [];
  const bytes = readFileSync(binaryPath);
  if (sha(bytes) !== manifest.artifact.sha256) issues.push('binary_sha256_mismatch');
  if (statSync(binaryPath).size !== manifest.artifact.bytes) issues.push('binary_size_mismatch');
  const packageRoot = resolve(manifestPath, '..', '..', '..');
  const licensePath = join(packageRoot, manifest.license.path);
  if (!existsSync(licensePath) || sha(readFileSync(licensePath)) !== manifest.license.sha256) issues.push('license_mismatch');
  let version = '';
  let capabilities: Record<string, unknown> = {};
  try {
    const runner = options.runner ?? defaultRunner();
    version = runner(binaryPath, ['--version']).toString('utf8').trim();
    const capabilityBytes = runner(binaryPath, ['capabilities', '--json']);
    capabilities = JSON.parse(capabilityBytes.toString('utf8')) as Record<string, unknown>;
    if (sha(capabilityBytes) !== manifest.provider.capabilitiesSha256) issues.push('capabilities_digest_mismatch');
    if (capabilities.schema !== manifest.provider.capabilitiesSchema) issues.push('capabilities_schema_mismatch');
    if (version !== manifest.artifact.version) issues.push('binary_version_mismatch');
    const goldenDigest = digest({
      version,
      capabilitiesSha256: sha(capabilityBytes),
      capabilitiesSchema: capabilities.schema,
      contractDigest: manifest.provider.contractDigest,
    });
    if (goldenDigest !== manifest.provider.goldenDigest) issues.push('golden_identity_mismatch');
  } catch (error) {
    issues.push(`sidecar_probe_failed:${String(error).slice(0, 200)}`);
  }
  if (issues.length > 0) {
    const code = issues.includes('binary_version_mismatch') || issues.includes('capabilities_schema_mismatch') || issues.includes('golden_identity_mismatch')
      ? 'identity_mismatch'
      : 'artifact_mismatch';
    return reject(code, issues, manifestPath, binaryPath);
  }
  return { ok: true, code: 'verified', manifestPath, binaryPath, packageRoot, manifest, version, capabilities };
}
