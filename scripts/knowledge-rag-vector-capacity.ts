import assert from "node:assert/strict";
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
  const count = mode === "portable" ? 20_000 : 100_000,
    dimensions = 768;
  const space = createEmbeddingSpace({
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
  const generation = store.begin("agent-capacity", "agent-workspace", space, backend.id);
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);
  const report: Record<string, unknown> = {
    schema: "ProjectRagVectorCapacity/v1",
    actor: "codex/project-rag",
    driven_by: "agent",
    candidate: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
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
    fixture: {
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
    for (let offset = 0; offset < count; offset += 256) {
      const rows = Array.from({ length: Math.min(256, count - offset) }, (_, n) => {
        const id = offset + n,
          key = `v${String(id).padStart(6, "0")}`;
        ids.push(key);
        return {
          schema: "VectorProjection/v1" as const,
          id: key,
          generationId: generation.generationId,
          workspaceId: "agent-workspace",
          namespaceId: "agent-capacity",
          spaceId: space.spaceId,
          chunkId: "chunk-" + key,
          chunkDigest: digestOwnerReadContent(key),
          sourceGeneration: "source-" + Math.floor(id / 100),
          vector: vector(id),
          source: {
            schema: "SourceRef/v2" as const,
            domain: "wiki" as const,
            authorityId: "agent-fixture",
            namespaceId: "agent-capacity",
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
      });
      await backend.write(generation, space, rows);
      if (mode === "ann") store.write(generation, space, rows);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (offset % 4096 === 0) console.log("rows", offset, "/", count);
    }
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
      const q = vector(100_001 + queryId),
        start = performance.now();
      const hits = await backend.search({
        namespaceId: "agent-capacity",
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
          namespaceId: "agent-capacity",
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
        for (let i = 0; i < count; i++)
          if (i % 5 !== 0) {
            const v = vector(i);
            let dot = 0;
            for (let n = 0; n < dimensions; n++) dot += v[n] * q[n];
            gold.push({ id: ids[i], distance: 1 - dot });
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
      namespaceId: "agent-capacity",
      workspaceId: "agent-workspace",
      generationId: generation.generationId,
      space,
      vector: vector(1),
      limit: 1,
      eligibleIds: ["v000001"],
    });
    assert.equal(reopened[0]?.id, "v000001");
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
