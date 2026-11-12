import path from "node:path";
import {
  ProjectionStore,
  VectorStore,
  waitForRetrievalOperation,
  type EmbeddingSpaceV1,
  type VectorBackendId,
  type VectorProjectionBackend,
  type VectorProjectionV1,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import {
  digestOwnerReadContent,
  evaluateOwnerReadSnapshot,
  matchOwnerReadPin,
} from "openclaw/plugin-sdk/memory-host-core";
import { resolveStateDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";
import type { OpenClawConfig } from "../../api.js";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  type MemoryWikiReadIdentity,
} from "../owner-read.js";
import { getMemoryWikiPage } from "../query.js";
import type { MemoryWikiEmbeddingService } from "../retrieval-embeddings.js";
import type { MemoryWikiProjectionService } from "../retrieval-index.js";
import { createLanceVectorBackend, createPortableVectorBackend } from "./vector-backends.js";

type Selection = { enabled: boolean; backend: VectorBackendId; identity: MemoryWikiReadIdentity };
type VectorState = "disabled" | "building" | "ready" | "unavailable" | "cancelled";

/** Wiki owns source events and raw reads; SQLite owns the one active backend pointer. */
export function createMemoryWikiVectorService(options: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  embedding: Pick<MemoryWikiEmbeddingService, "embed" | "status">;
  projection: Pick<MemoryWikiProjectionService, "enable" | "idle">;
  openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;
}) {
  const namespaceId = memoryWikiNamespaceId(options.config),
    store = new VectorStore(),
    chunks = new ProjectionStore();
  const key = digestOwnerReadContent(options.config.vault.path);
  const state = () =>
    options.openKeyedStore<Selection>({ namespace: "retrieval-vector-selection", maxEntries: 16 });
  const backends: Record<VectorBackendId, VectorProjectionBackend> = {
    "sqlite-flat": createPortableVectorBackend(),
    // UUID table identities already separate namespaces. Avoid a second long
    // digest directory so native Windows dataset paths fit ordinary profiles.
    "lancedb-ann": createLanceVectorBackend(path.join(resolveStateDir(), "ann")),
  };
  let selected: Selection | undefined;
  let effective: VectorBackendId = "sqlite-flat";
  let phase: VectorState = "disabled";
  let reason: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let abort = new AbortController();
  let pending: Promise<void> | undefined;
  // Drain one activation before another configure/disable can install its timer.
  let control: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>) => {
    const next = control.then(operation);
    control = next.catch(() => undefined);
    return next;
  };
  let observedManifest = "";
  let observedSourceManifest = "";
  const maintenance = new Set<"rebuild" | "optimize">();
  const sameScope = (identity: MemoryWikiReadIdentity) =>
    !selected ||
    ["workspaceId", "workspaceDir", "agentSessionKey", "sessionId"].every(
      (field) =>
        identity[field as keyof MemoryWikiReadIdentity] ===
        selected!.identity[field as keyof MemoryWikiReadIdentity],
    );
  const assertScope = (identity: MemoryWikiReadIdentity, replacing = false) => {
    if (
      !identity.workspaceId ||
      !identity.sessionId ||
      !identity.agentSessionKey ||
      !identity.workspaceDir
    )
      throw new Error("Vector index requires trusted workspace/session identity");
    if (!replacing && !sameScope(identity)) throw new Error("Vector index scope changed");
    const current = createMemoryWikiReadContext({
      config: options.config,
      appConfig: options.appConfig,
      identity,
    });
    if (current.sessionId !== identity.sessionId)
      throw new Error("Vector physical session generation changed");
    return current;
  };
  const currentSpace = (identity: MemoryWikiReadIdentity): EmbeddingSpaceV1 => {
    const status = options.embedding.status(identity);
    if (status.status !== "ready" || status.capability?.status !== "ready")
      throw new Error("Embedding must be ready before vector indexing");
    return status.capability.space;
  };
  const currentChunks = () => {
    const rows: ReturnType<ProjectionStore["currentChunks"]> = [];
    for (let offset = 0; ; offset += 512) {
      const batch = chunks.currentChunks(namespaceId, offset);
      rows.push(...batch);
      if (rows.length > 100_000) throw new Error("Vector reference capacity exceeds100000 chunks");
      if (batch.length < 512) break;
    }
    return rows;
  };
  const vectorId = (chunk: ReturnType<typeof currentChunks>[number], space: EmbeddingSpaceV1) =>
    digestOwnerReadContent(
      JSON.stringify([
        namespaceId,
        chunk.chunk.chunkId,
        chunk.chunk.chunkDigest,
        chunk.generationId,
        space.spaceId,
      ]),
    );
  const synchronize = async (force: boolean) => {
    if (!selected?.enabled) return;
    const identity = selected.identity,
      signal = abort.signal;
    assertScope(identity);
    const space = currentSpace(identity);
    const desired = selected.backend;
    const capability = await backends[desired].capability();
    effective = capability.available ? desired : "sqlite-flat";
    reason = capability.available ? undefined : capability.reason;
    const limit = effective === "sqlite-flat" ? 20_000 : 100_000;
    const sourceManifest = digestOwnerReadContent(
      JSON.stringify([
        space.spaceId,
        effective,
        chunks
          .sources(namespaceId)
          .map((source) => [
            source.sourceKey,
            source.intentSequence,
            source.eligible,
            source.activeGeneration,
          ]),
      ]),
    );
    // Owner generation changes are the event hint. Materialize all chunk rows
    // only after that hint changes, not on every timer tick for a100k index.
    if (!force && sourceManifest === observedSourceManifest) return;
    const sourceRows = currentChunks();
    if (sourceRows.length > limit)
      throw new Error(`Effective ${effective} capacity is${limit} eligible chunks`);
    const manifest = digestOwnerReadContent(
      JSON.stringify([
        space.spaceId,
        effective,
        sourceRows.map((row) => [row.generationId, row.chunk.chunkId, row.chunk.chunkDigest]),
      ]),
    );
    if (!force && manifest === observedManifest) {
      observedSourceManifest = sourceManifest;
      return;
    }
    const previous = store.active(namespaceId, identity.workspaceId!, space.spaceId);
    let target = force ? undefined : previous;
    if (target?.backend !== effective) target = undefined;
    const existing = new Set(target ? store.ids(target) : []);
    if (target && !(await backends[effective].hasGeneration(target, existing))) {
      // A native table that differs from SQLite receipts loses eligibility before rebuilding.
      store.fail(target);
      target = undefined;
      existing.clear();
    }
    const building = !target;
    target ??= store.begin(namespaceId, identity.workspaceId!, space, effective);
    const backend = backends[effective];
    phase = "building";
    try {
      const wantedRows = new Map(sourceRows.map((row) => [vectorId(row, space), row]));
      const sameVectorSource = (projection: VectorProjectionV1) => {
        const current = wantedRows.get(projection.id);
        return (
          current !== undefined &&
          projection.chunkId === current.chunk.chunkId &&
          projection.chunkDigest === current.chunk.chunkDigest &&
          projection.sourceGeneration === current.generationId &&
          JSON.stringify(projection.source) === JSON.stringify(current.chunk.source) &&
          projection.vector.length === space.dimensions
        );
      };
      if (building && previous) {
        // SQLite retains the vector bytes needed to repair a native index or
        // switch backends without sending unchanged documents to the provider again.
        for (let offset = 0; ; offset += 512) {
          signal.throwIfAborted();
          const page = store.rows(previous, offset);
          const reusable: VectorProjectionV1[] = page.flatMap((row) => {
            const bytes = Buffer.from(row.vector);
            const projection: VectorProjectionV1 = {
              schema: "VectorProjection/v1",
              id: row.id,
              generationId: target!.generationId,
              namespaceId,
              workspaceId: identity.workspaceId!,
              spaceId: space.spaceId,
              chunkId: row.chunk_id,
              chunkDigest: row.chunk_digest,
              sourceGeneration: row.source_generation,
              source: JSON.parse(row.source_ref_json),
              vector: Array.from({ length: row.dimensions }, (_, index) =>
                bytes.readFloatLE(index * 4),
              ),
            };
            return sameVectorSource(projection) ? [projection] : [];
          });
          await backend.write(target, space, reusable, signal);
          if (effective !== "sqlite-flat") store.write(target, space, reusable);
          reusable.forEach((row) => existing.add(row.id));
          if (page.length < 512) break;
        }
      }
      const missing = sourceRows.filter((row) => !existing.has(vectorId(row, space)));
      const missingIds = new Set(missing.map((row) => vectorId(row, space)));
      for (let offset = 0; offset < missing.length; offset += 8) {
        signal.throwIfAborted();
        assertScope(identity);
        if (currentSpace(identity).spaceId !== space.spaceId)
          throw new Error("Embedding space changed while building vectors");
        const batch = missing.slice(offset, offset + 8);
        const result = await options.embedding.embed(identity, {
          kind: "document",
          sources: batch.map((row) => row.chunk.source),
          expectedSpaceId: space.spaceId,
          signal,
        });
        signal.throwIfAborted();
        assertScope(identity);
        if (result.vectors.length !== batch.length)
          throw new Error("Vector embedding count mismatch");
        batch.forEach((row) => missingIds.delete(vectorId(row, space)));
        const rows: VectorProjectionV1[] = batch.map((row, index) => ({
          schema: "VectorProjection/v1",
          id: vectorId(row, space),
          generationId: target!.generationId,
          namespaceId,
          workspaceId: identity.workspaceId!,
          spaceId: space.spaceId,
          chunkId: row.chunk.chunkId,
          chunkDigest: row.chunk.chunkDigest,
          sourceGeneration: row.generationId,
          source: row.chunk.source,
          vector: result.vectors[index],
        }));
        // Native writes are idempotent and precede the canonical row receipt.
        // A crash retries the missing SQLite receipt instead of skipping native rows.
        await backend.write(target, space, rows, signal);
        if (effective !== "sqlite-flat") store.write(target, space, rows);
      }
      for (const id of [...existing].filter((id) => !wantedRows.has(id))) {
        await backend.deleteRows(target, [id]);
        if (effective !== "sqlite-flat") store.deleteRows(target, [id]);
      }
      if (missingIds.size) throw new Error("Vector generation is incomplete");
      signal.throwIfAborted();
      assertScope(identity);
      if (
        manifest !==
        digestOwnerReadContent(
          JSON.stringify([
            currentSpace(identity).spaceId,
            effective,
            currentChunks().map((row) => [
              row.generationId,
              row.chunk.chunkId,
              row.chunk.chunkDigest,
            ]),
          ]),
        )
      ) {
        throw new Error("Source generation changed while publishing vector projection");
      }
      if (building && !store.publish(target, sourceRows.length))
        throw new Error("Vector generation was superseded");
      observedManifest = manifest;
      observedSourceManifest = sourceManifest;
      phase = "ready";
      for (const old of store
        .generations(namespaceId)
        .filter((row) => row.generationId !== target!.generationId && row.state !== "active")) {
        await backends[old.backend].remove(old);
        store.remove(old);
      }
    } catch (error) {
      if (building) store.fail(target);
      throw error;
    }
  };
  const finishPending = () => {
    pending = undefined;
    if (abort.signal.aborted || !selected?.enabled) return;
    const action = maintenance.values().next().value;
    if (!action) return;
    maintenance.delete(action);
    void (action === "rebuild" ? reconcile(true) : optimizeCurrent()).catch(() => undefined);
  };
  const reconcile = (force = false): Promise<void> => {
    if (pending) {
      if (force) maintenance.add("rebuild");
      return pending;
    }
    pending = synchronize(force)
      .catch((error) => {
        phase = abort.signal.aborted ? "cancelled" : "unavailable";
        reason = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(finishPending);
    return pending;
  };
  const optimizeCurrent = (): Promise<void> => {
    if (pending) {
      maintenance.add("optimize");
      return pending;
    }
    pending = (async () => {
      const identity = selected!.identity;
      const space = currentSpace(identity);
      const generation = store.active(namespaceId, identity.workspaceId!, space.spaceId);
      if (!generation) throw new Error("Vector generation is unavailable");
      await backends[generation.backend].optimize(generation, abort.signal);
    })()
      .catch((error) => {
        reason = error instanceof Error ? error.message : String(error);
        phase = "unavailable";
        throw error;
      })
      .finally(finishPending);
    return pending;
  };
  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    maintenance.clear();
    abort.abort(new Error("Vector index stopped"));
    await pending?.catch(() => undefined);
    await Promise.all(Object.values(backends).map(async (backend) => backend.close()));
  };
  const activate = async (selection: Selection) => {
    await stop();
    selected = selection;
    abort = new AbortController();
    store.recover(namespaceId);
    observedManifest = "";
    observedSourceManifest = "";
    phase = "building";
    // The existing lexical projection remains the only source lifecycle owner.
    const signal = abort.signal;
    const preparation = (async () => {
      await options.projection.enable(selection.identity);
      signal.throwIfAborted();
      await options.projection.idle(selection.identity);
    })();
    // The lexical owner may keep working; cancelling vector activation only
    // detaches this wait, so disable never queues behind a full lexical rebuild.
    pending = waitForRetrievalOperation(preparation, signal)
      .then(() => {
        signal.throwIfAborted();
        return synchronize(false);
      })
      .catch((error) => {
        phase = signal.aborted ? "cancelled" : "unavailable";
        reason = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(finishPending);
    void pending.catch(() => undefined);
    timer = setInterval(() => {
      void reconcile().catch(() => undefined);
    }, 1500);
    timer.unref();
  };
  return {
    start: () =>
      enqueue(async () => {
        const saved = await state().lookup(key);
        if (saved?.enabled) {
          try {
            assertScope(saved.identity);
            await activate(saved);
          } catch {
            phase = "unavailable";
            reason = "Saved vector scope is unavailable";
          }
        }
      }),
    enable: (identity: MemoryWikiReadIdentity, backend: VectorBackendId) =>
      enqueue(async () => {
        assertScope(identity, true);
        currentSpace(identity);
        const selection = { enabled: true, backend, identity: structuredClone(identity) };
        await state().register(key, selection);
        await activate(selection);
      }),
    disable: (identity: MemoryWikiReadIdentity) =>
      enqueue(async () => {
        assertScope(identity);
        await stop();
        await state().delete(key);
        selected = undefined;
        phase = "disabled";
      }),
    async idle(identity: MemoryWikiReadIdentity) {
      await control;
      assertScope(identity);
      do {
        await reconcile();
        assertScope(identity);
      } while (pending);
    },
    rebuild: (identity: MemoryWikiReadIdentity) =>
      enqueue(async () => {
        assertScope(identity);
        if (!selected?.enabled) throw new Error("Vector index is disabled");
        if (pending) maintenance.add("rebuild");
        else void reconcile(true).catch(() => undefined);
      }),
    optimize: (identity: MemoryWikiReadIdentity) =>
      enqueue(async () => {
        assertScope(identity);
        if (!selected?.enabled) throw new Error("Vector index is disabled");
        if (pending) maintenance.add("optimize");
        else void optimizeCurrent().catch(() => undefined);
      }),
    snapshot(identity: MemoryWikiReadIdentity) {
      assertScope(identity, true);
      if (!selected?.enabled || !sameScope(identity)) return undefined;
      const space = currentSpace(identity);
      const generation = store.active(namespaceId, identity.workspaceId!, space.spaceId);
      return generation
        ? {
            generationId: generation.generationId,
            spaceId: space.spaceId,
            credentialEpoch: options.embedding.status(identity).credentialEpoch,
          }
        : undefined;
    },
    async status(identity: MemoryWikiReadIdentity) {
      assertScope(identity, true);
      if (!selected?.enabled || !sameScope(identity))
        return {
          status: "disabled" as const,
          requestedBackend: null,
          effectiveBackend: "sqlite-flat" as const,
          capability: await backends["sqlite-flat"].capability(),
          reason: null,
          generation: null,
          indexing: false,
        };
      const capability = await backends[selected?.backend ?? "sqlite-flat"].capability();
      let space: EmbeddingSpaceV1 | undefined;
      try {
        space = currentSpace(identity);
      } catch {
        /* Provider state is reported independently. */
      }
      const active = space
        ? store.active(namespaceId, identity.workspaceId!, space.spaceId)
        : undefined;
      return {
        status: phase,
        requestedBackend: selected?.backend ?? null,
        effectiveBackend: active?.backend ?? effective,
        capability,
        reason: reason ?? null,
        generation: active ?? null,
        indexing: Boolean(pending),
      };
    },
    async search(
      identity: MemoryWikiReadIdentity,
      text: string,
      limit = 10,
      request?: { signal?: AbortSignal; deadlineAt?: number },
    ) {
      const context = assertScope(identity),
        space = currentSpace(identity);
      if (!selected?.enabled)
        return { status: "unavailable", reason: "vector_index_disabled", candidates: [] };
      // Keep this query attached to its original activation through every await.
      // A later enable must not replace the signal of a disabled query.
      const signal = request?.signal
        ? AbortSignal.any([abort.signal, request.signal])
        : abort.signal;
      signal.throwIfAborted();
      const active = store.active(namespaceId, identity.workspaceId!, space.spaceId);
      if (!active)
        return { status: "unavailable", reason: "vector_generation_unavailable", candidates: [] };
      const query = await options.embedding.embed(identity, {
        kind: "query",
        text,
        expectedSpaceId: space.spaceId,
        signal,
        deadlineAt: request?.deadlineAt,
      });
      signal.throwIfAborted();
      const eligibleIds = store.eligibleIds(active);
      const hits = await backends[active.backend].search({
        namespaceId,
        workspaceId: identity.workspaceId!,
        generationId: active.generationId,
        space,
        vector: query.vectors[0],
        limit,
        eligibleIds,
        signal,
      });
      signal.throwIfAborted();
      const rows = new Map(
        store
          .lookup(
            active,
            hits.map((hit) => hit.id),
          )
          .map((row) => [row.id, row]),
      );
      const denied = new Set<string>();
      const deniedReasons: Array<{ namespaceId: string; subjectId: string; reason: string }> = [];
      const candidates: Array<{
        id: string;
        chunkId: string;
        sourceRef: VectorProjectionV1["source"];
        distance: number;
        quote: string;
      }> = [];
      for (const hit of hits) {
        const row = rows.get(hit.id);
        if (!row || denied.has(row.source.subjectId)) continue;
        const page = await getMemoryWikiPage({
          config: options.config,
          appConfig: options.appConfig,
          lookup: row.source.subjectId,
          sourceRef: row.source,
          lineCount: Number.MAX_SAFE_INTEGER,
          readIdentity: identity,
        });
        signal.throwIfAborted();
        const freshContext = assertScope(identity);
        if (
          !page?.ownerSnapshot ||
          page.status === "denied" ||
          page.ownerSnapshot.contentDigest !== row.chunkDigest ||
          matchOwnerReadPin(page.ownerSnapshot, row.source) ||
          evaluateOwnerReadSnapshot(page.ownerSnapshot, freshContext)
        ) {
          denied.add(row.source.subjectId);
          deniedReasons.push({
            namespaceId,
            subjectId: row.source.subjectId,
            reason: page?.reason ?? "owner-read-rejected",
          });
          continue;
        }
        candidates.push({
          id: row.id,
          chunkId: row.chunkId,
          sourceRef: page.ownerSnapshot.source,
          distance: hit.distance,
          quote: page.ownerSnapshot.content,
        });
      }
      signal.throwIfAborted();
      assertScope(identity);
      if (
        store.active(namespaceId, identity.workspaceId!, currentSpace(identity).spaceId)
          ?.generationId !== active.generationId
      )
        throw new Error("Vector backend changed during query");
      const stillEligible = new Set(store.eligibleIds(active));
      return {
        status: "available",
        denied: deniedReasons,
        effectiveBackend: active.backend,
        generationId: active.generationId,
        contextId: context.contextId,
        candidates: candidates.filter(
          (row) => stillEligible.has(row.id) && !denied.has(row.sourceRef.subjectId),
        ),
      };
    },
    stop: () => enqueue(stop),
  };
}

export type MemoryWikiVectorService = ReturnType<typeof createMemoryWikiVectorService>;
