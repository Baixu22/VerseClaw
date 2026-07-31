// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditPackagedCommandBoundaries,
  createFirstProductReleaseInfo,
  scanReleaseCandidateFiles,
  validatePackageFreshness,
  validateReleaseInfoDocument,
  validateRequiredSourceCoverage,
  validateSourceLicenseEvidence,
  validateUpdaterMetadata,
} from '../../scripts/validate-first-product-release-candidate.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'clawx-fp-p3-01-'));
  temporaryDirectories.push(path);
  return path;
}

function sourceLicenseEvidence() {
  return {
    schema: 'verse-claw-remote-forge-source-manifest/1',
    source: {
      upstreamUrl: 'https://github.com/tisrop/mergebeacon.git',
      snapshotInventory: {
        fileCount: 262,
        byteSize: 4428869,
        rootHash: '4e8255d3e9d4580e8bf5dd4d726f5d2d78b6be6c7dd97f91c62be098826152a4',
      },
      license: {
        spdx: 'Apache-2.0',
        licenseFileSha256: 'f6ca6d410b1858cdec5d3f502c7ad7f01646b9947d0a6504a0422fbb2d659835',
        noticeFilePresent: false,
      },
    },
    upstreamResolution: {
      status: 'exact_parent_commit_resolved',
      resolvedParentCommit: '14a17c7ecb821af4bdb645d5f492e7cf72bcd293',
      resolvedParentTree: '95fddba4593a879352a59de157db92c63afa819f',
      resolvedParentVerification: {
        commit: '14a17c7ecb821af4bdb645d5f492e7cf72bcd293',
        fileCount: 262,
        byteSize: 4428869,
        rootHash: '4e8255d3e9d4580e8bf5dd4d726f5d2d78b6be6c7dd97f91c62be098826152a4',
        matchesLocalSnapshot: true,
        noticeFilePresent: false,
      },
    },
    adoptionPolicy: {
      directSourceCopyAllowed: false,
      attributionAndModificationNotice: {
        upstreamCommit: '14a17c7ecb821af4bdb645d5f492e7cf72bcd293',
        snapshotRootSha256: '4e8255d3e9d4580e8bf5dd4d726f5d2d78b6be6c7dd97f91c62be098826152a4',
        implementation: 'clean-room TypeScript; no upstream implementation text copied',
      },
    },
  };
}

describe('FP-P3-01 fixture-grade release candidate validation', () => {
  it('requires every categorized Forge source to enter the release source manifest', () => {
    const requirements = {
      schema: 'verse-claw-first-product-release-sources/1',
      categories: {
        contract: ['shared/types/remote-forge.ts'],
        main: ['electron/services/remote-forge-api.ts'],
      },
    };
    const manifest = {
      files: [
        { path: 'electron/services/remote-forge-api.ts' },
        { path: 'shared/types/remote-forge.ts' },
      ],
    };
    expect(validateRequiredSourceCoverage(manifest, requirements)).toMatchObject({
      requiredSourceCount: 2,
      categories: { contract: 1, main: 1 },
    });
    expect(() =>
      validateRequiredSourceCoverage(
        { files: [{ path: 'shared/types/remote-forge.ts' }] },
        requirements,
      ),
    ).toThrow(/missing required first-product sources/i);
  });

  it('binds MergeBeacon attribution to the resolved parent archive and keeps copying disabled', () => {
    expect(validateSourceLicenseEvidence(sourceLicenseEvidence())).toMatchObject({
      commit: '14a17c7ecb821af4bdb645d5f492e7cf72bcd293',
      license: 'Apache-2.0',
      noticeFilePresent: false,
      directSourceCopyAllowed: false,
    });
    const unresolved = sourceLicenseEvidence();
    unresolved.upstreamResolution.status = 'exact_parent_commit_unresolved';
    expect(() => validateSourceLicenseEvidence(unresolved)).toThrow(/resolved parent status/i);
  });

  it('keeps release-info on the alpha x64 channel and binds latest.yml to installer bytes', () => {
    const version = '0.4.9-alpha.0';
    const installerName = `Verse Claw-${version}-win-x64.exe`;
    const releaseInfo = createFirstProductReleaseInfo({
      version,
      releaseDate: '2026-07-28T00:00:00.000Z',
    });
    expect(validateReleaseInfoDocument(releaseInfo, { version, installerName })).toMatchObject({
      channel: 'alpha',
      installerName,
    });
    const bytes = Buffer.from('fixture installer');
    const sha512Base64 = createHash('sha512').update(bytes).digest('base64');
    const yml = [
      `version: ${version}`,
      'files:',
      `  - url: ${installerName}`,
      `    sha512: ${sha512Base64}`,
      `    size: ${bytes.length}`,
      `path: ${installerName}`,
      `sha512: ${sha512Base64}`,
      '',
    ].join('\n');
    expect(
      validateUpdaterMetadata(yml, { name: installerName, size: bytes.length, sha512Base64 }),
    ).toMatchObject({ ok: true, checked: 1 });
    expect(() =>
      validateUpdaterMetadata(yml.replace(sha512Base64, 'tampered'), {
        name: installerName,
        size: bytes.length,
        sha512Base64,
      }),
    ).toThrow(/does not match/i);
    expect(() =>
      validateReleaseInfoDocument(
        {
          ...releaseInfo,
          downloads: { win: { x64: releaseInfo.downloads.win.x64, arm64: 'forbidden' } },
        },
        { version, installerName },
      ),
    ).toThrow(/architecture scope/i);
  });

  it('rejects bundled git/gh commands and GitHub CLI auth-state paths', async () => {
    const appDir = await temporaryDirectory();
    await mkdir(join(appDir, 'resources'), { recursive: true });
    await writeFile(join(appDir, 'Verse Claw.exe'), 'app');
    await writeFile(join(appDir, 'resources', 'app.asar'), 'asar');
    await expect(auditPackagedCommandBoundaries(appDir)).resolves.toMatchObject({
      forbiddenCommandCount: 0,
      forbiddenAuthStateCount: 0,
    });
    await writeFile(join(appDir, 'resources', 'gh.exe'), 'undeclared command');
    await expect(auditPackagedCommandBoundaries(appDir)).rejects.toThrow(/gh\.exe/i);
  });

  it('detects credentials, local paths, and verbatim tracked source bodies without echoing values', async () => {
    const root = await temporaryDirectory();
    const source = join(root, 'source.ts');
    const safe = join(root, 'safe.log');
    const leaked = join(root, 'leaked.log');
    const sourceBody = `export const marker = '${'x'.repeat(280)}';\n`;
    await writeFile(source, sourceBody);
    await writeFile(safe, 'fixture-grade scan completed\n');
    expect(
      await scanReleaseCandidateFiles([safe], {
        workspaceRoot: join(root, 'workspace-not-present'),
        userHome: join(root, 'home-not-present'),
        sourceFiles: [source],
      }),
    ).toMatchObject({ findings: [], sourceFilesChecked: 1 });
    await writeFile(
      leaked,
      `Authorization: Bearer ${'a'.repeat(24)}\n${sourceBody}`,
    );
    const result = await scanReleaseCandidateFiles([leaked], {
      workspaceRoot: join(root, 'workspace-not-present'),
      userHome: join(root, 'home-not-present'),
      sourceFiles: [source],
    });
    expect(result.findings.map((finding: { type: string }) => finding.type)).toEqual(
      expect.arrayContaining(['authorization-header', 'tracked-source-body']),
    );
    expect(JSON.stringify(result.findings)).not.toContain('a'.repeat(24));
  });

  it('requires app.asar to be newer than both renderer and Main build outputs', async () => {
    const root = await temporaryDirectory();
    const dist = join(root, 'dist');
    const distElectron = join(root, 'dist-electron');
    const asar = join(root, 'app.asar');
    await mkdir(dist);
    await mkdir(distElectron);
    const renderer = join(dist, 'index.js');
    const main = join(distElectron, 'main.js');
    await writeFile(renderer, 'renderer');
    await writeFile(main, 'main');
    await writeFile(asar, 'asar');
    const old = new Date('2026-07-28T00:00:00.000Z');
    const middle = new Date('2026-07-28T00:01:00.000Z');
    const fresh = new Date('2026-07-28T00:02:00.000Z');
    await utimes(renderer, old, old);
    await utimes(main, middle, middle);
    await utimes(asar, fresh, fresh);
    await expect(validatePackageFreshness(asar, [dist, distElectron])).resolves.toMatchObject({
      newestBuildFile: 'main.js',
    });
    await utimes(asar, old, old);
    await expect(validatePackageFreshness(asar, [dist, distElectron])).rejects.toThrow(/stale/i);
  });
});
