import { describe, expect, it, vi } from "vitest";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "../../../packages/llm-core/src/index.js";
import {
  generateSummary,
  INITIAL_COMPACTION_SUMMARY_SHAPE,
  UPDATE_COMPACTION_SUMMARY_SHAPE,
} from "../../../packages/agent-core/src/harness/compaction/compaction.js";
import {
  REQUIRED_COMPACTION_SECTIONS,
  renderCompactionSummaryShape,
} from "../../../packages/agent-core/src/harness/compaction/summary-contract.js";
import { MERGE_SUMMARIES_INSTRUCTIONS } from "../compaction.js";
import {
  auditSummaryQuality,
  buildCompactionStructureInstructions,
  buildStructuredFallbackSummary,
} from "./compaction-safeguard-quality.js";
import { buildValidatedCompactionOutput } from "./compaction-validated-pipeline.js";

function canonicalSummary(): string {
  return renderCompactionSummaryShape({
    "## Goal and Progress": [
      "Unify the compaction summary contract.",
      "Latest user ask: keep provider and LLM summaries under the same audit.",
    ].join("\n"),
    "## Attempts and Failures": "(none)",
    "## Key Decisions and Constraints": "Keep exact identifiers and do not change triggers.",
    "## Current State": [
      "### Done",
      "- Shared the canonical section list.",
      "### In Progress",
      "- Run regression tests.",
      "### Blocked",
      "- (none)",
    ].join("\n"),
    "## Key Decisions": "- Use the agent-core contract as the source of truth.",
    "## Files Touched": "- src/auth/middleware.ts",
    "## Tests": "- pnpm test:dcs",
    "## Next Actions": "1. Review the shared audit evidence.",
  });
}

describe("TF-0124 canonical compaction summary contract", () => {
  it("uses one required section list in both initial and update model shapes", () => {
    expect(REQUIRED_COMPACTION_SECTIONS).toHaveLength(8);
    for (const section of REQUIRED_COMPACTION_SECTIONS) {
      expect(INITIAL_COMPACTION_SUMMARY_SHAPE).toContain(section);
      expect(UPDATE_COMPACTION_SUMMARY_SHAPE).toContain(section);
    }
  });

  it.each([false, true])("passes sections and verbatim facts through the model prompt, update=%s", async (update) => {
    const statements = [
      "Objective COHORT-05 remains active after the boundary",
      "Acceptance: build-A=ready, receipt-B=missing.",
    ];
    const previousSummary = update ? `${canonicalSummary()}\n${statements.join("\n")}` : undefined;
    const captured: Context[] = [];
    const response: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: canonicalSummary() }],
      api: "test-api",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    };
    const streamFn = vi.fn(
      async (_model: Model, _context: Context, _options?: SimpleStreamOptions) => ({
        async *[Symbol.asyncIterator]() {},
        async result() { return response; },
      }),
    );
    const result = await generateSummary(
      [{
        role: "user",
        content: update
          ? "Continue the task; keep the active statements verbatim."
          : `Keep these active statements verbatim:\n${statements.join("\n")}\nContinue the task.`,
        timestamp: 0,
      }],
      {
        id: "test-model",
        name: "test-model",
        api: "test-api",
        provider: "test-provider",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
      },
      2048,
      "test-key",
      undefined,
      undefined,
      undefined,
      previousSummary,
      undefined,
      streamFn,
    );
    expect(result.ok).toBe(true);
    captured.push(...streamFn.mock.calls.map((call) => call[1]));
    const prompt = JSON.stringify(captured[0]?.messages ?? []);
    for (const section of REQUIRED_COMPACTION_SECTIONS) {
      expect(prompt).toContain(section);
    }
    for (const statement of statements) expect(prompt).toContain(statement);
    expect(prompt).toMatch(/preserved verbatim, copy[^\n]*exactly/u);
    expect(prompt).toContain("one complete original line");
    expect(prompt).toContain("do not extract a new label, add a colon, repeat an identifier");
    for (const detail of ["labels", "wording", "punctuation"]) expect(prompt).toContain(detail);
    expect(prompt).toContain("each fact in one relevant section");
    expect(prompt.includes("<previous-summary>")).toBe(update);
  });

  it("aligns merge instructions with the canonical section order", () => {
    const lines = MERGE_SUMMARIES_INSTRUCTIONS.split(/\r?\n/u);
    let cursor = -1;
    for (const section of REQUIRED_COMPACTION_SECTIONS) {
      const index = lines.indexOf(section);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("accepts a canonical summary under the ClawX quality audit", () => {
    const summary = canonicalSummary();
    expect(auditSummaryQuality({
      summary,
      identifiers: ["src/auth/middleware.ts"],
      latestAsk: "keep provider and LLM summaries under the same audit",
      identifierPolicy: "strict",
    })).toEqual({ ok: true, reasons: [] });
    for (const section of REQUIRED_COMPACTION_SECTIONS) {
      expect(buildCompactionStructureInstructions()).toContain(section);
    }
  });

  it("builds an eight-section fallback that also passes structural audit", () => {
    const fallback = buildStructuredFallbackSummary("Retain the previous objective.");
    expect(auditSummaryQuality({
      summary: fallback,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    })).toEqual({ ok: true, reasons: [] });
  });

  it("runs provider and LLM outputs through the same canonical quality audit", () => {
    const summary = canonicalSummary();
    const common = {
      summary,
      messages: [],
      identifiers: ["src/auth/middleware.ts"],
      latestAsk: "keep provider and LLM summaries under the same audit",
      identifierPolicy: "strict" as const,
    };
    const provider = buildValidatedCompactionOutput({ ...common, source: "provider" });
    const llm = buildValidatedCompactionOutput({ ...common, source: "llm" });
    expect(provider.decision.quality).toEqual({ ok: true, reasons: [] });
    expect(provider.decision.quality).toEqual(llm.decision.quality);
  });

  it("does not exempt provider summaries from missing-section failures", () => {
    const missingSection = REQUIRED_COMPACTION_SECTIONS[1];
    const sectionBlock = `${missingSection}\n(none)\n\n`;
    const summary = canonicalSummary().replace(sectionBlock, "");
    expect(summary).not.toContain(missingSection);
    const provider = buildValidatedCompactionOutput({
      source: "provider",
      summary,
      messages: [],
      identifiers: ["src/auth/middleware.ts"],
      latestAsk: "keep provider and LLM summaries under the same audit",
      identifierPolicy: "strict",
    });

    expect(provider.decision.quality.ok).toBe(false);
    expect(provider.decision.quality.reasons).toContain(`missing_section:${missingSection}`);
    expect(provider.decision.reasons).toContain(`missing_section:${missingSection}`);
  });
});
