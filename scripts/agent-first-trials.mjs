#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createTrialPlan, runTrialPlan, checkTrialRun, retainTrialRun, verifyRetainedRun, verifyTrialAcceptance } from './lib/agent-first-trials.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'run-dir': { type: 'string' }, root: { type: 'string' }, limit: { type: 'string' }, retained: { type: 'boolean' }, out: { type: 'string' }, acceptance: { type: 'string' }, raw: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? resolve(import.meta.dirname, '..'));
    const command = positionals[0];
    if (command === 'verify-acceptance') {
      if (!values.acceptance) throw new Error('--acceptance is required');
      const report = verifyTrialAcceptance(values.acceptance, { root, raw: values.raw });
      console.log(JSON.stringify(report));
    } else {
      if (!values['run-dir']) throw new Error('--run-dir is required');
      const directory = resolve(values['run-dir']);
      mkdirSync(directory, { recursive: true });
      if (values.limit && (!Number.isInteger(Number(values.limit)) || Number(values.limit) <= 0)) throw new Error('--limit must be positive');
      const report = command === 'plan' ? createTrialPlan(root, directory)
        : command === 'run' ? await runTrialPlan(directory, { root, limit: values.limit ? Number(values.limit) : undefined })
        : command === 'check' ? values.retained ? verifyRetainedRun(directory, { root }) : checkTrialRun(directory, { root, write: false })
        : command === 'retain' && values.out ? retainTrialRun(directory, resolve(values.out), { root }) : null;
      if (!report) throw new Error('use plan, run, check or retain --out');
      console.log(JSON.stringify({ schemaVersion: report.schemaVersion, trials: report.trials?.length, complete: report.complete, recordedTrials: report.recordedTrials, status: report.statistics?.status, expectedTrials: report.expectedTrials }));
    }
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}
