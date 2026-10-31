#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { replayRubricCalibration, reviewTrialRun } from './lib/agent-first-transcript-review.mjs';

if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, 'run-dir': { type: 'string' }, actor: { type: 'string' }, out: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? resolve(import.meta.dirname, '..'));
    const report = positionals[0] === 'calibration' ? replayRubricCalibration(root)
      : positionals[0] === 'run' && values['run-dir'] ? reviewTrialRun(root, resolve(values['run-dir']), values.actor) : null;
    if (!report) throw new Error('use calibration or run --run-dir');
    if (values.out) { const path = resolve(values.out); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
    const calibration = positionals[0] === 'calibration' ? report : report.rubricCalibration;
    console.log(JSON.stringify({ schemaVersion: report.schemaVersion, calibrationRows: calibration?.rows?.length, counts: report.counts, reviewedTrials: report.reviewedTrials, complete: report.complete, agreementRate: calibration?.agreementRate }));
    if (report.counts?.fail || report.counts?.unknown) process.exitCode = 1;
  } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
