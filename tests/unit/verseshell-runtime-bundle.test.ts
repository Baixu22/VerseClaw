// @vitest-environment node
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VERSESHELL_DEV_OVERRIDE_FLAG,
  VERSESHELL_DEV_OVERRIDE_PATH,
  buildVerseShellRuntimeEnv,
  resolveVerseShellRuntimeBundle,
  resolveVerseShellRuntimeForLaunch,
} from '@electron/utils/verseshell-runtime-bundle';
import { isVerseShellRuntimeRequestedByRollout } from '@electron/utils/verseshell-runtime-request';

const roots: string[] = [];
const LICENSE = 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n';
const PROJECT_ROOT = resolve(__dirname, '../..');
const SOURCE_INPUTS_SHA256 = '26c152fde20a87545a0b5544b998f3cb59e672338ed6110a2f18a79e6aca5f2f';
const SOURCE_IDENTITY_SHA256 = 'a9eb8940dd4f6509fdec8abebfc6351933266494387b3ae1e7e5e0445a00e0d5';
const SOURCE_REPOSITORY = 'https://github.com/Baixu22/VerseShell.git';
const SOURCE_COMMIT = 'c06f406e83566bb968448222d9c8caf429e580a0';
const SOURCE_LOCATOR = `${SOURCE_REPOSITORY}@${SOURCE_COMMIT}+resources/verseshell/source-inputs.json#sha256:${SOURCE_IDENTITY_SHA256}`;
const PATCHES = [
  'resources/verseshell/patches/p0-runtime-startup.patch',
  'resources/verseshell/patches/python-current-interpreter.patch',
  'resources/verseshell/patches/binary-test-targets.patch',
];

function digest(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function manifestFor(binary: Buffer, overrides: Record<string, unknown> = {}) {
  const binaryDigest = digest(binary);
  const handshake = {
    runtime_version: '1.0.0',
    server_protocol: 'verseshell.jsonl/v1',
    operation_catalog_schema: 'verseshell.operation-catalog/v1',
    operation_catalog_digest: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
    operation_catalog_count: 32,
  };
  return {
    schema_version: 2,
    component: 'verseshell',
    upstream: {
      cargo_repository: 'https://github.com/nervosys/verseshell',
      source_repository: 'https://github.com/Baixu22/VerseShell.git',
      pinned_commit: SOURCE_COMMIT,
      pinned_commit_epoch: 1791974123,
      source_model: 'pinned-commit-plus-ordered-patches',
      pinned_commit_status: 'qualified_ordered_patch_stack',
    },
    license: 'AGPL-3.0-or-later',
    crate: { name: 'verseshell', version: '1.0.0', rust_version: '1.75', edition: '2021' },
    protocol: {
      observation_schema: 'verseshell.observation/v1',
      mcp_protocol_version: '2024-11-05',
      expected_server_protocol: 'verseshell.jsonl/v1',
      operation_catalog_schema: 'verseshell.operation-catalog/v1',
      operation_catalog_digest: handshake.operation_catalog_digest,
      operation_catalog_count: handshake.operation_catalog_count,
      handshake_operation: 'runtime.handshake',
      server_name: 'ae-mcp',
      server_version: '1.0.0',
    },
    compliance: {
      license_file: 'LICENSE-AGPL-3.0-or-later.txt',
      notice_file: 'NOTICE.md',
      source_file: 'SOURCE.md',
      build_file: 'BUILD.md',
      source_inputs_file: 'source-inputs.json',
      notice_path: 'resources/verseshell/NOTICE.md',
      source_instructions_path: 'resources/verseshell/SOURCE.md',
      build_instructions_path: 'resources/verseshell/BUILD.md',
      source_inputs_path: 'resources/verseshell/source-inputs.json',
      corresponding_source_locator: SOURCE_LOCATOR,
      corresponding_source_status: 'tracked_ordered_patch_stack',
      patch_paths: PATCHES,
    },
    build: {
      instructions_path: 'resources/verseshell/BUILD.md',
      command: 'cargo build --locked --release --bin ae',
      primary_binary: 'ae',
      mcp_binary: 'not_packaged',
      cargo_version: 'cargo 1.94.0 (test)',
      rustc_version: 'rustc 1.94.0\nrelease: 1.94.0\nhost: x86_64-pc-windows-msvc',
      cargo_target: 'x86_64-pc-windows-msvc',
      cargo_metadata: {
        package_name: 'verseshell',
        package_version: '1.0.0',
        target_directory: '[independent-build-root]/target',
      },
      cargo_toml_sha256: 'ce56a1cb9842dac912d509673d7ab9238b42e044812101c24df8deaa4e68c63c',
      cargo_lock_sha256: '2970a2ad51f0f63ed66c51cf6935dbfd57ec0a1b19c78a4312d1eafe8b3a95e2',
      source_inputs_sha256: SOURCE_INPUTS_SHA256,
      source_identity_sha256: SOURCE_IDENTITY_SHA256,
      controls: {
        cargo_incremental: '0',
        source_date_epoch: 1791974123,
        encoded_rustflags: [
          '--remap-path-prefix={source_root}=/verseshell/source',
          '--remap-path-prefix={target_root}=/verseshell/target',
          '-C', 'link-arg=/Brepro', '-C', 'link-arg=/PDBALTPATH:%_PDB%',
        ],
      },
      qualification: {
        status: 'passed',
        rust_tests: [
          { argv: ['cargo', 'test', '--locked', '-j', '1'], exit_code: 0 },
          { argv: ['cargo', 'test', '--locked', '--no-run', '-j', '1'], exit_code: 0 },
        ],
        python_optional_verify: {
          status: 'passed', interpreter_version: 'Python 3.10.3',
          task_ids: ['python_edit_and_retest', 'python_fix_pytest_fail'], passed: 2, failed: 0,
        },
      },
      reproducibility: {
        status: 'passed', independent_source_roots: 2, independent_target_roots: 2,
        byte_identical: true, binary_sha256: binaryDigest, bytes: binary.length,
        builds: [
          { ordinal: 1, sha256: binaryDigest, bytes: binary.length, handshake },
          { ordinal: 2, sha256: binaryDigest, bytes: binary.length, handshake },
        ],
      },
      synchronized_at: '2026-08-14T00:00:00.000Z',
    },
    provenance: {
      repository: SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      commit_epoch: 1791974123,
      source_model: 'pinned-commit-plus-ordered-patches',
      unrecorded_changes: false,
      source_inputs: {
        path: 'resources/verseshell/source-inputs.json', sha256: SOURCE_INPUTS_SHA256,
        identity_sha256: SOURCE_IDENTITY_SHA256, patch_count: 3, recovered_input_count: 0,
      },
      corresponding_source: {
        locator: SOURCE_LOCATOR,
        patch_paths: PATCHES,
        instructions: 'Clone the HTTPS repository, checkout the pinned commit, then apply every source-input manifest patch in ascending order with git apply.',
      },
    },
    artifacts: {
      'win32-x64': {
        path: 'resources/bin/win32-x64/ae.exe',
        packaged_path: 'bin/ae.exe',
        sha256: binaryDigest,
        bytes: binary.length,
        version: '1.0.0',
      },
    },
    ...overrides,
  };
}

async function makePackagedBundle(
  name: string,
  options: { manifest?: Record<string, unknown>; omit?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), `${name}-路径 with spaces-`));
  roots.push(root);
  const compliance = join(root, 'resources', 'verseshell');
  const bin = join(root, 'bin');
  await mkdir(compliance, { recursive: true });
  await mkdir(bin, { recursive: true });
  const binary = Buffer.from('verified ae bytes');
  if (options.omit !== 'binary') await writeFile(join(bin, 'ae.exe'), binary);
  const files: Record<string, string> = {
    'LICENSE-AGPL-3.0-or-later.txt': LICENSE,
    'NOTICE.md': '# Notice\n',
    'SOURCE.md': '# Source\n',
    'BUILD.md': '# Build\n',
  };
  for (const [filename, content] of Object.entries(files)) {
    if (options.omit !== filename) await writeFile(join(compliance, filename), content);
  }
  if (options.omit !== 'source-inputs.json') {
    await cp(join(PROJECT_ROOT, 'resources/verseshell/source-inputs.json'), join(compliance, 'source-inputs.json'));
    for (const patch of PATCHES) {
      const destination = join(compliance, patch.replace('resources/verseshell/', ''));
      await mkdir(join(destination, '..'), { recursive: true });
      await cp(join(PROJECT_ROOT, patch), destination);
    }
  }
  const manifest = options.manifest ?? manifestFor(binary);
  await writeFile(join(compliance, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return { root, binary, manifest, executablePath: join(bin, 'ae.exe') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('resolveVerseShellRuntimeBundle', () => {
  it('verifies a packaged bundle under spaces and non-ASCII paths', async () => {
    const bundle = await makePackagedBundle('verseshell');
    const result = await resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    });
    expect(result.executablePath).toBe(bundle.executablePath);
    expect(result.provenance).toMatchObject({
      verified: true,
      source: 'packaged-bundle',
      sha256: digest(bundle.binary),
      version: '1.0.0',
      protocolVersion: 'verseshell.jsonl/v1',
      operationCatalogDigest: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
      operationCatalogCount: 32,
      commitEpoch: 1791974123,
      sourceIdentitySha256: SOURCE_IDENTITY_SHA256,
      unrecordedChanges: false,
    });
    expect(buildVerseShellRuntimeEnv(result)).toMatchObject({
      VERSESHELL_RUNTIME_PROVENANCE: 'verified',
      VERSESHELL_RUNTIME_VERSION: '1.0.0',
      VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
      VERSESHELL_OPERATION_CATALOG_DIGEST: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
      VERSESHELL_OPERATION_CATALOG_COUNT: '32',
    });
  });

  it('requests and fully contracts the verified bundle for a config-only governed canary', async () => {
    const config = {
      runtime: {
        verseShellFoundation: {
          verifiedRuntime: true,
          typedAci: true,
          facade: true,
          governedExec: true,
        },
      },
    };
    expect(isVerseShellRuntimeRequestedByRollout(config, {})).toBe(true);

    const bundle = await makePackagedBundle('verseshell-config-only');
    const runtime = await resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    });
    expect(buildVerseShellRuntimeEnv(runtime)).toEqual({
      VERSESHELL_AE_PATH: bundle.executablePath,
      VERSESHELL_RUNTIME_PROVENANCE: 'verified',
      VERSESHELL_AE_SHA256: digest(bundle.binary),
      VERSESHELL_RUNTIME_VERSION: '1.0.0',
      VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
      VERSESHELL_OPERATION_CATALOG_DIGEST: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
      VERSESHELL_OPERATION_CATALOG_COUNT: '32',
    });

    const resolver = vi.fn(async () => runtime);
    await expect(resolveVerseShellRuntimeForLaunch({
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      env: {},
      rolloutConfig: config,
      resolveRuntime: resolver,
    })).resolves.toBe(runtime);
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('keeps config rollout default-off and lets the kill switch veto resolution', () => {
    expect(isVerseShellRuntimeRequestedByRollout({}, {})).toBe(false);
    expect(isVerseShellRuntimeRequestedByRollout({
      runtime: {
        verseShellFoundation: { verifiedRuntime: true, killSwitch: true },
      },
    }, {})).toBe(false);
    expect(isVerseShellRuntimeRequestedByRollout({
      runtime: { verseShellFoundation: { governedExec: true } },
    }, { VERSE_VERSESHELL_FOUNDATION_GOVERNED_EXEC: '0' })).toBe(false);
  });

  it('does not break unrequested packaged targets that cannot bundle VerseShell', async () => {
    const resolver = vi.fn();
    await expect(resolveVerseShellRuntimeForLaunch({
      isPackaged: true,
      platform: 'linux',
      arch: 'x64',
      env: {},
      rolloutConfig: {},
      resolveRuntime: resolver,
    })).resolves.toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('fails closed on checksum mismatch', async () => {
    const bundle = await makePackagedBundle('verseshell-hash');
    await writeFile(bundle.executablePath, Buffer.from('tampered ae bytes'));
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: { PATH: 'C:\\untrusted\\ae' },
    })).rejects.toThrow(/size mismatch|checksum mismatch/);
  });

  it('fails when license or source compliance payload is missing', async () => {
    const missingLicense = await makePackagedBundle('verseshell-license', { omit: 'LICENSE-AGPL-3.0-or-later.txt' });
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: missingLicense.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/compliance license_file file is missing/);

    const missingSource = await makePackagedBundle('verseshell-source', { omit: 'SOURCE.md' });
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: missingSource.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/compliance source_file file is missing/);

    const missingSourceInputs = await makePackagedBundle('verseshell-source-inputs', { omit: 'source-inputs.json' });
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: missingSourceInputs.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/source-input|ENOENT/);
  });

  it('rejects wrong target or manifest architecture', async () => {
    const bundle = await makePackagedBundle('verseshell-target');
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'arm64',
      env: {},
    })).rejects.toThrow(/supports win32\/x64 only/);

    const wrongManifest = manifestFor(bundle.binary);
    wrongManifest.artifacts = {
      'win32-arm64': {
        path: 'resources/bin/win32-arm64/ae.exe',
        packaged_path: 'bin/ae.exe',
        sha256: digest(bundle.binary),
        bytes: bundle.binary.length,
        version: '1.0.0',
      },
    } as never;
    await writeFile(join(bundle.root, 'resources', 'verseshell', 'manifest.json'), JSON.stringify(wrongManifest));
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/no artifact for win32-x64/);
  });

  it('does not fall back to PATH when the packaged binary is missing', async () => {
    const bundle = await makePackagedBundle('verseshell-no-path', { omit: 'binary' });
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: { PATH: 'C:\\fake\\ae.exe' },
    })).rejects.toThrow(`VerseShell runtime is missing: ${bundle.executablePath}`);
  });

  it('forbids an explicit development override in packaged mode', async () => {
    const bundle = await makePackagedBundle('verseshell-package-override');
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {
        [VERSESHELL_DEV_OVERRIDE_FLAG]: '1',
        [VERSESHELL_DEV_OVERRIDE_PATH]: bundle.executablePath,
      },
    })).rejects.toThrow(/development override is forbidden in packaged mode/);
  });

  it('allows only the named development override and marks it unverified', async () => {
    const bundle = await makePackagedBundle('verseshell-dev-override');
    const result = await resolveVerseShellRuntimeBundle({
      isPackaged: false,
      cwd: join(bundle.root, 'not-the-bundle'),
      platform: 'win32',
      arch: 'x64',
      env: {
        [VERSESHELL_DEV_OVERRIDE_FLAG]: 'true',
        [VERSESHELL_DEV_OVERRIDE_PATH]: bundle.executablePath,
      },
    });
    expect(result).toMatchObject({
      executablePath: bundle.executablePath,
      provenance: { verified: false, source: 'development-override' },
    });
  });

  it('rejects a provenance lock drift even when the binary itself is intact', async () => {
    const bundle = await makePackagedBundle('verseshell-provenance-drift');
    const raw = JSON.parse(await readFile(join(bundle.root, 'resources', 'verseshell', 'manifest.json'), 'utf8'));
    raw.provenance.unrecorded_changes = true;
    await writeFile(join(bundle.root, 'resources', 'verseshell', 'manifest.json'), JSON.stringify(raw));
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/source provenance|corresponding-source/);
  });
});
