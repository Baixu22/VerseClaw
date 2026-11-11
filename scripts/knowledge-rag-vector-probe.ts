import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  createMemoryWikiEmbeddingService,
  createMemoryWikiProjectionService,
  createMemoryWikiVectorService,
  resolveMemoryWikiConfig,
} from "../openclaw_runtime/extensions/memory-wiki/runtime-api";
import {
  createPluginStateKeyedStoreForTests,
  closeOpenClawStateDatabaseForTest,
} from "../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime";
import { closeTrackedSqliteHandlesUnder } from "../openclaw_runtime/src/infra/node-sqlite";
import { ProjectionStore } from "../openclaw_runtime/src/knowledge/retrieval/projection-store";
import { VectorStore } from "../openclaw_runtime/src/knowledge/retrieval/vector-store";
import { memoryWikiNamespaceId } from "../openclaw_runtime/extensions/memory-wiki/runtime-api";

async function main() {
  const output = process.argv[2],
    artifact = process.argv[3];
  assert(output && artifact, "Pass receipt path and verified GGUF artifact");
  const nativeMissing = process.argv.includes("--native-missing");
  let blockedNativeLoads = 0;
  const hook = nativeMissing
    ? registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === "@lancedb/lancedb") {
            blockedNativeLoads++;
            throw Object.assign(new Error("Agent-injected unavailable native package"), {
              code: "ERR_MODULE_NOT_FOUND",
            });
          }
          return nextResolve(specifier, context);
        },
      })
    : undefined;
  const root = await mkdtemp(join(tmpdir(), "rag-vector-owner-"));
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = join(root, "state");
  const models = join(root, "state/models/project-rag");
  await mkdir(models, { recursive: true });
  await copyFile(artifact, join(models, "6fa0c02a9c302be6-embeddinggemma-300m-qat-Q8_0.gguf"));
  if (process.argv.includes("--model-switch")) {
    for (const [name, hash] of [
      ["tokenizer.json", "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a"],
      ["tokenizer_config.json", "355f2b4e5bad7b01f11ef6cb68ebc176f61b95c3276092ea225b1bea0e01e95c"],
    ])
      await copyFile(join(dirname(artifact), name), join(models, `${hash}-${name}`));
  }
  const vault = join(root, "vault");
  await mkdir(join(vault, "concepts"), { recursive: true });
  const config = resolveMemoryWikiConfig({
    vault: { path: vault },
    search: { backend: "local", corpus: "wiki" },
  });
  const identity = {
    workspaceId: "agent-vector-project",
    workspaceDir: root,
    agentSessionKey: "agent:main:vector-fixture",
    sessionId: "vector-generation-1",
    egressProviderRefs: [],
  };
  const file = join(vault, "concepts/source.md");
  const raw = (revision: number, body: string, denied = false) =>
    `---\ntitle: Vector owner\nrevision: ${revision}\nstatus: active\ntrust: confirmed\n${denied ? "acl:\n  read: [other]\n" : ""}scope:\n  workspaceId: ${identity.workspaceId}\n---\n${body}\n`;
  const services: Array<{ stop: () => Promise<void> }> = [];
  const make = () => {
    const state = <T>(options: Parameters<typeof createPluginStateKeyedStoreForTests<T>>[1]) =>
      createPluginStateKeyedStoreForTests<T>("memory-wiki", options);
    const projection = createMemoryWikiProjectionService({
      config,
      openKeyedStore: state,
      onError: (error) => console.error("projection", error.message),
    });
    const embedding = createMemoryWikiEmbeddingService({ config, openKeyedStore: state });
    let documentCalls = 0;
    const vector = createMemoryWikiVectorService({
      config,
      embedding: {
        status: embedding.status,
        embed: (...args) => {
          if (args[1].kind === "document") documentCalls++;
          return embedding.embed(...args);
        },
      },
      projection,
      openKeyedStore: state,
    });
    services.push(vector, embedding, projection);
    return { projection, embedding, vector, documentCalls: () => documentCalls };
  };
  const waitEmbedding = async (embedding: ReturnType<typeof make>["embedding"]) => {
    const deadline = Date.now() + 120_000;
    while (embedding.status(identity).status !== "ready") {
      const current = embedding.status(identity);
      if (current.status === "unavailable") throw new Error(JSON.stringify(current));
      if (Date.now() >= deadline) throw new Error("Local embedding did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const receipt: Record<string, unknown> = {
    schema: "ProjectRagVectorOwnerProbe/v1",
    actor: "codex/project-rag",
    driven_by: "agent",
    status: "fail",
    candidate: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    recordedAt: new Date().toISOString(),
    dirtyDevelopmentProbe: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
    ),
    steps: {},
  };
  try {
    await writeFile(
      file,
      raw(
        1,
        "The deployment gateway port is 18789. Source owners check project access before reading.",
      ),
    );
    const first = make();
    await first.embedding.configure({ mode: "local" }, identity);
    await waitEmbedding(first.embedding);
    await first.vector.enable(identity, "sqlite-flat");
    await first.vector.idle(identity);
    const portable = await first.vector.search(identity, "deployment gateway port");
    assert.equal(portable.status, "available");
    assert(portable.candidates.some((row) => row.quote.includes("18789")));
    await writeFile(
      file,
      raw(2, "The deployment gateway port is 18888. New append remains searchable."),
    );
    await first.projection.reconcile(identity);
    await first.projection.idle(identity);
    await first.vector.idle(identity);
    const updated = await first.vector.search(identity, "deployment gateway port");
    assert(updated.candidates.some((row) => row.quote.includes("18888")));
    assert(updated.candidates.every((row) => !row.quote.includes("18789")));
    await writeFile(file, raw(3, "PRIVATE_NOT_FOR_EMBEDDING", true));
    assert.equal(
      (await first.vector.search(identity, "deployment gateway port")).candidates.length,
      0,
    );
    await first.projection.reconcile(identity);
    await first.projection.idle(identity);
    await first.vector.idle(identity);
    await writeFile(file, raw(4, "The restored deployment gateway port is 19999."));
    await first.projection.reconcile(identity);
    await first.projection.idle(identity);
    await first.vector.idle(identity);
    await first.vector.enable(identity, "lancedb-ann");
    await first.vector.idle(identity);
    const ann = await first.vector.search(identity, "deployment gateway port");
    const expectedBackend = nativeMissing ? "sqlite-flat" : "lancedb-ann";
    assert.equal(ann.status, "available");
    assert("effectiveBackend" in ann && ann.effectiveBackend === expectedBackend);
    assert(ann.candidates.some((row) => row.quote.includes("19999")));
    const active = await first.vector.status(identity);
    assert.equal(active.generation?.backend, expectedBackend);
    if (nativeMissing) {
      assert.equal(active.capability.available, false);
      assert(blockedNativeLoads > 0);
    }
    if (process.argv.includes("--model-switch")) {
      await first.embedding.configure(
        { mode: "remote", providerRef: "siliconflow" },
        { ...identity, egressProviderRefs: ["siliconflow"] },
      );
      await waitEmbedding(first.embedding);
      await first.vector.idle(identity);
      const capability = first.embedding.status(identity).capability;
      assert(capability?.status === "ready");
      assert.equal(capability.space.dimensions, 4096);
      const replacement = await first.vector.status(identity);
      assert.notEqual(replacement.generation?.spaceId, active.generation?.spaceId);
      assert.notEqual(replacement.generation?.generationId, active.generation?.generationId);
      const answer = await first.vector.search(identity, "deployment gateway port");
      assert(answer.candidates.some((row) => row.quote.includes("19999")));
      receipt.modelReplacement = {
        status: "pass",
        fromDimensions: 768,
        toDimensions: capability.space.dimensions,
        from: active.generation,
        to: replacement.generation,
        answer,
      };
    }
    await first.vector.stop();
    await first.embedding.stop();
    await first.projection.stop();
    if (process.argv.includes("--drop-ann") && !nativeMissing) {
      await rm(join(root, "state/ann"), { recursive: true, force: true });
    }
    const restarted = make();
    await restarted.embedding.start();
    await waitEmbedding(restarted.embedding);
    await restarted.vector.start();
    await restarted.vector.idle(identity);
    const recovered = await restarted.vector.search(identity, "deployment gateway port");
    assert(recovered.candidates.some((row) => row.quote.includes("19999")));
    if (process.argv.includes("--drop-ann") && !nativeMissing) {
      const recoveryStatus = await restarted.vector.status(identity);
      const generation = recoveryStatus.generation;
      const vectorRows = generation ? new VectorStore().rows(generation) : [];
      const sourceRows = new ProjectionStore().currentChunks(memoryWikiNamespaceId(config));
      receipt.recoveryDiagnostics = {
        generation,
        documentEmbeddingCalls: restarted.documentCalls(),
        vectorRows: vectorRows.map((row) => ({
          id: row.id,
          sourceGeneration: row.source_generation,
        })),
        sourceRows: sourceRows.map((row) => ({
          chunkId: row.chunk.chunkId,
          generationId: row.generationId,
        })),
      };
      assert.equal(restarted.documentCalls(), 0, "ANN recovery must reuse current SQLite vectors");
      receipt.nativeLossRecovery = {
        status: "pass",
        simulated: true,
        documentEmbeddingCalls: restarted.documentCalls(),
      };
    }
    await unlink(file);
    assert.equal(
      (await restarted.vector.search(identity, "deployment gateway port")).candidates.length,
      0,
    );
    await restarted.projection.reconcile(identity);
    await restarted.projection.idle(identity);
    await restarted.vector.idle(identity);
    assert.equal(
      (await restarted.vector.search(identity, "deployment gateway port")).candidates.length,
      0,
    );
    receipt.status = "pass";
    receipt.steps = {
      portableReady: true,
      sourceUpdateReplaced: true,
      aclImmediateReject: true,
      nativeSwitchPublished: true,
      nativeRestartRecovered: true,
      deletionImmediateReject: true,
      cleanupReconciled: true,
    };
    receipt.portable = portable;
    receipt.ann = ann;
    receipt.active = active;
    receipt.recovered = recovered;
    if (nativeMissing) {
      receipt.steps = {
        portableReady: true,
        sourceUpdateReplaced: true,
        aclImmediateReject: true,
        missingNativeFallback: true,
        fallbackRestartRecovered: true,
        deletionImmediateReject: true,
        cleanupReconciled: true,
      };
      receipt.nativeDependencyFault = {
        simulated: true,
        actor: "codex/project-rag",
        mechanism: "Node module resolution rejection",
        blockedNativeLoads,
      };
    }
  } finally {
    for (const service of services) await service.stop();
    closeOpenClawStateDatabaseForTest();
    closeTrackedSqliteHandlesUnder(root);
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
    await rm(root, { recursive: true, force: true });
    hook?.deregister();
  }
  console.log(JSON.stringify({ status: receipt.status, output }));
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
