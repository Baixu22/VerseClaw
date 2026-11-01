import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkHistoricalRun } from '../lib/agent-first-trials.mjs';

export const TF0604_SYSTEM_RUN_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run';
export const TF0604_SYSTEM_RUN_ACTOR = 'codex/tf0604-system-runner';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const err = (code, message) => ({ code, message });
const rel = (path) => path.split('\\').join('/');

const INLINE_LOG_FILES = ['agent.stdout.log', 'agent.stderr.log'];
const MAX_INLINE_LOG_BYTES = 64 * 1024;
const EXCERPT_BYTES = 32 * 1024;

export function excerptLog(bytes) {
  const head = bytes.subarray(0, EXCERPT_BYTES);
  const tail = bytes.subarray(bytes.length - EXCERPT_BYTES);
  const marker = `\n... [truncated: ${bytes.length} bytes total, head+tail ${EXCERPT_BYTES} bytes retained; full sha256 ${sha256(bytes)}] ...\n`;
  return Buffer.concat([head, Buffer.from(marker, 'utf8'), tail]);
}

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
  const trialIds = new Set(progress.completed ?? []);

  // Never mix two runs, and never leave an orphan trial directory behind: a stale
  // directory would break the SHA256SUMS coverage check in a fresh checkout.
  const existingManifestPath = join(out, 'manifest.json');
  if (existsSync(existingManifestPath)) {
    const sameRun = read(existingManifestPath).runId === manifest.runId;
    if (!sameRun && !options.replace) throw new Error(`refusing to overwrite a different run pack: ${out}`);
    if (sameRun && !options.replace) {
      for (const entry of readdirSync(out, { withFileTypes: true })) {
        if (entry.isDirectory() && !trialIds.has(entry.name)) rmSync(join(out, entry.name), { recursive: true, force: true });
      }
    } else {
      rmSync(out, { recursive: true, force: true });
    }
  }

  const files = new Map();
  const add = (name, bytes) => files.set(rel(name), Buffer.from(bytes));
  add('manifest.json', readFileSync(join(run, 'manifest.json')));
  add('progress.json', readFileSync(join(run, 'progress.json')));
  add('aggregate.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  for (const name of ['progress.pre-reconcile.json', 'regrade-reconciliation.json', 'run-exclusions.json']) {
    const path = join(run, name);
    if (existsSync(path)) add(name, readFileSync(path));
  }
  for (const trialId of progress.completed) {
    const dir = join(run, 'trials', trialId);
    add(join(trialId, 'historical-result.json'), readFileSync(join(dir, 'historical-result.json')));
    for (const name of ['historical-result.pre-regrade.json', 'agent-last.json']) {
      const path = join(dir, name);
      if (existsSync(path)) add(join(trialId, name), readFileSync(path));
    }
    const logEntries = [];
    for (const name of INLINE_LOG_FILES) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const bytes = readFileSync(path);
      if (bytes.length > MAX_INLINE_LOG_BYTES) {
        const excerpt = excerptLog(bytes);
        add(join(trialId, name + '.excerpt'), excerpt);
        logEntries.push({ file: name, bytes: bytes.length, sha256: sha256(bytes), stored: name + '.excerpt', excerptBytes: excerpt.length, truncated: true });
      } else {
        add(join(trialId, name), bytes);
        logEntries.push({ file: name, bytes: bytes.length, sha256: sha256(bytes), stored: name, excerptBytes: bytes.length, truncated: false });
      }
    }
    if (logEntries.length) {
      add(join(trialId, 'agent-log-manifest.json'), Buffer.from(JSON.stringify({
        schemaVersion: 'RsiAgentLogManifest/v1', driven_by: 'agent', actor: TF0604_SYSTEM_RUN_ACTOR,
        truncated: logEntries.some((entry) => entry.truncated), logs: logEntries,
      }, null, 2) + '\n'));
    }
    const result = read(join(dir, 'historical-result.json'));
    const oracleDirectory = result.grader?.oracleDirectory;
    if (oracleDirectory && existsSync(oracleDirectory)) {
      for (const path of walk(oracleDirectory)) add(join(trialId, 'oracle', relative(oracleDirectory, path)), readFileSync(path));
    }
    const attemptDir = join(dir, 'attempt1');
    if (existsSync(attemptDir)) {
      for (const path of walk(attemptDir)) add(join(trialId, 'attempt1', relative(attemptDir, path)), readFileSync(path));
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
    directory: out, manifestDigest: progress.manifestDigest, runId: manifest.runId,
    recordedTrials: report.recordedTrials, expectedTrials: report.expectedTrials,
    completeCaseCount: report.completeCaseCount, failureClasses: report.failureClasses,
    fileCount: files.size, complete: report.complete, claims: manifest.claims,
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
    listed.set(rel(match[2]), match[1]);
  }
  const onDisk = walk(dir).map((path) => rel(relative(dir, path))).filter((name) => name !== 'SHA256SUMS').sort();
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
    catch { errors.push(err('missing-result', trialId)); continue; }
    if (result.schemaVersion !== 'RsiHistoricalTrialResult/v1' || result.driven_by !== 'agent') errors.push(err('result-producer', trialId));
    if (result.trialId !== trialId) errors.push(err('result-identity', trialId));
    if (!['baseline', 'treatment'].includes(result.arm)) errors.push(err('result-arm', trialId));
    const verdict = result.grader?.verdict;
    // A trial that died before grading produced a verdict has no receipts to seal. Re-running it
    // until the flake threshold appears to pass is not evidence, so an unscored failure is sealed
    // with its recorded stage and error text and its case is reported incomplete instead.
    const unscoredFailure = !['pass', 'fail', 'unknown'].includes(verdict ?? '')
      && typeof result.stage === 'string' && result.stage.length > 0
      && typeof result.error === 'string' && result.error.trim().length > 0;
    if (!unscoredFailure && !['pass', 'fail', 'unknown'].includes(verdict)) errors.push(err('result-verdict', trialId));
    if (!unscoredFailure && verdict === 'pass' && result.failureClass) errors.push(err('failure-class-on-pass', trialId));
    if (!unscoredFailure && verdict !== 'pass' && !['infrastructure', 'task', 'grader', 'agent'].includes(result.failureClass ?? '')) errors.push(err('unclassified-failure', trialId));
    if (unscoredFailure && !['infrastructure', 'task', 'grader', 'agent'].includes(result.failureClass ?? '')) errors.push(err('unclassified-failure', trialId));
    if (result.claims?.realHuman !== false) errors.push(err('claim-boundary', trialId));
    const oracleDir = join(dir, trialId, 'oracle');
    const receipts = existsSync(oracleDir) ? walk(oracleDir).filter((path) => path.endsWith('execution-receipt.json')) : [];
    if (!receipts.length && !unscoredFailure) errors.push(err('missing-receipt', trialId));
    for (const receiptPath of receipts) {
      const receipt = read(receiptPath);
      if (receipt.producerRole !== 'grader-owned-runner' || receipt.driven_by !== 'agent') errors.push(err('receipt-producer', trialId));
      if (receipt.sourceInputsVerified !== true || receipt.testsMutated === true) errors.push(err('receipt-inputs', trialId));
    }
    const logManifestPath = join(dir, trialId, 'agent-log-manifest.json');
    if (existsSync(logManifestPath)) {
      const logManifest = read(logManifestPath);
      if (logManifest.schemaVersion !== 'RsiAgentLogManifest/v1' || logManifest.driven_by !== 'agent') errors.push(err('log-manifest', trialId));
      for (const entry of logManifest.logs ?? []) {
        const storedPath = entry.stored ? join(dir, trialId, entry.stored) : null;
        if (!storedPath || !existsSync(storedPath)) { errors.push(err('log-missing', trialId + ':' + (entry.stored ?? '?'))); continue; }
        const storedBytes = readFileSync(storedPath);
        if (entry.truncated === true) {
          if (!(Number(entry.bytes) > Number(entry.excerptBytes)) || storedBytes.length !== Number(entry.excerptBytes)) errors.push(err('log-excerpt', trialId + ':' + entry.stored));
        } else if (sha256(storedBytes) !== entry.sha256) errors.push(err('log-digest', trialId + ':' + entry.stored));
      }
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
