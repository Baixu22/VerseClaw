import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hashSource, inspectSourceTree, deriveAndCompareCandidate } from './verseshell-reintegration-check.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'verseshell-preservation-'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'tests'));
  const files = { 'Cargo.toml': '[package]\nname = "frozen"\n', 'src/core.rs': 'pub fn result() -> u8 { 42 }\n',
    'tests/core.rs': '#[test] fn keeps_behavior() { assert_eq!(42, 42); }\n' };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(root, name), bytes);
  const lock = { files: Object.entries(files).map(([name, bytes]) => ({ path: name, digest: hashSource(Buffer.from(bytes)) })),
    protected_roots: ['src', 'tests', '.cargo'], protected_root_files: ['Cargo.toml', 'build.rs', 'rust-toolchain.toml'] };
  return { root, lock };
}
const inspect = ({ root, lock }) => inspectSourceTree(root, lock, 'digest');

test('accepts the frozen implementation', async () => {
  assert.deepEqual(await inspect(await fixture()), []);
});
test('allows CRLF normalization without ignoring other bytes', async () => {
  const f = await fixture();
  const name = path.join(f.root, 'src/core.rs');
  await writeFile(name, (await readFile(name, 'utf8')).replaceAll('\n', '\r\n'));
  assert.deepEqual(await inspect(f), []);
  assert.notEqual(hashSource(Buffer.from([0xff])), hashSource(Buffer.from([0xfe])));
});
test('rejects a plausible rewritten implementation', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'src/core.rs'), 'pub fn result() -> u8 { 0 }\n');
  assert.ok((await inspect(f)).some(x => x.kind === 'hash-mismatch' && x.path === 'src/core.rs'));
});
test('rejects a missing upstream module', async () => {
  const f = await fixture(); await unlink(path.join(f.root, 'src/core.rs'));
  assert.ok((await inspect(f)).some(x => x.kind === 'missing'));
});
test('rejects a second implementation inserted beside the frozen source', async () => {
  const f = await fixture(); await writeFile(path.join(f.root, 'src/replacement.rs'), 'pub fn fake() {}');
  assert.ok((await inspect(f)).some(x => x.kind === 'undeclared-file'));
});
test('rejects weakening a frozen upstream regression', async () => {
  const f = await fixture(); await writeFile(path.join(f.root, 'tests/core.rs'), '#[test] fn always_passes() {}');
  assert.ok((await inspect(f)).some(x => x.kind === 'hash-mismatch' && x.path === 'tests/core.rs'));
});
test('rejects an undeclared automatic Cargo build script', async () => {
  const f = await fixture(); await writeFile(path.join(f.root, 'build.rs'), 'fn main() {}');
  assert.ok((await inspect(f)).some(x => x.kind === 'undeclared-file' && x.path === 'build.rs'));
});
test('rejects hidden Cargo configuration overrides', async () => {
  const f = await fixture(); await mkdir(path.join(f.root, '.cargo'));
  await writeFile(path.join(f.root, '.cargo/config.toml'), '[build]\nrustc-wrapper="replacement"');
  assert.ok((await inspect(f)).some(x => x.path === '.cargo/config.toml'));
});
test('rejects a lock path escaping the source root', async () => {
  const f = await fixture(); f.lock.files[0].path = '../outside';
  await assert.rejects(() => inspect(f), /Unsafe source-lock path/);
});
test('rejects duplicate lock paths instead of accepting the last value', async () => {
  const f = await fixture(); f.lock.files.push(f.lock.files[0]);
  await assert.rejects(() => inspect(f), /Duplicate source-lock path/);
});

async function gitFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'verseshell-derive-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q');
  git('config', 'user.email', 'derive-test@example.invalid');
  git('config', 'user.name', 'Derive Test');
  git('config', 'core.autocrlf', 'false');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/core.rs'), 'pub fn result() -> u8 { 42 }\n');
  git('add', '-A');
  git('commit', '-qm', 'frozen upstream');
  return { root, git };
}

test('derives the effective source from upstream plus registered residual patches', async (t) => {
  const { root, git } = await gitFixture(t);
  const control = await mkdtemp(path.join(tmpdir(), 'verseshell-derive-control-'));
  t.after(() => rm(control, { recursive: true, force: true }));
  await writeFile(path.join(control, 'residual.patch'),
    'diff --git a/src/core.rs b/src/core.rs\nindex 0000000..1111111 100644\n--- a/src/core.rs\n+++ b/src/core.rs\n@@ -1 +1 @@\n-pub fn result() -> u8 { 42 }\n+pub fn result() -> u8 { 43 }\n');
  const commit = git('rev-parse', 'HEAD');
  const upstreamHash = hashSource(Buffer.from('pub fn result() -> u8 { 42 }\n'));
  const effectiveHash = hashSource(Buffer.from('pub fn result() -> u8 { 43 }\n'));
  const lock = {
    upstream: { commit },
    protected_roots: ['src'], protected_root_files: [],
    patches: [{ id: 'residual', path: 'residual.patch', sha256_lf: hashSource(await readFile(path.join(control, 'residual.patch'))), changed_paths: ['src/core.rs'] }],
    files: [{ path: 'src/core.rs', upstream_sha256_lf: upstreamHash, effective_sha256_lf: effectiveHash, residual_patch: 'residual' }],
  };
  const candidate = await mkdtemp(path.join(tmpdir(), 'verseshell-derive-candidate-'));
  t.after(() => rm(candidate, { recursive: true, force: true }));
  await mkdir(path.join(candidate, 'src'));
  await writeFile(path.join(candidate, 'src/core.rs'), 'pub fn result() -> u8 { 43 }\n');
  assert.deepEqual(await deriveAndCompareCandidate(root, candidate, lock, control), []);

  await writeFile(path.join(candidate, 'src/core.rs'), 'pub fn result() -> u8 { 99 }\n');
  const issues = await deriveAndCompareCandidate(root, candidate, lock, control);
  assert.ok(issues.some((issue) => issue.kind === 'candidate-not-derived' && issue.path === 'src/core.rs'));
});

test('rejects a residual patch that no longer applies to the frozen upstream', async (t) => {
  const { root, git } = await gitFixture(t);
  const control = await mkdtemp(path.join(tmpdir(), 'verseshell-derive-bad-'));
  t.after(() => rm(control, { recursive: true, force: true }));
  await writeFile(path.join(control, 'residual.patch'),
    'diff --git a/src/core.rs b/src/core.rs\n--- a/src/core.rs\n+++ b/src/core.rs\n@@ -1 +1 @@\n-pub fn absent() -> u8 { 0 }\n+pub fn absent() -> u8 { 1 }\n');
  const commit = git('rev-parse', 'HEAD');
  const lock = {
    upstream: { commit }, protected_roots: ['src'], protected_root_files: [],
    patches: [{ id: 'residual', path: 'residual.patch', sha256_lf: hashSource(await readFile(path.join(control, 'residual.patch'))), changed_paths: ['src/core.rs'] }],
    files: [{ path: 'src/core.rs', upstream_sha256_lf: hashSource(Buffer.from('pub fn result() -> u8 { 42 }\n')), effective_sha256_lf: hashSource(Buffer.from('pub fn result() -> u8 { 43 }\n')), residual_patch: 'residual' }],
  };
  const issues = await deriveAndCompareCandidate(root, root, lock, control);
  assert.ok(issues.some((issue) => issue.kind === 'residual-patch-not-applicable'));
});
