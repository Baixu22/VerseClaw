import { parentPort, workerData } from "node:worker_threads";
import { isDeepStrictEqual } from "node:util";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { normalizeKnowledgeSourceDocument } from "./source-document.js";
import { chunkKnowledgeDocument } from "./chunker.js";
import { ProjectionStore } from "./projection-store.js";
import {
  lexicalProjectionProfile,
  lexicalProjectionProfileDigest,
  lexicalProjectionTokenizer,
} from "./index-profile.js";
import type { ProjectionWorkerInput } from "./index-worker.js";

async function main() {
  if (!parentPort) throw new Error("Projection worker requires a parent");
  const port = parentPort;
  const input = workerData as ProjectionWorkerInput & { nonce: string };
  try {
    if (input.kind === "cleanup") {
      new ProjectionStore({ database: { path: input.databasePath } }).cleanup(input.sourceKey);
      port.postMessage({ nonce: input.nonce, kind: "published" });
      return;
    }
    if (
      input.job.profileDigest !== lexicalProjectionProfileDigest ||
      !isDeepStrictEqual(input.job.source, input.snapshot.source)
    )
      throw new Error("Projection source or profile changed");
    const document = normalizeKnowledgeSourceDocument({
      snapshot: input.snapshot,
      context: input.snapshot.context,
    });
    const chunks = chunkKnowledgeDocument(document, {
      context: input.snapshot.context,
      profile: lexicalProjectionProfile,
      tokenizer: lexicalProjectionTokenizer,
    });
    const permitted = new Promise<boolean>((resolve) => {
      port.once("message", (message: { nonce?: string; kind?: string; allowed?: boolean }) => {
        resolve(
          message.nonce === input.nonce && message.kind === "commit" && message.allowed === true,
        );
      });
    });
    port.postMessage({ nonce: input.nonce, kind: "prepared" });
    if (!(await permitted)) throw new Error("Owner rejected projection publication");
    const store = new ProjectionStore({ database: { path: input.databasePath } });
    const generation = store.publish(input.job, chunks);
    port.postMessage({ nonce: input.nonce, kind: "published", generation });
  } catch (error) {
    port.postMessage({
      nonce: input.nonce,
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // The long-lived owner checkpoints this shared WAL. A per-job TRUNCATE
    // waits for concurrent readers and can stall both publication and Gateway RPC.
    closeOpenClawStateDatabase({ checkpoint: false });
    port.close();
  }
}
void main();
