import { parentPort, workerData } from "node:worker_threads";
import { VectorStore } from "./vector-store.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { VectorSearchV1 } from "./vector-contracts.js";

const store = new VectorStore(workerData.database);
parentPort?.on("message", ({ id, query }: { id: number; query: VectorSearchV1 }) => {
  try {
    parentPort?.postMessage({ id, hits: store.exactSearch(query) });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
parentPort?.on("close", () => closeOpenClawStateDatabase());
