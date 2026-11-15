import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { IndexStatusV1 } from "../../../../shared/knowledge/operations.js";
import { getBackgroundWorkGate } from "../../resources/background-work-gate.js";
import { resolveOpenClawStateSqlitePath } from "../../state/openclaw-state-db.paths.js";
import type {
  OwnerReadSnapshotV1,
  ReadAdmissionContextV1,
  SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";
import { citationLocatorForChunk, verifyKnowledgeCitation } from "./citation.js";
import { lexicalProjectionProfileDigest } from "./index-profile.js";
import { runProjectionWorker } from "./index-worker.js";
import { ProjectionStore } from "./projection-store.js";

export type ProjectionOwnerAdapter = {
  namespaceId: string;
  list: () => Promise<string[]>;
  read: (
    source: string | SourceRefV2,
  ) => Promise<
    { status: "admitted"; snapshot: OwnerReadSnapshotV1 } | { status: "denied"; reason: string }
  >;
  subscribe: (
    hint: (subjectId: string | null) => void,
    error: (error: Error) => void,
  ) => () => void;
};

export class KnowledgeProjectionController {
  readonly #owner: ProjectionOwnerAdapter;
  readonly #databasePath: string;
  readonly #store: ProjectionStore;
  readonly #onError: (error: Error) => void;
  readonly #maxStorageBytes?: number;
  #paused = false;
  #stopped = true;
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setInterval>;
  #debounce?: ReturnType<typeof setTimeout>;
  #scan: Promise<void> = Promise.resolve();
  #scanInFlight?: Promise<void>;
  #running?: Promise<void>;
  #active?: { sourceKey: string; abort: AbortController };
  #lastError?: string;
  #workerThreadIds: number[] = [];

  constructor(options: {
    owner: ProjectionOwnerAdapter;
    databasePath?: string;
    maxStorageBytes?: number;
    paused?: boolean;
    onError: (error: Error) => void;
  }) {
    this.#owner = options.owner;
    this.#maxStorageBytes = options.maxStorageBytes;
    this.#paused = options.paused ?? false;
    this.#databasePath = options.databasePath ?? resolveOpenClawStateSqlitePath();
    this.#store = new ProjectionStore({ database: { path: this.#databasePath } });
    this.#onError = options.onError;
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    try {
      this.#store.recover(this.#owner.namespaceId);
      this.#unsubscribe = this.#owner.subscribe(
        (subject) => this.#hint(subject),
        (error) => this.#error(error),
      );
      this.#timer = setInterval(() => {
        void this.reconcile().catch((error) => this.#error(error));
      }, 1000);
      this.#timer.unref();
      await this.reconcile();
    } catch (error) {
      await this.stop();
      this.#error(error);
      throw error;
    }
  }

  #error(error: unknown) {
    const value = error instanceof Error ? error : new Error(String(error));
    this.#lastError = value.message;
    this.#onError(value);
  }

  #invalidate(source: SourceRefV2, reason: string) {
    return this.#store.observe({
      source,
      profileDigest: lexicalProjectionProfileDigest,
      eligible: false,
      reason,
      eventId: randomUUID(),
      deadlineAt: Date.now() + 60_000,
    });
  }

  #hint(subject: string | null) {
    if (this.#stopped) return;
    // Eligibility changes before the debounced scan. A late worker cannot
    // publish against the invalidated sequence, even when source bytes recur.
    try {
      for (const state of this.#store.sources(this.#owner.namespaceId)) {
        if (subject !== null && state.source.subjectId !== subject) continue;
        this.#invalidate(state.source, "owner-change-pending");
        if (this.#active?.sourceKey === state.sourceKey) this.#active.abort.abort();
      }
    } catch (error) {
      this.#active?.abort.abort();
      this.#error(error);
    }
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = undefined;
      void this.reconcile().catch((error) => this.#error(error));
    }, 100);
    this.#debounce.unref();
  }

  reconcile(force = false): Promise<void> {
    if (this.#scanInFlight && !force) return this.#scanInFlight;
    const operation = this.#scan.then(async () => {
      if (this.#stopped) return;
      let subjects: string[];
      try {
        subjects = await this.#owner.list();
      } catch (error) {
        for (const source of this.#store.sources(this.#owner.namespaceId))
          this.#invalidate(source.source, "owner_listing_failed");
        throw error;
      }
      if (this.#stopped) return;
      const seen = new Set(subjects);
      if (seen.size !== subjects.length || subjects.length > 1000)
        throw new Error("Owner source listing is not a bounded complete snapshot");
      for (const state of this.#store.sources(this.#owner.namespaceId)) {
        if (!seen.has(state.source.subjectId)) this.#invalidate(state.source, "not_found");
      }
      for (const subject of subjects) {
        if (this.#stopped) return;
        let result: Awaited<ReturnType<ProjectionOwnerAdapter["read"]>>;
        try {
          result = await this.#owner.read(subject);
        } catch (error) {
          const state = this.#store
            .sources(this.#owner.namespaceId)
            .find((row) => row.source.subjectId === subject);
          if (state) this.#invalidate(state.source, "owner_read_failed");
          throw error;
        }
        if (result.status === "denied") {
          const state = this.#store
            .sources(this.#owner.namespaceId)
            .find((row) => row.source.subjectId === subject);
          if (state) this.#invalidate(state.source, result.reason);
          continue;
        }
        if (
          result.snapshot.source.namespaceId !== this.#owner.namespaceId ||
          result.snapshot.truncated
        )
          throw new Error("Owner projection source is incomplete or mismatched");
        this.#store.observe({
          source: result.snapshot.source,
          profileDigest: lexicalProjectionProfileDigest,
          eligible: true,
          eventId: randomUUID(),
          deadlineAt: Date.now() + 60_000,
          force,
        });
      }
      this.#lastError = undefined;
      this.#pump();
    });
    this.#scan = operation.catch((error) => {
      this.#error(error);
    });
    this.#scanInFlight = operation;
    void operation
      .finally(() => {
        if (this.#scanInFlight === operation) this.#scanInFlight = undefined;
      })
      .catch(() => undefined);
    return operation;
  }

  #pump() {
    if (
      this.#stopped ||
      this.#paused ||
      this.#running ||
      getBackgroundWorkGate().shouldDefer("background")
    )
      return;
    const run = async () => {
      while (
        !this.#stopped &&
        !this.#paused &&
        !getBackgroundWorkGate().shouldDefer("background")
      ) {
        this.#store.recover(this.#owner.namespaceId);
        const job = this.#store.claim({
          namespaceId: this.#owner.namespaceId,
          leaseOwner: randomUUID(),
          leaseMs: 30_000,
        });
        if (!job) {
          // Retired generations remain the durable cleanup backlog. Repeating
          // cleanup after a crash is safe and never changes current eligibility.
          for (const source of this.#store.sources(this.#owner.namespaceId)) {
            if (this.#stopped || this.#paused || getBackgroundWorkGate().shouldDefer("background"))
              return;
            if (
              !this.#store
                .generations(source.sourceKey)
                .some((g) => g.generationId !== source.activeGeneration)
            )
              continue;
            const abort = new AbortController();
            this.#active = { sourceKey: source.sourceKey, abort };
            try {
              const receipt = await runProjectionWorker(
                {
                  kind: "cleanup",
                  sourceKey: source.sourceKey,
                  databasePath: this.#databasePath,
                  deadlineAt: Date.now() + 30_000,
                },
                { signal: abort.signal, verifyBeforePublish: async () => false },
              );
              this.#workerThreadIds = [...this.#workerThreadIds, receipt.threadId].slice(-32);
            } catch (error) {
              if (!abort.signal.aborted && !this.#stopped && !this.#paused) throw error;
            } finally {
              this.#active = undefined;
            }
          }
          return;
        }
        const abort = new AbortController();
        this.#active = { sourceKey: job.sourceKey, abort };
        try {
          const result = await this.#owner.read(job.source);
          if (
            result.status !== "admitted" ||
            !isDeepStrictEqual(result.snapshot.source, job.source)
          ) {
            this.#invalidate(
              job.source,
              result.status === "denied" ? result.reason : "source_pin_changed",
            );
            continue;
          }
          if (this.#maxStorageBytes && this.#storageBytes() >= this.#maxStorageBytes)
            throw new Error("index-storage-budget-exceeded");
          const receipt = await runProjectionWorker(
            { kind: "build", job, snapshot: result.snapshot, databasePath: this.#databasePath },
            {
              signal: abort.signal,
              verifyBeforePublish: async () => {
                if (this.#stopped || this.#paused) return false;
                // Staging may consume space, but a generation above the configured
                // database/WAL budget must never become the active projection.
                if (this.#maxStorageBytes && this.#storageBytes() > this.#maxStorageBytes)
                  throw new Error("index-storage-budget-exceeded");
                const current = await this.#owner.read(job.source);
                return (
                  current.status === "admitted" &&
                  isDeepStrictEqual(current.snapshot.source, job.source)
                );
              },
            },
          );
          this.#workerThreadIds = [...this.#workerThreadIds, receipt.threadId].slice(-32);
          this.#lastError = undefined;
        } catch (error) {
          this.#store.fail(job, error instanceof Error ? error.message : String(error), 500);
          if (!this.#stopped && !abort.signal.aborted) this.#error(error);
        } finally {
          this.#active = undefined;
        }
      }
    };
    this.#running = run()
      .catch((error) => this.#error(error))
      .finally(() => {
        this.#running = undefined;
      });
  }

  #storageBytes() {
    return [this.#databasePath, this.#databasePath + "-wal", this.#databasePath + "-shm"].reduce(
      (sum, file) => {
        try {
          return sum + statSync(file).size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return sum;
          throw error;
        }
      },
      0,
    );
  }

  async pause() {
    this.#paused = true;
    this.#active?.abort.abort();
    await this.#running;
  }

  async resume() {
    this.#paused = false;
    await this.reconcile();
  }

  status(): IndexStatusV1 {
    const jobs = this.#store.jobs(this.#owner.namespaceId);
    const sources = this.#store.sources(this.#owner.namespaceId);
    const currentFailure = jobs.some(
      (job) =>
        job.state === "failed" &&
        sources.some(
          (source) =>
            source.sourceKey === job.sourceKey && source.intentSequence === job.intentSequence,
        ),
    );
    const bytes = this.#storageBytes();
    const budgetExceeded = this.#maxStorageBytes !== undefined && bytes > this.#maxStorageBytes;
    return {
      schema: "IndexStatus/v1",
      status: this.#stopped
        ? "stopped"
        : this.#paused
          ? "paused"
          : budgetExceeded || this.#lastError || currentFailure
            ? "degraded"
            : "running",
      lastError: this.#lastError ?? null,
      sources: sources.map((source) => ({
        sourceKey: source.sourceKey,
        intentSequence: source.intentSequence,
        eligible: source.eligible,
        activeGeneration: source.activeGeneration,
        reason: source.reason,
      })),
      jobs: jobs.map((job) => ({
        jobId: job.jobId,
        state: job.state,
        attempt: job.attempt,
        error: job.error,
      })),
      activeWorker: Boolean(this.#active),
      workerThreadIds: [...this.#workerThreadIds],
      lagCount: sources.filter((source) => source.desiredEligible && !source.eligible).length,
      logicalDeletedCount: sources.filter((source) => source.reason === "not_found").length,
      cleanupPendingGenerations: sources.reduce(
        (sum, source) =>
          sum +
          this.#store
            .generations(source.sourceKey)
            .filter((generation) => generation.generationId !== source.activeGeneration).length,
        0,
      ),
      storage: { bytes, budgetBytes: this.#maxStorageBytes ?? null, budgetExceeded },
    };
  }

  async idle(timeoutMs = 60_000) {
    if (this.#paused) return;
    const deadline = Date.now() + timeoutMs;
    while (!this.#stopped) {
      const scan = this.#scan;
      await scan;
      this.#pump();
      if (this.#running) await this.#running;
      if (
        !this.#debounce &&
        this.#scan === scan &&
        !this.#store
          .jobs(this.#owner.namespaceId)
          .some((job) => job.state === "pending" || job.state === "leased")
      )
        return;
      if (Date.now() >= deadline)
        throw new Error("Projection did not become idle within its deadline");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async search(query: string, context: ReadAdmissionContextV1, limit = 10) {
    if (this.#stopped)
      return { status: "unavailable" as const, reason: "index_stopped", candidates: [] };
    const result = this.#store.search({
      namespaceId: this.#owner.namespaceId,
      query,
      context,
      limit,
    });
    if (result.status === "unavailable") return { ...result, candidates: [] };
    const candidates = [];
    const deniedParents = new Set<string>();
    const denied: Array<{ namespaceId: string; subjectId: string; reason: string }> = [];
    for (const hit of result.candidates) {
      const parentKey = JSON.stringify([hit.chunk.source.namespaceId, hit.chunk.source.subjectId]);
      if (deniedParents.has(parentKey)) continue;
      const current = await this.#owner.read(hit.chunk.source);
      if (current.status !== "admitted") {
        this.#invalidate(hit.chunk.source, current.reason);
        deniedParents.add(parentKey);
        denied.push({
          namespaceId: hit.chunk.source.namespaceId,
          subjectId: hit.chunk.source.subjectId,
          reason: current.reason,
        });
        continue;
      }
      const verified = verifyKnowledgeCitation({
        locator: citationLocatorForChunk(hit.chunk),
        snapshot: current.snapshot,
        context,
      });
      if (verified.status !== "exact-match") {
        this.#invalidate(hit.chunk.source, verified.reason);
        deniedParents.add(parentKey);
        denied.push({
          namespaceId: hit.chunk.source.namespaceId,
          subjectId: hit.chunk.source.subjectId,
          reason: verified.reason,
        });
        continue;
      }
      candidates.push({
        parentKey,
        generationId: hit.generationId,
        chunkId: hit.chunk.chunkId,
        sourceRef: current.snapshot.source,
        chunkDigest: hit.chunk.chunkDigest,
        quote: verified.quote,
        lexicalRank: hit.lexicalRank,
      });
    }
    const currentSources = this.#store.sources(this.#owner.namespaceId);
    return {
      status: "available" as const,
      denied,
      candidates: candidates
        .filter(
          (hit) =>
            !deniedParents.has(hit.parentKey) &&
            currentSources.some(
              (source) => source.eligible && source.activeGeneration === hit.generationId,
            ),
        )
        .map(({ parentKey: _parent, generationId: _generation, ...candidate }) => candidate),
    };
  }

  async stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#active?.abort.abort();
    await this.#scan;
    await this.#running;
  }
}
