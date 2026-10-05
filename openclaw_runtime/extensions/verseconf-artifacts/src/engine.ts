import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SchemaIdentity } from "./types.js";
import type { ComputeWorker, ComputeProfile, BusinessOutcomeLike } from "../vendor/verseconf/worker/index.mjs";

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

type BatchChangeInput = { recordId: string; fieldPath: string[]; op: string; expect?: unknown; value?: unknown };
type InspectSelector = { recordId: string; fieldPath?: string[] };
function resolveDeliveryRoot(): URL {
  const candidates = [
    new URL("../", import.meta.url),
    new URL("./", import.meta.url),
  ];
  const root = candidates.find((candidate) => existsSync(fileURLToPath(new URL("verseconf-delivery-lock.json", candidate))));
  if (!root) throw new Error("VerseConf delivery lock is unavailable");
  return root;
}

async function loadWorker(options: { profile?: ComputeProfile } = {}): Promise<ComputeWorker> {
  const root = resolveDeliveryRoot();
  const lock = JSON.parse(readFileSync(new URL("verseconf-delivery-lock.json", root), "utf8")) as {
    packageVersion: string; wasmSha256: string; manifestSha256: string;
  };
  const manifestBytes = readFileSync(new URL("vendor/verseconf/delivery-manifest.json", root));
  if (createHash("sha256").update(manifestBytes).digest("hex") !== lock.manifestSha256) {
    throw new Error("VerseConf delivery manifest does not match the host lock");
  }
  // Runtime import preserves the module's own import.meta.url after the plugin is bundled.
  // This keeps the upstream availability check and worker paths inside the installed module.
  const moduleUrl = new URL("vendor/verseconf/worker/index.mjs", root);
  const module: typeof import("../vendor/verseconf/worker/index.mjs") = await import(moduleUrl.href);
  return module.createComputeWorker({ ...options, expectedVersion: lock.packageVersion, wasmExpectedSha256: lock.wasmSha256 });
}

export class VerseConfComputeEngine {
  private readonly workerPromise: Promise<ComputeWorker>;
  private readonly schemaWorkerPromise: Promise<ComputeWorker>;

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
