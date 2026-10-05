#!/usr/bin/env node
// Import a complete, locally built module. Does not access npm or the upstream source tree.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(repo, 'openclaw_runtime/extensions/verseconf-artifacts');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--from', '--manifest-sha256', '--backup-dir'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Usage: sync-verseconf.mjs --from module-dir --manifest-sha256 sha256 --backup-dir directory');
  options[args[i]] = args[i + 1];
}
if (Object.keys(options).length !== 3) throw new Error('All three arguments are required; no registry/source fallback');
const source = realpathSync(options['--from']);
const destination = path.join(plugin, 'vendor/verseconf');
const backupRoot = path.resolve(options['--backup-dir']);
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
if (!inside(path.join(repo, 'openclaw_runtime/extensions'), destination)) throw new Error('Destination escapes extension root');
if (backupRoot === plugin || inside(plugin, backupRoot)) throw new Error('Backups must stay outside the packaged plugin');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const raw = readFileSync(path.join(source, 'delivery-manifest.json'));
if (hash(raw) !== options['--manifest-sha256']) throw new Error('Delivery manifest does not match the supplied trusted digest');
const manifest = JSON.parse(raw);
if (manifest.manifest !== 'verseconf-js-delivery/v1' || !manifest.deliveryTargets?.includes('nodejs') || !manifest.preservesMcp) throw new Error('Unsupported or incomplete module delivery');
const safeRelative = (p) => typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.includes(':') && !p.startsWith('/') && p.split('/').every((part) => part && part !== '.' && part !== '..');
const names = new Set(['delivery-manifest.json']);
for (const file of manifest.files) {
  if (!safeRelative(file.path) || names.has(file.path)) throw new Error(`Invalid/duplicate delivery path: ${file.path}`);
  names.add(file.path);
  const absolute = path.join(source, file.path);
  if (!inside(source, realpathSync(absolute)) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) throw new Error(`Linked/invalid delivery file: ${file.path}`);
  const bytes = readFileSync(absolute);
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`Changed delivery file: ${file.path}`);
}
function list(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Linked delivery entry: ${prefix}${entry.name}`);
    return entry.isDirectory() ? list(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`];
  });
}
const actual = list(source);
if (actual.length !== names.size || actual.some((p) => !names.has(p))) throw new Error('Delivery contains unlisted files');
const metadata = JSON.parse(readFileSync(path.join(source, 'package.json')));
if (metadata.version !== manifest.package.version || !metadata.exports?.['./web'] || !metadata.bin?.['verseconf-mcp-wasm']) throw new Error('Delivery metadata drops existing features');
const lock = {
  deliveryId: manifest.deliveryId, packageVersion: metadata.version,
  manifestSha256: options['--manifest-sha256'],
  wasmSha256: manifest.files.find((f) => f.path === 'pkg/verseconf_wasm_bg.wasm')?.sha256,
};
if (!/^[a-f0-9]{64}$/.test(lock.wasmSha256 ?? '')) throw new Error('Missing WASM identity');
const packageFile = path.join(plugin, 'package.json');
const originalPackage = readFileSync(packageFile);
const updated = JSON.parse(originalPackage);
updated.openclaw.build.staticAssets = [
  ...updated.openclaw.build.staticAssets.filter((a) => !a.source.startsWith('vendor/verseconf/') && a.source !== 'verseconf-delivery-lock.json'),
  ...[...names].sort().map((p) => ({ source: `vendor/verseconf/${p}`, output: `vendor/verseconf/${p}` })),
  { source: 'verseconf-delivery-lock.json', output: 'verseconf-delivery-lock.json' },
];
const backup = path.join(backupRoot, `${Date.now()}-${manifest.deliveryId.slice(0, 12)}`);
const staging = path.join(backup, 'incoming');
mkdirSync(staging, { recursive: true });
for (const p of names) {
  const target = path.join(staging, p);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(source, p), target);
}
// Recheck staged bytes before replacing anything, so concurrent source edits cannot slip through.
for (const file of manifest.files) if (hash(readFileSync(path.join(staging, file.path))) !== file.sha256) throw new Error(`Source changed while copying: ${file.path}`);
if (hash(readFileSync(path.join(staging, 'delivery-manifest.json'))) !== lock.manifestSha256) throw new Error('Manifest changed while copying');
if (!readFileSync(packageFile).equals(originalPackage)) throw new Error('Plugin metadata changed during sync');
writeFileSync(path.join(backup, 'package.json'), originalPackage);
const lockFile = path.join(plugin, 'verseconf-delivery-lock.json');
if (existsSync(lockFile)) copyFileSync(lockFile, path.join(backup, 'verseconf-delivery-lock.json'));
let movedOld = false;
let installedNew = false;
try {
  if (existsSync(destination)) { renameSync(destination, path.join(backup, 'previous')); movedOld = true; }
  renameSync(staging, destination);
  installedNew = true;
  writeFileSync(packageFile, `${JSON.stringify(updated, null, 2)}\n`);
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
} catch (error) {
  if (installedNew && existsSync(destination)) renameSync(destination, path.join(backup, 'failed-new'));
  if (movedOld) renameSync(path.join(backup, 'previous'), destination);
  writeFileSync(packageFile, originalPackage);
  if (existsSync(path.join(backup, 'verseconf-delivery-lock.json'))) copyFileSync(path.join(backup, 'verseconf-delivery-lock.json'), lockFile);
  else if (installedNew) rmSync(lockFile, { force: true });
  throw error;
}
console.log(JSON.stringify({ ...lock, files: names.size, destination, backup }, null, 2));
