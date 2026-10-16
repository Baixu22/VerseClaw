#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ROOT = 'packages/versebrowser';
const DEFAULT_LOCK = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';
const PATCH_HASH = '1532f36aa4fcd0dbdd6a0c0cb49fbb7e55b30b649d67eadde69d5eb70be33c13';

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function addIssue(issues, kind, detail) { issues.push({ kind, ...detail }); }

function lockIntegrity(lockText, name, version) {
  const lines = lockText.split(/\r?\n/);
  const keys = [`'${name}@${version}':`, `${name}@${version}:`];
  for (let index = 0; index < lines.length; index += 1) {
    if (!keys.includes(lines[index].trim())) continue;
    for (let cursor = index + 1; cursor < Math.min(index + 12, lines.length); cursor += 1) {
      const line = lines[cursor];
      if (cursor > index + 1 && /^  [^ ].*:$/.test(line)) break;
      const match = line.match(/resolution: \{integrity: ([^}]+)\}/);
      if (match) return match[1];
    }
  }
  return null;
}

async function inspectImport({ hostRoot, lock }) {
  const issues = [];
  const manifestPath = path.join(hostRoot, PACKAGE_ROOT, 'import-manifest.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { addIssue(issues, 'import_manifest_unreadable', { message: String(error.message) }); return { status: 'fail', issues }; }
  const product = new Set((lock.protectedInputs ?? []).filter((entry) => entry.role === 'product_source').map((entry) => entry.path));
  const manifestSha256 = hash(await readFile(manifestPath));
  // Declared integration patches intentionally rewrite a few imported files; the manifest keeps the
  // raw import hash and integration-patches.json owns the patched hash. Compare the patched target
  // against its declared hash rather than flagging it as an import mismatch.
  const patches = JSON.parse(await readFile(path.join(hostRoot, PACKAGE_ROOT, 'integration-patches.json'), 'utf8'));
  const patchedByTarget = new Map((patches.entries ?? []).map((entry) => [entry.targetPath, entry.patchedSha256]));
  const seen = new Set();
  for (const entry of manifest.files ?? []) {
    seen.add(entry.source);
    const target = path.join(hostRoot, entry.target);
    if (!existsSync(target)) { addIssue(issues, 'imported_file_missing', { target: entry.target }); continue; }
    const bytes = await readFile(target);
    const expected = patchedByTarget.get(entry.target) ?? entry.sha256;
    if (hash(bytes) !== expected) addIssue(issues, 'imported_file_hash_mismatch', { target: entry.target, expected, actual: hash(bytes) });
  }
  if (manifest.sourceCommit !== lock.source.commit) addIssue(issues, 'import_commit_mismatch', { expected: lock.source.commit, actual: manifest.sourceCommit });
  if (manifest.productSourceCount !== 127) addIssue(issues, 'import_product_count_mismatch', { expected: 127, actual: manifest.productSourceCount });
  for (const relative of product) if (!seen.has(relative)) addIssue(issues, 'import_product_missing', { path: relative });
  return { status: issues.length ? 'fail' : 'pass', manifestSha256, productSourceCount: manifest.productSourceCount, coveredProductSourceCount: seen.size, fileCount: manifest.fileCount, issues };
}

async function inspectPackageAndDependencies({ hostRoot, lock }) {
  const issues = [];
  const packageRoot = path.join(hostRoot, PACKAGE_ROOT);
  const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== '@verse-claw/versebrowser') addIssue(issues, 'package_name_mismatch', { actual: pkg.name });
  if (pkg.private !== true) addIssue(issues, 'package_not_private');
  const expectedDeps = Object.fromEntries(lock.dependencies.map((entry) => [entry.name, entry.locked]));
  const dependencyRows = [];
  for (const [name, version] of Object.entries(expectedDeps)) {
    if (pkg.dependencies?.[name] !== version) addIssue(issues, 'dependency_spec_mismatch', { name, expected: version, actual: pkg.dependencies?.[name] });
    const installedPath = path.join(packageRoot, 'node_modules', name, 'package.json');
    if (!existsSync(installedPath)) { addIssue(issues, 'dependency_not_installed', { name }); dependencyRows.push({ name, expected: version, installed: null, specMatches: pkg.dependencies?.[name] === version }); continue; }
    const installed = JSON.parse(await readFile(installedPath, 'utf8'));
    if (installed.version !== version) addIssue(issues, 'installed_version_mismatch', { name, expected: version, actual: installed.version });
    dependencyRows.push({ name, expected: version, installed: installed.version, specMatches: pkg.dependencies?.[name] === version });
  }
  if (pkg.peerDependencies?.electron !== '>=44') addIssue(issues, 'electron_peer_changed', { actual: pkg.peerDependencies?.electron });
  const lockText = await readFile(path.join(hostRoot, 'pnpm-lock.yaml'), 'utf8');
  for (const entry of lock.dependencies) {
    const actual = lockIntegrity(lockText, entry.name, entry.locked);
    const row = dependencyRows.find((candidate) => candidate.name === entry.name);
    if (row) { row.lockIntegrity = actual; row.expectedIntegrity = entry.integrity; row.integrityMatches = actual === entry.integrity; }
    if (actual !== entry.integrity) addIssue(issues, 'dependency_integrity_mismatch', { name: entry.name, expected: entry.integrity, actual });
  }
  const expectedExports = Object.keys(lock.publicExports ?? {}).length;
  const actualExports = Object.keys(pkg.exports ?? {}).length;
  if (actualExports !== expectedExports) addIssue(issues, 'export_count_mismatch', { expected: expectedExports, actual: actualExports });
  return { status: issues.length ? 'fail' : 'pass', dependencyCount: lock.dependencies.length, dependencies: dependencyRows, exportCount: actualExports, issues };
}

async function inspectPlaywrightAndPatch({ hostRoot }) {
  const issues = [];
  const lockText = await readFile(path.join(hostRoot, 'pnpm-lock.yaml'), 'utf8');
  const versions = ['playwright-core@1.63.0', 'playwright-core@1.64.0-alpha-1790635538000', 'playwright@1.64.0-alpha-1790635538000'];
  const families = versions.map((version) => ({ version, present: lockText.includes(version) }));
  for (const family of families) if (!family.present) addIssue(issues, 'playwright_family_missing', { version: family.version });
  const bundle = path.join(hostRoot, 'node_modules/.pnpm/playwright-core@1.64.0-alpha-1790635538000/node_modules/playwright-core/lib/coreBundle.js');
  if (!existsSync(bundle)) addIssue(issues, 'playwright_bundle_missing', { path: bundle });
  else {
    const actual = hash(await readFile(bundle));
    if (actual !== PATCH_HASH) addIssue(issues, 'upstream_patch_hash_mismatch', { expected: PATCH_HASH, actual });
  }
  let patchCheck;
  try {
    patchCheck = execFileSync(process.execPath, ['scripts/patch-upstream.mjs', '--check'], { cwd: path.join(hostRoot, PACKAGE_ROOT), encoding: 'utf8', windowsHide: true });
  } catch (error) {
    addIssue(issues, 'upstream_patch_check_failed', { message: String(error.stdout || error.message) });
  }
  return { status: issues.length ? 'fail' : 'pass', families, bundlePath: bundle, bundleSha256: existsSync(bundle) ? hash(await readFile(bundle)) : null, patchCheck: patchCheck ? 'pass' : 'fail', issues };
}

async function inspectBuildAndExports({ hostRoot }) {
  const issues = [];
  const packageRoot = path.join(hostRoot, PACKAGE_ROOT);
  const dist = path.join(packageRoot, 'dist');
  if (!existsSync(dist)) addIssue(issues, 'dist_missing');
  const distFiles = existsSync(dist) ? (await readdir(dist, { recursive: true })).filter((entry) => entry.endsWith('.js') || entry.endsWith('.d.ts')) : [];
  if (distFiles.length === 0) addIssue(issues, 'dist_empty');
  let exportOutput = '';
  try {
    exportOutput = execFileSync(process.execPath, ['-e', "Promise.all(['@verse-claw/versebrowser','@verse-claw/versebrowser/core','@verse-claw/versebrowser/engine/service','@verse-claw/versebrowser/openclaw/tool','@verse-claw/versebrowser/mcp/server'].map(async p=>{const m=await import(p); console.log(p+' '+Object.keys(m).length)})).catch(e=>{console.error(e);process.exit(1)})"], { cwd: packageRoot, encoding: 'utf8', windowsHide: true });
  } catch (error) { addIssue(issues, 'public_exports_import_failed', { message: String(error.stdout || error.message) }); }
  return { status: issues.length ? 'fail' : 'pass', distFiles: distFiles.length, exportOutput: exportOutput.trim().split(/\r?\n/).filter(Boolean), issues };
}

export async function verifyVersebrowserModule({ hostRoot = ROOT, lockPath = DEFAULT_LOCK }) {
  const lock = JSON.parse(await readFile(path.join(hostRoot, lockPath), 'utf8'));
  const [imports, dependencies, playwrightAndPatch, buildAndExports] = await Promise.all([
    inspectImport({ hostRoot, lock }), inspectPackageAndDependencies({ hostRoot, lock }), inspectPlaywrightAndPatch({ hostRoot }), inspectBuildAndExports({ hostRoot }),
  ]);
  const issues = [imports, dependencies, playwrightAndPatch, buildAndExports].flatMap((section) => section.issues ?? []);
  return { schemaVersion: 1, driven_by: 'agent', actor: 'codex', status: issues.length ? 'fail' : 'pass', imports, dependencies, playwrightAndPatch, buildAndExports, issues };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, lock: { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyVersebrowserModule({ hostRoot: values['host-root'], lockPath: values.lock });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(path.resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
