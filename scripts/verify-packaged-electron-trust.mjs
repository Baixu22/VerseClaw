#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFuseWire } from './validate-release-trust-metadata.mjs';

const require = createRequire(import.meta.url);
const electronFuses = require('@electron/fuses');
const { FuseV1Options, getCurrentFuseWire } = electronFuses;
const FUSE_ENABLED = 49;

export async function inspectPackagedElectronTrust(appDir, platform) {
  const root = resolve(appDir);
  const asarPaths = await findNamedFiles(root, 'app.asar');
  if (asarPaths.length === 0) throw new Error(`no app.asar found under ${root}`);
  const reports = [];
  for (const asarPath of asarPaths) {
    const executable = await findElectronExecutable(asarPath, platform);
    const fuseWire = await getCurrentFuseWire(executable);
    validateFuseWire(fuseWire, FUSE_ENABLED);
    const data = await readFile(asarPath);
    reports.push({
      platform,
      executable: relative(root, executable).replaceAll('\\', '/'),
      appAsar: relative(root, asarPath).replaceAll('\\', '/'),
      appAsarSize: data.length,
      appAsarSha256: createHash('sha256').update(data).digest('hex'),
      fuses: {
        enableEmbeddedAsarIntegrityValidation:
          fuseWire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === FUSE_ENABLED,
        onlyLoadAppFromAsar: fuseWire[FuseV1Options.OnlyLoadAppFromAsar] === FUSE_ENABLED,
      },
    });
  }
  return reports.sort((a, b) => a.appAsar.localeCompare(b.appAsar));
}

export async function verifyPackagedElectronTrustReport(appDir, report) {
  if (!report?.platform || !Array.isArray(report.packages) || report.packages.length === 0) {
    throw new Error('packaged Electron trust report is empty or malformed');
  }
  const actual = await inspectPackagedElectronTrust(appDir, report.platform);
  if (JSON.stringify(actual) !== JSON.stringify(report.packages)) {
    throw new Error('packaged Electron trust report does not match executable fuses or app.asar bytes');
  }
  return true;
}

async function findElectronExecutable(asarPath, platform) {
  const resourcesDir = dirname(asarPath);
  let candidates = [];
  if (platform === 'mac') {
    candidates = await filesIn(join(dirname(resourcesDir), 'MacOS'));
  } else {
    const appRoot = dirname(resourcesDir);
    candidates = await filesIn(appRoot);
    if (platform === 'win') candidates = candidates.filter((path) => /\.exe$/iu.test(path));
    else candidates = candidates.filter((path) => !/\.(?:dll|so|pak|bin|json|dat)$/iu.test(path));
  }
  for (const candidate of candidates) {
    try {
      const wire = await getCurrentFuseWire(candidate);
      if (String(wire.version) === '1') return candidate;
    } catch {
      // Continue until the Electron executable is found.
    }
  }
  throw new Error(`Electron executable not found for ${asarPath}`);
}

async function findNamedFiles(directory, fileName) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await findNamedFiles(fullPath, fileName)));
    else if (entry.isFile() && entry.name === fileName) results.push(fullPath);
  }
  return results;
}

async function filesIn(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(directory, entry.name);
      const fileStat = await stat(fullPath);
      if (fileStat.size > 0) files.push(fullPath);
    }
    return files.sort();
  } catch {
    return [];
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = readArg('--app-dir');
  const platform = readArg('--platform');
  const output = readArg('--output');
  const verifyReportPath = readArg('--verify-report');
  const task = verifyReportPath
    ? readFile(verifyReportPath, 'utf8').then((text) =>
        verifyPackagedElectronTrustReport(appDir, JSON.parse(text.replace(/^\uFEFF/u, ''))),
      )
    : inspectPackagedElectronTrust(appDir, platform).then(async (packages) => {
        const report = { schemaVersion: 1, platform, packages };
        if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
        return report;
      });
  task
    .then((result) => console.log(`[electron-trust] OK: ${JSON.stringify(result)}`))
    .catch((error) => {
      console.error(`[electron-trust] FAIL: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
