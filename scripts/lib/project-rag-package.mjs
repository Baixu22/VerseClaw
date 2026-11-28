import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RETRIEVAL_ARTIFACT_MANIFEST = 'retrieval-artifact-manifest.json';
const required = ['package.json', 'dist/entry.js', 'dist/plugin-sdk/knowledge-retrieval.js', 'dist/plugin-sdk/memory-host-core.js',
  'dist/project-rag-policy-verifier.mjs', 'dist/project-rag-policy-verifier.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
};
function resolvedFile(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || isAbsolute(name)
    || name.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('Invalid retrieval artifact path');
  const target = resolve(root, name);
  if (!inside(root, target) || !inside(realpathSync(root), realpathSync(target)) || !lstatSync(target).isFile())
    throw new Error('Retrieval artifact escapes its delivered root');
  return target;
}

/** Manifest the delivered runtime after target-specific dependency cleanup. */
export function createRetrievalArtifactManifest(rootInput, options) {
  const root = realpathSync(rootInput);
  if (!options || !/^[a-f0-9]{40}$/.test(options.candidate)
    || !['win32', 'darwin', 'linux'].includes(options.platform) || !['x64', 'arm64'].includes(options.arch))
    throw new Error('Retrieval package requires a fixed candidate and target');
  const names = new Set(required);
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (['node_modules', '.git', '.cache', 'test-results'].includes(entry.name)) continue;
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Materialize retrieval package links before sealing');
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) names.add(name);
    }
  }
  walk('dist');
  for (const directory of ['extensions/memory-wiki', 'src/knowledge/retrieval']) if (existsSync(join(root, directory))) walk(directory);
  for (const dependency of ['extensions/memory-wiki/node_modules/@lancedb', 'node_modules/@lancedb',
    'extensions/memory-wiki/node_modules/@huggingface', 'node_modules/@huggingface']) {
    if (existsSync(join(root, dependency))) walk(dependency);
  }
  if (names.size > 50000) throw new Error('Retrieval package inventory exceeds its bound');
  const files = [...names].sort().map(path => {
    const bytes = readFileSync(resolvedFile(root, path));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof packageInfo.version !== 'string' || !packageInfo.version) throw new Error('Runtime package version missing');
  const verifier = JSON.parse(readFileSync(resolvedFile(root, 'dist/project-rag-policy-verifier.json'), 'utf8'));
  if (verifier.schema !== 'ProjectRagPolicyVerifier/v1' || verifier.cleanSource !== true
    || verifier.candidate !== options.candidate
    || verifier.sha256 !== sha(readFileSync(resolvedFile(root, 'dist/project-rag-policy-verifier.mjs'))))
    throw new Error('Retrieval policy verifier does not bind this clean package candidate');
  const manifest = { schema: 'RetrievalArtifactManifest/v1', candidate: options.candidate,
    target: `${options.platform}-${options.arch}`, runtimeVersion: packageInfo.version,
    stateSchema: { minimumReadable: 1, maximumReadable: 1, writes: 1, migration: 'additive-owner-migration' },
    portableCapacity: 20000, annCapacity: 100000, nativeStatus: 'probe-required',
    modelArtifacts: [], files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    actor: 'codex/project-rag-package', driven_by: 'agent' };
  return { ...manifest, manifestDigest: sha(JSON.stringify(manifest)) };
}

export function verifyRetrievalArtifactManifest(rootInput, options = {}) {
  const root = realpathSync(rootInput);
  const manifest = JSON.parse(readFileSync(join(root, RETRIEVAL_ARTIFACT_MANIFEST), 'utf8'));
  const { manifestDigest, ...content } = manifest;
  if (manifest.schema !== 'RetrievalArtifactManifest/v1' || manifestDigest !== sha(JSON.stringify(content)))
    throw new Error('Retrieval manifest integrity mismatch');
  if (options.target && manifest.target !== options.target) throw new Error('Retrieval package target mismatch');
  if (!/^(win32|darwin|linux)-(x64|arm64)$/.test(manifest.target)) throw new Error('Invalid retrieval package target');
  if (!/^[a-f0-9]{40}$/.test(manifest.candidate) || !Array.isArray(manifest.files)
    || manifest.files.length > 50000 || !required.every(path => manifest.files.some(file => file.path === path)))
    throw new Error('Incomplete retrieval artifact inventory');
  const seen = new Set();
  let bytes = 0;
  for (const file of manifest.files) {
    if (seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('Invalid retrieval artifact entry');
    seen.add(file.path);
    const data = readFileSync(resolvedFile(root, file.path));
    if (data.length !== file.bytes || sha(data) !== file.sha256) throw new Error(`Retrieval artifact mismatch: ${file.path}`);
    bytes += data.length;
  }
  if (bytes !== manifest.totalBytes) throw new Error('Retrieval artifact size mismatch');
  return manifest;
}

export function sealRetrievalArtifactManifest(root, options) {
  const manifest = createRetrievalArtifactManifest(root, options);
  writeFileSync(join(root, RETRIEVAL_ARTIFACT_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return verifyRetrievalArtifactManifest(root, { target: manifest.target });
}

/** Preflight only: the existing installer and database owner perform all writes. */
export function planRetrievalUpgrade(previous, next, input) {
  if (!previous || !next || previous.schema !== 'RetrievalArtifactManifest/v1' || next.schema !== previous.schema
    || previous.target !== next.target || !Number.isSafeInteger(input.databaseUserVersion)
    || !Number.isFinite(input.freeBytes) || input.freeBytes < 0) throw new Error('Invalid retrieval upgrade inputs');
  for (const manifest of [previous, next]) {
    if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes <= 0
      || !manifest.stateSchema || !['minimumReadable', 'maximumReadable', 'writes'].every(key =>
        Number.isSafeInteger(manifest.stateSchema[key]) && manifest.stateSchema[key] >= 1)
      || manifest.stateSchema.minimumReadable > manifest.stateSchema.maximumReadable)
      throw new Error('Invalid retrieval schema compatibility contract');
  }
  const requiredFreeBytes = Math.ceil(next.totalBytes * 1.2) + previous.totalBytes;
  const reasons = [];
  if (!Number.isSafeInteger(requiredFreeBytes) || requiredFreeBytes <= 0 || input.freeBytes < requiredFreeBytes)
    reasons.push('insufficient-space-for-staging-and-rollback');
  for (const [label, manifest] of [['next', next], ['rollback', previous]]) {
    if (!manifest.stateSchema || input.databaseUserVersion < manifest.stateSchema.minimumReadable
      || input.databaseUserVersion > manifest.stateSchema.maximumReadable) reasons.push(`${label}-cannot-read-owner-state`);
  }
  if (next.stateSchema?.writes > previous.stateSchema?.maximumReadable) reasons.push('rollback-cannot-read-new-writes');
  return { schema: 'RetrievalUpgradeReceipt/v1', actor: 'codex/project-rag-upgrade', driven_by: 'agent',
    status: reasons.length ? 'rejected' : 'ready', previousDigest: previous.manifestDigest, nextDigest: next.manifestDigest,
    databaseUserVersion: input.databaseUserVersion, requiredFreeBytes, reasons,
    canonicalDataAction: 'preserve-owner-databases', projectionAction: 'rebuild-through-owner',
    dataCopied: false, dataDeleted: false, installed: false };
}

export function availableArtifactBytes(directory) {
  const status = statfsSync(directory);
  return status.bavail * status.bsize;
}
