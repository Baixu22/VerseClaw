#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, ROOT } from '../harness/src/specs.mjs';

export const TASK_SPEC_ROOT = path.join(ROOT, 'harness', 'specs', 'tasks');
export const LIFECYCLE_STATUSES = Object.freeze(['active', 'completed', 'archived']);

async function listTaskSpecs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listTaskSpecs(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files.sort();
}

export function validateLifecycleStatus(data, specPath = 'spec') {
  const status = data?.lifecycleStatus;
  if (!status) return [`${specPath}: missing required field "lifecycleStatus"`];
  if (!LIFECYCLE_STATUSES.includes(status)) {
    return [`${specPath}: lifecycleStatus must be one of ${LIFECYCLE_STATUSES.join(', ')}`];
  }
  return [];
}

export async function collectTaskSpecLifecycleErrors() {
  const failures = [];
  for (const file of await listTaskSpecs(TASK_SPEC_ROOT)) {
    const relativePath = path.relative(ROOT, file).replaceAll('\\', '/');
    try {
      const spec = parseFrontmatter(await readFile(file, 'utf8'));
      failures.push(...validateLifecycleStatus(spec.data, relativePath));
    } catch (error) {
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function main() {
  const failures = await collectTaskSpecLifecycleErrors();
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }
  console.log(`[specs] lifecycle status present for ${(await listTaskSpecs(TASK_SPEC_ROOT)).length} task specs.`);
}

if (isMainEntrypoint(import.meta.url)) await main();
