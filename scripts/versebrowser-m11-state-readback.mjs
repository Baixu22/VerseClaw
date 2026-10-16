#!/usr/bin/env node
// M11: prove user data stays readable across a cutover-style re-open. Create a task through the
// module's persisted task store, then re-instantiate the reader on the same file and recover it.
import { mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PACKAGE_ROOT = 'packages/versebrowser';

export async function verifyStateReadback({ hostRoot = ROOT } = {}) {
  const { AgentBrowserTaskService } = await import(new URL(`../${PACKAGE_ROOT}/dist/engine/task-service.js`, import.meta.url).href);
  const runRoot = join(hostRoot, '.tmp', `m11-readback-${Date.now()}`);
  await mkdir(runRoot, { recursive: true });
  const storagePath = join(runRoot, 'tasks.json');
  const report = { schemaVersion: 1, artifact: 'versebrowser-m11-state-readback', driven_by: 'agent', actor: 'codex', storagePath: 'agent-browser/tasks.json', steps: {}, checks: {} };
  try {
    const writer = new AgentBrowserTaskService({ storagePath });
    const task = writer.create({ name: 'm11 readback', objective: 'prove the task store survives a re-open', profile: 'm11', mode: 'headless', url: 'http://127.0.0.1/', steps: [] });
    report.steps.createdTaskId = task.id;
    report.steps.storeOnDisk = existsSync(storagePath);
    const raw = report.steps.storeOnDisk ? await readFile(storagePath) : Buffer.from('');
    report.steps.storeVersion = raw.length ? JSON.parse(raw.toString('utf8')).version : null;
    report.steps.storeSha256 = raw.length ? createHash('sha256').update(raw).digest('hex') : null;

    // Re-open: a fresh reader on the same file must recover the task unchanged.
    const reader = new AgentBrowserTaskService({ storagePath });
    const recovered = reader.list();
    report.steps.recoveredCount = recovered.length;
    report.steps.recoveredTaskId = recovered[0]?.id ?? null;
    report.steps.recoveredName = recovered[0]?.name ?? null;
    report.steps.recoveredStatus = recovered[0]?.status ?? null;

    // A rollback that keeps the same reader must not rewrite or lose the file.
    const after = await readFile(storagePath);
    report.steps.storeUnchangedAfterRead = createHash('sha256').update(after).digest('hex') === report.steps.storeSha256;
    report.checks = {
      task_store_written: report.steps.storeOnDisk === true,
      store_is_version_2: report.steps.storeVersion === 2,
      task_recovered_on_reopen: report.steps.recoveredTaskId === task.id && report.steps.recoveredName === 'm11 readback',
      store_not_rewritten_by_reader: report.steps.storeUnchangedAfterRead === true,
    };
  } catch (error) {
    report.steps.error = String(error?.message ?? error);
    report.checks = { task_store_written: false };
  } finally {
    await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  report.status = Object.values(report.checks).every(Boolean) ? 'pass' : 'fail';
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyStateReadback({ hostRoot: values['host-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });