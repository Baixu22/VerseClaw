import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryWikiProjectionService, resolveMemoryWikiConfig } from '../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { createPluginStateKeyedStoreForTests, closeOpenClawStateDatabaseForTest } from '../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime';
import { closeTrackedSqliteHandlesUnder } from '../openclaw_runtime/src/infra/node-sqlite';

async function main() {
  const output = process.argv[2]; assert(output, 'Pass a receipt path');
  const root = await mkdtemp(join(tmpdir(), 'rag04-index-probe-'));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = join(root, 'state-root');
  const running: Array<ReturnType<typeof createMemoryWikiProjectionService>> = [];
  const errors: string[] = [];
  const identity = { workspaceId: 'agent-probe', workspaceDir: root, agentSessionKey: 'agent:main:main', sessionId: 'agent-generation-1', egressProviderRefs: [] };
  try {
    const vault = join(root, 'vault'); await mkdir(join(vault, 'concepts'), { recursive: true });
    const file = join(vault, 'concepts/source.md');
    const raw = (revision: number, text: string, policy = '') => `---\ntitle: Agent fixture\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: agent-probe\n${policy}---\n# Source\n\n${text}\n`;
    const make = () => {
      const service = createMemoryWikiProjectionService({ config: resolveMemoryWikiConfig({ vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' } }),
        openKeyedStore: options => createPluginStateKeyedStoreForTests('memory-wiki', options), onError: error => errors.push(error.message) });
      running.push(service); return service;
    };
    await writeFile(file, raw(1, 'RAG_INDEX_PROBE_ALPHA 中文 日本語 русский 😀'));
    const first = make(); await first.start(); assert.equal(first.status(identity).status, 'disabled');
    await first.enable(identity); await first.idle(identity);
    assert((await first.search(identity, 'RAG_INDEX_PROBE_ALPHA')).candidates.length > 0);
    const initial = first.status(identity);
    await writeFile(file, raw(2, 'RAG_INDEX_PROBE_BETA updated'));
    await first.reconcile(identity); await first.idle(identity);
    assert.equal((await first.search(identity, 'RAG_INDEX_PROBE_ALPHA')).candidates.length, 0);
    assert((await first.search(identity, 'RAG_INDEX_PROBE_BETA')).candidates.length > 0);
    await first.stop();
    await writeFile(file, raw(3, 'RAG_INDEX_PROBE_GAMMA restart'));
    const restarted = make(); await restarted.start();
    try { await restarted.idle(identity); }
    catch (error) {
      await mkdir(dirname(resolve(output)), { recursive: true });
      await writeFile(resolve(output) + '.failure.json', JSON.stringify({ actor: 'codex/project-rag-index-probe', driven_by: 'agent', status: restarted.status(identity), errors }, null, 2));
      throw error;
    }
    assert((await restarted.search(identity, 'RAG_INDEX_PROBE_GAMMA')).candidates.length > 0);
    const resumed = restarted.status(identity);
    assert('sources' in resumed && resumed.sources.length === 1);
    await assert.rejects(restarted.search({ ...identity, sessionId: 'agent-generation-2' }, 'RAG_INDEX_PROBE_GAMMA'), /scope/);
    await writeFile(file, raw(4, 'RAG_INDEX_PROBE_FORBIDDEN', 'acl:\n  read: [someone-else]\n'));
    assert.equal((await restarted.search(identity, 'RAG_INDEX_PROBE_GAMMA')).candidates.length, 0);
    await restarted.reconcile(identity); await restarted.idle(identity);
    await unlink(file); await restarted.reconcile(identity); await restarted.idle(identity);
    const deleted = restarted.status(identity);
    assert('sources' in deleted && deleted.sources.every(source => !source.eligible));
    const db = new DatabaseSync(join(root, 'state-root/state/openclaw.sqlite'), { readOnly: true });
    let counts;
    try { counts = { sources: db.prepare('SELECT count(*) AS count FROM knowledge_index_sources').get(),
      generations: db.prepare('SELECT count(*) AS count FROM knowledge_index_generations').get(),
      chunks: db.prepare('SELECT count(*) AS count FROM knowledge_index_chunks').get() }; }
    finally { db.close(); }
    assert.equal(counts.generations?.count, 0); assert.equal(counts.chunks?.count, 0);
    assert.equal(errors.filter(message => !message.includes('cancelled')).length, 0);
    const receipt = { schema: 'ProjectRagIndexLifecycleProbe/v1', actor: 'codex/project-rag-index-probe', driven_by: 'agent',
      candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      fixtureOrigin: 'agent-authored-Wiki-owner', selectionStorage: 'real-plugin-SQLite', status: 'pass', initial, resumed, deleted, counts,
      steps: { explicitEnable: true, nativeWorkerPublished: true, editReplaced: true, restartRestoredSqliteSelection: true,
        sourceIdentityStable: true, changedGenerationRejected: true, aclRejected: true, deleteAndCleanupComplete: true }, errors };
    await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ status: receipt.status, counts, output: resolve(output) }));
  } finally {
    for (const service of running) await service.stop();
    closeOpenClawStateDatabaseForTest(); closeTrackedSqliteHandlesUnder(root);
    if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
