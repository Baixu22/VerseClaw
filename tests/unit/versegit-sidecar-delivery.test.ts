import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VG_SIDECAR_PACKAGE_SCHEMA,
  resolveVerseGitSidecar,
  type VerseGitSidecarManifest,
} from '../../electron/services/versegit-binary-resolver';
import { loadVerseGitHostDiagnosticConfig } from '../../electron/services/versegit-api';

const root = process.cwd();
const manifestPath = join(root, 'resources/versegit/manifest.json');
const binaryPath = join(root, 'resources/bin/win32-x64/vg.exe');
const licensePath = join(root, 'resources/versegit/LICENSE-APACHE-2.0.txt');
const tempRoot = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const roots: string[] = [];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VerseGitSidecarManifest;

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureRoot(): string {
  const temp = mkdtempSync(join(tempRoot, 'versegit-f3-resolver-'));
  roots.push(temp);
  mkdirSync(join(temp, 'resources/versegit'), { recursive: true });
  mkdirSync(join(temp, 'resources/bin/win32-x64'), { recursive: true });
  copyFileSync(binaryPath, join(temp, manifest.artifact.devPath));
  copyFileSync(licensePath, join(temp, manifest.license.path));
  writeFileSync(join(temp, 'resources/versegit/manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return temp;
}

function resolveFixture(temp: string, value: VerseGitSidecarManifest = manifest) {
  const pathValue = join(temp, 'resources/versegit/manifest.json');
  writeFileSync(pathValue, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return resolveVerseGitSidecar({
    appPath: temp,
    manifestPath: pathValue,
    binaryPath: join(temp, value.artifact.devPath),
    profile: 'M1',
    platform: 'win32',
    arch: 'x64',
  });
}

afterEach(() => {
  for (const temp of roots.splice(0)) rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
});

describe('F3 VerseGit sidecar package identity', () => {
  it('resolves the development package without provider checkout or target/debug fallback', () => {
    const resolved = resolveVerseGitSidecar({ appPath: root, platform: 'win32', arch: 'x64', profile: 'M1' });
    expect(resolved).toMatchObject({
      ok: true,
      code: 'verified',
      version: 'vg 0.1.0',
      manifest: {
        schema: VG_SIDECAR_PACKAGE_SCHEMA,
        artifact: {
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          version: 'vg 0.1.0',
          platform: 'win32',
          arch: 'x64',
        },
        provider: {
          capabilitiesSchema: 'versegit.capabilities/v1',
          capabilitiesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
        profiles: ['M1'],
      },
    });
    expect(JSON.stringify(resolved)).not.toContain('D:/Projects');
    expect(JSON.stringify(resolved)).not.toContain('target/debug');
  });

  it('loads host diagnostic identity from the package and fails closed when it is absent', () => {
    const loaded = loadVerseGitHostDiagnosticConfig({
      CLAWX_VERSGIT_DIAGNOSTICS: '1',
      CLAWX_VERSGIT_APP_PATH: root,
      CLAWX_VERSGIT_PROVIDER_ROOT: root,
    });
    expect(loaded).toMatchObject({
      binaryPath,
      expectedBinarySha256: manifest.artifact.sha256,
      expectedVersion: manifest.artifact.version,
      expectedCapabilitiesDigest: manifest.provider.capabilitiesSha256,
      contractDigest: manifest.provider.contractDigest,
      binaryResolution: { ok: true },
    });
    const absent = loadVerseGitHostDiagnosticConfig({
      CLAWX_VERSGIT_DIAGNOSTICS: '1',
      CLAWX_VERSGIT_APP_PATH: join(root, 'missing-app-root'),
      CLAWX_VERSGIT_RESOURCES_PATH: join(root, 'missing-resources-root'),
    });
    expect(absent).toMatchObject({ binaryPath: null, binaryResolution: { ok: false, code: 'artifact_missing' } });
  });

  it('rejects missing, schema, profile, platform and artifact identity mismatches', () => {
    const temp = fixtureRoot();
    const pathValue = join(temp, 'resources/versegit/manifest.json');
    rmSync(pathValue);
    expect(resolveVerseGitSidecar({ manifestPath: pathValue, binaryPath: join(temp, manifest.artifact.devPath), profile: 'M1', platform: 'win32', arch: 'x64' }))
      .toMatchObject({ ok: false, code: 'artifact_missing' });
    expect(resolveFixture(temp, { ...manifest, schema: 'clawx.versegit.sidecar-package/v999' as never }))
      .toMatchObject({ ok: false, code: 'schema_unsupported' });
    writeFileSync(pathValue, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    expect(resolveVerseGitSidecar({ manifestPath: pathValue, binaryPath: join(temp, manifest.artifact.devPath), profile: 'M4', platform: 'win32', arch: 'x64' }))
      .toMatchObject({ ok: false, code: 'profile_unauthorized' });
    expect(resolveVerseGitSidecar({ manifestPath: pathValue, binaryPath: join(temp, manifest.artifact.devPath), profile: 'M1', platform: 'linux', arch: 'x64' }))
      .toMatchObject({ ok: false, code: 'platform_or_arch_mismatch' });
    expect(resolveFixture(temp, { ...manifest, artifact: { ...manifest.artifact, sha256: '0'.repeat(64) } }))
      .toMatchObject({ ok: false, code: 'artifact_mismatch', issues: expect.arrayContaining(['binary_sha256_mismatch']) });
  });

  it('rejects a binary whose observed version or capabilities differ from the manifest', () => {
    const temp = fixtureRoot();
    const pathValue = join(temp, 'resources/versegit/manifest.json');
    const result = resolveVerseGitSidecar({
      manifestPath: pathValue,
      binaryPath: join(temp, manifest.artifact.devPath),
      profile: 'M1',
      platform: 'win32',
      arch: 'x64',
      runner: (_binary, args) => Buffer.from(args[0] === '--version' ? 'vg 9.9.9\n' : JSON.stringify({ schema: 'other.schema/v1' })),
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'identity_mismatch',
      issues: expect.arrayContaining(['binary_version_mismatch', 'capabilities_digest_mismatch', 'capabilities_schema_mismatch']),
    });
  });

  it('README package files contain only the pinned provider identity and Apache-2.0 license', () => {
    expect(manifest.license.spdx).toBe('Apache-2.0');
    expect(sha(readFileSync(licensePath))).toBe(manifest.license.sha256);
    expect(manifest.retention).toMatchObject({
      codeCopied: false,
      gitDirectoryCopied: false,
      taskForestCopied: false,
      privateEvidenceCopied: false,
      supportedTargets: ['win32-x64'],
    });
    expect(manifest.build.byteIdentical).toBe(false);
    expect(manifest.build.semanticIdentityEqual).toBe(true);
  });
});
