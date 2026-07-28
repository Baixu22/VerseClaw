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
  it('accepts the synchronized clean bundle in development and packaging modes', () => {
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

  it('rejects an unpinned or dirty provenance record', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.provenance.dirty = true;
    manifest.provenance.build_input.status_porcelain = [' M src/ops/runtime_ops.rs'];
    manifest.provenance.build_input.dirty_entry_count = 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(validateVerseShellManifest({ root: fixture, mode: 'package' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/provenance\.dirty/u)]),
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
        "name: 'read_file',\n    canonical_op: 'file.view'",
        "name: 'read_file',\n    canonical_op: 'repo.search'",
      ),
    );
    expect(validateVerseShellManifest({ root: fixture, mode: 'dev' }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/facade order\/mapping mismatch/u)]),
    );
  });
});
