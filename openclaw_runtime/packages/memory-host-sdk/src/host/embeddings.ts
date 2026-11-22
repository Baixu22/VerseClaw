// Memory Host SDK module implements embeddings behavior.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DEFAULT_LOCAL_MODEL } from "./embedding-defaults.js";
import { createLocalEmbeddingWorkerProvider } from "./embeddings-worker.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.types.js";
import {
  importNodeLlamaCpp,
  type Llama,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "./node-llama.js";
import { normalizeOptionalString } from "./string-utils.js";

type DisposableResource = {
  dispose?: () => Promise<void> | void;
};

export type {
  EmbeddingProvider,
  EmbeddingProviderFallback,
  EmbeddingProviderId,
  EmbeddingProviderOptions,
  EmbeddingProviderRequest,
  GeminiTaskType,
} from "./embeddings.types.js";

export { DEFAULT_LOCAL_MODEL } from "./embedding-defaults.js";

export type LocalEmbeddingProviderRuntimeOptions = {
  workerScriptPath?: string;
};

async function disposeResources(
  resources: Array<DisposableResource | null | undefined>,
): Promise<void> {
  let firstError: unknown;
  for (const resource of resources) {
    try {
      await resource?.dispose?.();
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError) {
    throw toLintErrorObject(firstError, "Non-Error thrown");
  }
}

function normalizeLocalVector(vector: Float32Array | number[]): number[] {
  const values = Array.from(vector);
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Local embedding model returned an invalid vector");
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Local embedding model returned an invalid vector");
  }
  return values.map((value) => value / magnitude);
}

export async function createLocalEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  return await createLocalEmbeddingWorkerProvider(options);
}

export async function createLocalEmbeddingProviderInProcess(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const modelPath = normalizeOptionalString(options.local?.modelPath) || DEFAULT_LOCAL_MODEL;
  const modelCacheDir = normalizeOptionalString(options.local?.modelCacheDir);
  const contextSize: number | "auto" = options.local?.contextSize ?? 4096;

  // Lazy-load node-llama-cpp to keep startup light unless local is enabled.
  const { getLlama, resolveModelFile, LlamaLogLevel } = await importNodeLlamaCpp();

  let llama: Llama | null = null;
  let embeddingModel: LlamaModel | null = null;
  let embeddingContext: LlamaEmbeddingContext | null = null;
  let initPromise: Promise<LlamaEmbeddingContext> | null = null;
  let initAbortController: AbortController | null = null;
  let closePromise: Promise<void> | null = null;
  let closed = false;
  let resolvedModelPath: string | undefined;
  let modelDigest: string | undefined;

  const throwIfClosed = () => {
    if (closed) {
      throw new Error("Local embedding provider has been closed");
    }
  };
  const disposeAndThrowIfClosed = async <T extends DisposableResource>(resource: T): Promise<T> => {
    if (!closed) {
      return resource;
    }
    await disposeResources([resource]);
    throwIfClosed();
    return resource;
  };

  const ensureContext = async (): Promise<LlamaEmbeddingContext> => {
    throwIfClosed();
    if (embeddingContext) {
      return embeddingContext;
    }
    if (initPromise) {
      return initPromise;
    }
    initPromise = (async () => {
      const abortController = new AbortController();
      initAbortController = abortController;
      try {
        if (!llama) {
          const nextLlama = await getLlama({
            logLevel: LlamaLogLevel.error,
          });
          llama = await disposeAndThrowIfClosed(nextLlama);
        }
        if (!embeddingModel) {
          const resolved = await resolveModelFile(modelPath, {
            ...(modelCacheDir ? { directory: modelCacheDir } : {}),
            signal: abortController.signal,
          });
          throwIfClosed();
          const nextModel = await llama.loadModel({
            modelPath: resolved,
            loadSignal: abortController.signal,
          });
          embeddingModel = await disposeAndThrowIfClosed(nextModel);
          resolvedModelPath = resolved;
        }
        if (!embeddingContext) {
          const nextContext = await embeddingModel.createEmbeddingContext({
            contextSize,
            createSignal: abortController.signal,
          });
          embeddingContext = await disposeAndThrowIfClosed(nextContext);
        }
        return embeddingContext;
      } catch (err) {
        initPromise = null;
        throw err;
      } finally {
        if (initAbortController === abortController) {
          initAbortController = null;
        }
      }
    })();
    return initPromise;
  };

  return {
    id: "local",
    model: modelPath,
    inspect: async (texts, callOptions) => {
      throwIfClosed();
      callOptions?.signal?.throwIfAborted();
      const ctx = await ensureContext();
      throwIfClosed();
      callOptions?.signal?.throwIfAborted();
      if (contextSize === "auto") {
        throw new Error("A fixed local context size is required for capability inspection");
      }
      if (!modelDigest) {
        const hash = createHash("sha256");
        for await (const bytes of createReadStream(resolvedModelPath!)) {
          throwIfClosed();
          callOptions?.signal?.throwIfAborted();
          hash.update(bytes);
        }
        modelDigest = `sha256:${hash.digest("hex")}`;
      }
      // GGUF contains the actual vocabulary, merges and special token metadata.
      // calculateInputLength includes the native embedding context's BOS/EOS preparation.
      const tokenizerId = "node-llama-cpp/calculateInputLength/v1";
      const tokenizerDigest = `sha256:${createHash("sha256")
        .update(JSON.stringify([modelDigest, tokenizerId]))
        .digest("hex")}`;
      callOptions?.signal?.throwIfAborted();
      throwIfClosed();
      return {
        dimensions: embeddingModel!.embeddingVectorSize,
        maxInputTokens: Math.min(contextSize, embeddingModel!.trainContextSize) - 1,
        modelDigest,
        tokenizerId,
        tokenizerDigest,
        tokenCounts: texts.map((text) => ctx.calculateInputLength(text)),
      };
    },
    embedQuery: async (text, optionsValue) => {
      throwIfClosed();
      optionsValue?.signal?.throwIfAborted();
      const ctx = await ensureContext();
      throwIfClosed();
      optionsValue?.signal?.throwIfAborted();
      const embedding = await ctx.getEmbeddingFor(text);
      throwIfClosed();
      optionsValue?.signal?.throwIfAborted();
      return normalizeLocalVector(embedding.vector);
    },
    embedBatch: async (texts, optionsLocal) => {
      throwIfClosed();
      optionsLocal?.signal?.throwIfAborted();
      const ctx = await ensureContext();
      throwIfClosed();
      optionsLocal?.signal?.throwIfAborted();
      const embeddings: number[][] = [];
      for (const text of texts) {
        throwIfClosed();
        optionsLocal?.signal?.throwIfAborted();
        const embedding = await ctx.getEmbeddingFor(text);
        throwIfClosed();
        optionsLocal?.signal?.throwIfAborted();
        embeddings.push(normalizeLocalVector(embedding.vector));
      }
      return embeddings;
    },
    close: async () => {
      if (closePromise) {
        return closePromise;
      }
      closed = true;
      initAbortController?.abort();
      initAbortController = null;
      closePromise = (async () => {
        const context = embeddingContext;
        const model = embeddingModel;
        const runtime = llama;
        embeddingContext = null;
        embeddingModel = null;
        llama = null;
        initPromise = null;
        await disposeResources([context, model, runtime]);
      })();
      return closePromise;
    },
  };
}

function toLintErrorObject(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  const error = new Error(fallbackMessage, { cause: value });
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    Object.assign(error, value);
  }
  return error;
}
