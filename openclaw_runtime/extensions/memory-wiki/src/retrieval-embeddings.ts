import { freemem } from "node:os";
import path from "node:path";
import {
  createEmbeddingSpace,
  KnowledgeEmbeddingSession,
  type EmbeddingSpaceV1,
  type ProviderCapabilitySnapshotV1,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import {
  getEmbeddingProvider,
  type EmbeddingInput,
  type EmbeddingProvider,
} from "openclaw/plugin-sdk/embedding-providers";
import {
  createLocalEmbeddingProvider,
  DEFAULT_LOCAL_EMBEDDING_ARTIFACT,
  installLocalEmbeddingModel,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { resolveStateDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { digestOwnerReadContent, type SourceRefV2 } from "openclaw/plugin-sdk/memory-host-core";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";
import type { OpenClawConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { createQwenVlTextTokenizer } from "./embedding-tokenizer.js";
import { createMemoryWikiReadContext, type MemoryWikiReadIdentity } from "./owner-read.js";
import { getMemoryWikiPage } from "./query.js";

type Selection = { mode: "local" | "remote"; providerRef?: string; model?: string };

function requireLocalText(input: EmbeddingInput): string {
  if (typeof input !== "string") throw new Error("Project retrieval embeddings require plain text");
  return input;
}
type Saved = {
  selection: Selection;
  identity: MemoryWikiReadIdentity;
  credentialEpoch: number;
  suspended: boolean;
  space?: EmbeddingSpaceV1;
};
type Status = {
  mode: "disabled" | "local" | "remote";
  status: "disabled" | "installing" | "warming" | "ready" | "unavailable" | "cancelled";
  credentialEpoch: number;
  capability?: ProviderCapabilitySnapshotV1;
  providerRef?: string;
  model?: string;
  dimensions?: number;
  spaceId?: string;
  progress?: { bytes: number; total: number };
  error?: string;
};

export function createMemoryWikiEmbeddingService(options: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;
  prepareRemoteTokenizer?: typeof createQwenVlTextTokenizer;
}) {
  const key = digestOwnerReadContent(options.config.vault.path);
  const state = () =>
    options.openKeyedStore<Saved>({ namespace: "retrieval-embedding-selection", maxEntries: 16 });
  const directory = path.join(resolveStateDir(), "models", "project-rag");
  let saved: Saved | undefined;
  let status: Status = { mode: "disabled", status: "disabled", credentialEpoch: 0 };
  let controller = new AbortController();
  let running: Promise<void> = Promise.resolve();
  let session: KnowledgeEmbeddingSession | undefined;
  let space: EmbeddingSpaceV1 | undefined;
  let serial: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = serial.then(run);
    serial = next.catch(() => undefined);
    return next;
  };
  const assertScope = (identity: MemoryWikiReadIdentity, replacing = false) => {
    if (
      !identity.workspaceId ||
      !identity.workspaceDir ||
      !identity.agentSessionKey ||
      !identity.sessionId
    ) {
      throw new Error("Embedding requires a trusted workspace and physical session");
    }
    if (
      !replacing &&
      saved &&
      ["workspaceId", "workspaceDir", "agentSessionKey", "sessionId"].some(
        (field) =>
          identity[field as keyof MemoryWikiReadIdentity] !==
          saved!.identity[field as keyof MemoryWikiReadIdentity],
      )
    )
      throw new Error("Embedding selection belongs to a different workspace or session");
    if (
      createMemoryWikiReadContext({
        config: options.config,
        appConfig: options.appConfig,
        identity,
      }).sessionId !== identity.sessionId
    ) {
      throw new Error("Embedding physical session generation has changed");
    }
  };
  const context = (identity: MemoryWikiReadIdentity) =>
    createMemoryWikiReadContext({
      config: options.config,
      appConfig: options.appConfig,
      identity: { ...identity, egressProviderRefs: saved?.identity.egressProviderRefs ?? [] },
    });
  const stop = async () => {
    controller.abort(new Error("Embedding operation cancelled"));
    await session?.close();
    session = undefined;
    space = undefined;
    await running;
  };
  const start = async (selection: Saved) => {
    const operation = controller;
    const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(10 * 60_000)]);
    let provider: EmbeddingProvider | undefined;
    try {
      const local = selection.selection.mode === "local";
      status = {
        mode: selection.selection.mode,
        status: "installing",
        credentialEpoch: selection.credentialEpoch,
      };
      let tokenizer: {
        id: string;
        digest: string;
        count: (text: string, signal?: AbortSignal) => number | Promise<number>;
      };
      let modelRevision: string;
      let providerRef: string;
      let maxInputTokens: number;
      let inputFormat: { id: string; query: string; document: string };
      if (local) {
        if (freemem() < 1536 * 1024 * 1024)
          throw new Error("Insufficient RAM budget for the local embedding model");
        const installed = await installLocalEmbeddingModel({
          directory,
          signal,
          onProgress: (progress) => {
            status = { ...status, progress: { bytes: progress.bytes, total: progress.total } };
          },
        });
        signal.throwIfAborted();
        status = { ...status, status: "warming", progress: undefined };
        if (freemem() < 1536 * 1024 * 1024)
          throw new Error("Insufficient RAM budget for local embedding warmup");
        const native = await createLocalEmbeddingProvider({
          config: options.appConfig ?? {},
          model: installed.path,
          local: { modelPath: installed.path, contextSize: 2048 },
        });
        provider = {
          id: "local",
          model: DEFAULT_LOCAL_EMBEDDING_ARTIFACT.model,
          embed: (text, call) => native.embedQuery(requireLocalText(text), call),
          embedBatch: (texts, call) => native.embedBatch(texts.map(requireLocalText), call),
          close: () => native.close?.(),
        };
        if (!native.inspect)
          throw new Error("Local embedding capability inspection is unavailable");
        const capability = await native.inspect([], { signal });
        if (
          capability.dimensions !== 768 ||
          capability.modelDigest !== `sha256:${installed.artifact.sha256}`
        ) {
          throw new Error("Local embedding capability differs from the verified artifact");
        }
        provider.dimensions = capability.dimensions;
        tokenizer = {
          id: capability.tokenizerId,
          digest: capability.tokenizerDigest,
          count: async (text, callSignal) =>
            (await native.inspect!([text], { signal: callSignal })).tokenCounts[0],
        };
        modelRevision = installed.artifact.revision + "/" + capability.modelDigest;
        providerRef = "local:embeddinggemma-300m";
        maxInputTokens = capability.maxInputTokens;
        inputFormat = {
          id: "embeddinggemma/search-v1",
          query: "task: search result | query: {text}",
          document: "title: {title} | text: {text}",
        };
      } else {
        providerRef = selection.selection.providerRef || "siliconflow";
        if (!selection.identity.egressProviderRefs?.includes(providerRef))
          throw new Error("Embedding egress was not admitted by the owner");
        const config = options.appConfig ?? {};
        // The registry matches provider aliases without case. A configured alias
        // must keep its endpoint and SecretRef instead of taking environment defaults.
        const hasConfiguredProvider = Object.keys(config.models?.providers ?? {}).some(
          (id) => id.trim().toLowerCase() === providerRef.trim().toLowerCase(),
        );
        const model = selection.selection.model || "Qwen/Qwen3-VL-Embedding-8B";
        if (model !== "Qwen/Qwen3-VL-Embedding-8B")
          throw new Error(
            "This embedding profile requires a Qwen3 VL tokenizer; configure a matching profile before changing models",
          );
        tokenizer = await (options.prepareRemoteTokenizer ?? createQwenVlTextTokenizer)(
          directory,
          signal,
        );
        signal.throwIfAborted();
        const adapter =
          getEmbeddingProvider(providerRef, config) ??
          getEmbeddingProvider("openai-compatible", config);
        if (!adapter || adapter.transport !== "remote")
          throw new Error("Remote embedding provider is unavailable");
        const result = await adapter.create({
          config,
          provider: providerRef,
          model,
          dimensions: 4096,
          ...(providerRef.trim().toLowerCase() === "siliconflow" && !hasConfiguredProvider
            ? {
                remote: {
                  baseUrl:
                    process.env.SILICONFLOW_BASE_URL?.trim() || "https://api.siliconflow.cn/v1",
                  apiKey: process.env.SILICONFLOW_API_KEY,
                },
              }
            : {}),
        });
        if (!result.provider) throw new Error("Remote embedding provider is unavailable");
        provider = result.provider;
        status = { ...status, status: "warming" };
        maxInputTokens = 32768;
        inputFormat = {
          id: "qwen3-vl/text-search-v1",
          query: "Retrieve relevant documents for the query.\n{text}",
          document: "{text}",
        };
        const previous = selection.space;
        const canReusePreviousSpace =
          previous?.providerRef === providerRef &&
          previous.model === provider.model &&
          previous.dimensions === (provider.dimensions ?? 4096) &&
          previous.maxInputTokens === maxInputTokens &&
          previous.tokenizerId === tokenizer.id &&
          previous.tokenizerDigest === tokenizer.digest &&
          previous.inputFormat.id === inputFormat.id &&
          previous.inputFormat.query === inputFormat.query &&
          previous.inputFormat.document === inputFormat.document &&
          previous.normalization === "l2";
        if (canReusePreviousSpace) {
          // The provider exposes no immutable weight revision. Persist the
          // observed capability identity so a restart does not turn a stable
          // selection into a new vector space when warmup output drifts.
          modelRevision = previous.modelRevision;
        } else {
          const fingerprint = await provider.embedBatch(
            [
              "Project RAG embedding capability query.",
              "Project RAG embedding capability document.",
            ],
            { inputType: "query", signal },
          );
          modelRevision =
            "provider-unversioned/fingerprint-v1:" +
            digestOwnerReadContent(JSON.stringify(fingerprint));
        }
      }
      signal.throwIfAborted();
      space = createEmbeddingSpace({
        providerRef,
        model: provider.model,
        modelRevision,
        dimensions: provider.dimensions ?? 4096,
        maxInputTokens,
        tokenizerId: tokenizer.id,
        tokenizerDigest: tokenizer.digest,
        inputFormat,
        normalization: "l2",
      });
      const prepared = new KnowledgeEmbeddingSession({
        workspaceId: selection.identity.workspaceId!,
        credentialEpoch: selection.credentialEpoch,
        provider,
        space,
        tokenizer,
        transport: local ? "local" : "remote",
        refreshContext: () => context(selection.identity),
        read: async (source, readSignal) => {
          readSignal.throwIfAborted();
          const page = await getMemoryWikiPage({
            config: options.config,
            appConfig: options.appConfig,
            lookup: source.subjectId,
            sourceRef: source,
            fromLine: 1,
            lineCount: Number.MAX_SAFE_INTEGER,
            readIdentity: selection.identity,
          });
          if (!page?.ownerSnapshot || page.status === "denied")
            throw new Error("Embedding source owner denied the read");
          return page.ownerSnapshot;
        },
      });
      session = prepared;
      await prepared.embed({
        kind: "query",
        text: "Project RAG capability warmup",
        space,
        context: context(selection.identity),
        signal,
      });
      signal.throwIfAborted();
      status = {
        mode: selection.selection.mode,
        status: "ready",
        credentialEpoch: selection.credentialEpoch,
        providerRef,
        model: provider.model,
        dimensions: space.dimensions,
        spaceId: space.spaceId,
        capability: {
          schema: "ProviderCapabilitySnapshot/v1",
          providerRef,
          transport: local ? "local" : "remote",
          credentialEpoch: selection.credentialEpoch,
          observedAt: new Date().toISOString(),
          status: "ready",
          space,
        },
      };
      saved = { ...selection, space };
      await state().register(key, saved);
      provider = undefined;
    } catch (error) {
      await provider?.close?.();
      await session?.close();
      session = undefined;
      space = undefined;
      status = {
        mode: selection.selection.mode,
        credentialEpoch: selection.credentialEpoch,
        status: signal.aborted ? "cancelled" : "unavailable",
        error: signal.aborted
          ? "Embedding operation cancelled"
          : `Embedding initialization failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
      };
    }
  };
  const activate = async (
    selection: Selection,
    identity: MemoryWikiReadIdentity,
    replacing = false,
    resumeSpace?: EmbeddingSpaceV1,
  ) => {
    assertScope(identity, replacing);
    await stop();
    const normalizedSelection: Selection = {
      mode: selection.mode,
      ...(selection.providerRef ? { providerRef: selection.providerRef } : {}),
      ...(selection.model ? { model: selection.model } : {}),
    };
    saved = {
      selection: normalizedSelection,
      identity: structuredClone(identity),
      credentialEpoch: (saved?.credentialEpoch ?? 0) + 1,
      suspended: false,
      ...(resumeSpace ? { space: resumeSpace } : {}),
    };
    await state().register(key, saved);
    controller = new AbortController();
    status = { mode: selection.mode, status: "installing", credentialEpoch: saved.credentialEpoch };
    running = start(saved);
    return structuredClone(status);
  };
  return {
    async start() {
      await enqueue(async () => {
        const previous = await state().lookup(key);
        if (!previous) return;
        saved = previous;
        if (previous.suspended) {
          status = {
            mode: previous.selection.mode,
            status: "cancelled",
            credentialEpoch: previous.credentialEpoch,
          };
          return;
        }
        try {
          await activate(previous.selection, previous.identity, false, previous.space);
        } catch {
          status = {
            mode: previous.selection.mode,
            status: "unavailable",
            credentialEpoch: previous.credentialEpoch,
            error: "Saved embedding scope is unavailable",
          };
        }
      });
    },
    status(identity: MemoryWikiReadIdentity): Status {
      assertScope(identity, true);
      if (
        saved &&
        ["workspaceId", "workspaceDir", "agentSessionKey", "sessionId"].some(
          (field) =>
            identity[field as keyof MemoryWikiReadIdentity] !==
            saved!.identity[field as keyof MemoryWikiReadIdentity],
        )
      )
        return { mode: "disabled" as const, status: "disabled" as const, credentialEpoch: 0 };
      return structuredClone(status);
    },
    configure(selection: Selection, identity: MemoryWikiReadIdentity) {
      return enqueue(() => activate(selection, identity, true));
    },
    retry(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        const previous = saved ?? (await state().lookup(key));
        if (!previous) throw new Error("Embedding selection is not configured");
        // Bare retry carries no new egress grant. Reuse the same owner's saved
        // provider admission after assertScope has fenced the physical identity.
        return activate(previous.selection, {
          ...identity,
          egressProviderRefs: previous.identity.egressProviderRefs,
        });
      });
    },
    cancel(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        assertScope(identity);
        await stop();
        if (saved) {
          saved = { ...saved, suspended: true };
          await state().register(key, saved);
        }
        status = {
          mode: status.mode,
          credentialEpoch: status.credentialEpoch,
          status: "cancelled",
        };
        return structuredClone(status);
      });
    },
    disable(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        assertScope(identity);
        await stop();
        await state().delete(key);
        saved = undefined;
        status = { mode: "disabled", status: "disabled", credentialEpoch: status.credentialEpoch };
        return structuredClone(status);
      });
    },
    async embed(
      identity: MemoryWikiReadIdentity,
      input: ({ kind: "query"; text: string } | { kind: "document"; sources: SourceRefV2[] }) & {
        expectedSpaceId?: string;
        deadlineAt?: number;
        signal?: AbortSignal;
      },
    ) {
      assertScope(identity);
      if (!session || !space || status.status !== "ready")
        throw new Error("Embedding provider is not ready");
      if (input.expectedSpaceId && input.expectedSpaceId !== space.spaceId)
        throw new Error("Embedding space changed during the operation");
      return session.embed({ ...input, context: context(identity), space });
    },
    async stop() {
      await enqueue(stop);
    },
  };
}

export type MemoryWikiEmbeddingService = ReturnType<typeof createMemoryWikiEmbeddingService>;
