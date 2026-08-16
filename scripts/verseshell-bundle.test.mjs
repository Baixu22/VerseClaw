import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  VerseShellBundleError,
  atomicCopy,
  calculateSourceIdentity,
  collectSourceDiff,
  PROJECT_ROOT,
  validatePackagedBundle,
} from './verseshell-bundle.mjs';

async function makeBundle() {
  const root = await mkdtemp(join(tmpdir(), 'verseshell-bundle-test-'));
  const compliance = join(root, 'resources', 'verseshell');
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(compliance, { recursive: true });
  const binary = Buffer.from('ae test artifact');
  const crypto = await import('node:crypto');
  const digest = crypto.createHash('sha256').update(binary).digest('hex');
  await writeFile(join(root, 'bin', 'ae.exe'), binary);
  await writeFile(join(compliance, 'LICENSE-AGPL-3.0-or-later.txt'), 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n');
  await writeFile(join(compliance, 'NOTICE.md'), '# Notice\n');
  await writeFile(join(compliance, 'SOURCE.md'), '# Source\n');
  await writeFile(join(compliance, 'BUILD.md'), '# Build\n');
  const sourceInputsPath = join(PROJECT_ROOT, 'resources', 'verseshell', 'source-inputs.json');
  await cp(sourceInputsPath, join(compliance, 'source-inputs.json'));
  const sourceInputs = JSON.parse(await readFile(sourceInputsPath, 'utf8'));
  for (const patch of sourceInputs.patches) {
    const destination = join(compliance, patch.path.replace('resources/verseshell/', ''));
    await mkdir(join(destination, '..'), { recursive: true });
    await cp(join(PROJECT_ROOT, patch.path), destination);
  }
  const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, 'resources', 'verseshell', 'manifest.json'), 'utf8'));
  manifest.build.reproducibility.binary_sha256 = digest;
  manifest.build.reproducibility.bytes = binary.length;
  manifest.build.reproducibility.builds = manifest.build.reproducibility.builds.map((build) => ({
    ...build,
    sha256: digest,
    bytes: binary.length,
  }));
  manifest.artifacts['win32-x64'].sha256 = digest;
  manifest.artifacts['win32-x64'].bytes = binary.length;
  await writeFile(join(compliance, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return { root, compliance, manifest };
}

async function rewriteSourceInputs(bundle, mutate) {
  const path = join(bundle.compliance, 'source-inputs.json');
  const sourceInputs = JSON.parse(await readFile(path, 'utf8'));
  mutate(sourceInputs);
  const calculated = calculateSourceIdentity(sourceInputs);
  sourceInputs.identity = {
    algorithm: sourceInputs.identity.algorithm,
    payload_sha256: calculated.payloadSha256,
    combined_algorithm: sourceInputs.identity.combined_algorithm,
    combined_sha256: calculated.combinedSha256,
  };
  await writeFile(path, `${JSON.stringify(sourceInputs, null, 2)}\n`, 'utf8');
}

async function rewriteManifest(bundle, mutate) {
  const path = join(bundle.compliance, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  mutate(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

test('packaged validator accepts the v2 ordered patch-stack schema', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  const result = await validatePackagedBundle({ resourcesPath: bundle.root });
  assert.equal(result.artifact.sha256, bundle.manifest.artifacts['win32-x64'].sha256);
});

test('source diff includes tracked edits and complete untracked source files', async (t) => {
  const source = await mkdtemp(join(tmpdir(), 'verseshell-source-diff-test-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: source });
  execFileSync('git', ['config', 'user.email', 'verseshell-test@example.invalid'], { cwd: source });
  execFileSync('git', ['config', 'user.name', 'VerseShell Bundle Test'], { cwd: source });
  await writeFile(join(source, 'tracked.rs'), 'fn tracked() {}\n');
  execFileSync('git', ['add', 'tracked.rs'], { cwd: source });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: source });
  await writeFile(join(source, 'tracked.rs'), 'fn tracked_changed() {}\n');
  await writeFile(join(source, 'untracked.rs'), 'fn untracked_complete() {}\n');

  const diff = collectSourceDiff(source);
  assert.match(diff, /tracked_changed/u);
  assert.match(diff, /new file mode 100644/u);
  assert.match(diff, /untracked_complete/u);
  assert.match(diff, /\+\+\+ b\/untracked\.rs/u);
});

test('verify-package CLI forwards --resources to the packaged validator', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  const output = execFileSync(
    process.execPath,
    ['scripts/verseshell-bundle.mjs', 'verify-package', '--resources', bundle.root, '--platform', 'win32', '--arch', 'x64'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.match(output, /"action": "verified-package"/);
});

test('packaged validator accepts canonical indented FSF AGPL title lines', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await writeFile(
    join(bundle.compliance, 'LICENSE-AGPL-3.0-or-later.txt'),
    '                    GNU AFFERO GENERAL PUBLIC LICENSE\r\n                       Version 3, 19 November 2007\r\n',
  );
  const result = await validatePackagedBundle({ resourcesPath: bundle.root });
  assert.equal(result.artifact.sha256, bundle.manifest.artifacts['win32-x64'].sha256);
});

test('package validator rejects non-whitespace license preambles', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await writeFile(
    join(bundle.compliance, 'LICENSE-AGPL-3.0-or-later.txt'),
    'custom license header\nGNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n',
  );
  await assert.rejects(
    validatePackagedBundle({ resourcesPath: bundle.root }),
    (error) => error instanceof VerseShellBundleError && /official GNU AGPL v3 text/.test(error.message),
  );
});

test('package validator rejects patch reorder after identity recalculation', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteSourceInputs(bundle, (sourceInputs) => sourceInputs.patches.reverse());
  await assert.rejects(
    validatePackagedBundle({ resourcesPath: bundle.root }),
    (error) => error instanceof VerseShellBundleError && /patch order\/role\/path drifted/.test(error.message),
  );
});

test('package validator rejects patch byte-size drift', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteSourceInputs(bundle, (sourceInputs) => { sourceInputs.patches[0].bytes += 1; });
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /byte size mismatch/);
});

test('package validator rejects source-input digest drift in the package manifest', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteManifest(bundle, (manifest) => { manifest.build.source_inputs_sha256 = '0'.repeat(64); });
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /build\/source\/toolchain identity drifted/);
});

test('package validator rejects an undeclared ignored source input', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteSourceInputs(bundle, (sourceInputs) => {
    sourceInputs.recovered_inputs.files.push({
      path: 'bench/aci/fixtures/undeclared.py',
      bytes: 1,
      sha256: '0'.repeat(64),
    });
  });
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /Recovered input allowlist mismatch/);
});

test('package validator rejects a non-identical reproducibility proof', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteManifest(bundle, (manifest) => {
    manifest.build.reproducibility.builds[1].sha256 = '0'.repeat(64);
  });
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /reproducibility build 2 identity drifted/);
});

test('package validator rejects a missing required final source assertion', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rewriteSourceInputs(bundle, (sourceInputs) => {
    sourceInputs.final_assertions = sourceInputs.final_assertions.filter((entry) => entry.path !== 'src/cache.rs');
  });
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /Final source assertions omit src\/cache\.rs/);
});

test('atomicCopy preserves destination and removes temp file when rename fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'verseshell-atomic-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.exe');
  const destination = join(root, 'destination.exe');
  await writeFile(source, 'new bytes');
  await writeFile(destination, 'old verified bytes');
  await assert.rejects(
    atomicCopy(source, destination, {
      rename: async () => { throw new Error('simulated atomic rename failure'); },
    }),
    /simulated atomic rename failure/,
  );
  assert.equal(await readFile(destination, 'utf8'), 'old verified bytes');
  const entries = await (await import('node:fs/promises')).readdir(root);
  assert.deepEqual(entries.sort(), ['destination.exe', 'source.exe']);
});

test('packaged validator rejects missing compliance source file', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  await rm(join(bundle.compliance, 'SOURCE.md'));
  await assert.rejects(validatePackagedBundle({ resourcesPath: bundle.root }), /compliance source_file is missing/);
});
