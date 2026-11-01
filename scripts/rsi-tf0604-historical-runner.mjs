#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildHistoricalTrialPlan, writeHistoricalManifest, runHistoricalTrial, regradeHistoricalTrial, recoverHistoricalTrial, checkHistoricalRun, retainHistoricalRun } from './lib/agent-first-trials.mjs';
import { removeScratchTree } from './lib/rsi-trial-scratch.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const tmp = path + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, path); };
if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'run-dir': { type: 'string' }, root: { type: 'string' }, 'dependencies-root': { type: 'string' }, 'trial-id': { type: 'string' }, 'trial-ids': { type: 'string' }, limit: { type: 'string' }, model: { type: 'string' }, 'retain-dir': { type: 'string' }, restart: { type: 'boolean' }, 'timeout-minutes': { type: 'string' }, concurrency: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? process.cwd());
    const runDir = resolve(values['run-dir'] ?? 'D:/tmp/rsi-tf0604-system-trials');
    const command = positionals[0];
    let result;
    if (command === 'plan') result = writeHistoricalManifest(runDir, { root, dependenciesRoot: values['dependencies-root'] ? resolve(values['dependencies-root']) : undefined, model: values.model, timeoutMs: values['timeout-minutes'] ? Number(values['timeout-minutes']) * 60000 : undefined, concurrency: values.concurrency ? Number(values.concurrency) : undefined });
    else if (command === 'list') { const plan=buildHistoricalTrialPlan(root); result={caseCount:plan.corpus.tasks.length,heldOutDigest:plan.splitDigest,trials:plan.trials.length}; }
    else if (command === 'regrade') {
      if (!values['trial-id']) throw new Error('regrade requires --trial-id');
      const trialId = values['trial-id'];
      const manifest = read(join(runDir,'manifest.json'));
      const manifestDigest = 'sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex');
      const progress = read(join(runDir,'progress.json'));
      if (progress.manifestDigest !== manifestDigest) throw new Error('historical manifest changed');
      const resultPath = join(runDir,'trials',trialId,'historical-result.json');
      const priorDigest = progress.recordDigests[trialId];
      const actualPrior = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex');
      if (priorDigest !== actualPrior) throw new Error('sealed historical result changed before regrade');
      result = await regradeHistoricalTrial(runDir, { root, trialId, dependenciesRoot: values['dependencies-root'] ? resolve(values['dependencies-root']) : undefined });
      const digest = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex');
      progress.recordDigests[trialId] = digest;
      write(join(runDir,'progress.json'), progress);
    }
    else if (command === 'recover') {
      const rawIds = values['trial-ids'] ?? values['trial-id'];
      if (!rawIds) throw new Error('recover requires --trial-id or --trial-ids');
      const ids = String(rawIds).split(',').map((id) => id.trim()).filter(Boolean);
      if (!ids.length || new Set(ids).size !== ids.length) throw new Error('recover trial ids must be unique');
      const progress = read(join(runDir,'progress.json'));
      const manifestDigest = 'sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex');
      if (progress.manifestDigest !== manifestDigest) throw new Error('historical manifest changed');
      for (const trialId of ids) {
        const resultPath = join(runDir,'trials',trialId,'historical-result.json');
        const archivePath = join(runDir,'trials',trialId,'attempt1','historical-result.json');
        const sealSource = existsSync(resultPath) ? resultPath : archivePath;
        const actualPrior = 'sha256:' + createHash('sha256').update(readFileSync(sealSource)).digest('hex');
        if (progress.recordDigests[trialId] !== actualPrior) throw new Error('sealed historical result changed before recover: ' + trialId);
      }
      const recovered = await Promise.all(ids.map((trialId) => recoverHistoricalTrial(runDir, { root, trialId, dependenciesRoot: values['dependencies-root'] ? resolve(values['dependencies-root']) : undefined })));
      const latest = read(join(runDir,'progress.json'));
      for (const trialId of ids) {
        const resultPath = join(runDir,'trials',trialId,'historical-result.json');
        latest.recordDigests[trialId] = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex');
      }
      write(join(runDir,'progress.json'), latest);
      result = recovered;
    }
    else if (command === 'run') {
      const manifest = read(join(runDir,'manifest.json'));
      const progress = read(join(runDir,'progress.json'));
      const manifestDigest = 'sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex');
      if (progress.manifestDigest !== manifestDigest) throw new Error('historical manifest changed');
      for (const trialId of progress.completed) { const resultPath = join(runDir,'trials',trialId,'historical-result.json'); const actual = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex'); if (progress.recordDigests[trialId] !== actual) throw new Error('sealed historical result changed'); }
      const limit = values.limit ? Number(values.limit) : undefined;
      if (values.restart) {
        for (const entry of manifest.trials) {
          if (progress.completed.includes(entry.trialId)) continue;
          const dir = join(runDir, 'trials', entry.trialId);
          if (existsSync(dir)) { removeScratchTree(dir); console.error('[restart] cleared ' + entry.trialId); }
        }
      }
      let executed = 0;
      const queue = manifest.trials.filter((trial) => values['trial-id'] ? trial.trialId === values['trial-id'] : true).filter((trial) => !progress.completed.includes(trial.trialId));
      let cursor = 0;
      const workers = Array.from({ length: Math.max(1, manifest.envelope.concurrency ?? 1) }, async () => {
        while (true) {
          if (limit && executed >= limit) return;
          const at = cursor++; if (at >= queue.length) return;
          const entry = queue[at];
          const trial = await runHistoricalTrial(runDir, { root, trialId: entry.trialId });
          const resultPath = join(runDir,'trials',entry.trialId,'historical-result.json');
          const digest = 'sha256:' + createHash('sha256').update(readFileSync(resultPath)).digest('hex');
          progress.completed.push(entry.trialId); progress.recordDigests[entry.trialId]=digest; write(join(runDir,'progress.json'),progress); executed++;
          console.log(JSON.stringify({trialId:entry.trialId,failureClass:trial.failureClass,grader:trial.grader?.verdict ?? 'unknown'}));
        }
      });
      await Promise.all(workers);
      result=checkHistoricalRun(runDir,{root});
    } else if (command === 'retain') { if (!values['retain-dir']) throw new Error('retain-dir is required'); result=retainHistoricalRun(runDir, values['retain-dir'], { root }); }
    else if (command === 'check') result=checkHistoricalRun(runDir,{root});
    else throw new Error('use plan, list, run, retain or check');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode=1; }
}
