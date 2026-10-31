#!/usr/bin/env node
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildHistoricalTrialPlan, writeHistoricalManifest, runHistoricalTrial, checkHistoricalRun } from './lib/agent-first-trials.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const tmp = path + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, path); };
if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'run-dir': { type: 'string' }, root: { type: 'string' }, 'dependencies-root': { type: 'string' }, 'trial-id': { type: 'string' }, limit: { type: 'string' }, model: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? process.cwd());
    const runDir = resolve(values['run-dir'] ?? 'D:/tmp/rsi-tf0604-system-trials');
    const command = positionals[0];
    let result;
    if (command === 'plan') result = writeHistoricalManifest(runDir, { root, dependenciesRoot: values['dependencies-root'] ? resolve(values['dependencies-root']) : undefined, model: values.model });
    else if (command === 'list') { const plan=buildHistoricalTrialPlan(root); result={caseCount:plan.corpus.tasks.length,heldOutDigest:plan.splitDigest,trials:plan.trials.length}; }
    else if (command === 'run') {
      const manifest = read(join(runDir,'manifest.json'));
      const progress = read(join(runDir,'progress.json'));
      const manifestDigest = 'sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex');
      if (progress.manifestDigest !== manifestDigest) throw new Error('historical manifest changed');
      for (const trialId of progress.completed) { const resultPath = join(runDir,'trials',trialId,'historical-result.json'); const actual = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex'); if (progress.recordDigests[trialId] !== actual) throw new Error('sealed historical result changed'); }
      const limit = values.limit ? Number(values.limit) : undefined;
      let executed = 0;
      for (const entry of manifest.trials.filter((trial) => values['trial-id'] ? trial.trialId === values['trial-id'] : true)) {
        if (progress.completed.includes(entry.trialId)) continue;
        if (limit && executed >= limit) break;
        const trial = await runHistoricalTrial(runDir, { root, trialId: entry.trialId });
        const resultPath = join(runDir,'trials',entry.trialId,'historical-result.json');
        const digest = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex');
        progress.completed.push(entry.trialId); progress.recordDigests[entry.trialId]=digest; write(join(runDir,'progress.json'),progress); executed++;
        console.log(JSON.stringify({trialId:entry.trialId,failureClass:trial.failureClass,grader:trial.grader?.verdict ?? 'unknown'}));
      }
      result=checkHistoricalRun(runDir,{root});
    } else if (command === 'check') result=checkHistoricalRun(runDir,{root});
    else throw new Error('use plan, list, run or check');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode=1; }
}
