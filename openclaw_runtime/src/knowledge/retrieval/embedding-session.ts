import { randomUUID } from "node:crypto";
import type { RetrievalSpendCall } from "./spend.js";
import type { EmbeddingProvider } from "../../plugins/embedding-provider-types.js";
import {
  digestOwnerReadContent,
  evaluateOwnerReadSnapshot,
  matchOwnerReadPin,
  type OwnerReadSnapshotV1,
  type ReadAdmissionContextV1,
  type SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";
import {
  assertSameEmbeddingSpace,
  checkEmbeddingInputBudget,
  formatEmbeddingInput,
  validateEmbeddingVector,
  type EmbeddingSpaceV1,
} from "./embedding-space.js";

export type EmbeddingJobV1 = {
  schema: "EmbeddingJob/v1";
  jobId: string;
  spaceId: string;
  credentialEpoch: number;
  state: "running" | "complete" | "cancelled" | "failed";
  inputKind: "query" | "document";
  inputCount: number;
  cacheHits: number;
};

type SessionOptions = {
  workspaceId: string;
  credentialEpoch: number;
  transport: "local" | "remote";
  provider: EmbeddingProvider;
  space: EmbeddingSpaceV1;
  tokenizer: Parameters<typeof checkEmbeddingInputBudget>[2];
  read: (source: SourceRefV2, signal: AbortSignal) => Promise<OwnerReadSnapshotV1>;
  refreshContext?: () => ReadAdmissionContextV1;
};

/** Cancel the caller's wait even when an adapter ignores its signal. Late values stay detached. */
export function waitForRetrievalOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) {
      operation.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** One prepared provider/space and bounded cache per workspace and credential generation. */
export class KnowledgeEmbeddingSession {
  private readonly abort = new AbortController();
  private readonly cache = new Map<string, number[]>();
  private readonly jobs = new Map<string, EmbeddingJobV1>();

  constructor(private readonly options: SessionOptions) {
    if (!Number.isSafeInteger(options.credentialEpoch) || options.credentialEpoch < 1) {
      throw new Error("Embedding credential generation is invalid");
    }
    if (!options.workspaceId) throw new Error("Embedding workspace is required");
    assertSameEmbeddingSpace(options.space, options.space);
  }

  status(): EmbeddingJobV1[] {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  private assertContext(context: ReadAdmissionContextV1) {
    this.abort.signal.throwIfAborted();
    if (
      context.schema !== "ReadAdmissionContext/v1" ||
      context.purpose !== "knowledge-read" ||
      context.workspaceId !== this.options.workspaceId ||
      !Number.isFinite(Date.parse(context.expiresAt)) ||
      Date.parse(context.expiresAt) <= Date.now()
    ) {
      throw new Error("Embedding context is invalid or expired");
    }
    if (
      this.options.transport === "remote" &&
      !context.egressProviderRefs.includes(this.options.space.providerRef)
    ) {
      throw new Error("Embedding egress is denied");
    }
  }

  async embed(
    input:
      | {
          kind: "query";
          text: string;
          context: ReadAdmissionContextV1;
          space: EmbeddingSpaceV1;
          signal?: AbortSignal;
          deadlineAt?: number;
          remoteSpend?: RetrievalSpendCall;
        }
      | {
          kind: "document";
          sources: SourceRefV2[];
          context: ReadAdmissionContextV1;
          space: EmbeddingSpaceV1;
          signal?: AbortSignal;
          deadlineAt?: number;
          remoteSpend?: RetrievalSpendCall;
        },
  ): Promise<{ vectors: number[][]; job: EmbeddingJobV1 }> {
    this.assertContext(input.context);
    assertSameEmbeddingSpace(this.options.space, input.space);
    let currentContext = input.context;
    const assertCurrentContext = () => {
      if (Date.now() >= deadlineAt) throw new Error("Embedding total deadline exceeded");
      const fresh = this.options.refreshContext?.();
      if (fresh) {
        const identityKeys = [
          "principalId",
          "sessionId",
          "sessionKey",
          "agentId",
          "workspaceId",
          "workspaceRootDigest",
          "policyDigest",
        ] as const;
        if (identityKeys.some((key) => fresh[key] !== input.context[key])) {
          throw new Error("Embedding owner context changed during the operation");
        }
        currentContext = fresh;
      }
      this.assertContext(currentContext);
    };
    const deadlineAt = input.deadlineAt ?? Date.now() + 120_000;
    if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now())
      throw new Error("Embedding total deadline exceeded");
    const signal = AbortSignal.any([
      this.abort.signal,
      ...(input.signal ? [input.signal] : []),
      AbortSignal.timeout(Math.min(120_000, Math.ceil(deadlineAt - Date.now()))),
    ]);
    signal.throwIfAborted();
    const count = input.kind === "query" ? 1 : input.sources.length;
    if (count < 1 || count > 64) throw new Error("Embedding input count must be between 1 and 64");
    if (input.kind === "query" && input.text.length > 96_000) {
      throw new Error("Embedding query exceeds the character budget");
    }
    if (
      input.kind === "document" &&
      input.sources.some(
        (source) =>
          !source.locator || source.locator.endByteExclusive - source.locator.startByte > 384_000,
      )
    ) {
      throw new Error("Embedding documents require bounded owner locators");
    }
    if ([...this.jobs.values()].filter((job) => job.state === "running").length >= 4) {
      throw new Error("Embedding session is at its active job limit");
    }
    const job: EmbeddingJobV1 = {
      schema: "EmbeddingJob/v1",
      jobId: randomUUID(),
      spaceId: this.options.space.spaceId,
      credentialEpoch: this.options.credentialEpoch,
      state: "running",
      inputKind: input.kind,
      inputCount: count,
      cacheHits: 0,
    };
    this.jobs.set(job.jobId, job);
    while (this.jobs.size > 32) {
      const terminal = [...this.jobs].find(([, value]) => value.state !== "running");
      if (!terminal) break;
      this.jobs.delete(terminal[0]);
    }
    const read = async (source: SourceRefV2) => {
      signal.throwIfAborted();
      assertCurrentContext();
      const snapshot = await waitForRetrievalOperation(this.options.read(source, signal), signal);
      if (snapshot.content.length > 96_000)
        throw new Error("Embedding document exceeds the character budget");
      assertCurrentContext();
      const denied = evaluateOwnerReadSnapshot(snapshot, currentContext, {
        stage: "embedding",
        ...(this.options.transport === "remote"
          ? { providerRef: this.options.space.providerRef }
          : {}),
        signal,
      });
      if (denied) throw new Error(`Embedding owner read denied: ${denied}`);
      const changed = matchOwnerReadPin(snapshot, source);
      if (changed) throw new Error(`Embedding owner pin changed: ${changed}`);
      return snapshot;
    };
    try {
      const vectors: number[][] = [];
      for (let offset = 0; offset < count; offset += 8) {
        signal.throwIfAborted();
        assertCurrentContext();
        const sources = input.kind === "document" ? input.sources.slice(offset, offset + 8) : [];
        const snapshots: OwnerReadSnapshotV1[] = [];
        for (const source of sources) snapshots.push(await read(source));
        const texts =
          input.kind === "query"
            ? [formatEmbeddingInput(this.options.space, "query", input.text)]
            : snapshots.map((snapshot) =>
                formatEmbeddingInput(
                  this.options.space,
                  "document",
                  snapshot.content,
                  snapshot.title,
                ),
              );
        for (const text of texts) {
          await waitForRetrievalOperation(
            checkEmbeddingInputBudget(this.options.space, text, this.options.tokenizer, signal),
            signal,
          );
        }
        signal.throwIfAborted();
        assertCurrentContext();
        // Owner pins and admission are checked before a cache hit as well as a provider call.
        const keys = texts.map((text, index) =>
          digestOwnerReadContent(
            JSON.stringify([
              this.options.workspaceId,
              this.options.credentialEpoch,
              this.options.space.spaceId,
              input.kind,
              text,
              snapshots[index]?.source,
            ]),
          ),
        );
        const missing = keys.flatMap((key, index) => (this.cache.has(key) ? [] : [index]));
        job.cacheHits += keys.length - missing.length;
        const remoteSpend = this.options.transport === "remote" ? input.remoteSpend : undefined;
        if (
          missing.length &&
          remoteSpend &&
          this.options.provider.requestAccounting !== "single-call-input-tokens"
        )
          throw new Error("remote-retrieval-usage-contract-unavailable");
        const fetchVectors = (onUsage?: (tokens: unknown) => void) =>
          this.options.provider.embedBatch(
            missing.map((index) => texts[index]),
            { inputType: input.kind, signal, onUsage },
          );
        const fetched = missing.length
          ? await waitForRetrievalOperation(
              remoteSpend
                ? remoteSpend(
                    {
                      providerRef: this.options.space.providerRef,
                      model: this.options.space.model,
                      texts: missing.map((index) => texts[index]),
                      signal,
                    },
                    fetchVectors,
                  )
                : fetchVectors(),
              signal,
            )
          : [];
        if (fetched.length !== missing.length) throw new Error("Embedding response count mismatch");
        const normalized = fetched.map((vector) =>
          validateEmbeddingVector(this.options.space, vector),
        );
        signal.throwIfAborted();
        assertCurrentContext();
        // Revocation while the provider is running must discard even a successful response.
        for (const source of sources) await read(source);
        missing.forEach((index, position) => this.cache.set(keys[index], normalized[position]));
        const batch = keys.map((key) => [...this.cache.get(key)!]);
        while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
        vectors.push(...batch);
      }
      signal.throwIfAborted();
      assertCurrentContext();
      job.state = "complete";
      return { vectors, job: { ...job } };
    } catch (error) {
      job.state = signal.aborted ? "cancelled" : "failed";
      throw error;
    }
  }

  async close(): Promise<void> {
    this.abort.abort(new Error("Embedding session closed"));
    this.cache.clear();
    await this.options.provider.close?.();
  }
}
