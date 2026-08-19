import { describe, expect, it } from "vitest";
import {
  collectContextCandidate,
  createContextCandidate,
  finalizeContextCandidates,
} from "./context-candidate.js";
import {
  beginTurnInjectionBudget,
} from "./turn-injection-budget.js";
import {
  createResolvedChatKnowledgeRef,
  normalizeChatKnowledgeReferences,
  packResolvedChatKnowledgeRef,
  resolveChatKnowledgeIntent,
  type ChatKnowledgeReferenceIntent,
  type ChatKnowledgeSourceAdapter,
  type ChatKnowledgeSourceAdapterResult,
  type ResolvedChatKnowledgeRef,
} from "./chat-knowledge-intent.js";

class FixtureWikiAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-wiki" as const;
  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (ref.lookup === "denied/acl") {
      return { status: "denied", reason: "acl_denied", visibleReason: `ACL denied for "${ref.title}".` };
    }
    if (ref.lookup === "denied/secret") {
      return { status: "denied", reason: "sensitive", visibleReason: `Sensitive for "${ref.title}".` };
    }
    if (ref.lookup === "denied/stale") {
      return { status: "denied", reason: "stale", visibleReason: `Stale for "${ref.title}".` };
    }
    if (ref.lookup === "denied/revoked") {
      return { status: "denied", reason: "revoked", visibleReason: `Revoked for "${ref.title}".` };
    }
    if (ref.lookup === "missing") return { status: "not_found" };
    if (!ref.lookup.startsWith("notes/") && ref.lookup !== "active-1") return { status: "not_found" };
    return {
      status: "resolved",
      resolved: createResolvedChatKnowledgeRef({
        owner: "memory-wiki",
        subjectKind: "wiki-page",
        subjectId: ref.lookup,
        revision: "rev-1",
        title: ref.title,
        lookup: ref.lookup,
        content: `Resolved body for ${ref.lookup}`,
        trust: "advisory",
        sensitivity: "workspace",
      }),
    };
  }
}

class FixtureMemoryAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-slot" as const;
  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (ref.lookup === "memory-card-1" || ref.id === "memory-card-1") {
      return {
        status: "resolved",
        resolved: createResolvedChatKnowledgeRef({
          owner: "memory-slot",
          subjectKind: "memory-card",
          subjectId: "memory-card-1",
          revision: "3",
          title: ref.title,
          lookup: ref.lookup,
          content: "Always keep the Task Ledger projection durable.",
          trust: "confirmed",
          sensitivity: "workspace",
        }),
      };
    }
    return { status: "not_found" };
  }
}

describe("normalizeChatKnowledgeReferences", () => {
  it("keeps only typed ref fields and drops renderer snippets", () => {
    const refs = normalizeChatKnowledgeReferences([
      {
        id: "decision-page",
        title: "Decision",
        lookup: "notes/decision.md",
        corpus: "wiki",
        snippet: "Trusted-looking body that must be dropped.",
        content: "Another body channel that must be dropped.",
        confidence: 0.91,
        attachKind: "auto",
      },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      id: "decision-page",
      title: "Decision",
      lookup: "notes/decision.md",
      corpus: "wiki",
      confidence: 0.91,
      attachKind: "auto",
    });
    expect(JSON.stringify(refs[0])).not.toContain("snippet");
    expect(JSON.stringify(refs[0])).not.toContain("content");
    expect(JSON.stringify(refs[0])).not.toContain("Trusted-looking");
  });

  it("rejects empty lookups", () => {
    expect(normalizeChatKnowledgeReferences([{ id: "x", title: "X", lookup: "" }])).toEqual([]);
  });
});

describe("resolveChatKnowledgeIntent", () => {
  const adapters = [new FixtureWikiAdapter(), new FixtureMemoryAdapter()];

  it("resolves active pinned refs through the DCS admission/resolve path", async () => {
    const resolution = await resolveChatKnowledgeIntent({
      scope: "wiki",
      mode: "auto-read",
      references: [
        { id: "decision-page", title: "Decision", lookup: "notes/decision.md", corpus: "wiki" },
        { id: "memory-card-1", title: "Task Ledger rule", lookup: "memory-card-1", corpus: "memory" },
      ],
      adapters,
    });
    expect(resolution.admitted).toHaveLength(2);
    expect(resolution.denied).toHaveLength(0);
    expect(resolution.admitted.map((ref) => ref.content)).toEqual([
      "Resolved body for notes/decision.md",
      "Always keep the Task Ledger projection durable.",
    ]);
  });

  it("never injects denied refs and returns a visible reason for each", async () => {
    const resolution = await resolveChatKnowledgeIntent({
      scope: "wiki",
      mode: "auto-read",
      references: [
        { id: "r1", title: "ACL", lookup: "denied/acl", corpus: "wiki" },
        { id: "r2", title: "Secret", lookup: "denied/secret", corpus: "wiki" },
        { id: "r3", title: "Stale", lookup: "denied/stale", corpus: "wiki" },
        { id: "r4", title: "Revoked", lookup: "denied/revoked", corpus: "wiki" },
        { id: "r5", title: "Missing", lookup: "missing", corpus: "wiki" },
      ],
      adapters,
    });
    expect(resolution.admitted).toHaveLength(0);
    expect(resolution.denied.map((entry) => entry.reason)).toEqual([
      "acl_denied",
      "sensitive",
      "stale",
      "revoked",
      "not_found",
    ]);
    for (const denial of resolution.denied) {
      expect(denial.visibleReason.length).toBeGreaterThan(0);
    }
  });

  it("falls through to the next owner only for corpus all / unset", async () => {
    const resolution = await resolveChatKnowledgeIntent({
      scope: "all",
      mode: "auto-read",
      references: [{ id: "memory-card-1", title: "Task Ledger rule", lookup: "memory-card-1" }],
      adapters,
    });
    // Fixture wiki returns not_found for that lookup, then memory-slot resolves.
    expect(resolution.admitted).toHaveLength(1);
    expect(resolution.admitted[0]?.owner).toBe("memory-slot");
  });
});

describe("DCS candidate injection path", () => {
  it("projects admitted refs through dcs-knowledge candidates and leaves denied refs out", async () => {
    const turnId = "turn-ks04-candidates";
    const resolution = await resolveChatKnowledgeIntent({
      scope: "wiki",
      mode: "auto-read",
      references: [
        { id: "active-1", title: "Active", lookup: "active-1", corpus: "wiki" },
        { id: "denied-1", title: "Denied", lookup: "denied/acl", corpus: "wiki" },
      ],
      adapters: [new FixtureWikiAdapter(), new FixtureMemoryAdapter()],
    });
    const ledger = beginTurnInjectionBudget({ turnId });
    for (const ref of resolution.admitted) {
      collectContextCandidate(
        turnId,
        createContextCandidate({
          authorityObjectId: `chat-knowledge:${ref.owner}:${ref.subjectId}`,
          authorityVersion: ref.revision,
          sourceId: "dcs-knowledge",
          channel: "knowledge",
          target: "message",
          text: packResolvedChatKnowledgeRef(ref),
        }),
      );
    }
    const projection = finalizeContextCandidates({ turnId, ledger });
    expect(resolution.admitted).toHaveLength(1);
    expect(projection.messages).toHaveLength(1);
    expect(projection.lineage).toHaveLength(1);
    expect(projection.lineage[0]?.sourceId).toBe("dcs-knowledge");
    expect(projection.lineage[0]?.charsApplied).toBeGreaterThan(0);
    expect(projection.lineage[0]?.disposition).toBe("applied");
  });
});

describe("packResolvedChatKnowledgeRef", () => {
  it("includes owner, revision, and digest without dumping unbounded content", () => {
    const resolved: ResolvedChatKnowledgeRef = createResolvedChatKnowledgeRef({
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: "notes/decision.md",
      revision: "rev-1",
      title: "Decision",
      lookup: "notes/decision.md",
      content: "Use the managed wiki.",
    });
    const packed = packResolvedChatKnowledgeRef(resolved);
    expect(packed).toContain("[Knowledge reference: Decision (notes/decision.md)]");
    expect(packed).toContain("owner: memory-wiki");
    expect(packed).toContain("revision: rev-1");
    expect(packed).toContain("digest:");
    expect(packed).toContain("Use the managed wiki.");
  });
});
