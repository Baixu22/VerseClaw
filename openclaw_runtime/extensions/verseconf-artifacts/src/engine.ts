import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SchemaIdentity } from "./types.js";

const RESEARCH_SCHEMA_URLS = [
  new URL("../schemas/research-source.schema.json", import.meta.url),
  new URL("./schemas/research-source.schema.json", import.meta.url),
];
export const RESEARCH_SCHEMA_PATH = RESEARCH_SCHEMA_URLS[0]!;
export const RESEARCH_SCHEMA_TEXT = (() => {
  for (const schemaUrl of RESEARCH_SCHEMA_URLS) {
    try {
      return readFileSync(schemaUrl, "utf8");
    } catch {
      // Source and bundled runtime layouts use different relative roots.
    }
  }
  throw new Error("research-source.schema.json is unavailable");
})();
export const RESEARCH_SCHEMA_IDENTITY: SchemaIdentity = {
  schemaId: "urn:clawx:research-comparison:v1",
  version: "research-comparison/v1",
  digest: `sha256:${createHash("sha256").update(RESEARCH_SCHEMA_TEXT, "utf8").digest("hex")}`,
  draft: "2020-12",
};
export const RESEARCH_RECORD_SPEC = { recordsPath: ["records"], idField: "id" } as const;

type ComputeWorkerLike = {
  call<T>(op: string, request: unknown, options?: { signal?: AbortSignal }): Promise<{ outcome: T }>;
  dispose(): Promise<unknown>;
};

type WorkerModule = { createComputeWorker: (options?: { profile?: "default" | "schema-validation"; workerPath?: string }) => ComputeWorkerLike };

type BatchChangeInput = { recordId: string; fieldPath: string[]; op: string; expect?: unknown; value?: unknown };
type InspectSelector = { recordId: string; fieldPath?: string[] };
type BusinessOutcomeLike = { ok: boolean; code?: string; message?: string; stage?: string; result?: unknown };

function resolveWorkerPath(): string {
  const candidates = [
    new URL("../vendor/verseconf/worker/compute-worker.mjs", import.meta.url),
    new URL("./vendor/verseconf/worker/compute-worker.mjs", import.meta.url),
  ];
  const workerUrl = candidates.find((candidate) => existsSync(fileURLToPath(candidate)));
  if (!workerUrl) throw new Error("VerseConf compute-worker.mjs is unavailable");
  return fileURLToPath(workerUrl);
}

async function loadWorker(options: { profile?: "default" | "schema-validation" } = {}): Promise<ComputeWorkerLike> {
  const module = await import("../vendor/verseconf/worker/index.mjs") as unknown as WorkerModule;
  return module.createComputeWorker({ ...options, workerPath: resolveWorkerPath() });
}

export class VerseConfComputeEngine {
  private readonly workerPromise: Promise<ComputeWorkerLike>;
  private readonly schemaWorkerPromise: Promise<ComputeWorkerLike>;

  constructor() {
    this.workerPromise = loadWorker();
    this.schemaWorkerPromise = loadWorker({ profile: "schema-validation" });
  }

  async capability(signal?: AbortSignal): Promise<BusinessOutcomeLike> {
    return this.call("capability", {}, signal);
  }

  async inspectRecord(source: string, selectors: InspectSelector[] = [], signal?: AbortSignal): Promise<BusinessOutcomeLike> {
    return this.call("inspect_record", { source, format: "json", spec: RESEARCH_RECORD_SPEC, selectors }, signal);
  }

  async applyBatch(source: string, changes: BatchChangeInput[], signal?: AbortSignal): Promise<BusinessOutcomeLike> {
    return this.call("apply_batch", { source, format: "json", spec: RESEARCH_RECORD_SPEC, changes }, signal);
  }

  async validateTrustedCandidate(
    baseline: string,
    candidate: string,
    schemaText = RESEARCH_SCHEMA_TEXT,
    identity: SchemaIdentity = RESEARCH_SCHEMA_IDENTITY,
    signal?: AbortSignal,
  ): Promise<BusinessOutcomeLike> {
    return this.call("validate_trusted_candidate", { baseline, candidate, format: "json", schemaText, identity }, signal);
  }

  async dispose(): Promise<void> {
    await Promise.all([(await this.workerPromise).dispose(), (await this.schemaWorkerPromise).dispose()]);
  }

  private async call(op: string, request: unknown, signal?: AbortSignal): Promise<BusinessOutcomeLike> {
    const worker = op === "validate_trusted_candidate" ? await this.schemaWorkerPromise : await this.workerPromise;
    const result = await worker.call<BusinessOutcomeLike>(op, request, { signal });
    return result.outcome;
  }
}

export function businessError(outcome: BusinessOutcomeLike): { code: string; message: string; stage?: string } | null {
  if (outcome.ok) return null;
  return { code: outcome.code ?? "business_rejected", message: outcome.message ?? "VerseConf rejected the request", stage: outcome.stage };
}
