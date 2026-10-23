#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_SCHEMA = 'clawx.versegit.sidecar-package/v1';
const CONTRACT_VERSION = 'clawx.versegit.consumer-contract/v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = join(ROOT, 'harness', 'specs', 'fixtures', 'versegit-product-integration', 'f3');
const DEFAULTS = {
  sourceRepo: 'D:\\Projects\\VerseGit',
  commit: '89af0c36216e64bb0f7430fc3fe21c39c485be7c',
  sourceA: 'D:\\tmp\\versegit-f3-build-a',
  sourceB: 'D:\\tmp\\versegit-f3-build-b',
  buildA: 'D:\\tmp\\versegit-f3-target-a2\\release\\vg.exe',
  buildB: 'D:\\tmp\\versegit-f3-target-b\\release\\vg.exe',
  binary: join(ROOT, 'resources', 'bin', 'win32-x64', 'vg.exe'),
  manifest: join(ROOT, 'resources', 'versegit', 'manifest.json'),
  license: join(ROOT, 'resources', 'versegit', 'LICENSE-APACHE-2.0.txt'),
  contract: join(ROOT, 'harness', 'specs', 'fixtures', 'versegit-planning-correction', 'mc1-evidence', 'contract.json'),
  provenance: join(EVIDENCE_DIR, 'build-provenance.json'),
  packageManifest: join(EVIDENCE_DIR, 'sidecar-package-manifest.json'),
  negative: join(EVIDENCE_DIR, 'package-negative.json'),
};

function parseArgs(argv) {
  const options = { ...DEFAULTS, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify') options.verify = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function shaFile(file) {
  return sha(readFileSync(file));
}

function git(repo, args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '')}`);
  return result.stdout;
}

function runBinary(binary, args, cwd = dirname(binary)) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${basename(binary)} ${args.join(' ')} exited ${String(result.status)}: ${String(result.stderr ?? '')}`);
  }
  return Buffer.from(result.stdout);
}

function identityProbe(binary) {
  const version = runBinary(binary, ['--version']).toString('utf8').trim();
  const capabilities = runBinary(binary, ['capabilities', '--json']);
  const capabilitiesDocument = JSON.parse(capabilities.toString('utf8'));
  return {
    version,
    capabilitiesDigest: sha(capabilities),
    capabilitiesBytes: capabilities.byteLength,
    capabilitiesSchema: capabilitiesDocument.schema,
  };
}

function fileIdentity(pathValue) {
  const bytes = readFileSync(pathValue);
  return { sha256: sha(bytes), bytes: bytes.byteLength };
}

function verifyPackage(input) {
  const issues = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, code: 'artifact_missing', issues: [String(error)] };
  }
  if (manifest.schema !== PACKAGE_SCHEMA) issues.push('unsupported_package_schema');
  if (!Array.isArray(manifest.profiles) || !manifest.profiles.includes(input.profile)) issues.push('profile_unauthorized');
  if (!manifest.artifact || manifest.artifact.platform !== input.platform || manifest.artifact.arch !== input.arch) issues.push('platform_or_arch_mismatch');
  if (!existsSync(input.binaryPath)) issues.push('artifact_missing');
  else {
    const artifact = fileIdentity(input.binaryPath);
    if (artifact.sha256 !== manifest.artifact?.sha256) issues.push('artifact_sha256_mismatch');
    if (artifact.bytes !== manifest.artifact?.bytes) issues.push('artifact_size_mismatch');
    try {
      const probe = identityProbe(input.binaryPath);
      if (probe.version !== manifest.artifact?.version) issues.push('artifact_version_mismatch');
      if (probe.capabilitiesDigest !== manifest.provider?.capabilitiesSha256) issues.push('capabilities_digest_mismatch');
      if (probe.capabilitiesSchema !== manifest.provider?.capabilitiesSchema) issues.push('capabilities_schema_mismatch');
    } catch (error) {
      issues.push('artifact_probe_failed:' + String(error).slice(0, 300));
    }
  }
  const cause = issues.includes('artifact_missing')
    ? 'artifact_missing'
    : issues.find((entry) => entry.includes('schema'))
    ? 'schema_unsupported'
    : issues.includes('profile_unauthorized')
      ? 'profile_unauthorized'
      : issues.length > 0
        ? 'artifact_mismatch'
        : null;
  return { ok: issues.length === 0, code: cause, issues, manifest };
}

function sourceTreeManifest(repo, commit) {
  const listing = git(repo, ['ls-tree', '-r', '-l', '--full-tree', commit], 'utf8');
  return listing.split(/\r?\n/u).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const meta = line.slice(0, tab).trim().split(/\s+/u);
    return {
      mode: meta[0],
      type: meta[1],
      object: meta[2],
      bytes: Number(meta[3]),
      path: line.slice(tab + 1),
    };
  });
}

function archiveDigest(repo, commit) {
  const temp = mkdtempSync(join(tmpdir(), 'versegit-f3-archive-'));
  const archive = join(temp, 'source.zip');
  try {
    git(repo, ['archive', '--format=zip', `--output=${archive}`, commit], 'utf8');
    return fileIdentity(archive);
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}

function clawxSourceState() {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const evidencePrefix = 'harness/specs/fixtures/versegit-product-integration/f3/';
  const packagePrefix = 'resources/versegit/';
  const dirty = String(status.stdout ?? '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .some((line) => {
      const name = line.slice(3).replaceAll('\\', '/');
      return !name.startsWith(evidencePrefix) && !name.startsWith(packagePrefix);
    });
  return {
    branch: spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(),
    commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(),
    tree: spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(),
    dirty,
  };
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assemble(options) {
  if (!existsSync(options.buildA) || !existsSync(options.buildB)) {
    throw new Error('two independent release binaries are required');
  }
  const clawxSource = clawxSourceState();
  const commit = git(options.sourceRepo, ['rev-parse', options.commit]).trim();
  const tree = git(options.sourceRepo, ['rev-parse', `${commit}^{tree}`]).trim();
  const epoch = Number(git(options.sourceRepo, ['show', '-s', '--format=%ct', commit]).trim());
  const sourceManifest = sourceTreeManifest(options.sourceRepo, commit);
  const sourceInputsDigest = sha(canonical(sourceManifest));
  const lockfileDigest = sha(readFileSync(join(options.sourceA, 'Cargo.lock')));
  const contract = JSON.parse(readFileSync(options.contract, 'utf8'));
  const contractDigest = sha(canonical(contract));
  const cargoVersion = spawnSync('cargo', ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const rustcVersion = spawnSync('rustc', ['--version', '--verbose'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const recipe = {
    command: ['cargo', 'build', '--locked', '--release', '--bin', 'vg'],
    profile: 'release',
    sourceDateEpoch: epoch,
    cargoIncremental: '0',
    cargoTarget: 'x86_64-pc-windows-msvc',
    encodedRustflags: [
      '--remap-path-prefix={source_root}=/versegit/source',
      '--remap-path-prefix={target_root}=/versegit/target',
      '-C',
      'link-arg=/Brepro',
      '-C',
      'link-arg=/PDBALTPATH:%_PDB%',
    ],
    cargoVersion,
    rustcVersion,
  };
  const recipeDigest = sha(canonical(recipe));
  const archive = archiveDigest(options.sourceRepo, commit);
  const copyA = fileIdentity(options.buildA);
  const copyB = fileIdentity(options.buildB);
  const probeA = identityProbe(options.buildA);
  const probeB = identityProbe(options.buildB);
  const semanticIdentityEqual = canonical(probeA) === canonical(probeB);
  if (!semanticIdentityEqual) throw new Error('independent release builds produced different semantic identity');
  const byteIdentical = copyA.sha256 === copyB.sha256;
  const golden = {
    version: probeA.version,
    capabilitiesSha256: probeA.capabilitiesDigest,
    capabilitiesSchema: probeA.capabilitiesSchema,
    contractDigest,
  };
  const goldenDigest = sha(canonical(golden));
  mkdirSync(dirname(options.binary), { recursive: true });
  mkdirSync(dirname(options.manifest), { recursive: true });
  copyFileSync(options.buildA, options.binary);
  copyFileSync(join(options.sourceRepo, 'LICENSE'), options.license);
  const artifactIdentity = fileIdentity(options.binary);
  const licenseIdentity = fileIdentity(options.license);
  const manifest = {
    schema: PACKAGE_SCHEMA,
    packageId: `vg-${probeA.version.replace(/^vg\s+/iu, '').replace(/[^a-z0-9.]+/giu, '-')}-win32-x64-release-${artifactIdentity.sha256.slice(0, 16)}`,
    driven_by: 'agent',
    actor: 'codex',
    source: {
      repository: 'https://github.com/Baixu22/VerseGit',
      commit,
      tree,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
      sourceInputsDigest,
      effectivePatchSet: [],
    },
    build: {
      profile: 'release',
      command: recipe.command,
      recipeDigest,
      sourceDateEpoch: epoch,
      lockfileSha256: lockfileDigest,
      toolchain: { cargo: cargoVersion, rustc: rustcVersion },
      independentBuildRoots: 2,
      byteIdentical,
      buildHashes: { a: copyA.sha256, b: copyB.sha256 },
      semanticIdentityEqual,
    },
    artifact: {
      devPath: 'resources/bin/win32-x64/vg.exe',
      packagedPath: 'bin/vg.exe',
      sha256: artifactIdentity.sha256,
      bytes: artifactIdentity.bytes,
      format: 'pe32+',
      platform: 'win32',
      arch: 'x64',
      version: probeA.version,
    },
    provider: {
      capabilitiesSchema: probeA.capabilitiesSchema,
      capabilitiesSha256: probeA.capabilitiesDigest,
      capabilitiesBytes: probeA.capabilitiesBytes,
      contractVersion: CONTRACT_VERSION,
      contractDigest,
      schemaVersions: [1, 2],
      ledgerSchemaVersion: 2,
      goldenDigest,
    },
    profiles: ['M1'],
    license: {
      spdx: 'Apache-2.0',
      path: 'resources/versegit/LICENSE-APACHE-2.0.txt',
      sha256: licenseIdentity.sha256,
    },
    retention: {
      codeCopied: false,
      gitDirectoryCopied: false,
      taskForestCopied: false,
      privateEvidenceCopied: false,
      supportedTargets: ['win32-x64'],
    },
  };
  writeJson(options.manifest, manifest);
  writeJson(options.provenance, {
    schema: 'clawx.versegit.f3-build-provenance/v1',
    driven_by: 'agent',
    actor: 'codex',
    generatedAt: new Date().toISOString(),
    clawxSource,
    source: { commit, tree, archiveSha256: archive.sha256, sourceInputsDigest },
    recipe,
    recipeDigest,
    builds: [
      { id: 'A', binarySha256: copyA.sha256, bytes: copyA.bytes, identity: probeA },
      { id: 'B', binarySha256: copyB.sha256, bytes: copyB.bytes, identity: probeB },
    ],
    byteIdentical,
    semanticIdentityEqual,
    reproducibility: byteIdentical
      ? { status: 'byte-identical', claimable: true }
      : {
          status: 'semantic-identity-only',
          claimable: false,
          limitation: 'Two independent source/target roots produced different PE hashes; the delivered artifact is digest-pinned but byte-identical reproducibility is not claimed.',
        },
    platform: 'win32-x64',
    boundaries: { published: false, defaultOn: false, liveReady: false, productApproved: false, m4Authorized: false },
  });
  writeJson(options.packageManifest, {
    schema: 'clawx.versegit.f3-sidecar-package-manifest-evidence/v1',
    driven_by: 'agent',
    actor: 'codex',
    generatedAt: new Date().toISOString(),
    clawxSource,
    source: { commit, tree },
    manifestPath: 'resources/versegit/manifest.json',
    artifactPath: 'resources/bin/win32-x64/vg.exe',
    package: manifest,
    packageDigest: sha(canonical(manifest)),
    verified: verifyPackage({ manifestPath: options.manifest, binaryPath: options.binary, profile: 'M1', platform: 'win32', arch: 'x64' }),
    reproducibility: { byteIdentical, semanticIdentityEqual },
  });
  const temp = mkdtempSync(join(tmpdir(), 'versegit-f3-negative-'));
  let negative;
  try {
    const manifestPath = join(temp, 'manifest.json');
    const binaryPath = join(temp, 'vg.exe');
    writeJson(manifestPath, manifest);
    const cases = [];
    cases.push({ id: 'missing', ...verifyPackage({ manifestPath, binaryPath, profile: 'M1', platform: 'win32', arch: 'x64' }) });
    copyFileSync(options.binary, binaryPath);
    const tampered = { ...manifest, artifact: { ...manifest.artifact, sha256: '0'.repeat(64) } };
    writeJson(manifestPath, tampered);
    cases.push({ id: 'hash_mismatch', ...verifyPackage({ manifestPath, binaryPath, profile: 'M1', platform: 'win32', arch: 'x64' }) });
    writeJson(manifestPath, { ...manifest, schema: 'clawx.versegit.sidecar-package/v999' });
    cases.push({ id: 'unsupported_schema', ...verifyPackage({ manifestPath, binaryPath, profile: 'M1', platform: 'win32', arch: 'x64' }) });
    writeJson(manifestPath, manifest);
    cases.push({ id: 'unauthorized_profile', ...verifyPackage({ manifestPath, binaryPath, profile: 'M4', platform: 'win32', arch: 'x64' }) });
    negative = {
      schema: 'clawx.versegit.f3-package-negative/v1',
      driven_by: 'agent',
      actor: 'codex',
      clawxSource,
      cases: cases.map((entry) => ({ id: entry.id, rejected: entry.ok === false, code: entry.code, issues: entry.issues })),
      passed: cases.every((entry) => entry.ok === false),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
  writeJson(options.negative, negative);
  if (!negative.passed) throw new Error('sidecar negative checks did not all reject');
  console.log(JSON.stringify({
    ok: true,
    manifest: options.manifest,
    binary: options.binary,
    artifactSha256: artifactIdentity.sha256,
    capabilitiesSha256: probeA.capabilitiesDigest,
    byteIdentical,
    semanticIdentityEqual,
  }, null, 2));
}

function verify(options) {
  const result = verifyPackage({
    manifestPath: options.manifest,
    binaryPath: options.binary,
    profile: 'M1',
    platform: 'win32',
    arch: 'x64',
  });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, packageId: result.manifest.packageId, artifactSha256: result.manifest.artifact.sha256 }, null, 2));
}

const options = parseArgs(process.argv.slice(2));
if (options.verify) verify(options);
else assemble(options);
