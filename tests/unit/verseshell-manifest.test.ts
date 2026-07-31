import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateVerseShellManifest } from '../../scripts/validate-verseshell-manifest.mjs';

const root = resolve(__dirname, '../..');
const temporaryDirectories: string[] = [];

async function fixtureRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'clawx-verseshell-manifest-'));
  temporaryDirectories.push(directory);
  for (const relative of [
    'resources/verseshell/manifest.json',
    'resources/verseshell/LICENSE-AGPL-3.0-or-later.txt',
    'resources/verseshell/NOTICE.md',
    'resources/verseshell/SOURCE.md',
    'resources/verseshell/BUILD.md',
    'resources/verseshell/patches/uas-05-process-lifecycle.patch',
    'resources/bin/win32-x64/ae.exe',
    'shared/verseshell/facade.ts',
  ]) {
    const destination = join(directory, relative);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, relative), destination);
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('VerseShell manifest validation', () => {
  it('accepts the synchronized dirty corresponding-source bundle in development and packaging modes', async () => {
    const manifestText = await readFile(join(root, 'resources/verseshell/manifest.json'), 'utf8');
    expect(manifestText).not.toMatch(/[A-Za-z]:\\Users\\/u);
    expect(manifestText).toContain('[build-source]');
    expect(manifestText).toContain('dirty_corresponding_source_recorded');
    expect(manifestText).toContain('resources/verseshell/patches/uas-05-process-lifecycle.patch');
    expect(validateVerseShellManifest({ root, mode: 'dev' })).toEqual({
      ok: true,
      mode: 'dev',
      platform: 'win32-x64',
      issues: [],
    });
    expect(validateVerseShellManifest({ root, mode: 'package', platform: 'win32-x64' })).toEqual({
      ok: true,
      mode: 'package',
      platform: 'win32-x64',
      issues: [],
    });
  });

  it('rejects a tampered corresponding-source patch', async () => {
    const fixture = await fixtureRoot();
    const patchPath = join(fixture, 'resources/verseshell/patches/uas-05-process-lifecycle.patch');
    await writeFile(patchPath, `${await readFile(patchPath, 'utf8')}\n# tampered\n`);
    expect(validateVerseShellManifest({ root: fixture, mode: 'package' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/patch checksum/u)]),
    );
  });

  it('rejects a corresponding-source hash mismatch', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.provenance.build_input.diff_sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(validateVerseShellManifest({ root: fixture, mode: 'package' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/patch checksum/u)]),
    );
  });

  it('rejects an unapproved dirty bundle', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.provenance.dirty_build_override.approved = false;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(validateVerseShellManifest({ root: fixture, mode: 'package' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/dirty provenance override/u)]),
    );
  });

  it('verifies existing artifact sizes and SHA-256 values', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = Buffer.from('fixture-verseshell-binary');
    const artifactPath = 'resources/verseshell/bin/ae-fixture';
    await mkdir(dirname(join(fixture, artifactPath)), { recursive: true });
    await writeFile(join(fixture, artifactPath), bytes);
    manifest.artifacts['win32-x64'] = {
      path: artifactPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(validateVerseShellManifest({ root: fixture, mode: 'dev' })).toEqual({
      ok: true,
      mode: 'dev',
      platform: 'win32-x64',
      issues: [],
    });

    await writeFile(join(fixture, artifactPath), 'tampered');
    expect(validateVerseShellManifest({ root: fixture, mode: 'dev' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/win32-x64.*(?:bytes|sha256)/u)]),
    );
  });

  it('requires only the selected packaging platform artifact', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = Buffer.from('fixture-linux-binary');
    const artifactPath = 'resources/verseshell/bin/ae-linux';
    await mkdir(dirname(join(fixture, artifactPath)), { recursive: true });
    await writeFile(join(fixture, artifactPath), bytes);
    manifest.artifacts['linux-x64'] = {
      path: artifactPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(
      validateVerseShellManifest({ root: fixture, mode: 'package', platform: 'linux-x64' }),
    ).toEqual({ ok: true, mode: 'package', platform: 'linux-x64', issues: [] });
  });

  it('rejects manifest drift and missing license/source files', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.license = 'MIT';
    manifest.protocol.observation_schema = 'other/v1';
    manifest.protocol.operation_catalog_digest = `sha256:${'0'.repeat(64)}`;
    manifest.protocol.operation_catalog_count = 27;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(join(fixture, 'resources/verseshell/NOTICE.md'));
    const result = validateVerseShellManifest({ root: fixture, mode: 'dev' });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/license/u),
        expect.stringMatching(/observation_schema/u),
        expect.stringMatching(/operation_catalog_digest/u),
        expect.stringMatching(/operation_catalog_count/u),
        expect.stringMatching(/NOTICE\.md/u),
      ]),
    );
  });

  it('rejects facade operation order drift', async () => {
    const fixture = await fixtureRoot();
    const facadePath = join(fixture, 'shared/verseshell/facade.ts');
    const source = await readFile(facadePath, 'utf8');
    await writeFile(
      facadePath,
      source.replace(
        /name: 'read_file',\r?\n {4}canonical_op: 'file\.view'/u,
        "name: 'read_file',\n    canonical_op: 'repo.search'",
      ),
    );
    expect(validateVerseShellManifest({ root: fixture, mode: 'dev' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/facade order\/mapping mismatch/u)]),
    );
  });
});
