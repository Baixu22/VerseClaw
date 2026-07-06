import { describe, expect, it, vi } from "vitest";
import {
  ReflectBudget,
  buildCritiquePrompt,
  buildReformedQuery,
  buildReflectiveRegenerationPrompt,
  dispositionForCategory,
  looksLikeAbstention,
  parseCritiqueResponse,
  runReflectAgent,
  shouldReflect,
} from "./helpers/runtime-memory-reflect-agent";

describe("runtime memory reflect agent — helpers", () => {
  it("parses valid critique JSON", () => {
    const content =
      '{"supported": false, "addresses": true, "issue": "missing", "missingConcept": "job title", "betterAnswer": ""}';
    const result = parseCritiqueResponse(content);
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.addresses).toBe(true);
    expect(result!.issue).toBe("missing");
    expect(result!.missingConcept).toBe("job title");
    expect(result!.betterAnswer).toBeUndefined();
  });

  it("parses critique JSON wrapped in markdown fences", () => {
    const content = '```json\n{"supported": true, "addresses": true, "issue": "none", "missingConcept": "", "betterAnswer": ""}\n```';
    const result = parseCritiqueResponse(content);
    expect(result).not.toBeNull();
    expect(result!.issue).toBe("none");
  });

  it("returns null for invalid JSON", () => {
    expect(parseCritiqueResponse("not json at all")).toBeNull();
    expect(parseCritiqueResponse('{"incomplete":')).toBeNull();
  });

  it("normalizes invalid issue to none", () => {
    const content =
      '{"supported": true, "addresses": true, "issue": "bogus", "missingConcept": "", "betterAnswer": ""}';
    const result = parseCritiqueResponse(content);
    expect(result).not.toBeNull();
    expect(result!.issue).toBe("none");
  });

  it("returns missingConcept only when non-empty", () => {
    const content =
      '{"supported": false, "addresses": false, "issue": "missing", "missingConcept": "  ", "betterAnswer": ""}';
    const result = parseCritiqueResponse(content);
    expect(result!.missingConcept).toBeUndefined();
  });

  it("builds reformed query focusing on missing concept", () => {
    const reformed = buildReformedQuery(
      "What does Alice do for work?",
      "job title",
    );
    expect(reformed).toContain("job title");
  });

  it("returns concept alone when concept is in question", () => {
    const reformed = buildReformedQuery(
      "What is Alice's job title?",
      "job title",
    );
    expect(reformed).toBe("job title");
  });

  it("returns original question when concept is empty", () => {
    const reformed = buildReformedQuery("What does Alice do?", "");
    expect(reformed).toBe("What does Alice do?");
  });

  it("returns category-aware dispositions", () => {
    expect(dispositionForCategory("multi_hop").skepticism).toBe(3);
    expect(dispositionForCategory("temporal").literalism).toBe(3);
    expect(dispositionForCategory("open_domain").empathy).toBe(3);
    const single = dispositionForCategory("single_hop");
    expect(single.skepticism).toBe(2);
    expect(single.literalism).toBe(2);
  });

  it("builds critique prompt with disposition and context cap", () => {
    const longContext = "x".repeat(5000);
    const { system, user } = buildCritiquePrompt(
      "What is Alice's job?",
      longContext,
      "engineer",
      { skepticism: 3, literalism: 2, empathy: 1 },
    );
    expect(system).toContain("skepticism=3/3");
    expect(system).toContain("literalism=2/3");
    expect(system).toContain("empathy=1/3");
    expect(user.length).toBeLessThan(longContext.length);
  });

  it("builds regeneration prompt with betterAnswer as hint only", () => {
    const { system } = buildReflectiveRegenerationPrompt(
      "What is Alice's job?",
      "single_hop",
      "Alice works as an engineer.",
      {
        supported: false,
        addresses: true,
        issue: "wrong",
        betterAnswer: "doctor",
      },
    );
    // Hint should be present but framed as a hint, not a directive.
    expect(system).toContain("doctor");
    expect(system).toContain("ONLY as a hint");
    expect(system).toContain("verify it against the context");
  });

  it("ReflectBudget enforces re-retrieval cap", () => {
    const budget = new ReflectBudget(100, 0.1); // max 10 re-retrievals
    expect(budget.maxReRetrieve).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(budget.tryReRetrieve()).toBe(true);
    }
    expect(budget.tryReRetrieve()).toBe(false);
    expect(budget.stats.reRetrieveUsed).toBe(10);
    expect(budget.stats.reRetrieveCapped).toBe(1);
  });
});

describe("runtime memory reflect agent — pre-check (v2)", () => {
  it("detects abstention-like answers", () => {
    expect(looksLikeAbstention("I don't know")).toBe(true);
    expect(looksLikeAbstention("not enough information")).toBe(true);
    expect(looksLikeAbstention("Cannot determine")).toBe(true);
    expect(looksLikeAbstention("[EVIDENCE_INSUFFICIENT]")).toBe(true);
    expect(looksLikeAbstention("")).toBe(true);
  });

  it("does not flag real answers as abstention", () => {
    expect(looksLikeAbstention("engineer")).toBe(false);
    expect(looksLikeAbstention("Alice works at Google")).toBe(false);
    expect(looksLikeAbstention("Paris, France")).toBe(false);
  });

  it("triggers reflect on abstention-like answers", () => {
    expect(shouldReflect("What is Alice's job?", "I don't know", "single_hop")).toBe(true);
    expect(shouldReflect("When did they meet?", "not enough information", "temporal")).toBe(true);
    expect(shouldReflect("How did they meet?", "cannot determine", "multi_hop")).toBe(true);
  });

  it("triggers reflect on very short empty-ish answers (< 3 chars)", () => {
    expect(shouldReflect("What is Alice's job?", "", "single_hop")).toBe(true);
    expect(shouldReflect("What is Alice's job?", "x", "multi_hop")).toBe(true);
  });

  it("does not trigger on real answers (v2.3 — multi_hop triggers, others abstention-only)", () => {
    // v2.3: multi_hop questions trigger reflect (for re-retrieval with new
    // embedding API). Other categories only trigger on abstention.
    expect(shouldReflect("What is Alice's job?", "engineer", "single_hop")).toBe(false);
    expect(shouldReflect("How did they meet?", "Spain", "multi_hop")).toBe(true); // v2.3
    expect(shouldReflect("When did they meet?", "March 2024", "temporal")).toBe(false);
    expect(
      shouldReflect("What about Alice?", "Alice enjoys hiking", "open_domain"),
    ).toBe(false);
  });
});

describe("runtime memory reflect agent — runReflectAgent (v2)", () => {
  it("skips critique on confident answers (pre-check)", async () => {
    const callLLM = vi.fn(async () => ({ content: "" }));
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "single_hop",
      initialAnswer: "Alice works as a senior engineer at Google",
      context: "Alice works as an engineer at Google.",
      callLLM: callLLM as unknown as Parameters<typeof runReflectAgent>[0]["callLLM"],
      extractFinalAnswer: (a) => a,
    });
    expect(result.used).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.critique).toBeNull();
    expect(result.finalAnswer).toBe("Alice works as a senior engineer at Google");
    // Critique LLM should NOT have been called.
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("keeps initial answer when critique is none (suspicious answer)", async () => {
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "single_hop",
      initialAnswer: "I don't know", // abstention → shouldReflect true
      context: "Alice works as an engineer at Google.",
      callLLM: async () => ({
        content:
          '{"supported": true, "addresses": true, "issue": "none", "missingConcept": "", "betterAnswer": ""}',
      }),
      extractFinalAnswer: (a) => a,
    });
    expect(result.used).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.finalAnswer).toBe("I don't know");
    expect(result.critique!.issue).toBe("none");
  });

  it("regenerates instead of using betterAnswer directly for wrong issue", async () => {
    let regenCalled = false;
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "single_hop",
      initialAnswer: "I don't know", // abstention → shouldReflect true
      context: "Alice works as an engineer at Google.",
      callLLM: async (system) => {
        if (system.includes("strict evaluator")) {
          return {
            content:
              '{"supported": false, "addresses": true, "issue": "wrong", "missingConcept": "", "betterAnswer": "doctor"}',
          };
        }
        // Regeneration call — v2 should reach here, v1 would not.
        regenCalled = true;
        return { content: "Final answer: engineer" };
      },
      regenerateWithContext: async () => "Final answer: engineer",
      extractFinalAnswer: (a) => {
        const m = a.match(/final answer:\s*(.+?)(\n|$)/is);
        return m ? m[1].trim() : a;
      },
    });
    // v2: regeneration is called, betterAnswer is NOT used directly.
    expect(regenCalled).toBe(true);
    expect(result.used).toBe(true);
    expect(result.finalAnswer).toBe("engineer");
    expect(result.reRetrieved).toBe(false);
    // critique.betterAnswer was "doctor" but finalAnswer is "engineer" —
    // proving betterAnswer was not used directly.
    expect(result.finalAnswer).not.toBe("doctor");
  });

  it("re-retrieves when critique says missing", async () => {
    const retrieveCalls: string[] = [];
    const result = await runReflectAgent({
      question: "What is Alice's job title?",
      category: "single_hop",
      initialAnswer: "I don't know", // abstention → shouldReflect true
      context: "Alice works at Google.",
      callLLM: async (system) => {
        if (system.includes("strict evaluator")) {
          return {
            content:
              '{"supported": false, "addresses": false, "issue": "missing", "missingConcept": "job title", "betterAnswer": ""}',
          };
        }
        return { content: "Final answer: software engineer" };
      },
      retrieve: async (query) => {
        retrieveCalls.push(query);
        return [
          {
            factId: "f1",
            subject: "Alice",
            predicate: "has job title",
            objectSummary: "software engineer",
          },
        ];
      },
      regenerateWithContext: async () => "Final answer: software engineer",
      extractFinalAnswer: (a) => {
        const m = a.match(/final answer:\s*(.+?)(\n|$)/is);
        return m ? m[1].trim() : a;
      },
    });
    expect(result.used).toBe(true);
    expect(result.reRetrieved).toBe(true);
    expect(result.finalAnswer).toBe("software engineer");
    expect(retrieveCalls).toHaveLength(1);
  });

  it("regenerates when no retrieve function (suspicious answer)", async () => {
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "single_hop",
      initialAnswer: "I don't know", // abstention → shouldReflect true
      context: "Alice works as an engineer.",
      callLLM: async (system) => {
        if (system.includes("strict evaluator")) {
          return {
            content:
              '{"supported": false, "addresses": true, "issue": "unsupported", "missingConcept": "", "betterAnswer": ""}',
          };
        }
        return { content: "Final answer: engineer" };
      },
      regenerateWithContext: async () => "Final answer: engineer",
      extractFinalAnswer: (a) => {
        const m = a.match(/final answer:\s*(.+?)(\n|$)/is);
        return m ? m[1].trim() : a;
      },
    });
    expect(result.used).toBe(true);
    expect(result.reRetrieved).toBe(false);
    expect(result.finalAnswer).toBe("engineer");
  });

  it("reverts to initial answer when regeneration looks worse (abstention)", async () => {
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "multi_hop",
      initialAnswer: "x", // < 3 chars → triggers shouldReflect
      context: "Alice works as an engineer at Google.",
      callLLM: async (system) => {
        if (system.includes("strict evaluator")) {
          return {
            content:
              '{"supported": false, "addresses": false, "issue": "wrong", "missingConcept": "", "betterAnswer": "engineer"}',
          };
        }
        // Regeneration produces an abstention-like answer — looks worse
        // than the initial (which was short but not abstention-like).
        return { content: "I don't know" };
      },
      regenerateWithContext: async () => "I don't know",
      extractFinalAnswer: (a) => a,
    });
    // Confidence check should revert: initial "x" was not abstention-like,
    // regeneration became abstention → revert.
    expect(result.used).toBe(false);
    expect(result.reverted).toBe(true);
    expect(result.finalAnswer).toBe("x");
  });

  it("keeps initial answer when regeneration is empty (fallback)", async () => {
    const result = await runReflectAgent({
      question: "What is Alice's job?",
      category: "multi_hop",
      initialAnswer: "x", // < 3 chars → triggers shouldReflect
      context: "Alice works as an engineer.",
      callLLM: async (system) => {
        if (system.includes("strict evaluator")) {
          return {
            content:
              '{"supported": false, "addresses": false, "issue": "wrong", "missingConcept": "", "betterAnswer": ""}',
          };
        }
        return { content: "" }; // empty regeneration
      },
      regenerateWithContext: async () => "",
      extractFinalAnswer: (a) => a,
    });
    // Empty regeneration falls through to fallback — keeps initial answer.
    expect(result.used).toBe(false);
    expect(result.finalAnswer).toBe("x");
  });
});
