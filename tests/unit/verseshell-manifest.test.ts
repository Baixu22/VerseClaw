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
    'resources/verseshell/source-inputs.json',
    'resources/verseshell/LICENSE-AGPL-3.0-or-later.txt',
    'resources/verseshell/NOTICE.md',
    'resources/verseshell/SOURCE.md',
    'resources/verseshell/BUILD.md',
    'resources/verseshell/patches/p0-runtime-startup.patch',
    'resources/verseshell/patches/python-current-interpreter.patch',
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

describe('VerseShell v2 manifest validation', () => {
  it('accepts the qualified ordered patch-stack bundle in development and packaging modes', async () => {
    const manifestText = await readFile(join(root, 'resources/verseshell/manifest.json'), 'utf8');
    const sourceInputs = JSON.parse(
      await readFile(join(root, 'resources/verseshell/source-inputs.json'), 'utf8'),
    );
    const expectedCombinedSha = sourceInputs.identity?.combined_sha256;
    expect(typeof expectedCombinedSha).toBe('string');
    expect(expectedCombinedSha).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifestText).not.toMatch(/[A-Za-z]:\\Users\\/u);
    expect(manifestText).toContain('"schema_version": 2');
    expect(manifestText).toContain('pinned-commit-plus-ordered-patches');
    expect(manifestText).toContain(expectedCombinedSha);
    await expect(validateVerseShellManifest({ root, mode: 'dev' })).resolves.toEqual({
      ok: true,
      mode: 'dev',
      platform: 'win32-x64',
      issues: [],
    });
    await expect(validateVerseShellManifest({ root, mode: 'package', platform: 'win32-x64' })).resolves.toEqual({
      ok: true,
      mode: 'package',
      platform: 'win32-x64',
      issues: [],
    });
  });

  it('rejects a tampered corresponding-source patch', async () => {
    const fixture = await fixtureRoot();
    const patchPath = join(fixture, 'resources/verseshell/patches/p0-runtime-startup.patch');
    await writeFile(patchPath, `${await readFile(patchPath, 'utf8')}\n# tampered\n`);
    const result = await validateVerseShellManifest({ root: fixture, mode: 'package' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Patch .* (?:byte size|checksum) mismatch/u)]));
  });

  it('rejects source-input manifest digest drift', async () => {
    const fixture = await fixtureRoot();
    const manifestPath = join(fixture, 'resources/verseshell/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.build.source_inputs_sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await validateVerseShellManifest({ root: fixture, mode: 'package' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/build\/source\/toolchain identity/u)]));
  });

  it('rejects a silently reintroduced recovered-source inventory at the pinned upstream', async () => {
    const fixture = await fixtureRoot();
    const sourceInputsPath = join(fixture, 'resources/verseshell/source-inputs.json');
    const sourceInputs = JSON.parse(await readFile(sourceInputsPath, 'utf8'));
    // The pinned upstream tracks every referenced python input, so the allowlist must stay empty;
    // adding an entry (even a real upstream path) without re-freezing the identity is rejected.
    sourceInputs.recovered_inputs.files.push({
      path: 'bench/aci/fixtures/undeclared.py', bytes: 1, sha256: '0'.repeat(64),
    });
    await writeFile(sourceInputsPath, `${JSON.stringify(sourceInputs, null, 2)}\n`);
    const result = await validateVerseShellManifest({ root: fixture, mode: 'package' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Source-input payload SHA-256 mismatch/u)]));
  });

  it('verifies the existing artifact size and SHA-256 values', async () => {
    const fixture = await fixtureRoot();
    await writeFile(join(fixture, 'resources/bin/win32-x64/ae.exe'), 'tampered');
    const result = await validateVerseShellManifest({ root: fixture, mode: 'dev' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/binary (?:size|checksum) mismatch/u)]));
  });

  it('rejects missing source-input provenance payload', async () => {
    const fixture = await fixtureRoot();
    await rm(join(fixture, 'resources/verseshell/source-inputs.json'));
    const result = await validateVerseShellManifest({ root: fixture, mode: 'dev' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/source inputs.*missing|ENOENT/u)]));
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
    const result = await validateVerseShellManifest({ root: fixture, mode: 'dev' });
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/facade order\/mapping mismatch/u)]));
  });
});
