#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectReleaseChannel,
  getWindowsSigningPolicy,
  verifyUpdateYmlHashes,
} from '../shared/release-policy/windows-signing-policy.mjs';
import { validateReleaseBaseline } from './validate-release-baseline.mjs';
import { inspectPackagedElectronTrust } from './verify-packaged-electron-trust.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN_COMMAND_NAMES = new Set(['git', 'git.exe', 'gh', 'gh.exe']);
const SENSITIVE_PATTERNS = [
  ['github-classic-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu],
  ['authorization-header', /\bauthorization\s*:\s*(?:bearer|token)\s+[^\s"']{12,}/giu],
  ['github-cli-oauth-token', /\boauth_token\s*:\s*[^\s"']{12,}/giu],
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/gu],
  ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/gu],
  ['credential-bearing-url', /https?:\/\/[^\s/:]+:[^\s/@]+@[^\s/]+/giu],
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

async function sha512Base64(path) {
  return createHash('sha512').update(await readFile(path)).digest('base64');
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''));
}

async function walkFiles(directory) {
  const base = resolve(directory);
  const files = [];
  async function walk(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile()) {
        const fileStat = await stat(absolutePath);
        files.push({
          absolutePath,
          relativePath: relative(base, absolutePath).replaceAll('\\', '/'),
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      }
    }
  }
  await walk(base);
  return files;
}

function flattenRequiredSources(requirements) {
  if (
    requirements?.schema !== 'verse-claw-first-product-release-sources/1' ||
    !requirements.categories ||
    typeof requirements.categories !== 'object'
  ) {
    throw new Error('first-product required source inventory is malformed');
  }
  const entries = [];
  for (const [category, paths] of Object.entries(requirements.categories)) {
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path)) {
      throw new Error(`first-product required source category is malformed: ${category}`);
    }
    for (const path of paths) entries.push({ category, path: path.replaceAll('\\', '/') });
  }
  const duplicates = entries
    .map((entry) => entry.path)
    .filter((path, index, paths) => paths.indexOf(path) !== index);
  if (duplicates.length > 0) {
    throw new Error(`first-product required source inventory contains duplicates: ${duplicates.join(', ')}`);
  }
  return entries;
}

export function validateRequiredSourceCoverage(manifest, requirements) {
  if (!Array.isArray(manifest?.files)) throw new Error('release source manifest is malformed');
  const required = flattenRequiredSources(requirements);
  const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
  const missing = required.filter((entry) => !manifestPaths.has(entry.path));
  if (missing.length > 0) {
    throw new Error(
      `release source manifest is missing required first-product sources: ${missing
        .map((entry) => entry.path)
        .join(', ')}`,
    );
  }
  return {
    requiredSourceCount: required.length,
    categories: Object.fromEntries(
      Object.entries(requirements.categories).map(([category, paths]) => [category, paths.length]),
    ),
    paths: required.map((entry) => entry.path),
  };
}

export function validateSourceLicenseEvidence(document) {
  const snapshot = document?.source?.snapshotInventory;
  const resolution = document?.upstreamResolution;
  const license = document?.source?.license;
  const verification = resolution?.resolvedParentVerification;
  const disposition = document?.adoptionPolicy?.attributionAndModificationNotice;
  const failures = [];
  if (document?.schema !== 'verse-claw-remote-forge-source-manifest/1') {
    failures.push('source manifest schema');
  }
  if (resolution?.status !== 'exact_parent_commit_resolved') failures.push('resolved parent status');
  if (!/^[a-f0-9]{40}$/u.test(resolution?.resolvedParentCommit || '')) {
    failures.push('resolved parent commit');
  }
  if (!/^[a-f0-9]{40}$/u.test(resolution?.resolvedParentTree || '')) {
    failures.push('resolved parent tree');
  }
  if (!/^[a-f0-9]{64}$/u.test(snapshot?.rootHash || '')) failures.push('snapshot root hash');
  if (
    verification?.commit !== resolution?.resolvedParentCommit ||
    verification?.fileCount !== snapshot?.fileCount ||
    verification?.byteSize !== snapshot?.byteSize ||
    verification?.rootHash !== snapshot?.rootHash ||
    verification?.matchesLocalSnapshot !== true
  ) {
    failures.push('resolved parent archive verification');
  }
  if (verification?.noticeFilePresent !== false || license?.noticeFilePresent !== false) {
    failures.push('NOTICE state');
  }
  if (license?.spdx !== 'Apache-2.0' || !/^[a-f0-9]{64}$/u.test(license?.licenseFileSha256 || '')) {
    failures.push('Apache-2.0 evidence');
  }
  if (document?.adoptionPolicy?.directSourceCopyAllowed !== false) {
    failures.push('direct source copy boundary');
  }
  if (
    disposition?.upstreamCommit !== resolution?.resolvedParentCommit ||
    disposition?.snapshotRootSha256 !== snapshot?.rootHash ||
    disposition?.implementation !== 'clean-room TypeScript; no upstream implementation text copied'
  ) {
    failures.push('attribution and modification disposition');
  }
  if (failures.length > 0) {
    throw new Error(`MergeBeacon source/license evidence is incomplete: ${failures.join(', ')}`);
  }
  return {
    upstream: document.source.upstreamUrl,
    commit: resolution.resolvedParentCommit,
    tree: resolution.resolvedParentTree,
    snapshotRootSha256: snapshot.rootHash,
    fileCount: snapshot.fileCount,
    byteSize: snapshot.byteSize,
    license: license.spdx,
    noticeFilePresent: false,
    directSourceCopyAllowed: false,
    implementation: disposition.implementation,
  };
}

export function createFirstProductReleaseInfo({ version, releaseDate, baseUrl }) {
  const policy = getWindowsSigningPolicy(version);
  if (policy.allowPublicPublish || !['alpha', 'beta'].includes(policy.channel)) {
    throw new Error(`fixture-grade release-info requires a non-public alpha/beta version: ${version}`);
  }
  const normalizedBase = String(baseUrl || `https://oss.intelli-spectrum.com/${policy.ossChannelDir}`)
    .replace(/\/+$/u, '');
  return {
    version,
    channel: policy.channel,
    releaseDate: releaseDate || new Date().toISOString(),
    downloads: {
      win: {
        x64: `${normalizedBase}/Verse Claw-${version}-win-x64.exe`,
      },
    },
    changelog: `https://github.com/IntelliSpectrum/ClawX/releases/tag/v${version}`,
  };
}

export function validateReleaseInfoDocument(document, { version, installerName }) {
  const policy = getWindowsSigningPolicy(version);
  const failures = [];
  if (document?.version !== version) failures.push('version');
  if (document?.channel !== policy.channel) failures.push('channel');
  const platformKeys = Object.keys(document?.downloads || {});
  const winKeys = Object.keys(document?.downloads?.win || {});
  if (platformKeys.length !== 1 || platformKeys[0] !== 'win') failures.push('platform scope');
  if (winKeys.length !== 1 || winKeys[0] !== 'x64') failures.push('Windows architecture scope');
  let downloadUrl;
  try {
    downloadUrl = new URL(document?.downloads?.win?.x64);
    if (downloadUrl.protocol !== 'https:') failures.push('download HTTPS URL');
    if (decodeURIComponent(basename(downloadUrl.pathname)) !== installerName) {
      failures.push('installer filename');
    }
    if (!downloadUrl.pathname.includes(`/${policy.ossChannelDir}/`)) failures.push('channel path');
    if (downloadUrl.pathname.includes('/latest/')) failures.push('public latest boundary');
  } catch {
    failures.push('download URL');
  }
  if (document?.changelog !== `https://github.com/IntelliSpectrum/ClawX/releases/tag/v${version}`) {
    failures.push('changelog URL');
  }
  if (failures.length > 0) {
    throw new Error(`release-info is inconsistent with the fixture-grade RC: ${failures.join(', ')}`);
  }
  return { channel: policy.channel, installerName, downloadUrl: downloadUrl.toString() };
}

export function validateUpdaterMetadata(ymlText, installer) {
  const result = verifyUpdateYmlHashes(ymlText, [installer]);
  if (!result.ok || result.checked !== 1) {
    throw new Error(`latest.yml does not match the Windows x64 installer: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function auditPackagedCommandBoundaries(appDir) {
  const files = await walkFiles(appDir);
  const forbiddenCommands = files.filter((file) =>
    FORBIDDEN_COMMAND_NAMES.has(basename(file.relativePath).toLowerCase()),
  );
  const forbiddenState = files.filter((file) => {
    const path = `/${file.relativePath.toLowerCase()}`;
    return (
      path.includes('/.git/') ||
      path.endsWith('/.gitconfig') ||
      path.endsWith('/.git-credentials') ||
      path.includes('/.config/gh/') ||
      path.includes('/github cli/') ||
      /\/(?:gh|github-cli)\/hosts\.yml$/u.test(path)
    );
  });
  if (forbiddenCommands.length > 0 || forbiddenState.length > 0) {
    throw new Error(
      `packaged app contains undeclared git/gh command or auth state: ${[
        ...forbiddenCommands,
        ...forbiddenState,
      ]
        .map((file) => file.relativePath)
        .join(', ')}`,
    );
  }
  return { fileCount: files.length, forbiddenCommandCount: 0, forbiddenAuthStateCount: 0 };
}

function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0);
}

function normalizedText(buffer) {
  return buffer.toString('utf8').replace(/\r\n?/gu, '\n');
}

function displayPath(path) {
  const absolute = resolve(path);
  const relativePath = relative(root, absolute).replaceAll('\\', '/');
  return relativePath.startsWith('../') ? basename(absolute) : relativePath;
}

export async function scanReleaseCandidateFiles(paths, options = {}) {
  const targetFiles = [];
  for (const path of paths) {
    const absolute = resolve(path);
    const fileStat = await stat(absolute);
    if (fileStat.isDirectory()) targetFiles.push(...(await walkFiles(absolute)));
    else if (fileStat.isFile()) {
      targetFiles.push({ absolutePath: absolute, relativePath: basename(absolute), size: fileStat.size });
    }
  }
  const uniqueTargets = [...new Map(targetFiles.map((file) => [file.absolutePath, file])).values()];
  const sourceBodies = [];
  for (const path of options.sourceFiles || []) {
    const buffer = await readFile(path);
    if (buffer.length < 256 || !isProbablyText(buffer)) continue;
    sourceBodies.push({ path, text: normalizedText(buffer) });
  }
  const literalBuffers = [
    ['workspace-absolute-path', resolve(options.workspaceRoot || root)],
    ['user-home-absolute-path', resolve(options.userHome || homedir())],
  ].flatMap(([id, value]) => [
    [id, Buffer.from(value, 'utf8')],
    [`${id}-utf16`, Buffer.from(value, 'utf16le')],
  ]);
  const findings = [];
  let scannedBytes = 0;
  let textFileCount = 0;
  for (const file of uniqueTargets.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath))) {
    const buffer = await readFile(file.absolutePath);
    scannedBytes += buffer.length;
    for (const [id, literal] of literalBuffers) {
      if (literal.length > 0 && buffer.includes(literal)) {
        findings.push({ type: id, file: displayPath(file.absolutePath) });
      }
    }
    const text = buffer.toString('utf8');
    for (const [id, pattern] of SENSITIVE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) findings.push({ type: id, file: displayPath(file.absolutePath) });
    }
    if (!isProbablyText(buffer)) continue;
    textFileCount += 1;
    const normalized = normalizedText(buffer);
    for (const source of sourceBodies) {
      if (normalized.includes(source.text)) {
        findings.push({
          type: 'tracked-source-body',
          file: displayPath(file.absolutePath),
          source: displayPath(source.path),
        });
      }
    }
  }
  return {
    scannedFileCount: uniqueTargets.length,
    textFileCount,
    scannedBytes,
    sourceFilesChecked: sourceBodies.length,
    findings,
  };
}

export async function validatePackageFreshness(appAsarPath, buildDirectories) {
  const appAsarStat = await stat(appAsarPath);
  const buildFiles = [];
  for (const directory of buildDirectories) buildFiles.push(...(await walkFiles(directory)));
  const newestBuildFile = buildFiles.reduce(
    (latest, file) => (file.mtimeMs > latest.mtimeMs ? file : latest),
    { relativePath: '<none>', mtimeMs: 0 },
  );
  if (appAsarStat.mtimeMs < newestBuildFile.mtimeMs) {
    throw new Error(
      `app.asar is stale: app.asar=${appAsarStat.mtime.toISOString()} newestBuild=${new Date(
        newestBuildFile.mtimeMs,
      ).toISOString()} (${newestBuildFile.relativePath})`,
    );
  }
  return {
    appAsarMtime: appAsarStat.mtime.toISOString(),
    newestBuildMtime: new Date(newestBuildFile.mtimeMs).toISOString(),
    newestBuildFile: newestBuildFile.relativePath,
  };
}

async function validateCandidate(options) {
  const version = options.version;
  const installerName = `Verse Claw-${version}-win-x64.exe`;
  const installerPath = join(options.releaseDir, installerName);
  const latestYmlPath = join(options.releaseDir, 'latest.yml');
  const appAsarPath = join(options.appDir, 'resources', 'app.asar');
  for (const requiredPath of [installerPath, latestYmlPath, appAsarPath]) {
    if (!existsSync(requiredPath)) throw new Error(`required release output is missing: ${requiredPath}`);
  }

  const topLevel = await readdir(options.releaseDir, { withFileTypes: true });
  const topLevelInstallers = topLevel
    .filter((entry) => entry.isFile() && /-win-(?:x64|arm64)\.exe$/iu.test(entry.name))
    .map((entry) => entry.name);
  if (topLevelInstallers.length !== 1 || topLevelInstallers[0] !== installerName) {
    throw new Error(`release directory must contain exactly the Windows x64 installer: ${topLevelInstallers.join(', ')}`);
  }

  const installerStat = await stat(installerPath);
  const installer = {
    name: installerName,
    size: installerStat.size,
    sha256: await sha256File(installerPath),
    sha512Base64: await sha512Base64(installerPath),
  };
  const latestYmlText = await readFile(latestYmlPath, 'utf8');
  const updater = validateUpdaterMetadata(latestYmlText, installer);
  const releaseInfo = validateReleaseInfoDocument(await readJson(options.releaseInfoPath), {
    version,
    installerName,
  });
  const freshness = await validatePackageFreshness(appAsarPath, options.buildDirectories);
  const packages = await inspectPackagedElectronTrust(options.appDir, 'win');
  const commandBoundary = await auditPackagedCommandBoundaries(options.appDir);
  return {
    installer,
    latestYml: { path: 'latest.yml', sha256: await sha256File(latestYmlPath), ...updater },
    releaseInfo: { path: basename(options.releaseInfoPath), sha256: await sha256File(options.releaseInfoPath), ...releaseInfo },
    freshness,
    electronTrust: packages,
    commandBoundary,
  };
}

function parseArgs(argv) {
  const values = {};
  const repeated = { scan: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const name = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[name] = true;
    else {
      if (name === 'scan') repeated.scan.push(next);
      else values[name] = next;
      index += 1;
    }
  }
  return { ...values, ...repeated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requiredArgs = [
    'release-dir',
    'app-dir',
    'dist-dir',
    'dist-electron-dir',
    'manifest',
    'evidence',
    'requirements',
    'source-license-manifest',
    'version',
    'ref',
    'commit',
    'out',
  ];
  const missingArgs = requiredArgs.filter((name) => !args[name]);
  if (missingArgs.length > 0) throw new Error(`missing required arguments: ${missingArgs.join(', ')}`);

  const releaseInfoPath = resolve(
    args['release-info'] || join(dirname(resolve(args.out)), 'release-info.json'),
  );
  if (!args['release-info']) {
    await mkdir(dirname(releaseInfoPath), { recursive: true });
    await writeFile(
      releaseInfoPath,
      `${JSON.stringify(
        createFirstProductReleaseInfo({
          version: args.version,
          releaseDate: args['release-date'],
          baseUrl: args['release-base-url'],
        }),
        null,
        2,
      )}\n`,
    );
  }

  const baseline = validateReleaseBaseline({
    root,
    manifestPath: resolve(args.manifest),
    evidencePath: resolve(args.evidence),
    version: args.version,
    ref: args.ref,
    commit: args.commit,
  });
  const manifest = await readJson(args.manifest);
  const requirements = await readJson(args.requirements);
  const sourceCoverage = validateRequiredSourceCoverage(manifest, requirements);
  const upstream = validateSourceLicenseEvidence(await readJson(args['source-license-manifest']));
  const artifacts = await validateCandidate({
    version: args.version,
    releaseDir: resolve(args['release-dir']),
    appDir: resolve(args['app-dir']),
    releaseInfoPath,
    buildDirectories: [resolve(args['dist-dir']), resolve(args['dist-electron-dir'])],
  });
  const sourceFiles = sourceCoverage.paths
    .filter((path) => /\.(?:ts|tsx|mjs|mts)$/u.test(path))
    .map((path) => join(root, path));
  const scanPaths = [
    resolve(args['release-dir']),
    resolve(args.manifest),
    resolve(args.evidence),
    resolve(args.requirements),
    resolve(args['source-license-manifest']),
    ...args.scan.map((path) => resolve(path)),
  ];
  const scans = await scanReleaseCandidateFiles(scanPaths, { sourceFiles });
  if (scans.findings.length > 0) {
    throw new Error(`release candidate leakage scan failed: ${JSON.stringify(scans.findings)}`);
  }

  const policy = getWindowsSigningPolicy(args.version);
  if (policy.channel !== detectReleaseChannel(args.version) || policy.allowPublicPublish) {
    throw new Error('fixture-grade release candidate must remain outside public latest');
  }
  const report = {
    schemaVersion: 1,
    taskId: 'FP-P3-01',
    scope: 'fixture-grade',
    generatedAt: new Date().toISOString(),
    identity: { version: args.version, ref: args.ref, commit: args.commit },
    policy: {
      channel: policy.channel,
      unsignedAllowed: !policy.requireCodeSigning,
      publicLatest: false,
      liveReady: false,
      productApproved: false,
      defaultOn: false,
    },
    baseline,
    sourceCoverage,
    upstream,
    artifacts,
    scans: { ...scans, findings: [] },
  };
  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[FP-P3-01] validation OK commit=${args.commit} installerSha256=${artifacts.installer.sha256} scanned=${scans.scannedFileCount}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[FP-P3-01] validation FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
