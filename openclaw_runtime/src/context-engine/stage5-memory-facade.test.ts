import { describe, expect, it } from "vitest";
import {
  createSemanticMemoryFacade,
  STAGE5_MEMORY_TOOL_NAMES,
  STAGE5_MEMORY_WRITE_BOUNDARY,
  type MemoryCandidate,
} from "./stage5-memory-facade.js";

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;
const VALID_EVIDENCE = { ref: "ref:evidence:1", digest: VALID_DIGEST };

const candidate: MemoryCandidate = {
  id: "mem-1",
  namespace: "workspace-a",
  contentRef: "ref:memory:1",
  backend: "semantic-memory",
  source: "memory",
  freshness: "fresh",
  evidence: [VALID_EVIDENCE],
};

describe("stage5 semantic memory facade", () => {
  it("routes all compatibility reads to candidate-only results with provenance", () => {
    const calls: string[] = [];
    const facade = createSemanticMemoryFacade({
      owner: { append: () => calls.push("write") },
      adapter: {
        search: () => [candidate],
        get: () => candidate,
      },
    });
    expect(STAGE5_MEMORY_TOOL_NAMES).toEqual([
      "memory_search",
      "memory_get",
      "memory_query",
      "context_search",
      "context_read",
    ]);
    for (const tool of STAGE5_MEMORY_TOOL_NAMES) {
      const result = facade.search(tool, { namespace: "workspace-a", limit: 5 });
      expect(result.tool).toBe(tool);
      expect(result.authority).toBe("candidate-only");
      expect(result.candidates[0]).toMatchObject({ backend: "semantic-memory", source: "memory", freshness: "fresh" });
      expect(result.candidates[0]?.evidence[0]).toEqual(VALID_EVIDENCE);
    }
    expect(calls).toEqual([]);
  });

  it("uses exactly the injected owner for persistence", () => {
    const writes: unknown[] = [];
    const facade = createSemanticMemoryFacade({
      owner: { append: (request) => writes.push(request) },
      adapter: { search: () => [] },
    });
    expect(STAGE5_MEMORY_WRITE_BOUNDARY).toContain("single-writer");
    expect(facade.persist({ namespace: "workspace-a", contentRef: "ref:memory:1", evidence: [VALID_EVIDENCE] })).toEqual({
      ok: true,
      owner: "semantic-memory",
    });
    expect(writes).toHaveLength(1);
  });

  it("is deterministic", () => {
    const facade = createSemanticMemoryFacade({ owner: { append: () => undefined }, adapter: { search: () => [candidate] } });
    const first = facade.search("memory_search", { namespace: "workspace-a" });
    const second = facade.search("memory_search", { namespace: "workspace-a" });
    expect(second).toEqual(first);
  });

  it("fails closed on unknown tool names and invalid query fields", () => {
    const facade = createSemanticMemoryFacade({ owner: { append: () => undefined }, adapter: { search: () => [candidate] } });
    expect(() => facade.search("bogus" as never, { namespace: "workspace-a" })).toThrow("memory-invalid-tool-name");
    expect(() => facade.search("memory_search", { namespace: "bad\nns" })).toThrow("memory-invalid-namespace");
    expect(() => facade.search("memory_search", { namespace: "bad*ns" })).toThrow("memory-invalid-namespace");
    expect(() => facade.search("memory_search", { namespace: "workspace-a", limit: Number.NaN })).toThrow("memory-invalid-limit");
    expect(() => facade.search("memory_search", { namespace: "workspace-a", id: "bad id" })).toThrow("memory-invalid-query-id");
  });

  it("fails closed on schema-invalid adapter candidates", () => {
    const facade = createSemanticMemoryFacade({
      owner: { append: () => undefined },
      adapter: { search: () => [{ ...candidate, source: "bogus" as never }] },
    });
    expect(() => facade.search("memory_search", { namespace: "workspace-a" })).toThrow("memory-invalid-source");
    const badBackend = createSemanticMemoryFacade({
      owner: { append: () => undefined },
      adapter: { search: () => [{ ...candidate, backend: "bogus" as never }] },
    });
    expect(() => badBackend.search("memory_search", { namespace: "workspace-a" })).toThrow("memory-invalid-backend");
    const badFreshness = createSemanticMemoryFacade({
      owner: { append: () => undefined },
      adapter: { search: () => [{ ...candidate, freshness: "bogus" as never }] },
    });
    expect(() => badFreshness.search("memory_search", { namespace: "workspace-a" })).toThrow("memory-invalid-freshness");
    const badEvidence = createSemanticMemoryFacade({
      owner: { append: () => undefined },
      adapter: { search: () => [{ ...candidate, evidence: [{ ref: "ref:e", digest: "sha256:e1" }] }] },
    });
    expect(() => badEvidence.search("memory_search", { namespace: "workspace-a" })).toThrow("memory-invalid-evidence-digest");
  });

  it("fails closed on schema-invalid writes without calling the owner", () => {
    const writes: unknown[] = [];
    const facade = createSemanticMemoryFacade({ owner: { append: (request) => writes.push(request) }, adapter: { search: () => [] } });
    expect(() => facade.persist({ namespace: " ", contentRef: "ref:x", evidence: [] })).toThrow("memory-invalid-namespace");
    expect(() => facade.persist({ namespace: "bad*ns", contentRef: "ref:x", evidence: [] })).toThrow("memory-invalid-namespace");
    expect(() => facade.persist({ namespace: "workspace-a", contentRef: "bad\nref", evidence: [] })).toThrow("memory-invalid-content-ref");
    expect(() =>
      facade.persist({ namespace: "workspace-a", contentRef: "ref:x", evidence: [{ ref: "ref:e", digest: "sha256:e1" }] }),
    ).toThrow("memory-invalid-evidence-digest");
    expect(writes).toEqual([]);
  });
});
