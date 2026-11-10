import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { OwnerReadSnapshotV1 } from "../../runtime-core/knowledge-owner-read.js";
import type { ProjectionGeneration, ProjectionIndexJob } from "./projection-contracts.js";

export type ProjectionWorkerInput =
  | {
      kind: "build";
      job: ProjectionIndexJob;
      snapshot: OwnerReadSnapshotV1;
      databasePath: string;
    }
  | { kind: "cleanup"; sourceKey: string; databasePath: string; deadlineAt: number };

function workerUrl(): URL {
  const source = fileURLToPath(import.meta.url);
  const marker = source.replaceAll(path.sep, "/").lastIndexOf("/dist/");
  if (marker >= 0)
    return pathToFileURL(
      path.join(source.slice(0, marker + 6), "knowledge/retrieval/index.worker.js"),
    );
  return new URL(`./index.worker${path.extname(source) || ".js"}`, import.meta.url);
}

/** Build and SQLite publication stay off the event loop. The owner rechecks the pin before commit. */
export function runProjectionWorker(
  input: ProjectionWorkerInput,
  options: {
    signal?: AbortSignal;
    verifyBeforePublish: () => Promise<boolean>;
    workerUrl?: URL;
  },
): Promise<{ generation?: ProjectionGeneration; threadId: number }> {
  if (options.signal?.aborted) return Promise.reject(new Error("Projection worker cancelled"));
  const target = options.workerUrl ?? workerUrl();
  const nonce = randomUUID();
  const worker = new Worker(target, {
    workerData: { ...input, nonce },
    execArgv: target.pathname.endsWith(".ts")
      ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]
      : [],
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let verifying = false;
    const finish = (error?: Error, generation?: ProjectionGeneration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      worker.removeAllListeners();
      const threadId = worker.threadId;
      void worker
        .terminate()
        .then(() => (error ? reject(error) : resolve({ generation, threadId })), reject);
    };
    const abort = () => finish(new Error("Projection worker cancelled"));
    const remaining =
      (input.kind === "build" ? input.job.deadlineAt : input.deadlineAt) - Date.now();
    const leaseRemaining =
      input.kind === "build" ? (input.job.leaseExpiresAt ?? Date.now()) - Date.now() : remaining;
    const timeout = setTimeout(
      () => finish(new Error("Projection worker deadline exceeded")),
      Math.max(1, Math.min(remaining, leaseRemaining)),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    worker.once("error", (error) =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
    worker.once("exit", (code) => {
      if (!settled) finish(new Error(`Projection worker exited before receipt: ${code}`));
    });
    worker.on(
      "message",
      (message: {
        nonce?: string;
        kind?: string;
        generation?: ProjectionGeneration;
        error?: string;
      }) => {
        if (settled || message.nonce !== nonce) return;
        if (message.kind === "prepared" && !verifying) {
          verifying = true;
          void options.verifyBeforePublish().then(
            (allowed) => {
              if (!settled)
                worker.postMessage({
                  nonce,
                  kind: "commit",
                  allowed: allowed && !options.signal?.aborted,
                });
            },
            (error) => finish(error instanceof Error ? error : new Error(String(error))),
          );
        } else if (message.kind === "published") finish(undefined, message.generation);
        else if (message.kind === "failed")
          finish(new Error(message.error ?? "Projection worker failed"));
      },
    );
  });
}
