import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { installLocalEmbeddingModel } from 'file:///C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/openclaw_runtime/packages/memory-host-sdk/src/host/embedding-model-artifact.ts';
import { createLocalEmbeddingProvider } from 'file:///C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/openclaw_runtime/packages/memory-host-sdk/src/host/embeddings.ts';
const model = await installLocalEmbeddingModel({ directory: process.argv[3] });
assert.equal(model.downloaded, false);
const provider = await createLocalEmbeddingProvider({ config: {}, model: model.path, local: { modelPath: model.path, contextSize: 2048 } });
try {
  const capability = await provider.inspect!(['task: search result | query: Offline restart verification'], { signal: AbortSignal.timeout(120_000) });
  const vector = await provider.embedQuery('task: search result | query: Offline restart verification', { signal: AbortSignal.timeout(120_000) });
  assert.equal(vector.length, 768); assert(vector.every(Number.isFinite));
  await provider.close!();
  const root = process.env.PROJECT_RAG_OFFLINE_RECEIPT_DIR!;
  const files = (await readdir(root)).filter(name => name.startsWith(process.env.PROJECT_RAG_OFFLINE_RUN_ID + '-'));
  const network = await Promise.all(files.map(async name => JSON.parse(await readFile(root + '/' + name, 'utf8'))));
  assert(network.length >= 2, 'The parent and native child must both load the network guard');
  assert(network.every(row => row.loaded && row.networkAttempts === 0));
  const receipt = { schema: 'ProjectRagLocalOfflineRestart/v1', actor: 'codex/project-rag', driven_by: 'agent',
    status: 'pass', recordedAt: new Date().toISOString(), nativeDependencyMode: 'real worktree package resolution without dependency redirect',
    downloaded: false, dimensions: vector.length, capability, network, candidate: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: 'C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX', encoding: 'utf8', windowsHide: true }).trim() };
  await writeFile(process.argv[2], JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await provider.close!(); }
