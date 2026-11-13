import { afterEach, describe, expect, it } from "vitest";
import {
  createOwnerReadSnapshot,
  digestOwnerReadContent,
} from "../runtime-core/knowledge-owner-read.js";
import {
  createResolvedChatKnowledgeRef,
  resolveChatKnowledgeIntent,
} from "./chat-knowledge-intent.js";
import {
  collectContextCandidate,
  createContextCandidate,
  projectContextCandidates,
  reopenContextCandidateCollection,
  resetContextCandidateCollectionsForTests,
} from "./context-candidate.js";
import { packKnowledgeCandidates } from "./project-rag-packing.js";
import {
  beginTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
  summarizeTurnInjection,
} from "./turn-injection-budget.js";

function ref(id: string, content: string, conflictGroupId?: string) {
  const raw = "owner header\n" + content;
  const ownerSnapshot = createOwnerReadSnapshot({
    raw,
    startChar: raw.indexOf(content),
    endChar: raw.length,
    title: id,
    source: {
      authorityId: "memory-wiki",
      domain: "wiki",
      namespaceId: "fixture-vault",
      subjectId: id,
      revision: "1",
    },
    context: {
      schema: "ReadAdmissionContext/v1",
      contextId: "fixture",
      principalId: "operator",
      sessionId: "session",
      workspaceId: "workspace",
      ownerNamespaces: ["fixture-vault"],
      policyDigest: "fixture-policy",
      purpose: "knowledge-read",
      egressProviderRefs: ["fixture"],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    policy: {
      status: "active",
      trust: "confirmed",
      sensitivity: "workspace",
      acl: { read: ["operator"] },
      scope: { workspaceId: "workspace" },
      retention: { policy: "source-coupled" },
      verifiedAt: new Date().toISOString(),
    },
  });
  return {
    ...createResolvedChatKnowledgeRef({
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: id,
      revision: "1",
      title: id,
      lookup: id,
      content,
      ownerSnapshot,
      intentId: id,
      conflictGroupId,
    }),
    refId: id,
  };
}

function project(turnId: string, refs: ReturnType<typeof ref>[], total = 6000) {
  const ledger = beginTurnInjectionBudget({ turnId, total });
  for (const input of packKnowledgeCandidates(refs))
    collectContextCandidate(turnId, createContextCandidate(input));
  return { ledger, ...projectContextCandidates({ turnId, ledger, messages: [] }) };
}

afterEach(() => {
  resetContextCandidateCollectionsForTests();
  resetTurnInjectionBudgetsForTests();
});
describe("Project RAG atomic DCS packing", () => {
  it("retains the admitted ordinal rather than source identifiers, while preserving channel precedence", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "order", total: 6000 });
    collectContextCandidate(
      "order",
      createContextCandidate({
        authorityObjectId: "tools",
        authorityVersion: "1",
        sourceId: "dcs-tool-registry",
        channel: "tool_registry",
        target: "message",
        text: "tool metadata",
      }),
    );
    for (const input of packKnowledgeCandidates([
      ref("z-first", "first evidence"),
      ref("a-second", "second evidence"),
    ])) {
      collectContextCandidate("order", createContextCandidate(input));
    }
    const result = projectContextCandidates({ turnId: "order", ledger, messages: [] });
    expect(result.messages.map((message) => message.content)).toEqual([
      expect.stringContaining("first evidence"),
      expect.stringContaining("second evidence"),
      "tool metadata",
    ]);
    expect(
      result.projection.retainedEvidence?.units.map((unit) => unit.citations[0].intentId),
    ).toEqual(["z-first", "a-second"]);
    expect(result.projection.lineage.map((row) => row.channel)).toEqual([
      "knowledge",
      "knowledge",
      "tool_registry",
    ]);
  });

  it("drops an oversized chunk as a whole and keeps its requested token estimate", () => {
    const source = ref("long", "中文 💡 ".repeat(400));
    const input = packKnowledgeCandidates([source])[0];
    const result = project("chunk-drop", [source], input.text.length - 1);
    expect(result.messages).toHaveLength(0);
    expect(result.projection.retainedEvidence?.units).toEqual([]);
    expect(result.projection.lineage[0]).toMatchObject({
      reason: "budget-drop",
      charsApplied: 0,
      estimatedTokensRequested: Math.ceil(Buffer.byteLength(input.text) / 4),
      estimatedTokensApplied: 0,
      utf8BytesApplied: 0,
    });
    expect(summarizeTurnInjection(result.ledger).charsTruncated).toBe(0);
  });

  it("treats a conflict group atomically and deduplicates repeated chunk references", () => {
    const a = ref("a", "port 8080", "port"),
      b = ref("b", "port 9090", "port");
    const inputs = packKnowledgeCandidates([a, b, a]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].knowledgePacking?.citations).toHaveLength(2);
    expect(project("conflict-drop", [a, b, a], inputs[0].text.length - 1).messages).toHaveLength(0);
    const result = project("conflict-fit", [a, b, a], inputs[0].text.length);
    expect(result.projection.retainedEvidence?.units).toHaveLength(1);
    expect(
      result.projection.retainedEvidence?.units[0].citations.map((citation) => citation.intentId),
    ).toEqual(["a", "b"]);
    expect(result.messages[0].content).toContain("port 8080");
    expect(result.messages[0].content).toContain("port 9090");
  });
  it("rejects ambiguous group membership instead of silently retaining half a group", () => {
    const source = ref("a", "body", "first");
    expect(() =>
      packKnowledgeCandidates([source, { ...source, conflictGroupId: "second" }]),
    ).toThrow("conflicting packing groups");
  });

  it("binds source, chunk and projection digests to the actual retained UTF-8 bytes", () => {
    const source = ref("multilingual", "知识 💡 evidence\n");
    const result = project("digests", [source]);
    const text = result.messages[0].content as string;
    const manifest = result.projection.retainedEvidence!;
    const unit = manifest.units[0],
      citation = unit.citations[0];
    expect(citation.sourceDigest).toBe(digestOwnerReadContent("owner header\n" + source.content));
    expect(citation.chunkDigest).toBe(digestOwnerReadContent(source.content));
    expect(unit.projectionDigest).toBe(digestOwnerReadContent(text));
    expect(new Set([citation.sourceDigest, citation.chunkDigest, unit.projectionDigest]).size).toBe(
      3,
    );
    expect(citation.retainedBodyUtf8Bytes).toBe(
      citation.sourceRef.locator!.endByteExclusive - citation.sourceRef.locator!.startByte,
    );
    expect(manifest).toMatchObject({
      retainedChars: text.length,
      retainedUtf8Bytes: Buffer.byteLength(text),
      estimatedTokens: Math.ceil(Buffer.byteLength(text) / 4),
      estimateMethod: "utf8-bytes-div4",
    });
  });

  it("reuses a cached projection once, then excludes removed evidence on a reopened model call", () => {
    const first = project("calls", [ref("fact", "a retained fact")]);
    const used = first.ledger.budget.used;
    const repeated = projectContextCandidates({
      turnId: "calls",
      ledger: first.ledger,
      messages: first.messages,
    });
    expect(repeated.messages).toHaveLength(1);
    expect(first.ledger.budget.used).toBe(used);
    reopenContextCandidateCollection("calls");
    const next = projectContextCandidates({
      turnId: "calls",
      ledger: first.ledger,
      messages: repeated.messages,
    });
    expect(next.messages).toHaveLength(1);
    expect(next.projection.retainedEvidence?.units).toHaveLength(1);
    reopenContextCandidateCollection("calls");
    const removed = projectContextCandidates({
      turnId: "calls",
      ledger: first.ledger,
      messages: [],
    });
    expect(removed.projection.retainedEvidence?.units).toEqual([]);
    expect(removed.projection.retainedEvidence?.retainedUtf8Bytes).toBe(0);
  });

  it("keeps kill-switch accounting empty and refuses unbound source bodies", () => {
    const ledger = beginTurnInjectionBudget({ turnId: "killed", killed: true });
    for (const input of packKnowledgeCandidates([ref("fact", "secret-free fixture")]))
      collectContextCandidate("killed", createContextCandidate(input));
    const result = projectContextCandidates({ turnId: "killed", ledger, messages: [] });
    expect(result.messages).toHaveLength(0);
    expect(result.projection.retainedEvidence?.units).toEqual([]);
    expect(summarizeTurnInjection(ledger).charsApplied).toBe(0);
    const unbound = { ...ref("unbound", "body"), ownerSnapshot: undefined };
    expect(() => packKnowledgeCandidates([unbound])).toThrow("owner-bound");
  });

  it("does not retain one side of a conflict group when its other owner read is denied", async () => {
    const a = ref("a", "first", "conflict");
    const result = await resolveChatKnowledgeIntent({
      scope: "wiki",
      mode: "manual",
      references: [
        { id: "a", title: "a", lookup: "a", corpus: "wiki", conflictGroupId: "conflict" },
        { id: "b", title: "b", lookup: "b", corpus: "wiki", conflictGroupId: "conflict" },
      ],
      adapters: [
        {
          owner: "memory-wiki",
          resolve: async (input) =>
            input.id === "a"
              ? { status: "resolved", resolved: a }
              : { status: "denied", reason: "acl_denied", visibleReason: "fixture denial" },
        },
      ],
    });
    expect(result.admitted).toHaveLength(0);
    expect(result.denied.map((denial) => denial.id)).toEqual(["b", "a"]);
  });
});
