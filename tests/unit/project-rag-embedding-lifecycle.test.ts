// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalEmbeddingProviderInProcess } from "../../openclaw_runtime/packages/memory-host-sdk/src/host/embeddings";
import { createLocalEmbeddingWorkerProvider } from "../../openclaw_runtime/packages/memory-host-sdk/src/host/embeddings-worker";
import {
  installLocalEmbeddingModel,
  verifyLocalEmbeddingModel,
} from "../../openclaw_runtime/packages/memory-host-sdk/src/host/embedding-model-artifact";
import {
  assertSameEmbeddingSpace,
  checkEmbeddingInputBudget,
  createEmbeddingSpace,
  formatEmbeddingInput,
  validateEmbeddingVector,
} from "../../openclaw_runtime/src/knowledge/retrieval/embedding-space";
import { getEmbeddingProvider } from "../../openclaw_runtime/src/plugin-sdk/embedding-providers";
import { KnowledgeEmbeddingSession } from "../../openclaw_runtime/src/knowledge/retrieval/embedding-session";
import {
  createOwnerReadSnapshot,
  deriveReadAdmissionContext,
  type OwnerReadSnapshotV1,
} from "../../openclaw_runtime/src/runtime-core/knowledge-owner-read";
import {
  createMemoryWikiEmbeddingService,
  resolveMemoryWikiConfig,
} from "../../openclaw_runtime/extensions/memory-wiki/runtime-api";
import {
  createPluginStateKeyedStoreForTests,
  closeOpenClawStateDatabaseForTest,
} from "../../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime";
import { closeTrackedSqliteHandlesUnder } from "../../openclaw_runtime/src/infra/node-sqlite";

const transport = vi.hoisted(() => ({ request: vi.fn(), release: vi.fn(async () => {}) }));
const resourceBudget = vi.hoisted(() => ({
  diskBytes: undefined as number | undefined,
  ramBytes: undefined as number | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    statfs: async (directory: string) =>
      resourceBudget.diskBytes === undefined
        ? actual.statfs(directory)
        : {
            type: 0,
            bsize: 1,
            blocks: 0,
            bfree: resourceBudget.diskBytes,
            bavail: resourceBudget.diskBytes,
            files: 0,
            ffree: 0,
          },
  };
});
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, freemem: () => resourceBudget.ramBytes ?? actual.freemem() };
});
vi.mock("../../openclaw_runtime/src/infra/net/fetch-guard", () => ({
  fetchWithSsrFGuard: transport.request,
}));

const native = vi.hoisted(() => ({
  getEmbeddingFor: vi.fn(async () => ({ vector: [3, 4, 0] })),
  calculateInputLength: vi.fn(() => 7),
  contextDispose: vi.fn(),
  modelDispose: vi.fn(),
  runtimeDispose: vi.fn(),
}));
vi.mock("../../openclaw_runtime/packages/memory-host-sdk/src/host/node-llama", () => ({
  importNodeLlamaCpp: async () => ({
    LlamaLogLevel: { error: 1 },
    getLlama: async () => ({
      loadModel: async () => ({
        embeddingVectorSize: 3,
        trainContextSize: 2048,
        createEmbeddingContext: async () => ({
          getEmbeddingFor: native.getEmbeddingFor,
          calculateInputLength: native.calculateInputLength,
          dispose: native.contextDispose,
        }),
        dispose: native.modelDispose,
      }),
      dispose: native.runtimeDispose,
    }),
    resolveModelFile: async (file: string) => file,
  }),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resourceBudget.diskBytes = undefined;
  resourceBudget.ramBytes = undefined;
});

// Agent fixtures exercise the space protocol; real model receipts are separate.
const descriptor = {
  providerRef: "agent-fixture-provider",
  model: "agent-fixture-model",
  modelRevision: "agent-fixture-revision-1",
  dimensions: 3,
  maxInputTokens: 8,
  tokenizerId: "agent-fixture-tokenizer",
  tokenizerDigest: `sha256:${"1".repeat(64)}`,
  inputFormat: {
    id: "agent-fixture-format-1",
    query: "query: {text}",
    document: "title: {title} | text: {text}",
  },
  normalization: "l2" as const,
};

describe("Project RAG embedding space lifecycle", () => {
  it.each([
    { modelRevision: "agent-fixture-revision-2" },
    { dimensions: 4 },
    { tokenizerDigest: `sha256:${"2".repeat(64)}` },
    { inputFormat: { ...descriptor.inputFormat, query: "changed query: {text}" } },
    { normalization: "none" as const },
  ])("rejects vectors from a changed space %j", (change) => {
    const original = createEmbeddingSpace(descriptor);
    expect(() =>
      assertSameEmbeddingSpace(original, createEmbeddingSpace({ ...descriptor, ...change })),
    ).toThrow("space mismatch");
    expect(() => assertSameEmbeddingSpace(original, { ...original, ...change })).toThrow(
      "space mismatch",
    );
  });

  it("retains literal source placeholders and counts the complete query or document", async () => {
    const space = createEmbeddingSpace(descriptor);
    const query = formatEmbeddingInput(space, "query", "literal {title}");
    const document = formatEmbeddingInput(space, "document", "literal {text}", "Guide");
    expect(query).toBe("query: literal {title}");
    expect(document).toBe("title: Guide | text: literal {text}");
    const count = vi.fn(() => 8);
    const tokenizer = { id: space.tokenizerId, digest: space.tokenizerDigest, count };
    await expect(checkEmbeddingInputBudget(space, query, tokenizer)).resolves.toBe(8);
    expect(count).toHaveBeenCalledExactlyOnceWith(query, undefined);
    count.mockReturnValue(9);
    await expect(checkEmbeddingInputBudget(space, document, tokenizer)).rejects.toThrow(
      "budget exceeded",
    );
    count.mockClear();
    await expect(
      checkEmbeddingInputBudget(space, query, { ...tokenizer, digest: `sha256:${"3".repeat(64)}` }),
    ).rejects.toThrow("tokenizer mismatch");
    expect(count).not.toHaveBeenCalled();
  });

  it.each(
    [[], [1, 0], [0, 0, 0], [NaN, 0, 1], [Infinity, 0, 1], [null, 0, 1]].map((vector) => ({
      vector,
    })),
  )("rejects an invalid vector %j", ({ vector }) => {
    expect(() => validateEmbeddingVector(createEmbeddingSpace(descriptor), vector)).toThrow(
      "Embedding vector",
    );
  });

  it("normalizes into an isolated vector and binds a deterministic immutable space", () => {
    const space = createEmbeddingSpace(descriptor);
    const vector = [3, 4, 0];
    expect(validateEmbeddingVector(space, vector)).toEqual([0.6, 0.8, 0]);
    expect(vector).toEqual([3, 4, 0]);
    expect(
      createEmbeddingSpace({ ...descriptor, inputFormat: { ...descriptor.inputFormat } }).spaceId,
    ).toBe(space.spaceId);
    expect(Object.isFrozen(space)).toBe(true);
    expect(Object.isFrozen(space.inputFormat)).toBe(true);
  });
});

describe("local embedding artifact and capability lifecycle", () => {
  const bytes = Buffer.from("agent fixture model bytes");
  const artifact = {
    model: "agent-fixture",
    revision: "fixture-1",
    filename: "fixture.gguf",
    url: "https://example.test/fixture.gguf",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };

  it("verifies an existing model offline and rejects same-size corruption", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-model-verified-"));
    try {
      const file = path.join(directory, `${artifact.sha256.slice(0, 16)}-${artifact.filename}`);
      await writeFile(file, bytes);
      await expect(installLocalEmbeddingModel({ directory, artifact })).resolves.toMatchObject({
        path: file,
        downloaded: false,
      });
      expect(transport.request).not.toHaveBeenCalled();
      await writeFile(file, Buffer.alloc(bytes.length, 65));
      await expect(verifyLocalEmbeddingModel(file, artifact)).rejects.toThrow("checksum");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an installation before opening the downloader when the disk budget is exhausted", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-model-low-disk-"));
    resourceBudget.diskBytes = 0;
    try {
      await expect(installLocalEmbeddingModel({ directory, artifact })).rejects.toThrow(
        "Insufficient disk budget",
      );
      expect(transport.request).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cancels an incomplete install, cleans staging, and retries with checksum verification", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-model-cancel-"));
    const signal = new AbortController();
    try {
      transport.request.mockImplementationOnce(async () => ({
        response: new Response(bytes),
        release: transport.release,
      }));
      await expect(
        installLocalEmbeddingModel({
          directory,
          artifact,
          signal: signal.signal,
          onProgress: () => signal.abort(new Error("agent fixture cancel")),
        }),
      ).rejects.toThrow("agent fixture cancel");
      expect(transport.release).toHaveBeenCalledOnce();
      expect(await readdir(directory)).toEqual([]);
      transport.request.mockImplementationOnce(async () => ({
        response: new Response(bytes),
        release: transport.release,
      }));
      const installed = await installLocalEmbeddingModel({ directory, artifact });
      expect(installed.downloaded).toBe(true);
      expect(await readFile(installed.path)).toEqual(bytes);
      expect(await readdir(directory)).toEqual([path.basename(installed.path)]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cancels while waiting for download headers and removes staging", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-model-cancel-headers-"));
    const abort = new AbortController();
    let entered!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    transport.request.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          entered();
        }),
    );
    try {
      const operation = installLocalEmbeddingModel({ directory, artifact, signal: abort.signal });
      await requestStarted;
      abort.abort(new Error("agent fixture header cancellation"));
      await expect(operation).rejects.toThrow("agent fixture header cancellation");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("inspects the loaded model and full native token count, then releases all resources", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-model-inspect-"));
    const file = path.join(directory, "fixture.gguf");
    await writeFile(file, bytes);
    const provider = await createLocalEmbeddingProviderInProcess({
      config: {},
      model: "agent-fixture",
      local: { modelPath: file, contextSize: 128 },
    });
    try {
      const text = "prefix and body together";
      const capability = await provider.inspect!([text]);
      expect(capability).toMatchObject({
        dimensions: 3,
        maxInputTokens: 127,
        modelDigest: `sha256:${artifact.sha256}`,
        tokenCounts: [7],
      });
      expect(native.calculateInputLength).toHaveBeenCalledExactlyOnceWith(text);
      expect(capability.tokenizerDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(provider.embedQuery(text)).resolves.toEqual([0.6, 0.8, 0]);
      native.getEmbeddingFor.mockResolvedValueOnce({ vector: [NaN, 1, 0] });
      await expect(provider.embedQuery(text)).rejects.toThrow("invalid vector");
    } finally {
      await provider.close!();
      await rm(directory, { recursive: true, force: true });
    }
    expect(native.contextDispose).toHaveBeenCalledOnce();
    expect(native.modelDispose).toHaveBeenCalledOnce();
    expect(native.runtimeDispose).toHaveBeenCalledOnce();
    await expect(provider.inspect!(["after close"])).rejects.toThrow("closed");
  });

  it("cancels a real child inspect wait and allows a replacement child to answer", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rag-worker-inspect-cancel-"));
    const worker = path.join(directory, "worker.cjs"),
      witness = path.join(directory, "worker-pid.txt");
    await writeFile(
      worker,
      `const fs = require('node:fs'); process.on('message', message => {
      if (message.type === 'initialize' || message.type === 'close') process.send({ id: message.id, ok: true });
      else if (message.type === 'inspect') { fs.writeFileSync(${JSON.stringify(witness)}, String(process.pid)); }
      else if (message.type === 'embedQuery') process.send({ id: message.id, ok: true, value: [1, 0, 0] });
    }); process.once('disconnect', () => process.exit(0));`,
    );
    const provider = await createLocalEmbeddingWorkerProvider(
      { config: {}, model: "agent-child-fixture" },
      { workerScriptPath: worker },
    );
    try {
      const abort = new AbortController();
      const request = provider.inspect!(["pending native tokenizer"], { signal: abort.signal });
      await vi.waitFor(async () =>
        expect(Number(await readFile(witness, "utf8"))).toBeGreaterThan(0),
      );
      const pid = Number(await readFile(witness, "utf8"));
      abort.abort(new Error("agent child inspect cancellation"));
      await expect(request).rejects.toThrow("agent child inspect cancellation");
      await expect(provider.embedQuery("replacement child")).resolves.toEqual([1, 0, 0]);
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally {
      await provider.close!();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("public remote embedding provider boundary", () => {
  const create = async () => {
    const result = await getEmbeddingProvider("openai-compatible")!.create({
      config: {},
      model: "agent-fixture-model",
      dimensions: 3,
      remote: { baseUrl: "https://example.test/v1", apiKey: "agent-fixture-key" },
      queryInputType: "query",
      documentInputType: "document",
    });
    return result.provider!;
  };
  const respond = (data: unknown) =>
    transport.request.mockImplementation(async () => ({
      response: new Response(JSON.stringify({ data })),
      release: transport.release,
    }));

  it("binds reordered vectors to inputs and preserves query/document semantics", async () => {
    const provider = await create();
    respond([
      { index: 1, embedding: [0, 1, 0] },
      { index: 0, embedding: [1, 0, 0] },
    ]);
    await expect(
      provider.embedBatch(["document A", "document B"], { inputType: "document" }),
    ).resolves.toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const documentRequest = transport.request.mock.calls[0][0];
    expect(JSON.parse(documentRequest.init.body)).toMatchObject({
      dimensions: 3,
      input_type: "document",
    });
    respond([{ index: 0, embedding: [1, 0, 0] }]);
    await provider.embed("query A", { inputType: "query" });
    expect(JSON.parse(transport.request.mock.calls[1][0].init.body).input_type).toBe("query");
    expect(transport.release).toHaveBeenCalledTimes(2);
  });
  it("reports provider input usage even when subsequent vector validation rejects the response", async () => {
    const provider = await create(), onUsage = vi.fn();
    transport.request.mockResolvedValue({ response: new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 12 },
    })), release: transport.release });
    expect(provider.requestAccounting).toBe("single-call-input-tokens");
    await expect(provider.embed("query", { onUsage })).rejects.toThrow("malformed JSON response");
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(12);
    respond([{ index: 0, embedding: [1, 0, 0] }]);
    await provider.embed("query", { onUsage });
    expect(onUsage).toHaveBeenLastCalledWith(undefined);
  });

  it.each([
    [
      { index: 0, embedding: [1, 0, 0] },
      { index: 0, embedding: [0, 1, 0] },
    ],
    [
      { index: 0, embedding: [1, 0, 0] },
      { index: 2, embedding: [0, 1, 0] },
    ],
    [{ index: 0, embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
    [
      { index: 0, embedding: [] },
      { index: 1, embedding: [0, 1, 0] },
    ],
    [
      { index: 0, embedding: [1, 0] },
      { index: 1, embedding: [0, 1, 0] },
    ],
  ])("rejects malformed row binding or dimensions %#", async (...rows) => {
    respond(rows);
    await expect((await create()).embedBatch(["A", "B"])).rejects.toThrow(
      "malformed JSON response",
    );
    expect(transport.release).toHaveBeenCalledOnce();
  });

  it("keeps provider error response text out of surfaced failures", async () => {
    transport.request.mockResolvedValue({
      response: new Response("agent fixture echoed private request", { status: 401 }),
      release: transport.release,
    });
    await expect((await create()).embed("query")).rejects.toThrow("HTTP 401");
    try {
      await (await create()).embed("query");
    } catch (error) {
      expect(String(error)).not.toContain("private request");
    }
  });

  it("rejects a response that identifies a different model", async () => {
    transport.request.mockResolvedValue({
      response: new Response(
        JSON.stringify({ model: "another-model", data: [{ index: 0, embedding: [1, 0, 0] }] }),
      ),
      release: transport.release,
    });
    await expect((await create()).embed("query")).rejects.toThrow("model mismatch");
  });

  it("resolves a rotated SecretRef anew without retaining credential bytes in runtime metadata", async () => {
    const adapter = getEmbeddingProvider("openai-compatible")!;
    const options = {
      config: {
        secrets: {
          providers: { default: { source: "env" as const, allowlist: ["AGENT_EMBEDDING_KEY"] } },
        },
      },
      model: "agent-fixture-model",
      dimensions: 3,
      remote: {
        baseUrl: "https://example.test/v1",
        apiKey: { source: "env" as const, provider: "default", id: "AGENT_EMBEDDING_KEY" },
      },
    };
    respond([{ index: 0, embedding: [1, 0, 0] }]);
    vi.stubEnv("AGENT_EMBEDDING_KEY", "agent-fixture-credential-1");
    const first = await adapter.create(options);
    await first.provider!.embed("first");
    vi.stubEnv("AGENT_EMBEDDING_KEY", "agent-fixture-credential-2");
    const second = await adapter.create(options);
    await second.provider!.embed("second");
    expect(transport.request.mock.calls[0][0].init.headers.authorization).toBe(
      "Bearer agent-fixture-credential-1",
    );
    expect(transport.request.mock.calls[1][0].init.headers.authorization).toBe(
      "Bearer agent-fixture-credential-2",
    );
    expect(JSON.stringify([first.runtime, second.runtime])).not.toContain(
      "agent-fixture-credential-",
    );
  });
});

describe("embedding selection persisted in real plugin SQLite", () => {
  it("preserves a configured case-insensitive provider alias and SecretRef over environment defaults", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rag-embedding-provider-alias-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
    vi.stubEnv("AGENT_EMBEDDING_KEY", "agent-fixture-configured-key");
    vi.stubEnv("SILICONFLOW_API_KEY", "agent-fixture-environment-key");
    vi.stubEnv("SILICONFLOW_BASE_URL", "https://environment.example.test/v1");
    const identity = {
      workspaceId: "agent-fixture-project",
      workspaceDir: root,
      agentSessionKey: "agent:main:fixture",
      sessionId: "generation-1",
      egressProviderRefs: ["siliconflow"],
    };
    let responseGeneration = 0;
    transport.request.mockImplementation(async ({ init }) => {
      const payload = JSON.parse(init.body);
      responseGeneration += 1;
      return {
        response: new Response(
          JSON.stringify({
            model: payload.model,
            data: payload.input.map((_: string, index: number) => ({
              index,
              embedding: [responseGeneration + index + 1, ...Array(4095).fill(0)],
            })),
          }),
        ),
        release: transport.release,
      };
    });
    const make = () =>
      createMemoryWikiEmbeddingService({
        config: resolveMemoryWikiConfig({
          vault: { path: path.join(root, "vault") },
          search: { backend: "local", corpus: "wiki" },
        }),
        appConfig: {
          secrets: {
            providers: { default: { source: "env", allowlist: ["AGENT_EMBEDDING_KEY"] } },
          },
          models: {
            providers: {
              SiliconFlow: {
                api: "openai-completions",
                baseUrl: "https://configured.example.test/v1",
                apiKey: { source: "env", provider: "default", id: "AGENT_EMBEDDING_KEY" },
                models: [],
              },
            },
          },
        },
        prepareRemoteTokenizer: async () => ({
          id: "agent-fixture-tokenizer",
          digest: `sha256:${"1".repeat(64)}`,
          count: () => 1,
        }),
        openKeyedStore: (options) => createPluginStateKeyedStoreForTests("memory-wiki", options),
      });
    const service = make();
    try {
      await service.configure({ mode: "remote", providerRef: "siliconflow" }, identity);
      await vi.waitFor(() => expect(service.status(identity).status).toBe("ready"));
      expect(transport.request.mock.calls[0][0].url).toBe(
        "https://configured.example.test/v1/embeddings",
      );
      expect(transport.request.mock.calls[0][0].init.headers.authorization).toBe(
        "Bearer agent-fixture-configured-key",
      );
      await service.stop();
      const restarted = make();
      try {
        await restarted.start();
        await vi.waitFor(() => expect(restarted.status(identity).status).toBe("ready"));
        expect(restarted.status(identity).spaceId).toBe(service.status(identity).spaceId);
        await restarted.retry({ ...identity, egressProviderRefs: [] });
        await vi.waitFor(() => expect(restarted.status(identity).status).toBe("ready"));
        expect(
          transport.request.mock.calls.every(
            (call) => call[0].init.headers.authorization === "Bearer agent-fixture-configured-key",
          ),
        ).toBe(true);
      } finally {
        await restarted.stop();
      }
    } finally {
      await service.stop();
      closeOpenClawStateDatabaseForTest();
      closeTrackedSqliteHandlesUnder(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("omits undefined optional fields and preserves cancellation across service restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rag-embedding-selection-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
    const identity = {
      workspaceId: "agent-fixture-project",
      workspaceDir: root,
      agentSessionKey: "agent:main:fixture",
      sessionId: "generation-1",
      egressProviderRefs: [],
    };
    const make = () =>
      createMemoryWikiEmbeddingService({
        config: resolveMemoryWikiConfig({
          vault: { path: path.join(root, "vault") },
          search: { backend: "local", corpus: "wiki" },
        }),
        openKeyedStore: (options) => createPluginStateKeyedStoreForTests("memory-wiki", options),
      });
    const first = make(),
      second = make();
    try {
      await expect(
        first.configure({ mode: "local", providerRef: undefined, model: undefined }, identity),
      ).resolves.toMatchObject({ mode: "local", status: "installing" });
      await expect(first.cancel(identity)).resolves.toMatchObject({ status: "cancelled" });
      await first.stop();
      await second.start();
      expect(second.status(identity).status).toBe("cancelled");
      const nextIdentity = { ...identity, sessionId: "generation-2" };
      expect(second.status(nextIdentity)).toEqual({
        mode: "disabled",
        status: "disabled",
        credentialEpoch: 0,
      });
      await expect(
        second.embed(nextIdentity, { kind: "query", text: "old scope" }),
      ).rejects.toThrow("different workspace or session");
      await expect(second.configure({ mode: "local" }, nextIdentity)).resolves.toMatchObject({
        mode: "local",
        status: "installing",
      });
      await second.cancel(nextIdentity);
      await second.disable(nextIdentity);
      expect(second.status(nextIdentity).status).toBe("disabled");
    } finally {
      await first.stop();
      await second.stop();
      closeOpenClawStateDatabaseForTest();
      closeTrackedSqliteHandlesUnder(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the selected provider unavailable when the RAM budget cannot admit the local model", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rag-embedding-low-ram-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
    resourceBudget.ramBytes = 0;
    const identity = {
      workspaceId: "agent-fixture-project",
      workspaceDir: root,
      agentSessionKey: "agent:main:fixture",
      sessionId: "generation-1",
      egressProviderRefs: [],
    };
    const service = createMemoryWikiEmbeddingService({
      config: resolveMemoryWikiConfig({
        vault: { path: path.join(root, "vault") },
        search: { backend: "local", corpus: "wiki" },
      }),
      openKeyedStore: (options) => createPluginStateKeyedStoreForTests("memory-wiki", options),
    });
    try {
      await service.configure({ mode: "local" }, identity);
      await vi.waitFor(() => expect(service.status(identity).status).toBe("unavailable"));
      expect(transport.request).not.toHaveBeenCalled();
    } finally {
      await service.stop();
      closeOpenClawStateDatabaseForTest();
      closeTrackedSqliteHandlesUnder(root);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("owner-bound embedding sessions", () => {
  const setup = (
    workspaceId = "agent-workspace",
    credentialEpoch = 1,
    refresh?: (
      context: ReturnType<typeof deriveReadAdmissionContext>,
    ) => ReturnType<typeof deriveReadAdmissionContext>,
  ) => {
    const space = createEmbeddingSpace(descriptor);
    const context = deriveReadAdmissionContext({
      principalId: "operator",
      sessionId: "agent-session",
      workspaceId,
      ownerNamespaces: ["agent-namespace"],
      policyDigest: `sha256:${"2".repeat(64)}`,
      egressProviderRefs: [space.providerRef],
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    let snapshot = createOwnerReadSnapshot({
      raw: "agent fixture project document",
      startChar: 0,
      endChar: 30,
      title: "Guide",
      context,
      source: {
        domain: "wiki",
        authorityId: "agent-owner",
        namespaceId: "agent-namespace",
        subjectId: "source-1",
        revision: "1",
      },
      policy: {
        status: "active",
        trust: "confirmed",
        sensitivity: "workspace",
        acl: { read: ["operator"] },
        retention: { policy: "source-coupled" },
      },
    });
    const embedBatch = vi.fn(async (texts: unknown[]) => texts.map(() => [3, 4, 0]));
    const read = vi.fn(async () => snapshot);
    const provider = { id: space.providerRef, model: space.model, requestAccounting: "single-call-input-tokens" as const, embed: vi.fn(), embedBatch };
    const session = new KnowledgeEmbeddingSession({
      workspaceId,
      credentialEpoch,
      transport: "remote",
      provider,
      space,
      tokenizer: { id: space.tokenizerId, digest: space.tokenizerDigest, count: () => 7 },
      read,
      ...(refresh ? { refreshContext: () => refresh(context) } : {}),
    });
    return {
      session,
      provider,
      space,
      context,
      read,
      source: snapshot.source,
      setSnapshot: (value: OwnerReadSnapshotV1) => {
        snapshot = value;
      },
      snapshot,
    };
  };

  it("rechecks the owner before cached vectors and isolates query/document, workspace, and credential generation", async () => {
    const one = setup();
    const input = {
      kind: "document" as const,
      sources: [one.source],
      context: one.context,
      space: one.space,
    };
    const first = await one.session.embed(input);
    expect(first.vectors).toEqual([[0.6, 0.8, 0]]);
    first.vectors[0][0] = 100;
    expect((await one.session.embed(input)).vectors).toEqual([[0.6, 0.8, 0]]);
    expect(one.provider.embedBatch).toHaveBeenCalledOnce();
    expect(one.read).toHaveBeenCalledTimes(4);
    await one.session.embed({
      kind: "query",
      text: one.snapshot.content,
      context: one.context,
      space: one.space,
    });
    expect(one.provider.embedBatch).toHaveBeenCalledTimes(2);
    for (const other of [setup("other-workspace"), setup("agent-workspace", 2)]) {
      await other.session.embed({
        kind: "document",
        sources: [other.source],
        context: other.context,
        space: other.space,
      });
      expect(other.provider.embedBatch).toHaveBeenCalledOnce();
      await other.session.close();
    }
    one.setSnapshot({ ...one.snapshot, policy: { ...one.snapshot.policy, status: "revoked" } });
    await expect(one.session.embed(input)).rejects.toThrow("revoked");
    expect(one.provider.embedBatch).toHaveBeenCalledTimes(2);
    await one.session.close();
  });
  it("reserves only uncached remote batches and forwards response usage to the request owner", async () => {
    const one = setup(), reported = vi.fn();
    const call = vi.fn(async (_request, operation) => operation(reported));
    one.provider.embedBatch.mockImplementation(async (texts, options?: { onUsage?: (tokens: number) => void }) => {
      options?.onUsage?.(7); return texts.map(() => [3, 4, 0]);
    });
    const input = { kind: "query" as const, text: "same query", context: one.context, space: one.space, remoteSpend: call };
    await one.session.embed(input);
    expect((await one.session.embed(input)).job.cacheHits).toBe(1);
    expect(call).toHaveBeenCalledOnce(); expect(reported).toHaveBeenCalledExactlyOnceWith(7);
    expect(one.provider.embedBatch).toHaveBeenCalledOnce();
    await one.session.close();
  });

  it("rejects denied egress and owner pin changes before any provider call", async () => {
    const one = setup();
    const input = {
      kind: "document" as const,
      sources: [one.source],
      context: one.context,
      space: one.space,
    };
    await expect(
      one.session.embed({ ...input, context: { ...one.context, egressProviderRefs: [] } }),
    ).rejects.toThrow("egress");
    one.setSnapshot({ ...one.snapshot, source: { ...one.source, revision: "2" } });
    await expect(one.session.embed(input)).rejects.toThrow("pin changed");
    expect(one.provider.embedBatch).not.toHaveBeenCalled();
    await one.session.close();
  });

  it("discards a response when the owner revokes during inference or the session is closed", async () => {
    const one = setup();
    one.provider.embedBatch.mockImplementationOnce(async () => {
      one.setSnapshot({ ...one.snapshot, policy: { ...one.snapshot.policy, status: "revoked" } });
      return [[3, 4, 0]];
    });
    await expect(
      one.session.embed({
        kind: "document",
        sources: [one.source],
        context: one.context,
        space: one.space,
      }),
    ).rejects.toThrow("revoked");
    expect(one.session.status()[0].state).toBe("failed");
    await one.session.close();
    await expect(
      one.session.embed({
        kind: "query",
        text: "after close",
        context: one.context,
        space: one.space,
      }),
    ).rejects.toThrow("closed");
  });

  it("releases cancellation even when the provider ignores its signal", async () => {
    const one = setup();
    let entered!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    one.provider.embedBatch.mockImplementationOnce(() => {
      entered();
      return new Promise(() => {});
    });
    const abort = new AbortController();
    const job = one.session.embed({
      kind: "query",
      text: "cancel ignored provider",
      context: one.context,
      space: one.space,
      signal: abort.signal,
    });
    await providerEntered;
    abort.abort(new Error("agent fixture cancellation"));
    await expect(job).rejects.toThrow("agent fixture cancellation");
    expect(one.session.status()[0].state).toBe("cancelled");
    await one.session.close();
  });

  it("refreshes owner context after a slow response and rejects a changed physical generation", async () => {
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    let generation: string | undefined;
    const one = setup("agent-workspace", 1, (context) => ({
      ...context,
      sessionId: generation ?? context.sessionId,
      expiresAt: new Date(clock + 30_000).toISOString(),
    }));
    try {
      one.provider.embedBatch.mockImplementationOnce(async () => {
        clock += 31_000;
        return [[3, 4, 0]];
      });
      await expect(
        one.session.embed({
          kind: "query",
          text: "slow response",
          context: one.context,
          space: one.space,
          deadlineAt: clock + 120_000,
        }),
      ).resolves.toMatchObject({ vectors: [[0.6, 0.8, 0]] });
      const fresh = { ...one.context, expiresAt: new Date(clock + 30_000).toISOString() };
      generation = "another-physical-generation";
      await expect(
        one.session.embed({
          kind: "query",
          text: "changed generation",
          context: fresh,
          space: one.space,
        }),
      ).rejects.toThrow("owner context changed");
    } finally {
      now.mockRestore();
      await one.session.close();
    }
  });

  it("enforces the supplied total deadline after a provider response", async () => {
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const one = setup();
    try {
      const deadlineAt = clock + 1000;
      one.provider.embedBatch.mockImplementationOnce(async () => {
        clock += 1001;
        return [[3, 4, 0]];
      });
      await expect(
        one.session.embed({
          kind: "query",
          text: "expired operation",
          context: one.context,
          space: one.space,
          deadlineAt,
        }),
      ).rejects.toThrow("total deadline");
      expect(one.session.status()[0].state).toBe("failed");
    } finally {
      now.mockRestore();
      await one.session.close();
    }
  });
});
