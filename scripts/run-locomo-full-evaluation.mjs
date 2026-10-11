import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getRuntimeMemoryLlmConfig } from '../tests/unit/helpers/runtime-memory-real-llm-client.ts';
import { verifyLocomoEmbeddingResources } from '../tests/unit/helpers/locomo-embedding-provider.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The 500-question suite declares a 36h test timeout (extraction is ~10h and
// generation/judging ~25h), so this outer budget must be configurable instead of
// silently truncating a run that is designed to take longer than 90 minutes.
const DEFAULT_TIMEOUT_MINUTES = 90;

// Caches the 500-question suite reads back to skip work a previous run finished.
// They are intermediate state, never evidence: the report is still produced and
// verified from scratch by this run.
const RESUMABLE_CACHE_FILES = [
  'extracted-facts-cache-v6-additive-p0.json',
  'observations-cache.json',
  'session-summary-cache.json',
  'dev-slice-cache.json',
];

export function resolveTimeoutMinutes(raw, fromEnv = process.env.RUNTIME_MEMORY_FULL_TIMEOUT_MINUTES) {
  const value = raw ?? fromEnv;
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MINUTES;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('timeout-minutes must be a positive number of minutes');
  }
  return minutes;
}

/**
 * The suite's own evaluation budget must be strictly smaller than this wrapper's
 * budget, so a run that runs out of time fails as a normal test failure with a
 * report attempt instead of being killed mid-flight by the wrapper.
 */
export function resolveTestTimeoutMinutes(raw, outerMinutes) {
  if (raw === undefined || raw === null || raw === '') return null;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('test-timeout-minutes must be a positive number of minutes');
  }
  if (minutes >= outerMinutes) {
    throw new Error(
      'test-timeout-minutes must be smaller than timeout-minutes so the suite fails on its own budget instead of being killed by the wrapper',
    );
  }
  return minutes;
}

/**
 * Copies resumable caches out of a previous run directory into a fresh one.
 *
 * `sourceRevision` is required: a cache may only be reused when the run that
 * produced it is named, so a resumed report can always be traced back to the
 * revisions that contributed to it.
 */
export function seedResumeCaches(resumeFrom, output, sourceRevision) {
  if (typeof sourceRevision !== 'string' || !sourceRevision.trim()) {
    throw new Error('resume-from requires resume-source-revision so the reused cache keeps its provenance');
  }
  const source = resolve(resumeFrom);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error('resume-from must be an existing run directory: ' + source);
  }
  if (source === resolve(output)) throw new Error('resume-from must not be the output directory');
  const copied = [];
  for (const file of RESUMABLE_CACHE_FILES) {
    const from = join(source, file);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(output, file));
    copied.push({ file, sha256: createHash('sha256').update(readFileSync(from)).digest('hex') });
  }
  if (copied.length === 0) {
    throw new Error('resume-from has none of the resumable caches: ' + RESUMABLE_CACHE_FILES.join(', '));
  }
  return { source, sourceRevision, copied };
}

async function main() {
  const { values } = parseArgs({ options: {
    'credentials-stdin': { type: 'boolean', default: false },
    'base-url': { type: 'string' }, model: { type: 'string' }, 'output-dir': { type: 'string' },
    'local-embedding-url': { type: 'string' }, 'local-embedding-model': { type: 'string' },
    'timeout-minutes': { type: 'string' }, 'test-timeout-minutes': { type: 'string' },
    'resume-from': { type: 'string' },
    'resume-source-revision': { type: 'string' },
    'extraction-only': { type: 'boolean', default: false },
    'extraction-batch': { type: 'string' },
  } });
  if (values['credentials-stdin']) {
    let credentials;
    try { credentials = JSON.parse(readFileSync(0, 'utf8')); } catch { throw new Error('Invalid credentials JSON on stdin'); }
    if (typeof credentials.key !== 'string' || !credentials.key) throw new Error('Missing model key in stdin credentials');
    process.env.RUNTIME_MEMORY_LLM_API_KEY = credentials.key;
    if (typeof credentials.embeddingKey === 'string') process.env.SILICONFLOW_API_KEY = credentials.embeddingKey;
  }
  if (values['base-url']) process.env.RUNTIME_MEMORY_LLM_BASE_URL = values['base-url'];
  if (values.model) process.env.RUNTIME_MEMORY_LLM_MODEL = values.model;
  if (!(process.env.RUNTIME_MEMORY_LLM_API_KEY || process.env.DEEPSEEK_API_KEY)) throw new Error('Model credential required; this command never treats a skipped evaluation as success');
  if (values['local-embedding-url']) process.env.RUNTIME_MEMORY_LOCAL_EMBEDDING_URL = values['local-embedding-url'];
  if (values['local-embedding-model']) process.env.RUNTIME_MEMORY_LOCAL_EMBEDDING_MODEL_FILE = values['local-embedding-model'];
  // Staged extraction is LLM-only; requiring the embedding server here would
  // force the 12.8 GB model to be resident for work that never uses it.
  const extractionOnly = values['extraction-only'] === true;
  if (!extractionOnly) {
    await verifyLocomoEmbeddingResources();
  } else {
    if (!values['output-dir']) throw new Error('--extraction-only requires --output-dir so the cache has a stable home');
    console.log('[LoCoMo-Full] Extraction-only stage: embedding server is not required and will not be verified.');
  }
  getRuntimeMemoryLlmConfig(); // Reject accidental credential routing before starting a child.
  const timeoutMinutes = resolveTimeoutMinutes(values['timeout-minutes']);
  const testTimeoutMinutes = resolveTestTimeoutMinutes(values['test-timeout-minutes'], timeoutMinutes);
  const output = resolve(values['output-dir'] ?? join(root, 'artifacts/runtime-memory-eval/runs', randomUUID()));
  if (existsSync(output) && !extractionOnly) throw new Error('Use a new output directory; previous run evidence is never overwritten');
  if (!existsSync(output)) mkdirSync(output, { recursive: true });
  if (values['resume-from']) {
    const seed = seedResumeCaches(values['resume-from'], output, values['resume-source-revision']);
    writeFileSync(join(output, 'resume-seed.json'), JSON.stringify({ driven_by: 'agent', actor: 'dsh-lead', seededAt: new Date().toISOString(), ...seed }, null, 2) + '\n');
    console.log('[LoCoMo-Full] Resumed from ' + seed.source + ' (' + seed.sourceRevision + '): ' + seed.copied.map((entry) => entry.file).join(', '));
  }
  const env = { ...process.env, RUNTIME_MEMORY_REAL_LLM: '1', FULL_EVAL: '1', SMOKE: '0', RUNTIME_MEMORY_EVAL_ARTIFACT_DIR: output,
    DEEPSEEK_MODEL: process.env.RUNTIME_MEMORY_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  if (extractionOnly) {
    env.RUNTIME_MEMORY_EXTRACTION_ONLY = '1';
    if (values['extraction-batch']) env.RUNTIME_MEMORY_EXTRACTION_BATCH = values['extraction-batch'];
  }
  // Only override the suite's own default when the operator asked for it, so the
  // historical 36h behaviour is preserved for every existing invocation.
  if (testTimeoutMinutes !== null) env.RUNTIME_MEMORY_FULL_TEST_TIMEOUT_MINUTES = String(testTimeoutMinutes);
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/unit/runtime-memory-locomo-full-500.test.ts', '--reporter=verbose'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: timeoutMinutes * 60 * 1000,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('LoCoMo runner failed: exit=' + result.status + ', signal=' + result.signal + (result.error ? ', ' + result.error.message : ''));
  if (extractionOnly) {
    // A staged run intentionally produces no report; the facts cache is the output.
    console.log('[LoCoMo-Full] Extraction-only stage finished; no report is produced or verified.');
    return;
  }
  // The frozen judge reads its model at import time; CLI options must be applied first.
  const { verifyLocomoEvidenceFile } = await import('./check-locomo-evidence.mjs');
  const verified = verifyLocomoEvidenceFile(join(output, 'locomo-full-500-report.json'));
  console.log(JSON.stringify(verified, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { await main(); }
  catch (error) {
    console.error('LoCoMo full evaluation NOT VERIFIED: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
