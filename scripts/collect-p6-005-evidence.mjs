#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertCleanReleaseTree,
  createReleaseBaselineManifest,
  resolveReleaseIdentity,
} from './release-baseline-manifest.mjs';
import { validateReleaseBaseline } from './validate-release-baseline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(readArg('--out') || join(root, 'artifacts/system-maturity/P6-005'));
const gatesPath = join(root, 'plans/system-maturity/gates.json');
const version = readArg('--version') || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const ref = readArg('--ref') || process.env.GITHUB_REF;
const commit = readArg('--commit') || process.env.GITHUB_SHA;
const childEnv = { ...process.env, GITHUB_REF: ref || '', GITHUB_SHA: commit || '' };
delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gmu, '').replace(/\n*$/u, '');
  return text ? `${text}\n` : '';
}

function safeName(id) {
  return id.replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

assertCleanReleaseTree(root);
const identity = resolveReleaseIdentity({ root, version, ref, commit });
const firstManifest = createReleaseBaselineManifest({ root, ...identity, checkClean: false });
const secondManifest = createReleaseBaselineManifest({ root, ...identity, checkClean: false });
if (firstManifest !== secondManifest) throw new Error('source manifest regeneration changed bytes');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'gates'), { recursive: true });
const manifestPath = join(outDir, 'release-source-manifest.json');
writeFileSync(manifestPath, firstManifest);

const gatesText = readFileSync(gatesPath, 'utf8');
const required = JSON.parse(gatesText).loops.release.commands;
const gateRuns = [];
for (const gate of required) {
  console.log(`[P6-005 evidence] RUN ${gate.id}: ${gate.run}`);
  const result = spawnSync(gate.run, {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    shell: true,
    timeout: 60 * 60 * 1000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = normalize(result.stdout);
  const stderr = normalize(
    [result.stderr || '', result.error ? `${result.error.stack || result.error}\n` : ''].join(''),
  );
  const name = safeName(gate.id);
  const stdoutPath = `gates/${name}.stdout.txt`;
  const stderrPath = `gates/${name}.stderr.txt`;
  writeFileSync(join(outDir, stdoutPath), stdout);
  writeFileSync(join(outDir, stderrPath), stderr);
  const exitCode = result.status ?? 1;
  gateRuns.push({
    id: gate.id,
    command: gate.run,
    exitCode,
    stdoutPath,
    stdoutSha256: sha256(stdout),
    stderrPath,
    stderrSha256: sha256(stderr),
  });
  console.log(`[P6-005 evidence] ${exitCode === 0 ? 'PASS' : 'FAIL'} ${gate.id} exit=${exitCode}`);
}

const evidencePath = join(outDir, 'release-gate-evidence.json');
writeFileSync(
  evidencePath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      taskId: 'P6-005',
      version: identity.version,
      ref: identity.ref,
      commit: identity.commit,
      tree: identity.tree,
      manifestSha256: sha256(firstManifest),
      gatesConfigSha256: sha256(gatesText),
      gates: gateRuns,
    },
    null,
    2,
  )}\n`,
);

let validation;
try {
  validation = validateReleaseBaseline({
    root,
    manifestPath,
    evidencePath,
    gatesPath,
    ...identity,
    evidenceOnly: true,
  });
} catch (error) {
  validation = { error: error instanceof Error ? error.message : String(error) };
}

const acceptance = [
  { id: 'A1', title: 'clean tree and ref/commit binding are enforced', status: 'passed' },
  {
    id: 'A2',
    title: 'all required full release gates have zero-exit hash-addressed evidence',
    status: gateRuns.every((gate) => gate.exitCode === 0) && !validation.error ? 'passed' : 'failed',
  },
  {
    id: 'A3',
    title: 'release source manifest regenerates byte-for-byte',
    status: firstManifest === secondManifest ? 'passed' : 'failed',
  },
];
writeFileSync(
  join(outDir, 'acceptance-matrix.json'),
  `${JSON.stringify({ schemaVersion: 1, taskId: 'P6-005', identity, acceptance, validation }, null, 2)}\n`,
);

const files = {};
for (const path of [
  'release-source-manifest.json',
  'release-gate-evidence.json',
  'acceptance-matrix.json',
  ...gateRuns.flatMap((gate) => [gate.stdoutPath, gate.stderrPath]),
]) {
  const bytes = readFileSync(join(outDir, path));
  files[path] = { bytes: bytes.length, sha256: sha256(bytes) };
}
writeFileSync(
  join(outDir, 'evidence-index.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      taskId: 'P6-005',
      root: relative(root, outDir).replaceAll('\\', '/'),
      files,
    },
    null,
    2,
  )}\n`,
);

if (validation.error || acceptance.some((item) => item.status !== 'passed')) process.exit(1);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
