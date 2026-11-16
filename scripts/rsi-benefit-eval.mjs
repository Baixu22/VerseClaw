#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { adoptLiveCalibration, checkBenefitRun, recordMeasuredBenefitTrials, runOfflineBenefit, sealBenefitRun, writeBenefitPlan } from './lib/rsi-benefit-eval.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      'run-dir': { type: 'string' }, endpoint: { type: 'string' }, model: { type: 'string' }, actor: { type: 'string' },
      limit: { type: 'string' }, json: { type: 'boolean' },
      mode: { type: 'string' }, 'candidate-file': { type: 'string' }, 'max-provider-calls': { type: 'string' },
      'max-total-tokens': { type: 'string' }, receipt: { type: 'string' }, 'calibration-dir': { type: 'string' },
      'coding-collector': { type: 'boolean' },
      'collector-version': { type: 'string' },
      'candidate-evolution': { type: 'string' }, 'candidate-generation': { type: 'string' },
    } });
    const command = positionals[0];
    if (!values['run-dir'] || positionals.length !== 1 || !['plan', 'offline', 'calibrate', 'record', 'report', 'check'].includes(command)) {
      throw new Error('Usage: node scripts/rsi-benefit-eval.mjs <plan|offline|calibrate|record|report|check> --run-dir <new/retained directory> [--endpoint URL --model ID]');
    }
    const directory = resolve(values['run-dir']);
    let result;
    if (command === 'plan') {
      const plan = writeBenefitPlan(ROOT, directory, { endpoint: values.endpoint, model: values.model, actor: values.actor,
        mode: values.mode, candidate: values['candidate-file'] ? JSON.parse(readFileSync(values['candidate-file'], 'utf8')) : undefined,
        maxProviderCalls: values['max-provider-calls'] ? Number(values['max-provider-calls']) : undefined,
        maxTotalTokens: values['max-total-tokens'] ? Number(values['max-total-tokens']) : undefined,
        codingCollector: values['coding-collector'], collectorVersion: values['collector-version'],
        candidateEvolution: values['candidate-evolution'] ? JSON.parse(readFileSync(values['candidate-evolution'], 'utf8')) : undefined,
        candidateGeneration: values['candidate-generation'] ? Number(values['candidate-generation']) : undefined });
      result = { passed: true, runId: plan.runId, trials: plan.slots.length, provider: plan.provider, budget: plan.budget };
    } else if (command === 'offline') {
      const execution = runOfflineBenefit(ROOT, directory, { limit: values.limit === undefined ? undefined : Number(values.limit) });
      const report = sealBenefitRun(ROOT, directory);
      result = { passed: true, execution, status: report.status, benefit: report.benefit };
    } else if (command === 'calibrate') {
      if (!values['calibration-dir']) throw new Error('--calibration-dir is required');
      result = { passed: true, ...adoptLiveCalibration(ROOT, directory, values['calibration-dir']) };
    } else if (command === 'record') {
      if (!values.receipt) throw new Error('--receipt is required');
      const input = JSON.parse(readFileSync(values.receipt, 'utf8'));
      const trials = recordMeasuredBenefitTrials(ROOT, directory, Array.isArray(input) ? input : [input]);
      result = { passed: true, recorded: trials.length, trials: trials.map((trial) => ({ trialId: trial.row.slot.id, outcome: trial.outcome })) };
    } else if (command === 'report') result = sealBenefitRun(ROOT, directory, values.actor);
    else result = checkBenefitRun(ROOT, directory);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed === false ? 1 : 0;
  } catch (caught) { console.error(caught.message); process.exitCode = 1; }
}
