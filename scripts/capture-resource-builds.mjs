#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveMixedToolchain } from './lib/resource-mixed-measurement.mjs';

const { values } = parseArgs({ options: { before: { type: 'string' }, after: { type: 'string' }, builds: { type: 'string' }, output: { type: 'string' } } });
assert(values.before && values.after && values.builds && values.output, '--before, --after, --builds and --output required');
const roots = { before: resolve(values.before), after: resolve(values.after) };
const builds = JSON.parse(readFileSync(values.builds, 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : entry.isFile() ? [join(root, entry.name)] : []);
const git = (cwd, ...args) => { const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const products = {};
for (const [variant, root] of Object.entries(roots)) {
  const steps = builds.filter(step => step.variant === (variant === 'before' ? 'baseline' : 'candidate'));
  assert.equal(steps.length, 7); assert(steps.every(step => step.exitCode === 0));
  assert.equal(git(root, 'status', '--porcelain'), ''); assert.equal(git(root, 'rev-parse', 'HEAD'), steps[0].commit);
  const artifacts = ['dist', 'dist-electron', 'openclaw_runtime/dist', 'packages/versebrowser/dist'].flatMap(directory => files(join(root, directory))).sort();
  products[variant] = { source: steps[0].commit, tree: git(root, 'rev-parse', 'HEAD^{tree}'), files: artifacts.map(path => ({ path: relative(root, path).replaceAll('\\', '/'), bytes: statSync(path).size, sha256: digest(path) })) };
}
const executables = resolveMixedToolchain().map(file => ({ ...file, bytes: statSync(file.path).size, sha256: digest(file.path) }));
const report = { driven_by: 'agent', actor: 'codex', capturedAt: new Date().toISOString(), products, executables };
writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ files: Object.fromEntries(Object.entries(products).map(([key, value]) => [key, value.files.length])), executables: executables.length }));
