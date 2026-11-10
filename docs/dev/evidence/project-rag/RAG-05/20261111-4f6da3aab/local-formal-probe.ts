import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { freemem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const nativeRequire = createRequire('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/openclaw_runtime/packages/memory-host-sdk/package.json');
const nativePath = nativeRequire.resolve('node-llama-cpp');
const { getLlama, LlamaLogLevel } = await import(pathToFileURL(nativePath).href);
import {
  DEFAULT_LOCAL_EMBEDDING_ARTIFACT,
  installLocalEmbeddingModel,
} from 'file:///C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/openclaw_runtime/packages/memory-host-sdk/src/host/embedding-model-artifact.ts';
import { createLocalEmbeddingProvider } from 'file:///C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/openclaw_runtime/packages/memory-host-sdk/src/host/embeddings.ts';

const output = process.argv[2];
assert(output, 'Pass the formal receipt path');
const modelDirectory = process.argv[3];
assert(modelDirectory, 'Pass the formal model directory');
const workspace = 'C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX';
const receipt: Record<string, unknown> = {
  schema: 'ProjectRagLocalEmbeddingAcceptanceProbe/v1',
  actor: 'codex/project-rag', driven_by: 'agent',
  recordedAt: new Date().toISOString(), status: 'running',
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim()),
  dependency: { package: 'node-llama-cpp', version: '3.22.3', resolvedPath: nativePath, resolverHook: 'none', platform: process.platform, arch: process.arch },
  artifact: DEFAULT_LOCAL_EMBEDDING_ARTIFACT,
};
const save = async () => writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
let provider: Awaited<ReturnType<typeof createLocalEmbeddingProvider>> | undefined;
try {
  await mkdir(modelDirectory, { recursive: true });
  assert(freemem() >= 2 * 1024 ** 3, 'At least 2 GiB of free memory is required for the native development probe');
  receipt.phase = 'cpu-binding'; await save();
  const llama = await getLlama({ gpu: false, build: 'never', logLevel: LlamaLogLevel.error });
  receipt.cpuBinding = { status: 'pass', gpu: llama.gpu, release: llama.llamaCppRelease };
  await llama.dispose();
  receipt.phase = 'model-install'; await save();
  const cancelled = new AbortController();
  let cancellationProgressBytes = 0;
  try {
    await installLocalEmbeddingModel({ directory: modelDirectory, signal: cancelled.signal, onProgress: progress => { cancellationProgressBytes = progress.bytes; if (progress.bytes > 128 * 1024) cancelled.abort(new Error('agent-driven-install-cancellation')); } });
    throw new Error('Fresh install unexpectedly completed before cancellation');
  } catch (error) {
    assert(cancelled.signal.aborted, 'The first download must be cancelled by the agent, not fail for another reason');
    receipt.cancelledInstall = { status: 'pass', driven_by: 'agent', progressBytes: cancellationProgressBytes };
  }
  assert.deepEqual(await readdir(modelDirectory), [], 'Cancelled staging must be removed before retry');
  let lastProgress = -1;
  const model = await installLocalEmbeddingModel({
    directory: modelDirectory,
    signal: AbortSignal.timeout(10 * 60_000),
    onProgress: ({ phase, bytes, total }) => {
      const progress = Math.floor(bytes / total * 20);
      if (progress !== lastProgress) { console.log(phase, Math.floor(bytes / total * 100) + '%'); lastProgress = progress; }
    },
  });
  receipt.install = { ...model, status: 'pass' };
  receipt.phase = 'worker-warmup'; await save();
  assert(freemem() >= 2 * 1024 ** 3, 'Memory changed before warmup');
  provider = await createLocalEmbeddingProvider({ config: {}, model: model.path, local: { modelPath: model.path, contextSize: 2048 } });
  assert(provider.inspect);
  const query = 'task: search result | query: How is project source access checked?';
  const document = 'title: Project RAG | text: The source owner checks workspace access before each retrieval.';
  const capability = await provider.inspect([query, document], { signal: AbortSignal.timeout(120_000) });
  assert.equal(capability.dimensions, 768);
  assert.equal(capability.modelDigest, 'sha256:' + DEFAULT_LOCAL_EMBEDDING_ARTIFACT.sha256);
  const vectors = [await provider.embedQuery(query, { signal: AbortSignal.timeout(120_000) }), ...(await provider.embedBatch([document], { signal: AbortSignal.timeout(120_000) }))];
  assert(vectors.every(vector => vector.length === 768 && vector.every(Number.isFinite)));
  receipt.warmup = {
    status: 'pass', capability, inputKinds: ['query', 'document'],
    dimensions: vectors.map(vector => vector.length),
    l2Norms: vectors.map(vector => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))),
  };
  await provider.close!(); provider = undefined;
  receipt.phase = 'verified-file-reopen'; await save();
  const reopened = await installLocalEmbeddingModel({ directory: modelDirectory });
  assert.equal(reopened.downloaded, false);
  provider = await createLocalEmbeddingProvider({ config: {}, model: reopened.path, local: { modelPath: reopened.path, contextSize: 2048 } });
  const secondVector = await provider.embedQuery(query, { signal: AbortSignal.timeout(120_000) });
  assert.equal(secondVector.length, 768);
  receipt.reopen = { status: 'pass', downloaded: false, dimensions: secondVector.length, networkIsolation: 'not-applied-in-this-probe' };
  await provider.close!(); provider = undefined;
  receipt.status = 'pass'; receipt.phase = 'complete';
} catch (error) {
  receipt.status = 'fail';
  receipt.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
  process.exitCode = 1;
} finally {
  await provider?.close?.();
  receipt.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(receipt));
}
