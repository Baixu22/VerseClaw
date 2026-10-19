#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_ROOTS = ['tests', 'openclaw_runtime/src', 'openclaw_runtime/test'];
const SOURCE_ROOTS = ['electron/gateway', 'electron/services'];
const BASELINE = { 'electron/gateway': 27, 'electron/services': 75 };

async function listFiles(dir, predicate) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && predicate(full, entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(path.join(ROOT, dir));
  return out;
}

function sourceName(file) {
  return path.basename(file).replace(/\.(ts|tsx)$/, '');
}

export async function collectCoverageBaselineErrors() {
  const testFiles = [];
  for (const root of TEST_ROOTS) {
    testFiles.push(...await listFiles(root, (_full, name) => /\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(name)));
  }
  const testText = (await Promise.all(testFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  const failures = [];
  const actual = {};
  for (const dir of SOURCE_ROOTS) {
    const sources = await listFiles(dir, (_full, name) => /\.(ts|tsx)$/.test(name) && !/\.(test|spec|d)\.ts$/.test(name));
    const referenced = sources.filter((file) => testText.includes(sourceName(file)));
    actual[dir] = referenced.length;
    const minimum = BASELINE[dir];
    if (referenced.length < minimum) {
      failures.push(`${dir}: ${referenced.length} referenced source files, baseline is ${minimum}`);
    }
  }
  return { failures, actual };
}

async function main() {
  const { failures, actual } = await collectCoverageBaselineErrors();
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }
  console.log(`[test-coverage] gateway=${actual['electron/gateway']} services=${actual['electron/services']} meet baseline`);
}

if (isMainEntrypoint(import.meta.url)) await main();
