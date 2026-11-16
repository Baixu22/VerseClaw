import { afterEach, expect, it, vi } from "vitest";
import {
  createOwnerReadSnapshot,
  deriveReadAdmissionContext,
  digestOwnerReadContent,
} from "openclaw/plugin-sdk/memory-host-core";
import { resolveMemoryWikiConfig } from "./config.js";
import { searchMemoryWiki } from "./query.js";

const { ownerRead, search } = vi.hoisted(() => ({ ownerRead: vi.fn(), search: vi.fn() }));
vi.mock("openclaw/plugin-sdk/memory-host-search", () => ({
  getActiveMemorySearchManager: async () => ({ manager: { search } }),
}));
vi.mock("openclaw/plugin-sdk/knowledge-retrieval", async (original) => ({
  ...(await original<typeof import("openclaw/plugin-sdk/knowledge-retrieval")>()),
  readNativeMemorySource: ownerRead,
}));
vi.mock("./vault.js", async (original) => ({
  ...(await original<typeof import("./vault.js")>()),
  initializeMemoryWikiVault: async () => undefined,
}));
afterEach(() => vi.clearAllMocks());

it("rejects provider hits outside the declared memory or sessions source contract", async () => {
  search.mockResolvedValue([
    {
      path: "memory/unknown.md",
      startLine: 1,
      endLine: 1,
      score: 0.9,
      snippet: "UNPINNED_PROVIDER_BODY",
      source: "qmd-collection",
    },
  ]);
  const result = await searchMemoryWiki({
    config: resolveMemoryWikiConfig({
      vaultMode: "isolated",
      vault: { path: "D:/tmp" },
      search: { backend: "shared", corpus: "memory" },
    }),
    appConfig: { session: { store: "D:/tmp/project-rag-unused-query-session.json" } },
    query: "unknown provider body",
    searchBackend: "shared",
    searchCorpus: "memory",
  });
  expect(result).toEqual([]);
  expect(ownerRead).not.toHaveBeenCalled();
});

it("keeps a late native search hit and its raw-source coordinates instead of the file prefix", async () => {
  const head = Array.from({ length: 220 }, (_, i) => `noise ${i} ${"x".repeat(30)}\r\n`).join("");
  const quote = "RAG13_LATE_QUERY 中文😀\r\n",
    raw = head + quote + "after\r\n";
  const hitLine = 1 + (head.match(/\n/g)?.length ?? 0);
  const context = deriveReadAdmissionContext({
    principalId: "operator",
    agentId: "main",
    sessionId: "query-test",
    workspaceId: "query-test",
    workspaceRootDigest: digestOwnerReadContent("query-test"),
    ownerNamespaces: ["native-memory:query-test"],
    policyDigest: digestOwnerReadContent("query-policy"),
    egressProviderRefs: [],
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
  const snapshot = createOwnerReadSnapshot({
    raw,
    startChar: 0,
    endChar: raw.length,
    context,
    title: "memory/long.md",
    source: {
      domain: "native-memory",
      authorityId: "native-memory",
      namespaceId: "native-memory:query-test",
      subjectId: "memory/long.md",
      revision: digestOwnerReadContent(raw),
    },
    policy: {
      status: "active",
      trust: "confirmed",
      sensitivity: "workspace",
      acl: { read: ["operator"] },
      retention: { policy: "source-coupled" },
    },
  });
  ownerRead.mockResolvedValue({ status: "admitted", snapshot });
  search.mockResolvedValue([
    {
      path: "memory/long.md",
      startLine: hitLine,
      endLine: hitLine,
      score: 0.9,
      snippet: "old index preview",
      source: "memory",
    },
  ]);
  const result = await searchMemoryWiki({
    config: resolveMemoryWikiConfig({
      vaultMode: "isolated",
      vault: { path: "D:/tmp" },
      search: { backend: "shared", corpus: "memory" },
    }),
    appConfig: { session: { store: "D:/tmp/project-rag-unused-query-session.json" } },
    agentId: "other-agent",
    query: "RAG13_LATE_QUERY",
    searchBackend: "shared",
    searchCorpus: "memory",
  });
  expect(result).toHaveLength(1);
  expect(ownerRead).toHaveBeenCalledWith(expect.objectContaining({ agentId: "other-agent" }));
  expect(result[0].snippet).toBe(quote);
  expect(result[0]).toMatchObject({ startLine: hitLine, endLine: hitLine });
  expect(result[0].sourceRef).toMatchObject({
    sourceDigest: digestOwnerReadContent(raw),
    locator: {
      coordinateSpace: "raw-source-utf8-v1",
      startByte: Buffer.byteLength(head, "utf8"),
      endByteExclusive: Buffer.byteLength(head + quote, "utf8"),
      startLine: hitLine,
      endLine: hitLine,
    },
  });
});
