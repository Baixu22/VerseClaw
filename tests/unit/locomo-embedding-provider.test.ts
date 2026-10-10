// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_QWEN_EMBEDDING, createLocomoEmbeddingProvider, getLocomoEmbeddingConfig, hasLocomoEmbeddingConfig, verifyLocomoEmbeddingResources } from "./helpers/locomo-embedding-provider";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
const vector = (value = 1) => [value, ...Array<number>(4095).fill(0)];
beforeEach(() => { vi.stubEnv("SILICONFLOW_API_KEY", ""); vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", ""); vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_MODEL_FILE", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.mocked(createHash).mockReset(); });
describe("explicit local LoCoMo embedding resource", () => {
  it("keeps the default provider unchanged and fails without credentials", async () => {
    expect(getLocomoEmbeddingConfig()).toMatchObject({ id: "siliconflow-qwen3-embed-8b", dimension: 4096 });
    expect(hasLocomoEmbeddingConfig()).toBe(false);
    await expect(verifyLocomoEmbeddingResources()).rejects.toThrow("SILICONFLOW_API_KEY");
  });
  it.each(["http://example.com/v1", "https://127.0.0.1/v1", "http://u:p@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#x"])("rejects unsafe local URL %s", url => {
    vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", url);
    expect(() => getLocomoEmbeddingConfig()).toThrow("loopback");
  });
  it("requires the actual pinned model file, not merely a self-declared provider ID", async () => {
    vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", "http://127.0.0.1:19087/v1");
    await expect(verifyLocomoEmbeddingResources()).rejects.toThrow("model file");
    const dir = mkdtempSync(join(tmpdir(), "locomo-weight-hash-"));
    try { const file = join(dir, "not-a-model.gguf"); writeFileSync(file, "not model weights"); vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_MODEL_FILE", file); await expect(verifyLocomoEmbeddingResources()).rejects.toThrow("SHA256 mismatch"); }
    finally { rmSync(join(dir, "not-a-model.gguf")); rmdirSync(dir); }
  });
  it.each(["valid", "wrong-alias", "wrong-path", "missing-build"])("binds weights to live server properties: %s", async scenario => {
    const dir = mkdtempSync(join(tmpdir(), "locomo-server-identity-"));
    const file = join(dir, "synthetic-weights.gguf");
    writeFileSync(file, "synthetic test bytes, never measured weights");
    try {
      vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", "http://127.0.0.1:19087/v1");
      vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_MODEL_FILE", file);
      vi.mocked(createHash).mockReturnValueOnce({ update: vi.fn(), digest: () => LOCAL_QWEN_EMBEDDING.weightsSha256 } as unknown as ReturnType<typeof createHash>);
      const props = { model_path: scenario === "wrong-path" ? dir : file, model_alias: scenario === "wrong-alias" ? "other-model" : LOCAL_QWEN_EMBEDDING.model, build_info: scenario === "missing-build" ? undefined : "synthetic-test-build" };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(props))));
      if (scenario === "valid") await expect(verifyLocomoEmbeddingResources()).resolves.toMatchObject({ serverBuild: "synthetic-test-build", verifiedWeightsSha256: LOCAL_QWEN_EMBEDDING.weightsSha256 });
      else await expect(verifyLocomoEmbeddingResources()).rejects.toThrow("not serving the verified model");
    } finally { rmSync(file); rmdirSync(dir); }
  });
  it("uses a distinct cache identity, retains ordering and never sends provider credentials", async () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "secret-test-not-a-key"); vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", "http://127.0.0.1:19087/v1");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "qwen3-embedding-8b-q4_k_m", data: [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector() }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createLocomoEmbeddingProvider();
    expect(provider.id).not.toBe("siliconflow-qwen3-embed-8b");
    expect((await provider.embedBatch(["first", "second"])).map(row => row[0])).toEqual([1, 2]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("secret-test-not-a-key");
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });
  it.each([
    { data: [] }, { model: undefined, data: [{ index: 0, embedding: vector() }] },
    { data: [{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }] }, { data: [{ index: 1, embedding: vector() }] },
    { data: [{ index: 0, embedding: [1, 2] }] },
    { data: [{ index: 0, embedding: Array(4096).fill(0) }] },
    { model: "wrong-model", data: [{ index: 0, embedding: vector() }] },
  ])("fails closed on malformed model/vector responses", async body => {
    vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", "http://127.0.0.1:19087/v1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "qwen3-embedding-8b-q4_k_m", ...body }))));
    await expect(createLocomoEmbeddingProvider().embedQuery("fixture")).rejects.toThrow();
  });
  it("does not expose backend error bodies or turn failed requests into zero vectors", async () => {
    vi.stubEnv("RUNTIME_MEMORY_LOCAL_EMBEDDING_URL", "http://127.0.0.1:19087/v1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private body", { status: 503 })));
    await expect(createLocomoEmbeddingProvider().embedQuery("fixture")).rejects.toThrow(/^Local embedding HTTP 503$/);
  });
});
