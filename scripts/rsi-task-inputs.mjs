#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { TASK_INPUT_BINDINGS, buildPublicTaskInputs, buildTaskInputBindings, verifyTaskInputBindings } from './lib/rsi-task-inputs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkTaskInputs(root = ROOT) {
  const bindings = JSON.parse(readFileSync(resolve(root, TASK_INPUT_BINDINGS), 'utf8'));
  verifyTaskInputBindings(root, bindings);
  const manifest = readFileSync(resolve(root, dirname(TASK_INPUT_BINDINGS), 'SHA256SUMS'), 'utf8').trim();
  assert.equal(manifest, digest(readFileSync(resolve(root, TASK_INPUT_BINDINGS))) + '  public-bindings.v1.json', 'public-input-manifest-drift');
  const tasks = bindings.tasks.map(task => {
    const result = buildPublicTaskInputs(root, task.identity.id);
    return { id: task.identity.id, kind: task.kind, inputDigest: result.inputDigest,
      publicApiFiles: task.publicSources.length, baseFiles: result.input.baseFiles.length,
      missingBaseFiles: result.input.baseFiles.filter(file => file.missing).length,
      omittedContext: result.omitted, inputChars: JSON.stringify(result.input, null, 2).length };
  });
  return { schemaVersion: 'RsiCodingTaskInputsCheck/v1', driven_by: 'agent', actor: 'codex/rsi-public-task-inputs',
    passed: true, tasks, coverage: { total: tasks.length,
      moduleImplementation: tasks.filter(task => task.kind === 'module-implementation').length,
      specificationVerification: tasks.filter(task => task.kind === 'specification-verification').length },
    claims: { benefit: false, promotionReady: false, providerCalls: 0, realHuman: false } };
}
if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' }, check: { type: 'boolean' },
    json: { type: 'boolean' }, root: { type: 'string' }, report: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? ROOT);
    if (values.write) {
      const target = resolve(root, TASK_INPUT_BINDINGS), bindings = buildTaskInputBindings(root);
      assert(!existsSync(target), 'new-public-input-version-required');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(bindings, null, 2) + '\n', { flag: 'wx' });
      writeFileSync(resolve(dirname(target), 'SHA256SUMS'), digest(readFileSync(target)) + '  public-bindings.v1.json\n', { flag: 'wx' });
    }
    const report = checkTaskInputs(root);
    if (values.report) writeFileSync(resolve(values.report), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(values.json ? report : { passed: report.passed, coverage: report.coverage, claims: report.claims }));
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error.message }));
    process.exitCode = 1;
  }
}
