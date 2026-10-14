import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hashSource, inspectSourceTree } from './verseshell-reintegration-check.mjs';

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
