import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchVerifiedAsset,
  downloadVerifiedAssetToFile,
  verifyAssetBuffer,
} from '../../scripts/lib/verified-download.mjs';
import { RELEASE_INTEGRITY_MANIFEST } from '../../scripts/release-integrity-manifest.mjs';
import {
  scanWorkflowText,
  validateManifest,
  validateSupplyChainIntegrity,
} from '../../scripts/validate-supply-chain-integrity.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

function fixtureAsset(value: string) {
  const buffer = Buffer.from(value);
  return {
    name: 'fixture.bin',
    url: 'https://downloads.example/fixture.bin',
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

describe('P6-003 supply-chain integrity pinning', () => {
  it('A1 verifies an offline asset and rejects size/hash mismatches', () => {
    const asset = fixtureAsset('verified-offline-payload');
    expect(verifyAssetBuffer(asset, Buffer.from('verified-offline-payload'))).toMatchObject({
      size: asset.size,
      sha256: asset.sha256,
    });
    expect(() => verifyAssetBuffer(asset, Buffer.from('tampered-offline-payload'))).toThrow(
      /mismatch/i,
    );
  });

  it('A1 fetches with TLS enabled and validates before returning bytes', async () => {
    const asset = fixtureAsset('downloaded-payload');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('downloaded-payload', {
        status: 200,
        headers: { 'content-length': String(asset.size) },
      }),
    );
    await expect(
      fetchVerifiedAsset(asset, { fetchImpl, tlsRejectUnauthorized: '1' }),
    ).resolves.toMatchObject({ size: asset.size, sha256: asset.sha256 });
    await expect(
      fetchVerifiedAsset(asset, { fetchImpl, tlsRejectUnauthorized: '0' }),
    ).rejects.toThrow(/certificate verification/i);
  });

  it('A1 leaves no installed file after mismatch and atomically writes verified bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clawx-p6-003-'));
    temporaryDirectories.push(directory);
    const destination = join(directory, 'tool.bin');
    const asset = fixtureAsset('verified-file-bytes');
    const tamperedFetch = vi.fn().mockResolvedValue(
      new Response('tampered-file-bytes', {
        status: 200,
        headers: { 'content-length': String(asset.size) },
      }),
    );
    await expect(
      downloadVerifiedAssetToFile(asset, destination, {
        fetchImpl: tamperedFetch,
        tlsRejectUnauthorized: '1',
      }),
    ).rejects.toThrow(/SHA256 mismatch/i);
    await expect(access(destination)).rejects.toThrow();

    const verifiedFetch = vi.fn().mockResolvedValue(
      new Response('verified-file-bytes', {
        status: 200,
        headers: { 'content-length': String(asset.size) },
      }),
    );
    await expect(
      downloadVerifiedAssetToFile(asset, destination, {
        fetchImpl: verifiedFetch,
        tlsRejectUnauthorized: '1',
      }),
    ).resolves.toMatchObject({ path: destination, sha256: asset.sha256 });
    await expect(readFile(destination, 'utf8')).resolves.toBe('verified-file-bytes');
  });

  it('A1 manifest covers every packaged binary family with size and SHA256', () => {
    expect(validateManifest(RELEASE_INTEGRITY_MANIFEST)).toEqual([]);
    expect(Object.keys(RELEASE_INTEGRITY_MANIFEST.downloads.uv.assets)).toHaveLength(6);
    expect(Object.keys(RELEASE_INTEGRITY_MANIFEST.downloads.agentBrowser.assets)).toHaveLength(5);
    expect(Object.keys(RELEASE_INTEGRITY_MANIFEST.downloads.node.assets)).toHaveLength(2);
    expect(Object.keys(RELEASE_INTEGRITY_MANIFEST.downloads.ossutil.assets)).toEqual([
      'ossutil-linux-amd64.zip',
    ]);
  });

  it('A2/A3 rejects remote installer pipes and movable Action refs', () => {
    const unsafe = `
      - uses: actions/checkout@v6
      - run: curl -sL https://example.invalid/install.sh | sudo bash
    `;
    expect(scanWorkflowText(unsafe, 'unsafe.yml')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/full commit SHA/i),
        expect.stringMatching(/remote installer pipe/i),
      ]),
    );
  });

  it('A1-A3 validates all repository downloaders and workflows', () => {
    expect(validateSupplyChainIntegrity()).toEqual({ ok: true, issues: [] });
  });
});
