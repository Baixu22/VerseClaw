#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCK = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';
const PACKAGE_ROOT = 'packages/versebrowser';
const SUPPORT_FILES = ['LICENSE', 'tsconfig.json', 'tsconfig.build.json', 'scripts/patch-upstream.mjs'];

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export async function importVersebrowser({ sourceRoot, hostRoot = ROOT, lockPath = DEFAULT_LOCK }) {
  const lock = JSON.parse(await readFile(path.resolve(hostRoot, lockPath), 'utf8'));
  const source = path.resolve(sourceRoot);
  const packageRoot = path.join(hostRoot, PACKAGE_ROOT);
  const manifest = { schemaVersion: 1, driven_by: 'agent', actor: 'codex', sourceCommit: lock.source.commit, packageRoot: PACKAGE_ROOT, files: [] };
  const productSource = (lock.protectedInputs ?? []).filter((entry) => entry.role === 'product_source');
  for (const entry of productSource) {
    if (!entry.path.startsWith('src/')) throw new Error(`Unexpected product source path: ${entry.path}`);
    const from = path.join(source, entry.path);
    const to = path.join(packageRoot, entry.path);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    const bytes = await readFile(to);
    if (hash(bytes) !== entry.sha256 || hash(Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')) !== entry.lfSha256) throw new Error(`Imported hash mismatch: ${entry.path}`);
    manifest.files.push({ source: entry.path, target: `${PACKAGE_ROOT}/${entry.path}`, sha256: entry.sha256, lfSha256: entry.lfSha256, bytes: bytes.byteLength });
  }
  for (const relative of SUPPORT_FILES) {
    const from = path.join(source, relative);
    const to = path.join(packageRoot, relative);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    const bytes = await readFile(to);
    manifest.files.push({ source: relative, target: `${PACKAGE_ROOT}/${relative}`, sha256: hash(bytes), bytes: bytes.byteLength });
  }
  manifest.productSourceCount = productSource.length;
  manifest.fileCount = manifest.files.length;
  await writeFile(path.join(packageRoot, 'import-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

export async function checkImport({ sourceRoot, hostRoot = ROOT, lockPath = DEFAULT_LOCK }) {
  const manifestPath = path.join(hostRoot, PACKAGE_ROOT, 'import-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const source = path.resolve(sourceRoot);
  const host = path.resolve(hostRoot);
  const issues = [];
  for (const entry of manifest.files) {
    const imported = await readFile(path.join(host, entry.target)).catch(() => null);
    const original = await readFile(path.join(source, entry.source)).catch(() => null);
    if (!imported) issues.push({ kind: 'missing', path: entry.target });
    else if (imported.byteLength !== entry.bytes || hash(imported) !== entry.sha256) issues.push({ kind: 'manifest-hash-mismatch', path: entry.target });
    if (original && hash(original) !== entry.sha256) issues.push({ kind: 'source-drift', path: entry.source });
  }
  return { status: issues.length ? 'fail' : 'pass', checked: manifest.files.length, issues };
}

async function main() {
  const { values } = parseArgs({ options: {
    'source-root': { type: 'string' }, 'host-root': { type: 'string' }, lock: { type: 'string' }, check: { type: 'boolean' }, json: { type: 'boolean' },
  }, allowPositionals: false });
  const sourceRoot = values['source-root'] ?? process.env.VERSEBROWSER_SOURCE_ROOT ?? 'D:/versebrowser';
  const result = values.check
    ? await checkImport({ sourceRoot, hostRoot: values['host-root'], lockPath: values.lock })
    : await importVersebrowser({ sourceRoot, hostRoot: values['host-root'], lockPath: values.lock });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
