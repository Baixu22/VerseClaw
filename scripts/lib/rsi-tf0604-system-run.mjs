import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkHistoricalRun } from '../lib/agent-first-trials.mjs';

export const TF0604_SYSTEM_RUN_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run';
export const TF0604_SYSTEM_RUN_ACTOR = 'codex/tf0604-system-runner';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const err = (code, message) => ({ code, message });

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []);
}

export function preserveTrialEvidence(runDir, outputDir, options = {}) {
  const root = options.root ?? process.cwd();
  const run = resolve(runDir);
  const out = resolve(outputDir);
  const report = checkHistoricalRun(run, { root, write: false });
  const manifest = read(join(run, 'manifest.json'));
  const progress = read(join(run, 'progress.json'));
  const files = new Map();
  const add = (name, bytes) => files.set(name.split('\\').join('/'), Buffer.from(bytes));
  add('manifest.json', readFileSync(join(run, 'manifest.json')));
  add('progress.json', readFileSync(join(run, 'progress.json')));
  add('aggregate.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  for (const trialId of progress.completed) {
    const dir = join(run, 'trials', trialId);
    add(join(trialId, 'historical-result.json'), readFileSync(join(dir, 'historical-result.json')));
    for (const name of ['agent-last.json', 'agent.stdout.log', 'agent.stderr.log']) {
      const path = join(dir, name);
      if (existsSync(path)) add(join(trialId, name), readFileSync(path));
    }
    const result = read(join(dir, 'historical-result.json'));
    const oracleDirectory = result.grader?.oracleDirectory;
    if (oracleDirectory && existsSync(oracleDirectory)) {
      for (const path of walk(oracleDirectory)) add(join(trialId, 'oracle', relative(oracleDirectory, path)), readFileSync(path));
    }
  }
  const sums = [...files.keys()].sort().map((name) => sha256(files.get(name)).concat('  ', name));
  files.set('SHA256SUMS', Buffer.from(sums.join('\n') + '\n'));
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of files) {
    const target = resolve(out, name);
    if (target !== out && !target.startsWith(out + sep)) throw new Error('escape: ' + name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return {
    schemaVersion: 'RsiTf0604SystemRunRetention/v1', driven_by: 'agent', actor: TF0604_SYSTEM_RUN_ACTOR,
    directory: out, manifestDigest: progress.manifestDigest, recordedTrials: report.recordedTrials,
    expectedTrials: report.expectedTrials, completeCaseCount: report.completeCaseCount,
    failureClasses: report.failureClasses, fileCount: files.size, complete: report.complete,
    claims: manifest.claims,
  };
}

export function validateTrialPack(packDir, options = {}) {
  const root = options.root ?? process.cwd();
  const dir = resolve(packDir ?? join(root, TF0604_SYSTEM_RUN_DIR));
  const errors = [];
  let manifest, progress, aggregate;
  try {
    manifest = read(join(dir, 'manifest.json'));
    progress = read(join(dir, 'progress.json'));
    aggregate = read(join(dir, 'aggregate.json'));
  } catch (error) {
    return { schemaVersion: 'RsiTf0604SystemRunValidation/v1', passed: false, errors: [err('missing-pack', String(error.message))], recordedTrials: 0, completeCaseCount: 0 };
  }
  if (manifest.schemaVersion !== 'RsiHistoricalTrialManifest/v1' || manifest.driven_by !== 'agent' || !manifest.actor) errors.push(err('manifest-producer', 'manifest producer is invalid'));
  if (progress.schemaVersion !== 'RsiHistoricalTrialProgress/v1') errors.push(err('progress-schema', 'progress schema is invalid'));
  const manifestDigest = 'sha256:' + sha256(readFileSync(join(dir, 'manifest.json')));
  if (progress.manifestDigest !== manifestDigest) errors.push(err('manifest-digest', 'progress does not bind the on-disk manifest'));
  if (manifest.claims?.realHuman !== false || manifest.claims?.productLocksChanged !== false) errors.push(err('claim-boundary', 'manifest exceeds the agent evidence boundary'));

  const summed = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trimEnd().split(/\r?\n/u);
  const listed = new Map();
  for (const line of summed) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { errors.push(err('sums-format', 'malformed manifest line')); continue; }
    listed.set(match[2].split('\\').join('/'), match[1]);
  }
  const onDisk = walk(dir).map((path) => relative(dir, path).split('\\').join('/')).filter((name) => name !== 'SHA256SUMS').sort();
  if (JSON.stringify([...listed.keys()].sort()) !== JSON.stringify(onDisk)) errors.push(err('sums-coverage', 'SHA256SUMS does not cover exactly the files on disk'));
  for (const name of onDisk) {
    const expected = listed.get(name);
    if (!expected) continue;
    if (sha256(readFileSync(join(dir, name))) !== expected) errors.push(err('digest-mismatch', name));
  }

  const trialIds = progress.completed ?? [];
  if (new Set(trialIds).size !== trialIds.length) errors.push(err('duplicate-trial', 'progress repeats a trial id'));
  for (const trialId of trialIds) {
    let result;
    try { result = read(join(dir, trialId, 'historical-result.json')); }
    catch (error) { errors.push(err('missing-result', trialId)); continue; }
    if (result.schemaVersion !== 'RsiHistoricalTrialResult/v1' || result.driven_by !== 'agent') errors.push(err('result-producer', trialId));
    if (result.trialId !== trialId) errors.push(err('result-identity', trialId));
    if (!['baseline', 'treatment'].includes(result.arm)) errors.push(err('result-arm', trialId));
    const verdict = result.grader?.verdict;
    if (!['pass', 'fail', 'unknown'].includes(verdict)) errors.push(err('result-verdict', trialId));
    if (verdict === 'pass' && result.failureClass) errors.push(err('failure-class-on-pass', trialId));
    if (verdict !== 'pass' && !['infrastructure', 'task', 'grader', 'agent'].includes(result.failureClass ?? '')) errors.push(err('unclassified-failure', trialId));
    if (result.claims?.realHuman !== false) errors.push(err('claim-boundary', trialId));
    const receipts = walk(join(dir, trialId, 'oracle')).filter((path) => path.endsWith('execution-receipt.json'));
    if (!receipts.length) errors.push(err('missing-receipt', trialId));
    for (const receiptPath of receipts) {
      const receipt = read(receiptPath);
      if (receipt.producerRole !== 'grader-owned-runner' || receipt.driven_by !== 'agent') errors.push(err('receipt-producer', trialId));
      if (receipt.sourceInputsVerified !== true || receipt.testsMutated === true) errors.push(err('receipt-inputs', trialId));
    }
  }

  const recorded = aggregate.recordedTrials ?? 0;
  if (recorded !== trialIds.length) errors.push(err('aggregate-count', 'aggregate trial count differs from progress'));
  const expectedRecorded = aggregate.statistics?.run?.trialCount ?? 0;
  if (expectedRecorded !== recorded) errors.push(err('aggregate-recompute', 'aggregate statistics do not match recorded trials'));

  return {
    schemaVersion: 'RsiTf0604SystemRunValidation/v1', passed: errors.length === 0, errors,
    manifestDigest, recordedTrials: trialIds.length, expectedTrials: manifest.trials?.length ?? null,
    completeCaseCount: aggregate.completeCaseCount ?? 0, complete: aggregate.complete === true,
    failureClasses: aggregate.failureClasses ?? null, fileCount: onDisk.length + 1,
  };
}
