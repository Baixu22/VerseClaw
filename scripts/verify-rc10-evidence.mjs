#!/usr/bin/env node
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { verifyRc10Evidence } from './lib/rc10-evidence.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--evidence' || !argv[1] || argv[1].startsWith('--')) {
    console.error('Usage: node scripts/verify-rc10-evidence.mjs --evidence <directory>');
    return 1;
  }
  try {
    const result = await verifyRc10Evidence(resolve(argv[1]));
    console.log(JSON.stringify({ schema: 'rc10-evidence-integrity-check/v1', driven_by: 'agent', scope: 'integrity-only', ...result }, null, 2));
    return result.ok ? 0 : 1;
  } catch {
    console.error('RC-10 evidence integrity check could not read the bundle');
    return 1;
  }
}

if (isMainEntrypoint(import.meta.url)) process.exitCode = await main();
