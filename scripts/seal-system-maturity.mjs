#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label, command, args) {
  console.log(`maturity:seal step=${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: true,
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`maturity:seal FAILED at ${label} exit=${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

// Index first; hash-sync before validate because validate includes evidence checks.
run('sync-index', 'node', ['scripts/sync-system-maturity-index.mjs']);
run('hash-sync-pre', 'node', ['scripts/update-system-maturity-delivery-hashes.mjs']);
run('validate', 'pnpm', ['maturity:validate']);
// Validate may rewrite baseline/plan reports; seal hashes again for consistency.
run('hash-sync-post', 'node', ['scripts/update-system-maturity-delivery-hashes.mjs']);
run('evidence', 'pnpm', ['maturity:evidence']);
console.log('maturity:seal: OK');
