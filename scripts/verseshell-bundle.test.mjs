import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  VerseShellBundleError,
  atomicCopy,
  collectSourceDiff,
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
  const locator = 'source-snapshot://verseshell-test';
  const manifest = {
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
      server_version: '1.0.0',
    },
    build: {
      command: 'cargo build --release --bin ae',
      cargo_version: 'cargo 1.75.0',
      rustc_version: 'rustc 1.75.0',
      cargo_target: 'x86_64-pc-windows-msvc',
    },
    provenance: {
      repository: 'https://github.com/Baixu22/VerseShell.git',
      commit: '15c027d72807d231a98b795ea2d1112654710add',
      dirty: false,
      build_input: { status_porcelain: [], diff_sha256: '0'.repeat(64) },
      corresponding_source: { locator, patch_instructions: null },
      dirty_build_override: { approved: false },
    },
    compliance: {
      license_file: 'LICENSE-AGPL-3.0-or-later.txt',
      notice_file: 'NOTICE.md',
      source_file: 'SOURCE.md',
      build_file: 'BUILD.md',
      corresponding_source_locator: locator,
    },
    artifacts: {
      'win32-x64': {
        path: 'resources/bin/win32-x64/ae.exe',
        packaged_path: 'bin/ae.exe',
        sha256: digest,
        bytes: binary.length,
        version: '1.0.0',
      },
    },
  };
  await writeFile(join(compliance, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return { root, compliance, manifest };
}

test('packaged validator accepts the unified Task14 schema', async (t) => {
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

test('package validator rejects dirty source without patch provenance', async (t) => {
  const bundle = await makeBundle();
  t.after(() => rm(bundle.root, { recursive: true, force: true }));
  bundle.manifest.provenance.dirty = true;
  bundle.manifest.provenance.dirty_build_override.approved = true;
  bundle.manifest.provenance.corresponding_source.patch_instructions = null;
  await writeFile(join(bundle.compliance, 'manifest.json'), JSON.stringify(bundle.manifest));
  await assert.rejects(
    validatePackagedBundle({ resourcesPath: bundle.root }),
    (error) => error instanceof VerseShellBundleError && /patch\/source-snapshot instructions/.test(error.message),
  );
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
