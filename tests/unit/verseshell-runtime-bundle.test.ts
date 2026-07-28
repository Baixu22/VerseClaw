// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function digest(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function manifestFor(binary: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    component: 'verseshell',
    upstream: {
      source_repository: 'https://github.com/Baixu22/VerseShell.git',
      pinned_commit: '15c027d72807d231a98b795ea2d1112654710add',
    },
    crate: { name: 'verseshell', version: '1.0.0', rust_version: '1.75' },
    protocol: {
      observation_schema: 'verseshell.observation/v1',
      mcp_protocol_version: '2024-11-05',
      expected_server_protocol: 'verseshell.jsonl/v1',
      operation_catalog_schema: 'verseshell.operation-catalog/v1',
      operation_catalog_digest: `sha256:${'a'.repeat(64)}`,
      operation_catalog_count: 26,
      server_name: 'ae-mcp',
      server_version: '1.0.0',
    },
    build: {
      cargo_version: 'cargo 1.75.0',
      rustc_version: 'rustc 1.75.0\nhost: x86_64-pc-windows-msvc',
      cargo_target: 'x86_64-pc-windows-msvc',
    },
    provenance: {
      repository: 'https://github.com/Baixu22/VerseShell.git',
      commit: '15c027d72807d231a98b795ea2d1112654710add',
      dirty: false,
      corresponding_source: {
        locator: 'https://github.com/Baixu22/VerseShell.git@15c027d72807d231a98b795ea2d1112654710add',
        patch_instructions: null,
      },
    },
    compliance: {
      license_file: 'LICENSE-AGPL-3.0-or-later.txt',
      notice_file: 'NOTICE.md',
      source_file: 'SOURCE.md',
      build_file: 'BUILD.md',
      corresponding_source_locator: 'https://github.com/Baixu22/VerseShell.git@15c027d72807d231a98b795ea2d1112654710add',
    },
    artifacts: {
      'win32-x64': {
        path: 'resources/bin/win32-x64/ae.exe',
        packaged_path: 'bin/ae.exe',
        sha256: digest(binary),
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
      operationCatalogDigest: `sha256:${'a'.repeat(64)}`,
      operationCatalogCount: 26,
      dirty: false,
    });
    expect(buildVerseShellRuntimeEnv(result)).toMatchObject({
      VERSESHELL_RUNTIME_PROVENANCE: 'verified',
      VERSESHELL_RUNTIME_VERSION: '1.0.0',
      VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
      VERSESHELL_OPERATION_CATALOG_DIGEST: `sha256:${'a'.repeat(64)}`,
      VERSESHELL_OPERATION_CATALOG_COUNT: '26',
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
      VERSESHELL_OPERATION_CATALOG_DIGEST: `sha256:${'a'.repeat(64)}`,
      VERSESHELL_OPERATION_CATALOG_COUNT: '26',
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
    };
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

  it('requires dirty manifests to carry patch instructions', async () => {
    const bundle = await makePackagedBundle('verseshell-dirty');
    const raw = JSON.parse(await readFile(join(bundle.root, 'resources', 'verseshell', 'manifest.json'), 'utf8'));
    raw.provenance.dirty = true;
    raw.provenance.corresponding_source.patch_instructions = null;
    await writeFile(join(bundle.root, 'resources', 'verseshell', 'manifest.json'), JSON.stringify(raw));
    await expect(resolveVerseShellRuntimeBundle({
      isPackaged: true,
      resourcesPath: bundle.root,
      platform: 'win32',
      arch: 'x64',
      env: {},
    })).rejects.toThrow(/Dirty VerseShell manifest lacks patch/);
  });
});
