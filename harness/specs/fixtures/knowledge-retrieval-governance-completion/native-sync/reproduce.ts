import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { appendFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createKnowledgeSourceSync, type KnowledgeSourceTransition } from 'D:/ClawX-work/knowledge-relay-20261105/electron/services/knowledge-source-sync';

const repo = 'D:/ClawX-work/knowledge-relay-20261105';
const output = 'D:/tmp/knowledge-relay-20261105/final/source-sync-native';
const root = join(output, 'sources');
await mkdir(root, { recursive: true });
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')) };
assert.equal(candidate.dirty, false);
const changes: KnowledgeSourceTransition[] = [];
const operations: Array<Record<string, unknown>> = [];
const nativeEvents: Array<Record<string, unknown>> = [];
const errors: string[] = [];
const observer = watch(root, { recursive: true }, (event, filename) => nativeEvents.push({ event, filename, at: new Date().toISOString() }));
const options = {
  id: 'native-acceptance', root, patterns: ['**/*.md'], cursorPath: join(output, 'cursor.json'), debounceMs: 30,
  capture: async (change: KnowledgeSourceTransition) => { changes.push(change); await appendFile(join(output, 'transitions.jsonl'), JSON.stringify(change) + '\n'); },
  onError: (error: unknown) => errors.push(String(error)),
};
let sync = createKnowledgeSourceSync(options);
async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) { assert(Date.now() < deadline, 'native reconciliation timed out'); await new Promise(resolve => setTimeout(resolve, 25)); }
}
async function put(name: string, body: string, phase: string) {
  operations.push({ operation: 'write', name, body, phase }); await writeFile(join(root, name), body);
}
async function remove(name: string, phase: string) {
  operations.push({ operation: 'delete', name, phase }); await unlink(join(root, name));
}
try {
  await sync.start();
  await Promise.all(Array.from({ length: 20 }, (_, i) => put(`source-${i}.md`, `Version one ${i}`, 'live')));
  await until(() => changes.filter(change => change.kind === 'created').length === 20);
  await put('source-0.md', 'Version two 0', 'live');
  await until(() => changes.some(change => change.relativePath === 'source-0.md' && change.kind === 'updated'));
  await remove('source-1.md', 'live');
  await until(() => changes.some(change => change.relativePath === 'source-1.md' && change.kind === 'withdrawn'));
  await sync.scan(); assert.equal(changes.length, 22);
  await writeFile(join(output, 'cursor-before-restart.json'), await readFile(options.cursorPath));
  sync.stop(); await sync.settled();
  await put('source-2.md', 'Changed while stopped', 'offline');
  await remove('source-3.md', 'offline');
  await put('missed.md', 'Created while stopped', 'offline');
  sync = createKnowledgeSourceSync(options); await sync.start(); await sync.scan();
  assert.equal(changes.length, 25); assert.equal(new Set(changes.map(change => change.captureKey)).size, 25);
  const cursor = JSON.parse(await readFile(options.cursorPath, 'utf8'));
  assert.equal(Object.keys(cursor.files).length, 19); assert.equal(cursor.sequence, 25); assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-knowledge-source-sync-native', candidate,
    status: 'pass', nativeEvents: nativeEvents.length, transitions: changes.length, uniqueCaptureKeys: 25,
    counts: { created: 21, updated: 2, withdrawn: 2 }, startupRecovered: 3, finalSources: 19, errors,
    dirtyAfter: Boolean(git('status', '--porcelain')), commitAfter: git('rev-parse', 'HEAD'),
    limitation: 'Agent-owned local files on Windows; no human evidence or long-running soak.' }, null, 2));
  console.log('Native source sync: 20 creates, 2 updates, 2 withdrawals, 1 offline create; 25 unique transitions.');
} finally {
  sync.stop(); await sync.settled(); observer.close();
  await writeFile(join(output, 'input-operations.json'), JSON.stringify(operations, null, 2));
  await writeFile(join(output, 'native-events.json'), JSON.stringify(nativeEvents, null, 2));
}
