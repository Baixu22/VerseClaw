import { describe, expect, it } from "vitest";
import {
  createOwnerReadSnapshot,
  digestOwnerReadContent,
  type OwnerReadPolicy,
  type ReadAdmissionContextV1,
} from "../../runtime-core/knowledge-owner-read.js";
import { knowledgeChunkId } from "./citation.js";
import { chunkKnowledgeDocument } from "./chunker.js";
import type {
  ChunkerProfileV1,
  KnowledgeTokenizer,
  NormalizedSourceDocumentV1,
} from "./contracts.js";
import { normalizeKnowledgeSourceDocument } from "./source-document.js";

const context: ReadAdmissionContextV1 = {
  schema: "ReadAdmissionContext/v1",
  contextId: "ctx-rag-03",
  principalId: "agent-main",
  sessionId: "session-rag-03",
  workspaceId: "workspace-rag",
  ownerNamespaces: ["owner-rag"],
  policyDigest: "sha256:policy",
  purpose: "knowledge-read",
  egressProviderRefs: [],
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const policy: OwnerReadPolicy = {
  status: "active",
  trust: "confirmed",
  sensitivity: "workspace",
  acl: { read: ["agent-main"] },
  retention: { policy: "source-coupled" },
  verifiedAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
};

/** Agent-driven fixture: counting Unicode code points is not a model-tokenizer claim. */
const agentFixtureTokenizer: KnowledgeTokenizer = {
  id: "agent-fixture/codepoints-v1",
  digest: digestOwnerReadContent("agent-fixture/codepoints-v1"),
  count: (text) => [...text].length,
};

function profile(overrides: Partial<ChunkerProfileV1> = {}): ChunkerProfileV1 {
  return {
    schema: "ChunkerProfile/v1",
    version: "agent-fixture-profile-v1",
    targetTokens: 384,
    maxTokens: 768,
    maxChars: 2400,
    overlap: 0,
    tokenizerId: agentFixtureTokenizer.id,
    tokenizerDigest: agentFixtureTokenizer.digest,
    ...overrides,
  };
}

function isWellFormed(value: string): boolean {
  return (
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(value)) === value
  );
}

function documentFor(
  text: string,
  revision = "source-revision-1",
  readContext = context,
): NormalizedSourceDocumentV1 {
  const snapshot = createOwnerReadSnapshot({
    raw: text,
    startChar: 0,
    endChar: text.length,
    source: {
      domain: "wiki",
      authorityId: "owner-rag",
      namespaceId: "owner-rag",
      subjectId: "structure-fixture",
      revision,
    },
    context: readContext,
    policy,
    title: "Structure fixture",
  });
  return normalizeKnowledgeSourceDocument({ snapshot, context: readContext });
}

describe("chunkKnowledgeDocument", () => {
  it("keeps structure, raw CRLF quotes, heading retrieval context, and multilingual search tokens", () => {
    const text = [
      "# Root",
      "",
      "Intro CAFÉ parseKnowledgeDocumentV2 foo_bar.",
      "",
      "- 日本語かなカナ中文",
      "- второй",
      "",
      "1. Первый шаг",
      "2. Second step",
      "",
      "```ts",
      'const emoji = "😀";',
      "```",
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| 中 | 文 |",
      "",
      "> quoted 🇷🇺",
      "",
    ].join("\r\n");
    const document = documentFor(text);
    const chunks = chunkKnowledgeDocument(document, {
      context,
      profile: profile(),
      tokenizer: agentFixtureTokenizer,
    });

    expect(chunks.map((chunk) => chunk.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "step",
      "step",
      "code",
      "table",
      "blockquote",
    ]);
    expect(chunks.map((chunk) => chunk.quote).join("")).toBe(text);
    expect(chunks.find((chunk) => chunk.kind === "paragraph")?.headingPath).toEqual(["Root"]);
    const paragraph = chunks.find((chunk) => chunk.kind === "paragraph")!;
    expect(paragraph.retrievalText.startsWith("root\n\nintro café")).toBe(true);
    expect(paragraph.quote).toContain("CAFÉ");
    expect(paragraph.searchTokens).toEqual(
      expect.arrayContaining([
        "café",
        "parseknowledgedocumentv2",
        "parse",
        "knowledge",
        "document",
        "v2",
        "foo_bar",
        "foo",
        "bar",
      ]),
    );
    const listChunk = chunks.find((chunk) => chunk.quote.includes("日本語"))!;
    expect(listChunk.searchTokens).toEqual(expect.arrayContaining(["日本", "本語", "中文"]));
    expect(listChunk.searchTokens).toEqual(expect.arrayContaining(["かな", "なカ", "カナ"]));
    const firstStep = chunks.find((chunk) => chunk.quote.includes("Первый"))!;
    const secondList = chunks.find((chunk) => chunk.quote.includes("второй"))!;
    expect(firstStep.searchTokens).toContain("первый");
    expect(secondList.searchTokens).toContain("второй");
    expect(paragraph.tokenCount).toBe([...paragraph.retrievalText].length);
    for (const chunk of chunks) {
      expect(chunk.chunkId).toBe(knowledgeChunkId(chunk.source, chunk.chunker));
      expect(chunk.chunkId).toMatch(/^chunk:sha256:[a-f0-9]{64}$/);
    }
  });

  it("bounds long CRLF code and tables without splitting emoji or losing source bytes", () => {
    const longCode = `const value = "${"😀é中".repeat(72)}";`;
    const text = [
      "```ts",
      longCode,
      "```",
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| 😀 | 中文 |",
      "",
    ].join("\r\n");
    const document = documentFor(text);
    const boundedProfile = profile({ targetTokens: 24, maxTokens: 48, maxChars: 120 });
    const chunks = chunkKnowledgeDocument(document, {
      context,
      profile: boundedProfile,
      tokenizer: agentFixtureTokenizer,
    });

    expect(chunks.some((chunk) => chunk.kind === "code")).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "table")).toBe(true);
    expect(chunks.map((chunk) => chunk.quote).join("")).toBe(text);
    let prefix = "";
    for (const chunk of chunks) {
      expect(isWellFormed(chunk.quote)).toBe(true);
      expect(chunk.quote.endsWith("\r")).toBe(false);
      expect([...chunk.retrievalText].length).toBeLessThanOrEqual(boundedProfile.maxChars);
      expect(chunk.tokenCount).toBeLessThanOrEqual(boundedProfile.maxTokens);
      expect(chunk.tokenCount).toBe([...chunk.retrievalText].length);
      expect(document.text.slice(prefix.length, prefix.length + chunk.quote.length)).toBe(
        chunk.quote,
      );
      const locator = chunk.source.locator;
      expect(locator.startByte).toBe(Buffer.byteLength(prefix, "utf8"));
      expect(locator.endByteExclusive - locator.startByte).toBe(
        Buffer.byteLength(chunk.quote, "utf8"),
      );
      prefix += chunk.quote;
    }
    expect(prefix).toBe(text);
  });

  it("rejects tampered, expired, tokenizer-mismatched, and invalid-count inputs", () => {
    const document = documentFor("A paragraph.\r\n");
    const options = { context, profile: profile(), tokenizer: agentFixtureTokenizer };

    expect(() =>
      chunkKnowledgeDocument({ ...document, text: `${document.text}tampered` }, options),
    ).toThrow("does not match its snapshot");

    const expiredContext = { ...context, expiresAt: "2000-01-01T00:00:00.000Z" };
    const expiredDocument = {
      ...document,
      snapshot: { ...document.snapshot, context: expiredContext },
    };
    expect(() =>
      chunkKnowledgeDocument(expiredDocument, { ...options, context: expiredContext }),
    ).toThrow("knowledge source denied: expired");

    expect(() =>
      chunkKnowledgeDocument(document, {
        ...options,
        tokenizer: { ...agentFixtureTokenizer, id: "other-tokenizer" },
      }),
    ).toThrow("tokenizer identity does not match profile");

    expect(() =>
      chunkKnowledgeDocument(document, {
        ...options,
        tokenizer: { ...agentFixtureTokenizer, count: () => Number.NaN },
      }),
    ).toThrow("finite non-negative integer");
  });

  it("groups chunks by the original heading line and uses root outside headings", () => {
    const text = [
      "# Same",
      "",
      "first",
      "",
      "second",
      "",
      "# Same",
      "",
      "third",
      "",
      "fourth",
      "",
    ].join("\r\n");
    const document = documentFor(text);
    const options = { context, profile: profile(), tokenizer: agentFixtureTokenizer };
    const chunks = chunkKnowledgeDocument(document, options);
    const first = chunks.find((chunk) => chunk.quote.includes("first"))!;
    const second = chunks.find((chunk) => chunk.quote.includes("second"))!;
    const third = chunks.find((chunk) => chunk.quote.includes("third"))!;
    const fourth = chunks.find((chunk) => chunk.quote.includes("fourth"))!;
    const headings = chunks.filter((chunk) => chunk.kind === "heading");
    expect(first.sectionId).toBe(second.sectionId);
    expect(third.sectionId).toBe(fourth.sectionId);
    expect(first.sectionId).not.toBe(third.sectionId);
    expect(headings[0]!.sectionId).not.toBe(headings[1]!.sectionId);

    const rootChunks = chunkKnowledgeDocument(documentFor("alpha\r\n\r\nbeta\r\n"), options);
    expect(rootChunks[0]!.sectionId).toBe(rootChunks[1]!.sectionId);
  });

  it("scans a bounded code-unit window without quadratic source traversal", () => {
    let largestTokenizerInput = 0;
    const boundedTokenizer: KnowledgeTokenizer = {
      id: "agent-fixture/bounded-codepoints-v1",
      digest: digestOwnerReadContent("agent-fixture/bounded-codepoints-v1"),
      count: (value) => {
        largestTokenizerInput = Math.max(largestTokenizerInput, [...value].length);
        return [...value].length;
      },
    };
    const boundedProfile = profile({
      targetTokens: 80,
      maxTokens: 120,
      maxChars: 160,
      tokenizerId: boundedTokenizer.id,
      tokenizerDigest: boundedTokenizer.digest,
    });
    const text = `\`\`\`ts\r\n${"x".repeat(6000)}\r\n\`\`\`\r\n`;
    const chunks = chunkKnowledgeDocument(documentFor(text), {
      context,
      profile: boundedProfile,
      tokenizer: boundedTokenizer,
    });

    expect(chunks.map((chunk) => chunk.quote).join("")).toBe(text);
    expect(chunks.every((chunk) => !chunk.quote.endsWith("\r"))).toBe(true);
    expect(
      chunks.every((chunk) => [...chunk.retrievalText].length <= boundedProfile.maxChars),
    ).toBe(true);
    expect(largestTokenizerInput).toBeLessThanOrEqual(boundedProfile.maxChars);
  });

  it("does not assume a non-monotonic tokenizer prefix count", () => {
    const nonMonotonicTokenizer: KnowledgeTokenizer = {
      id: "agent-fixture/non-monotonic-v1",
      digest: digestOwnerReadContent("agent-fixture/non-monotonic-v1"),
      count: (value) => ([...value].length === 13 ? 2 : 100),
    };
    const nonMonotonicProfile = profile({
      targetTokens: 5,
      maxTokens: 5,
      maxChars: 40,
      tokenizerId: nonMonotonicTokenizer.id,
      tokenizerDigest: nonMonotonicTokenizer.digest,
    });
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunkKnowledgeDocument(documentFor(text), {
      context,
      profile: nonMonotonicProfile,
      tokenizer: nonMonotonicTokenizer,
    });

    expect(chunks.map((chunk) => chunk.quote)).toEqual(["abcdefghijklm", "nopqrstuvwxyz"]);
    expect(chunks.every((chunk) => chunk.tokenCount === 2)).toBe(true);
  });

  it("stops when a tokenizer callback aborts the read", () => {
    const controller = new AbortController();
    const abortingTokenizer: KnowledgeTokenizer = {
      id: "agent-fixture/aborting-v1",
      digest: digestOwnerReadContent("agent-fixture/aborting-v1"),
      count: (value) => {
        controller.abort();
        return [...value].length;
      },
    };
    const abortingProfile = profile({
      tokenizerId: abortingTokenizer.id,
      tokenizerDigest: abortingTokenizer.digest,
    });

    expect(() =>
      chunkKnowledgeDocument(documentFor("A paragraph.\r\n"), {
        context,
        profile: abortingProfile,
        tokenizer: abortingTokenizer,
        signal: controller.signal,
      }),
    ).toThrow("knowledge chunking aborted");
  });

  it("rebuilds identical identities and separates source revisions", () => {
    const text = "# Stable\r\n\r\nSame source.\r\n";
    const firstDocument = documentFor(text, "revision-a");
    const secondDocument = documentFor(text, "revision-b");
    const options = { context, profile: profile(), tokenizer: agentFixtureTokenizer };
    const first = chunkKnowledgeDocument(firstDocument, options);
    const rebuilt = chunkKnowledgeDocument(firstDocument, options);
    const changed = chunkKnowledgeDocument(secondDocument, options);

    expect(rebuilt).toEqual(first);
    expect(new Set(first.map((chunk) => chunk.parentId)).size).toBe(1);
    expect(first.map((chunk) => chunk.chunkId)).not.toEqual(changed.map((chunk) => chunk.chunkId));
    expect(first[0]!.parentId).not.toBe(changed[0]!.parentId);
    expect(first[0]!.sectionId).not.toBe(changed[0]!.sectionId);
  });
});
