#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseBaselineManifest, resolveReleaseIdentity } from './release-baseline-manifest.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const comparePath = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const canonicalEvidenceDirectory = (root) => join(root, 'artifacts/system-maturity/P6-005');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalReleaseConfigText(value) {
  const text = String(value).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
}

function assertSortedUniqueManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('release source manifest is malformed');
  }
  if (manifest.trackedFileCount !== manifest.files.length) {
    throw new Error('release source manifest trackedFileCount mismatch');
  }
  const paths = manifest.files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error('release source manifest has duplicate paths');
  const sorted = [...paths].sort(comparePath);
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    throw new Error('release source manifest paths are not deterministically sorted');
  }
  for (const entry of manifest.files) {
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || !/^\d{6}$/u.test(entry.mode)) {
      throw new Error(`release source manifest entry is malformed: ${entry.path}`);
    }
  }
}

export function validateReleaseGateEvidence({ evidencePath, gatesPath, manifestText, identity }) {
  const evidence = readJson(evidencePath);
  const gatesText = readFileSync(gatesPath, 'utf8');
  const gates = JSON.parse(gatesText);
  const required = gates.loops?.release?.commands || [];
  if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.gates)) {
    throw new Error('release gate evidence is malformed');
  }
  for (const key of ['commit', 'ref', 'version']) {
    if (evidence[key] !== identity[key]) throw new Error(`release gate evidence ${key} mismatch`);
  }
  if (evidence.manifestSha256 !== sha256(manifestText)) {
    throw new Error('release gate evidence manifest digest mismatch');
  }
  if (evidence.gatesConfigSha256 !== sha256(canonicalReleaseConfigText(gatesText))) {
    throw new Error('release gate evidence gates.json digest mismatch');
  }
  if (evidence.gates.length !== required.length) {
    throw new Error(`release gate evidence count mismatch: expected=${required.length} actual=${evidence.gates.length}`);
  }

  const evidenceDir = dirname(evidencePath);
  const validateCapturedCommand = (actual, expected, label) => {
    if (actual?.id !== expected.id || actual?.command !== expected.command) {
      throw new Error(`${label} evidence mismatch`);
    }
    if (actual.exitCode !== 0) throw new Error(`${label} failed with exit ${actual.exitCode}`);
    for (const stream of ['stdout', 'stderr']) {
      const relativePath = actual[`${stream}Path`];
      const expectedDigest = actual[`${stream}Sha256`];
      const absolutePath = join(evidenceDir, relativePath || '');
      if (!relativePath || !existsSync(absolutePath)) {
        throw new Error(`${label} missing ${stream} evidence`);
      }
      const bytes = readFileSync(absolutePath);
      if (sha256(bytes) !== expectedDigest) {
        throw new Error(`${label} ${stream} digest mismatch`);
      }
    }
  };

  validateCapturedCommand(
    evidence.preflight,
    { id: 'runtime-build-preflight', command: 'pnpm build:runtime' },
    'release runtime preflight',
  );

  for (let index = 0; index < required.length; index += 1) {
    const expected = required[index];
    const actual = evidence.gates[index];
    validateCapturedCommand(
      actual,
      { id: expected.id, command: expected.run },
      `release gate ${expected.id} at index ${index}`,
    );
  }
  return { preflightCount: 1, gateCount: required.length };
}

export function validateReleaseWorkflowBaselinePolicy(text) {
  const source = String(text);
  const required = [
    'release-baseline:',
    'needs: release-baseline',
    'scripts/collect-p6-005-evidence.mjs',
    'name: release-baseline',
    'scripts/validate-release-baseline.mjs',
  ];
  const missing = required.filter((anchor) => !source.includes(anchor));
  if (missing.length > 0) {
    throw new Error(`release workflow baseline anchors missing: ${missing.join(', ')}`);
  }
  return { baselineJob: true, packagingDependency: true, evidenceTransfer: true };
}

export function resolveReleaseBaselinePaths(options = {}) {
  const root = resolve(options.root || repositoryRoot);
  const evidenceDirectory = canonicalEvidenceDirectory(root);
  return {
    root,
    manifestPath: options.manifestPath
      ? resolve(options.manifestPath)
      : join(evidenceDirectory, 'release-source-manifest.json'),
    evidencePath: options.evidencePath
      ? resolve(options.evidencePath)
      : join(evidenceDirectory, 'release-gate-evidence.json'),
    gatesPath: options.gatesPath
      ? resolve(options.gatesPath)
      : join(root, 'plans/system-maturity/gates.json'),
    workflowPath: options.workflowPath
      ? resolve(options.workflowPath)
      : join(root, '.github/workflows/release.yml'),
  };
}

export function validateReleaseBaseline(options = {}) {
  const { root, manifestPath, evidencePath, gatesPath, workflowPath } = resolveReleaseBaselinePaths(options);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText.replace(/^\uFEFF/u, ''));
  assertSortedUniqueManifest(manifest);
  // A local no-argument validation has no CI ref. The manifest may provide that
  // binding, but it still has to resolve to the current HEAD below; stale evidence
  // therefore remains fail-closed.
  const identity = resolveReleaseIdentity({ ...options, root, ref: options.ref || manifest.ref });
  for (const key of ['commit', 'ref', 'version', 'tree']) {
    if (manifest[key] !== identity[key]) throw new Error(`release source manifest ${key} mismatch`);
  }
  if (options.evidenceOnly !== true) {
    const regenerated = createReleaseBaselineManifest({
      root,
      version: identity.version,
      ref: identity.ref,
      commit: identity.commit,
    });
    if (regenerated !== manifestText) {
      throw new Error('release source manifest is not byte-for-byte reproducible');
    }
  }
  const evidence = validateReleaseGateEvidence({ evidencePath, gatesPath, manifestText, identity });
  const workflow = validateReleaseWorkflowBaselinePolicy(readFileSync(workflowPath, 'utf8'));
  return { ...identity, manifestSha256: sha256(manifestText), ...evidence, workflow };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateReleaseBaseline({
      root: readArg('--root') || repositoryRoot,
      manifestPath: readArg('--manifest'),
      evidencePath: readArg('--evidence'),
      gatesPath: readArg('--gates'),
      workflowPath: readArg('--workflow'),
      version: readArg('--version'),
      ref: readArg('--ref') || process.env.GITHUB_REF,
      commit: readArg('--commit') || process.env.GITHUB_SHA,
      evidenceOnly: process.argv.includes('--evidence-only'),
    });
    console.log(`[release-baseline] validation OK: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[release-baseline] validation FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
