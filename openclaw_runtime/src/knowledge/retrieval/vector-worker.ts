import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { VectorHit, VectorSearchV1 } from "./vector-contracts.js";

/** One lifecycle-owned worker keeps a bounded, revision-checked vector snapshot. */
export function createPortableVectorSearch(database: { path?: string } | undefined) {
  const source = fileURLToPath(import.meta.url);
  const marker = source.replaceAll(path.sep, "/").lastIndexOf("/dist/");
  const target =
    marker >= 0
      ? pathToFileURL(
          path.join(source.slice(0, marker + 6), "knowledge/retrieval/vector.worker.js"),
        )
      : new URL("./vector.worker.ts", import.meta.url);
  let worker: Worker | undefined;
  let sequence = 0;
  const pending = new Map<number, (error?: Error, hits?: VectorHit[]) => void>();
  const stop = async (error: Error) => {
    const current = worker;
    worker = undefined;
    for (const finish of pending.values()) finish(error);
    if (current) await current.terminate();
  };
  const start = () => {
    const current = new Worker(target, {
      workerData: { database },
      execArgv: target.pathname.endsWith(".ts")
        ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]
        : [],
    });
    worker = current;
    current.on("message", (message: { id: number; error?: string; hits?: VectorHit[] }) => {
      if (worker === current)
        pending.get(message.id)?.(
          message.error ? new Error(message.error) : undefined,
          message.hits,
        );
    });
    current.on("error", (error) => {
      if (worker === current) void stop(error instanceof Error ? error : new Error(String(error)));
    });
    current.on("exit", (code) => {
      if (worker === current) void stop(new Error(`Vector worker exited ${code}`));
    });
    current.unref();
    return current;
  };
  return {
    async search(query: VectorSearchV1): Promise<VectorHit[]> {
      query.signal?.throwIfAborted();
      const { signal, ...input } = query;
      const current = worker ?? start();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const finish = (error?: Error, hits?: VectorHit[]) => {
          if (!pending.delete(id)) return;
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
          if (!pending.size) current.unref();
          if (error) reject(error);
          else resolve(hits!);
        };
        // Termination interrupts synchronous scoring; the next request opens a fresh worker.
        const abort = () => {
          void stop(new Error("Vector search cancelled"));
        };
        const timeout = setTimeout(() => {
          void stop(new Error("Vector search deadline exceeded"));
        }, 30_000);
        pending.set(id, finish);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        current.ref();
        try {
          current.postMessage({ id, query: input });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close: () => stop(new Error("Vector search closed")),
  };
}
