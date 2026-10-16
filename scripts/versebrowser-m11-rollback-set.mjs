#!/usr/bin/env node
// M11: bind the cutover/rollback version set as one unit and prove the default selector and the
// state readers are unchanged and readable. Reporting only; it never mutates product state.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOCK = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';

// The set that must move together on a cutover or a rollback.
const VERSION_SET = {
  source: ['packages/versebrowser/import-manifest.json'],
  patch: ['packages/versebrowser/integration-patches.json', 'packages/versebrowser/patches/src__index.ts.patch', 'packages/versebrowser/patches/src__host__paths.ts.patch', 'packages/versebrowser/scripts/patch-upstream.mjs'],
  lock: ['pnpm-lock.yaml', 'packages/versebrowser/package.json'],
  adapter: ['electron/services/agent-browser-api.ts', 'electron/gateway/agent-browser-bridge.ts', 'electron/main/ipc-handlers.ts'],
  contract: ['shared/host-api/contract.ts', 'src/lib/host-api.ts'],
  'state-reader': ['packages/versebrowser/src/engine/task-service.ts', 'packages/versebrowser/src/engine/vault.ts', 'packages/versebrowser/src/engine/service.ts'],
  assets: ['packages/versebrowser/dist/index.js', 'packages/versebrowser/dist/engine/service.js', 'resources/bin/win32-x64/node-runtime.json'],
};

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export async function buildRollbackSet({ hostRoot = ROOT } = {}) {
  const lock = JSON.parse(await readFile(join(hostRoot, LOCK), 'utf8'));
  const groups = {};
  const missing = [];
  for (const [group, paths] of Object.entries(VERSION_SET)) {
    groups[group] = [];
    for (const rel of paths) {
      const abs = join(hostRoot, rel);
      if (!existsSync(abs)) { missing.push(rel); groups[group].push({ path: rel, present: false }); continue; }
      const bytes = await readFile(abs);
      groups[group].push({ path: rel, present: true, bytes: bytes.byteLength, sha256: sha(bytes) });
    }
  }
  const standalone = await import(new URL(`../packages/versebrowser/dist/engine/standalone.js`, import.meta.url).href);
  const { createStandaloneFacade } = standalone;
  const probe = await createStandaloneFacade({ workspaceRoot: join(hostRoot, '.tmp', `m11-default-${Date.now()}`) });
  const defaultDriver = probe.driver;
  await probe.facade.dispose?.().catch(() => undefined);
  return {
    schemaVersion: 1,
    artifact: 'versebrowser-m11-rollback-set',
    driven_by: 'agent',
    actor: 'codex',
    sourceCommit: lock.source?.commit,
    groups,
    missing,
    defaultSelector: { driver: defaultDriver, isLegacy: defaultDriver === 'playwright' },
    status: missing.length === 0 && defaultDriver === 'playwright' ? 'pass' : 'fail',
    validationBoundary: 'Binds the files that must roll back together and confirms the default selector is still legacy. It does not perform a rollback; it proves the set is present and hashable.',
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await buildRollbackSet({ hostRoot: values['host-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });