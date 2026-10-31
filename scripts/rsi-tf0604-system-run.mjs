#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { preserveTrialEvidence } from './lib/rsi-tf0604-system-run.mjs';

if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'run-dir': { type: 'string' }, 'retain-dir': { type: 'string' }, root: { type: 'string' },
  } });
  const command = positionals[0];
  try {
    const root = resolve(values.root ?? process.cwd());
    if (command !== 'preserve') throw new Error('use preserve');
    if (!values['run-dir'] || !values['retain-dir']) throw new Error('run-dir and retain-dir are required');
    const result = preserveTrialEvidence(resolve(values['run-dir']), resolve(values['retain-dir']), { root });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
