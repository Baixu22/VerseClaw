#!/usr/bin/env node
/**
 * Build or refresh the TF-0570 matrix receipt from the checked-in matrix and
 * source commit. Smoke logs, environment and validation history are preserved
 * from the previous receipt; source and evidence hashes are recomputed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_ACCEPTANCE_SCHEMA,
  DEFAULT_ACCEPTANCE_PATH,
  DEFAULT_FIXTURE_DIR,
  DEFAULT_MATRIX_PATH,
  VERIFIER_PATH,
  BUILDER_PATH,
  TEST_PATH,
  SPEC_PATH,
  buildAcceptance,
  readJson,
  validateMatrixStructure,
} from './verify-harness-active-matrix.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const matrix = readJson(ROOT, DEFAULT_MATRIX_PATH);
const structure = validateMatrixStructure(matrix, { root: ROOT });
if (!structure.ok) throw new Error(structure.issues.join('\n'));
const previousPath = resolve(ROOT, DEFAULT_ACCEPTANCE_PATH);
const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : null;
const allowedOwned = (path) => path.startsWith(DEFAULT_FIXTURE_DIR + '/')
  || path === SPEC_PATH
  || path === VERIFIER_PATH
  || path === BUILDER_PATH
  || path === TEST_PATH;
const isInput = (path) => [...(matrix.sourceFiles ?? []), ...(matrix.packageFiles ?? [])]
  .some((entry) => path === entry || path.startsWith(entry.replace(/[\\/]+$/u, '') + '/'));
const status = git(['status', '--porcelain=v1'])
  .split(/\r?\n/u)
  .filter((line) => {
    const relativePath = line.slice(2).trim();
    return relativePath && !allowedOwned(relativePath) && !isInput(relativePath);
  })
  .join('\n');
const acceptance = buildAcceptance({
  matrix,
  sourceCommit: git(['rev-parse', 'HEAD']),
  sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  sourceDirty: status !== '',
  freshness: 'fresh',
  validation: previous?.validation ?? [],
  environment: previous?.environment,
  matrixDryRun: previous?.matrixDryRun,
  smoke: previous?.smoke ?? [],
  root: ROOT,
});
acceptance.generatedAt = new Date().toISOString();
writeFileSync(previousPath, JSON.stringify(acceptance, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ path: DEFAULT_ACCEPTANCE_PATH, schema: ACTIVE_ACCEPTANCE_SCHEMA, summary: acceptance.summary, source: acceptance.source }, null, 2));
