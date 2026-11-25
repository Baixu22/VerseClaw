import assert from "node:assert/strict";
import { loadCapacityInput } from "./lib/project-rag-capacity-input";
import type { VectorProjectionV1 } from "../openclaw_runtime/src/knowledge/retrieval/vector-contracts";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createPortableVectorBackend,
  createLanceVectorBackend,
} from "../openclaw_runtime/extensions/memory-wiki/runtime-api.js";
import { VectorStore } from "../openclaw_runtime/src/knowledge/retrieval/vector-store.js";
import { createEmbeddingSpace } from "../openclaw_runtime/src/knowledge/retrieval/embedding-space.js";
import { digestOwnerReadContent } from "../openclaw_runtime/src/runtime-core/knowledge-owner-read.js";
import { closeOpenClawStateDatabase } from "../openclaw_runtime/src/state/openclaw-state-db.js";
async function main() {
  const output = process.argv[2];
  assert(output, "Pass an isolated benchmark output directory");
  const mode = process.argv[3];
  assert(mode === "portable" || mode === "ann");
  await mkdir(output, { recursive: true });
  try {
    await stat(path.join(output, "report.json"));
    throw new Error("Preserve the existing report; choose a new output directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const candidate = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  const captured = process.argv[4] ? await loadCapacityInput(process.argv[4], candidate) : undefined;
  const count = captured?.input.count ?? (mode === "portable" ? 20_000 : 100_000), dimensions = captured?.space.dimensions ?? 768;
  assert(count >= (mode === "portable" ? 20_000 : 100_000), "Capacity input is below the frozen row count");
  const namespaceId = captured?.input.namespaceId ?? "agent-capacity";
  const space = captured?.space ?? createEmbeddingSpace({
    providerRef: "agent-capacity-fixture",
    model: "deterministic-latent32-topic-v1",
    modelRevision: "seed-87319",
    dimensions,
    maxInputTokens: 512,
    tokenizerId: "not-used-synthetic-capacity",
    tokenizerDigest: digestOwnerReadContent("synthetic-capacity-not-semantic-quality"),
    inputFormat: { id: "capacity-only", query: "{text}", document: "{text}" },
    normalization: "l2",
  });
  function vector(id: number) {
    let state = (id + 87319) >>> 0;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296 - 0.5;
    };
    const latent = Array.from({ length: 32 }, random);
    const result = Array.from(
      { length: dimensions },
      (_, index) => latent[index % 32] + Math.sin((index + 1) * ((id % 128) + 1)) * 0.01,
    );
    const magnitude = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    return result.map((value) => value / magnitude);
  }
  const dbPath = path.join(output, "state.sqlite"),
    store = new VectorStore({ path: dbPath });
  let backend =
    mode === "portable"
      ? createPortableVectorBackend({ path: dbPath })
      : createLanceVectorBackend(path.join(output, "lance"));
  const capability = await backend.capability();
  assert(capability.available, capability.reason);
  const generation = store.begin(namespaceId, "agent-workspace", space, backend.id);
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);
  const report: Record<string, unknown> = {
    schema: "ProjectRagVectorCapacity/v1",
    actor: "codex/project-rag",
    driven_by: "agent",
    candidate,
    dirtyDevelopmentProbe: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
    ),
    recordedAt: new Date().toISOString(),
    mode,
    rows: count,
    dimensions,
    semanticQualityMeasured: false,
    input: captured ? { provenance: captured.input.provenance, manifestDigest: captured.digest, corpusDigest: captured.input.corpusDigest,
      space: captured.space, verifiedProviderResponses: true } : null,
    fixture: captured ? null : {
      kind: "agent-generated deterministic synthetic vectors",
      distribution: "32 latent coordinates repeated across768 with topic jitter",
      seed: 87319,
      semanticQualityMeasured: false,
    },
    capability,
    status: "running",
  };
  const save = () =>
    writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const ids: string[] = [];
  try {
    const buildStart = performance.now();
    async function* rows(): AsyncGenerator<VectorProjectionV1> {
      if (captured) {
        for await (const row of captured.rows()) yield { schema: "VectorProjection/v1", id: row.id,
          generationId: generation.generationId, workspaceId: "agent-workspace", namespaceId, spaceId: space.spaceId,
          chunkId: row.id, chunkDigest: row.chunkDigest, sourceGeneration: row.source.sourceDigest, source: row.source, vector: row.vector };
      } else for (let id = 0; id < count; id++) {
        const key = `v${String(id).padStart(6, "0")}`;
        yield {
          schema: "VectorProjection/v1" as const,
          id: key,
          generationId: generation.generationId,
          workspaceId: "agent-workspace",
          namespaceId,
          spaceId: space.spaceId,
          chunkId: "chunk-" + key,
          chunkDigest: digestOwnerReadContent(key),
          sourceGeneration: "source-" + Math.floor(id / 100),
          vector: vector(id),
          source: {
            schema: "SourceRef/v2" as const,
            domain: "wiki" as const,
            authorityId: "agent-fixture",
            namespaceId,
            subjectId: "source-" + id,
            revision: "1",
            sourceDigest: digestOwnerReadContent(key),
            policyEpoch: "fixture",
            locator: {
              coordinateSpace: "raw-source-utf8-v1" as const,
              startByte: 0,
              endByteExclusive: 1,
              startLine: 1,
              endLine: 1,
            },
          },
        };
      }
    }
    let batch: VectorProjectionV1[] = [], restartVector: number[] | undefined;
    const flush = async () => { await backend.write(generation, space, batch); if (mode === "ann") store.write(generation, space, batch); batch = []; };
    for await (const row of rows()) {
      ids.push(row.id); if (ids.length === 2) restartVector = row.vector;
      batch.push(row);
      if (batch.length === 256) await flush();
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    if (batch.length) await flush();
    assert(store.publish(generation, count));
    report.writeMs = Math.round(performance.now() - buildStart);
    await save();
    if (mode === "ann") {
      const start = performance.now();
      await backend.optimize(
        store.active(generation.namespaceId, generation.workspaceId, space.spaceId)!,
      );
      report.indexBuildAndOptimizeMs = Math.round(performance.now() - start);
      await save();
    }
    const eligible = ids.filter((_, index) => index % 5 !== 0);
    const timings: number[] = [],
      recalls: number[] = [];
    for (let queryId = 0; queryId < 31; queryId++) {
      const q = captured?.queries[queryId].vector ?? vector(100_001 + queryId),
        start = performance.now();
      const hits = await backend.search({
        namespaceId,
        workspaceId: "agent-workspace",
        generationId: generation.generationId,
        space,
        vector: q,
        limit: 20,
        eligibleIds: eligible,
      });
      timings.push(performance.now() - start);
      let exact: string[];
      if (mode === "ann") {
        const all = await backend.search({
          namespaceId,
          workspaceId: "agent-workspace",
          generationId: generation.generationId,
          space,
          vector: q,
          limit: 20,
          eligibleIds: eligible,
          exact: true,
        });
        exact = all.map((row) => row.id);
      } else {
        const gold: { id: string; distance: number }[] = [];
        const eligibleSet = new Set(eligible);
        for await (const row of rows()) if (eligibleSet.has(row.id)) {
          let dot = 0;
          for (let n = 0; n < dimensions; n++) dot += row.vector[n] * q[n];
          gold.push({ id: row.id, distance: 1 - dot });
        }
        gold.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        exact = gold.slice(0, 20).map((row) => row.id);
      }
      const expected = new Set(exact);
      recalls.push(hits.filter((row) => expected.has(row.id)).length / 20);
      console.log("query", queryId, "ms", Math.round(timings.at(-1)!), "recall", recalls.at(-1));
    }
    const sorted = timings.slice(1).sort((a, b) => a - b),
      recall = recalls.reduce((s, v) => s + v, 0) / recalls.length;
    const warmP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const warmBudgetMs = mode === "portable" ? 900 : 2500;
    report.query = {
      count: timings.length,
      warmCount: sorted.length,
      coldMs: timings[0],
      warmP50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
      warmP95Ms,
      recallAt20: recall,
      eachRecall: recalls,
      timingsMs: timings,
      filterSelectivity: 0.8,
    };
    report.gates = {
      recall: { minimum: 0.98, actual: recall, passed: recall >= 0.98 },
      warmLatency: {
        maximumMs: warmBudgetMs,
        actualMs: warmP95Ms,
        passed: warmP95Ms <= warmBudgetMs,
      },
    };
    assert(recall >= 0.98, "Recall@20 is below0.98");
    assert(warmP95Ms <= warmBudgetMs, "Warm P95 exceeds the frozen profile budget");
    await backend.close();
    backend =
      mode === "portable"
        ? createPortableVectorBackend({ path: dbPath })
        : createLanceVectorBackend(path.join(output, "lance"));
    const reopened = await backend.search({
      namespaceId,
      workspaceId: "agent-workspace",
      generationId: generation.generationId,
      space,
      vector: restartVector!,
      limit: 1,
      eligibleIds: [ids[1]],
    });
    assert.equal(reopened[0]?.id, ids[1]);
    report.restart = { status: "pass" };
    const size = async (dir: string): Promise<number> => {
      let bytes = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        bytes += entry.isDirectory() ? await size(file) : (await stat(file)).size;
      }
      return bytes;
    };
    report.diskBytes = await size(output);
    report.peakRssBytes = peakRss;
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    report.peakRssBytes = peakRss;
    clearInterval(sample);
    await backend.close();
    closeOpenClawStateDatabase();
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify(report));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
