import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateReleaseTrustMetadata } from '../../scripts/generate-release-trust-metadata.mjs';
import { fetchVerifiedAsset } from '../../scripts/lib/verified-download.mjs';
import {
  validateElectronBuilderTrustPolicy,
  validateFuseWire,
  validateReleaseTrustMetadata,
  verifyAsarDigest,
} from '../../scripts/validate-release-trust-metadata.mjs';
import { verifyPackagedElectronTrustReport } from '../../scripts/verify-packaged-electron-trust.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawx-p6-004-'));
  temporaryDirectories.push(root);
  const artifactsDir = join(root, 'artifacts');
  const outputDir = join(root, 'trust');
  const packageJsonPath = join(root, 'package.json');
  const lockfilePath = join(root, 'pnpm-lock.yaml');
  await writeFile(packageJsonPath, JSON.stringify({ name: 'clawx', productName: 'ClawX' }));
  await writeFile(
    lockfilePath,
    "lockfileVersion: '9.0'\npackages:\n\n  demo@1.2.3:\n    resolution: {integrity: sha512-YWJj}\n    peerDependencies:\n      '@types/react': '*'\n\nsnapshots:\n",
  );
  await rm(artifactsDir, { recursive: true, force: true });
  await import('node:fs/promises').then(({ mkdir }) => mkdir(artifactsDir, { recursive: true }));
  await writeFile(join(artifactsDir, 'ClawX.exe'), 'signed-executable');
  await writeFile(join(artifactsDir, 'latest.yml'), 'version: 1.2.3');
  const generated = await generateReleaseTrustMetadata({
    artifactsDir,
    outputDir,
    packageJsonPath,
    lockfilePath,
    version: '1.2.3',
    commit: 'a'.repeat(40),
    repository: 'IntelliSpectrum/ClawX',
    ref: 'refs/tags/v1.2.3',
    runId: '42',
    runAttempt: '1',
    generatedAt: '2026-07-17T00:00:00.000Z',
  });
  return { root, artifactsDir, lockfilePath, ...generated };
}

describe('P6-004 release artifact and runtime integrity', () => {
  it('preserves hash verification when a managed Windows system proxy fallback is required', async () => {
    const payload = Buffer.from('proxy-verified-payload');
    const { createHash } = await import('node:crypto');
    const asset = {
      name: 'proxy.bin',
      url: 'https://downloads.example/proxy.bin',
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    };
    await expect(
      fetchVerifiedAsset(asset, {
        fetchImpl: async () => {
          throw new Error('managed route');
        },
        systemProxyFetch: async () => ({ buffer: payload, url: asset.url }),
        tlsRejectUnauthorized: '1',
      }),
    ).resolves.toMatchObject({ sha256: asset.sha256 });
  });

  it('rejects a managed proxy fallback that cannot prove its final HTTPS URL', async () => {
    const payload = Buffer.from('proxy-payload');
    const { createHash } = await import('node:crypto');
    const asset = {
      name: 'proxy.bin',
      url: 'https://downloads.example/proxy.bin',
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    };
    await expect(
      fetchVerifiedAsset(asset, {
        fetchImpl: async () => {
          throw new Error('managed route');
        },
        systemProxyFetch: async () => ({ buffer: payload }),
        tlsRejectUnauthorized: '1',
      }),
    ).rejects.toMatchObject({ code: 'ERR_RELEASE_TLS_REQUIRED' });
  });

  it('A1/A2 binds CycloneDX SBOM and SLSA provenance to exact artifact SHA256 subjects', async () => {
    const fixture = await createFixture();
    await expect(
      validateReleaseTrustMetadata({
        artifactsDir: fixture.artifactsDir,
        inventoryPath: fixture.inventoryPath,
        sbomPath: fixture.sbomPath,
        provenancePath: fixture.provenancePath,
        lockfilePath: fixture.lockfilePath,
        version: '1.2.3',
        commit: 'a'.repeat(40),
        repository: 'IntelliSpectrum/ClawX',
        ref: 'refs/tags/v1.2.3',
      }),
    ).resolves.toMatchObject({ artifacts: 2, dependencies: 1 });
  });

  it('A1/A2 rejects artifact and provenance tampering', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.artifactsDir, 'ClawX.exe'), 'tampered-executable');
    await expect(
      validateReleaseTrustMetadata({
        artifactsDir: fixture.artifactsDir,
        inventoryPath: fixture.inventoryPath,
        sbomPath: fixture.sbomPath,
        provenancePath: fixture.provenancePath,
        lockfilePath: fixture.lockfilePath,
      }),
    ).rejects.toThrow(/subjects do not match/i);

    const second = await createFixture();
    const provenance = JSON.parse(await readFile(second.provenancePath, 'utf8'));
    provenance.subject[0].digest.sha256 = '0'.repeat(64);
    await writeFile(second.provenancePath, JSON.stringify(provenance));
    await expect(
      validateReleaseTrustMetadata({
        artifactsDir: second.artifactsDir,
        inventoryPath: second.inventoryPath,
        sbomPath: second.sbomPath,
        provenancePath: second.provenancePath,
        lockfilePath: second.lockfilePath,
      }),
    ).rejects.toThrow(/provenance subjects/i);
  });

  it('A1 rejects an SBOM whose dependency inventory diverges from pnpm-lock.yaml', async () => {
    const fixture = await createFixture();
    const sbom = JSON.parse(await readFile(fixture.sbomPath, 'utf8'));
    sbom.components = sbom.components.filter((component: { type: string }) => component.type !== 'library');
    await writeFile(fixture.sbomPath, JSON.stringify(sbom));
    await expect(
      validateReleaseTrustMetadata({
        artifactsDir: fixture.artifactsDir,
        inventoryPath: fixture.inventoryPath,
        sbomPath: fixture.sbomPath,
        provenancePath: fixture.provenancePath,
        lockfilePath: fixture.lockfilePath,
      }),
    ).rejects.toThrow(/dependencies do not match/i);
  });

  it('A3 requires ASAR and both critical Electron fuse policies', () => {
    const valid = `asar: true\nelectronFuses:\n  enableEmbeddedAsarIntegrityValidation: true\n  onlyLoadAppFromAsar: true\n`;
    expect(validateElectronBuilderTrustPolicy(valid)).toMatchObject({ asar: true });
    expect(() => validateElectronBuilderTrustPolicy(valid.replace('onlyLoadAppFromAsar: true', 'onlyLoadAppFromAsar: false'))).toThrow(/only-load-asar/i);
  });

  it('A3 rejects a packaged fuse wire when either critical fuse is disabled', () => {
    expect(validateFuseWire({ version: '1', 4: 49, 5: 49 })).toBe(true);
    expect(() => validateFuseWire({ version: '1', 4: 49, 5: 48 })).toThrow(/OnlyLoadAppFromAsar/i);
    expect(() => validateFuseWire({ version: '1', 4: 48, 5: 49 })).toThrow(/EmbeddedAsar/i);
  });

  it('A3 rejects app.asar bytes that no longer match the packaged trust report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-p6-004-asar-'));
    temporaryDirectories.push(root);
    const asarPath = join(root, 'app.asar');
    await writeFile(asarPath, 'original-asar');
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update('original-asar').digest('hex');
    await expect(verifyAsarDigest(asarPath, expected, 13)).resolves.toMatchObject({ sha256: expected });
    await writeFile(asarPath, 'tampered-asar');
    await expect(verifyAsarDigest(asarPath, expected, 13)).rejects.toThrow(/SHA256 mismatch/i);
  });

  it('A3 loads the real CommonJS fuse reader and rejects a malformed packaged report', async () => {
    await expect(verifyPackagedElectronTrustReport('.', { packages: [] })).rejects.toThrow(
      /empty or malformed/i,
    );
  });
});
