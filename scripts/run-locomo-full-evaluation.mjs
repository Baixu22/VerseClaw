import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getRuntimeMemoryLlmConfig } from '../tests/unit/helpers/runtime-memory-real-llm-client.ts';
import { verifyLocomoEvidenceFile } from './check-locomo-evidence.mjs';
import { verifyLocomoEmbeddingResources } from '../tests/unit/helpers/locomo-embedding-provider.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { values } = parseArgs({ options: {
    'credentials-stdin': { type: 'boolean', default: false },
    'base-url': { type: 'string' }, model: { type: 'string' }, 'output-dir': { type: 'string' },
    'local-embedding-url': { type: 'string' }, 'local-embedding-model': { type: 'string' },
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
  await verifyLocomoEmbeddingResources();
  getRuntimeMemoryLlmConfig(); // Reject accidental credential routing before starting a child.
  const output = resolve(values['output-dir'] ?? join(root, 'artifacts/runtime-memory-eval/runs', randomUUID()));
  if (existsSync(output)) throw new Error('Use a new output directory; previous run evidence is never overwritten');
  mkdirSync(output, { recursive: true });
  const env = { ...process.env, RUNTIME_MEMORY_REAL_LLM: '1', FULL_EVAL: '1', SMOKE: '0', RUNTIME_MEMORY_EVAL_ARTIFACT_DIR: output,
    DEEPSEEK_MODEL: process.env.RUNTIME_MEMORY_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/unit/runtime-memory-locomo-full-500.test.ts', '--reporter=verbose'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 90 * 60 * 1000,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('LoCoMo runner failed: exit=' + result.status + ', signal=' + result.signal + (result.error ? ', ' + result.error.message : ''));
  const verified = verifyLocomoEvidenceFile(join(output, 'locomo-full-500-report.json'));
  console.log(JSON.stringify(verified, null, 2));
} catch (error) {
  console.error('LoCoMo full evaluation NOT VERIFIED: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
