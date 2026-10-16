#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = 'build/main-runtime-delivery/main-runtime.asar';
const RELEASE_MAIN_RUNTIME = 'release/win-unpacked/resources/main-runtime.asar';
const RELEASE_APP_ASAR = 'release/win-unpacked/resources/app.asar';
const MODULE_IN_ARCHIVE = path.join('node_modules', '@verse-claw', 'versebrowser');
const DEV_PATH_NEEDLES = ['D:/versebrowser', 'D:\\versebrowser', '.local/runtime', '.local\\runtime', 'D:/tmp', 'D:\\tmp', 'D:/ClawX', 'D:\\ClawX', '.agent-workbench'];
const FORBIDDEN_TOP = ['.ae', 'src', 'tests', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts'];

function issue(kind, detail) { return { kind, ...detail }; }

function loadAsar(hostRoot) {
  const require = createRequire(path.join(hostRoot, 'package.json'));
  return createRequire(require.resolve('electron-builder'))('@electron/asar');
}

export async function verifyPackage({ hostRoot = ROOT, archive: archiveOverride } = {}) {
  const archive = archiveOverride ? path.resolve(hostRoot, archiveOverride) : path.join(hostRoot, ARCHIVE);
  const issues = [];
  if (!existsSync(archive)) {
    return { schemaVersion: 1, driven_by: 'agent', actor: 'codex', status: 'fail', issues: [issue('archive_missing', { archive: ARCHIVE })] };
  }
  const asar = loadAsar(hostRoot);
  const entries = asar.listPackage(archive);
  const moduleEntries = entries.filter((entry) => entry.replace(/\//g, '\\').includes(MODULE_IN_ARCHIVE.replace(/\//g, '\\')));

  const topLevel = new Map();
  for (const entry of moduleEntries) {
    const rel = entry.replace(/[\s\S]*?@verse-claw[\\/]versebrowser[\\/]?/, '').split(/[\\/]/)[0];
    topLevel.set(rel || '(root)', (topLevel.get(rel || '(root)') ?? 0) + 1);
  }
  for (const forbidden of FORBIDDEN_TOP) {
    if (topLevel.has(forbidden)) issues.push(issue('forbidden_package_content', { top: forbidden, entries: topLevel.get(forbidden) }));
  }
  if (!moduleEntries.some((entry) => /versebrowser[\\/]dist[\\/]index\.js$/.test(entry))) issues.push(issue('dist_index_missing', {}));
  if (!moduleEntries.some((entry) => /versebrowser[\\/]package\.json$/.test(entry))) issues.push(issue('package_json_missing', {}));
  if (!moduleEntries.some((entry) => /versebrowser[\\/]LICENSE$/.test(entry))) issues.push(issue('license_missing', {}));

  const distJs = moduleEntries.filter((entry) => /versebrowser[\\/]dist[\\/].*\.js$/.test(entry));
  const devPathHits = [];
  for (const entry of distJs) {
    let text;
    try { text = asar.extractFile(archive, entry.replace(/^[/\\]+/, '')).toString('utf8'); } catch { continue; }
    for (const needle of DEV_PATH_NEEDLES) if (text.includes(needle)) devPathHits.push({ entry, needle });
  }
  if (devPathHits.length) issues.push(issue('dev_path_leak', { hits: devPathHits.slice(0, 10) }));

  const load = { status: 'not_attempted' };
  const extractRoot = await mkdtemp(path.join(tmpdir(), 'vb-package-verify-'));
  try {
    asar.extractAll(archive, extractRoot, MODULE_IN_ARCHIVE);
    const entry = path.join(extractRoot, MODULE_IN_ARCHIVE, 'dist', 'index.js');
    const mod = await import(pathToFileURL(entry).href);
    load.exportsIndex = typeof mod.AgentBrowserFacade === 'function';
    load.status = load.exportsIndex ? 'pass' : 'fail';
    if (!load.exportsIndex) issues.push(issue('packaged_module_load_failed', {}));
  } catch (error) {
    load.status = 'fail';
    load.message = String(error?.message ?? error);
    issues.push(issue('packaged_module_load_failed', { message: load.message }));
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }

  return {
    schemaVersion: 1,
    artifact: 'versebrowser-m10-package-verify',
    driven_by: 'agent',
    actor: 'codex',
    status: issues.length === 0 ? 'pass' : 'fail',
    archive: archiveOverride ?? ARCHIVE,
    moduleEntryCount: moduleEntries.length,
    topLevel: Object.fromEntries([...topLevel.entries()].sort((a, b) => b[1] - a[1])),
    distJsScanned: distJs.length,
    devPathHits: devPathHits.length,
    packagedModuleLoad: load,
    issues,
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, 'archive': { type: 'string' }, 'release': { type: 'boolean' }, output: { type: 'string' } }, allowPositionals: false });
  const report = values.release
    ? await verifyReleasePackages({ hostRoot: values['host-root'] })
    : await verifyPackage({ hostRoot: values['host-root'], archive: values.archive });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await (await import('node:fs/promises')).writeFile(path.resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

export async function verifyReleasePackages({ hostRoot = ROOT } = {}) {
  const targets = [RELEASE_MAIN_RUNTIME, RELEASE_APP_ASAR].filter((rel) => existsSync(path.join(hostRoot, rel)));
  const reports = [];
  for (const target of targets) reports.push(await verifyPackage({ hostRoot, archive: target }));
  const issues = reports.flatMap((report) => (report.issues ?? []).map((entry) => ({ ...entry, archive: report.archive })));
  return { schemaVersion: 1, artifact: 'versebrowser-m10-release-package-verify', driven_by: 'agent', actor: 'codex', status: issues.length === 0 && reports.length > 0 ? 'pass' : 'fail', reports, issues };
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });