#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCleanReleaseTree,
  createReleaseBaselineManifest,
  resolveReleaseIdentity,
} from './release-baseline-manifest.mjs';
import {
  canonicalReleaseConfigText,
  validateReleaseBaseline,
} from './validate-release-baseline.mjs';
import { normalizeCapturedOutput } from './lib/captured-output-redaction.mjs';
import { runReleaseGateCommand } from './lib/run-release-gate-command.mjs';
import { prepareAcceptanceArtifacts } from './lib/acceptance-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(readArg('--out') || process.env.CLAWX_RELEASE_BASELINE_OUT || join(root, 'artifacts/system-maturity/P6-005'));
const gatesPath = join(root, 'plans/system-maturity/gates.json');
const version = readArg('--version') || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const ref = readArg('--ref') || process.env.GITHUB_REF;
const commit = readArg('--commit') || process.env.GITHUB_SHA;
const artifactRoot = join(outDir, 'artifacts');
const childEnv = {
  ...process.env, GITHUB_REF: ref || '', GITHUB_SHA: commit || '',
  CLAWX_ACCEPTANCE_ARTIFACT_ROOT: artifactRoot,
  SYSTEM_MATURITY_SECURITY_OUT: join(artifactRoot, 'system-maturity/P7-002'),
  CLAWX_E2E_EVIDENCE_ROOT: join(outDir, 'e2e'),
};
delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gmu, '').replace(/\n*$/u, '');
  return normalizeCapturedOutput(text, {
    workspaceRoot: root,
    userHome: process.env.USERPROFILE || homedir(),
  });
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
prepareAcceptanceArtifacts(root, artifactRoot);
const manifestPath = join(outDir, 'release-source-manifest.json');
writeFileSync(manifestPath, firstManifest);

function captureCommand(id, command) {
  console.log(`[P6-005 evidence] RUN ${id}: ${command}`);
  const env = { ...childEnv };
  if (id === 'test') {
    delete env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT;
    delete env.CLAWX_RELEASE_BASELINE_OUT;
  }
  const result = runReleaseGateCommand(command, {
    cwd: root,
    env,
    timeout: 60 * 60 * 1000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = normalize(result.stdout);
  const stderr = normalize(
    [result.stderr || '', result.error ? `${result.error.stack || result.error}\n` : ''].join(''),
  );
  const name = safeName(id);
  const stdoutPath = `gates/${name}.stdout.txt`;
  const stderrPath = `gates/${name}.stderr.txt`;
  writeFileSync(join(outDir, stdoutPath), stdout);
  writeFileSync(join(outDir, stderrPath), stderr);
  const exitCode = result.status ?? 1;
  console.log(`[P6-005 evidence] ${exitCode === 0 ? 'PASS' : 'FAIL'} ${id} exit=${exitCode}`);
  return {
    id,
    command,
    exitCode,
    stdoutPath,
    stdoutSha256: sha256(stdout),
    stderrPath,
    stderrSha256: sha256(stderr),
  };
}

const preflight = captureCommand('runtime-build-preflight', 'pnpm build:runtime');
assertCleanReleaseTree(root);

const gatesText = readFileSync(gatesPath, 'utf8');
const required = JSON.parse(gatesText).loops.release.commands;
const gateRuns = [];
for (const gate of required) {
  gateRuns.push(captureCommand(gate.id, gate.run));
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
      gatesConfigSha256: sha256(canonicalReleaseConfigText(gatesText)),
      preflight,
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
    title: 'runtime preflight and all required full release gates have zero-exit hash-addressed evidence',
    status: preflight.exitCode === 0
      && gateRuns.every((gate) => gate.exitCode === 0)
      && !validation.error
      ? 'passed'
      : 'failed',
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
function retainedFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? retainedFiles(join(directory, entry.name), path) : [path];
  });
}
for (const path of retainedFiles(outDir)) {
  const bytes = readFileSync(join(outDir, path));
  files[path] = { bytes: bytes.length, sha256: sha256(bytes) };
}
writeFileSync(
  join(outDir, 'evidence-index.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      schema: 'clawx.release-baseline-evidence/v1',
      taskId: 'P6-005',
      candidate: identity,
      ok: !validation.error && acceptance.every((item) => item.status === 'passed'),
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
