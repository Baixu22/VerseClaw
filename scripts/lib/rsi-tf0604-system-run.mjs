import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { checkHistoricalRun } from '../lib/agent-first-trials.mjs';

export const TF0604_SYSTEM_RUN_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run';
export const TF0604_SYSTEM_RUN_ACTOR = 'codex/tf0604-system-runner';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []);
}

/**
 * Copy only named, audit-relevant evidence from a finished historical run into a
 * tracked pack: manifest, progress, aggregate, per-trial result, agent output and
 * grader receipts. Never copies node_modules, caches, credentials or whole checkouts.
 */
export function preserveTrialEvidence(runDir, outputDir, options = {}) {
  const root = options.root ?? process.cwd();
  const run = resolve(runDir);
  const out = resolve(outputDir);
  const report = checkHistoricalRun(run, { root, write: false });
  const manifest = read(join(run, 'manifest.json'));
  const progress = read(join(run, 'progress.json'));
  const files = new Map();
  const add = (name, bytes) => files.set(name.replaceAll('\\', '/'), Buffer.from(bytes));
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
    if (!target.startsWith(out)) throw new Error(`escape: ${name}`);
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
