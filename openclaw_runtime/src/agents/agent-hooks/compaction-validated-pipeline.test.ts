import { describe, expect, it, vi } from "vitest";
import { REQUIRED_COMPACTION_SECTIONS } from "./compaction-damage-rules.js";
import {
  buildDeterministicCompressionArtifact,
  type CompressionArtifact,
  type CompressionSemanticAtom,
} from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import { renderCompactionSummaryShape } from "../../../packages/agent-core/src/harness/compaction/summary-contract.js";
import type { AgentMessage } from "../runtime/index.js";
import { __testing as compactionSafeguardTesting } from "./compaction-safeguard.js";
import {
  COMPACTION_VALIDATED_PIPELINE_SCHEMA,
  buildValidatedCompactionOutput,
  extractCandidateSemanticAtoms,
} from "./compaction-validated-pipeline.js";

function message(id: string, role: AgentMessage["role"], content: string): AgentMessage {
  return { id, role, content } as unknown as AgentMessage;
}

function structuredSummary(overrides: Partial<Record<string, string>> = {}): string {
  return renderCompactionSummaryShape({
    "## Goal and Progress": [
      overrides.goal ?? "Implement the validated compaction pipeline.",
      `Latest user ask: ${overrides.asks ?? "Implement the validated compaction pipeline with shadow decisions."}`,
    ].join("\n"),
    "## Attempts and Failures": overrides.failedAttempts ?? "(none)",
    "## Key Decisions and Constraints":
      overrides.constraints ?? "- Keep P2 shadow-only and never enforce retries.",
    "## Current State": [
      "### Done",
      "- The shared validation path is implemented.",
      "",
      "### In Progress",
      "- Run the final regression suite.",
      "",
      "### Blocked",
      "- (none)",
    ].join("\n"),
    "## Key Decisions":
      overrides.decisions ?? "- Use one shared finalize helper for provider and LLM.",
    "## Files Touched": overrides.identifiers ?? "- src/auth/middleware.ts",
    "## Tests": "- pnpm test",
    "## Next Actions": overrides.todos ?? "1. Run the regression test suite.",
  });
}

function atom(
  id: string,
  type: CompressionSemanticAtom["type"],
  canonicalIdentity: string,
  text: string,
  status: CompressionSemanticAtom["status"] = "verified",
): CompressionSemanticAtom {
  return {
    id,
    type,
    canonicalIdentity,
    severity: "critical",
    confidence: 0.95,
    scope: "session",
    polarity: "neutral",
    status,
    text,
    evidenceRefs: [{ type: "session", ref: "message:1" }],
  };
}

function previousArtifactWith(atoms: CompressionSemanticAtom[]): CompressionArtifact {
  return buildDeterministicCompressionArtifact({
    messages: [message("message:1", "user", "Preserve the critical ledger.")],
    semanticAtoms: atoms,
  });
}

const STANDARD_MESSAGES: AgentMessage[] = [
  message("message:1", "user", "Please implement the validated compaction pipeline."),
  message(
    "message:2",
    "assistant",
    "Implemented the shared finalize path and covered src/auth/middleware.ts.",
  ),
];

describe("buildValidatedCompactionOutput", () => {
  it("builds a schemaVersion 1 shadow artifact with JSON-serializable candidates", () => {
    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary: structuredSummary(),
      messages: STANDARD_MESSAGES,
      identifiers: ["src/auth/middleware.ts"],
      latestAsk: "Implement the validated compaction pipeline.",
      identifierPolicy: "strict",
    });

    expect(output.artifact.schemaVersion).toBe(1);
    expect(output.decision.schema).toBe(COMPACTION_VALIDATED_PIPELINE_SCHEMA);
    expect(output.decision.mode).toBe("shadow");
    expect(output.decision.repairAttempts).toBe(0);
    expect(output.decision.wouldRetry).toBe(false);
    expect(output.decision.wouldFallback).toBe(false);
    expect(output.decision.wouldPreserveTurns).toBe(false);
    expect(output.artifact.semanticAtoms?.length ?? 0).toBeGreaterThan(0);
    expect(() => JSON.stringify(output)).not.toThrow();
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it("matches every retained previous critical atom and reports no ledger omissions", () => {
    const previous = previousArtifactWith([
      atom("atom-goal-a", "goal", "goal:ship-pipeline", "Ship the validated compaction pipeline."),
      atom("atom-decision-a", "decision", "decision:shared-finalize", "Use one shared finalize helper."),
      atom("atom-constraint-a", "constraint", "constraint:shadow-only", "Keep P2 shadow-only."),
      atom("atom-failed-a", "failed_attempt", "failed:trusted-provider", "Provider trusted bypass dropped audits."),
      atom("atom-next-a", "next_action", "next:regressions", "Run the regression test suite."),
    ]);

    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary({
        goal: "Ship the validated compaction pipeline.",
        decisions: "- Use one shared finalize helper.",
        constraints: "- Keep P2 shadow-only.",
        todos: "- Run the regression test suite.",
        asks: "Ship the pipeline and run regressions.",
        failedAttempts: "- Provider trusted bypass dropped audits.",
        identifiers: "src/auth/middleware.ts",
      }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.criticalLedger.compared).toBe(5);
    expect(output.decision.criticalLedger.missingAtomIds).toEqual([]);
  });

  it("compares an authoritative first-compaction baseline from explicit message markers", () => {
    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary({
        goal: "Ship the bounded retry pipeline.",
        decisions: "- Keep the provider retry bounded.",
        todos: "- Inspect the final gate.",
      }),
      messages: [
        message("message:goal", "user", "Objective: ship the bounded retry pipeline."),
        message("message:decision", "assistant", "Decision: retry at most once per compaction."),
        message("message:next", "assistant", "Next action: inspect the final gate evidence."),
      ],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.criticalLedger.compared).toBe(3);
    expect(output.decision.criticalLedger.missingAtomIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^missing_atom:/u),
      ]),
    );
    expect(output.decision.wouldRetry).toBe(true);
  });

  it("reports a dropped critical decision and records shadow fallback decisions", () => {
    const previous = previousArtifactWith([
      atom("atom-goal-a", "goal", "goal:ship-pipeline", "Ship the validated compaction pipeline."),
      atom("atom-decision-a", "decision", "decision:shared-finalize", "Use one shared finalize helper for all sources."),
    ]);

    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary: structuredSummary({
        goal: "Ship the validated compaction pipeline.",
        decisions: "- Use a provider-specific helper instead.",
      }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.criticalLedger.missingAtomIds).toContain("missing_atom:atom-decision-a");
    expect(output.decision.wouldRetry).toBe(true);
    expect(output.decision.wouldFallback).toBe(true);
    expect(output.decision.wouldPreserveTurns).toBe(true);
  });

  it("ignores superseded and stale previous atoms during critical comparison", () => {
    const previous = previousArtifactWith([
      atom("atom-stale-a", "goal", "goal:stale", "A stale goal that no longer applies.", "stale"),
      atom("atom-superseded-a", "decision", "decision:superseded", "A superseded decision.", "superseded"),
      atom("atom-goal-a", "goal", "goal:active", "Ship the validated compaction pipeline."),
    ]);

    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary: structuredSummary({ goal: "Ship the validated compaction pipeline." }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.criticalLedger.compared).toBe(1);
    expect(output.decision.criticalLedger.missingAtomIds).toEqual([]);
    expect(output.artifact.semanticAtoms?.map((item) => item.id)).toEqual(
      expect.arrayContaining(["atom-stale-a", "atom-superseded-a", "atom-goal-a"]),
    );
  });

  it("keeps conflicting atoms visible on both sides of the ledger", () => {
    const previous = previousArtifactWith([
      atom("atom-decision-old", "decision", "decision:old-plan", "Use the original provider plan."),
      atom("atom-decision-new", "decision", "decision:new-plan", "Use the shared finalize plan."),
    ]);

    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary({
        decisions: "- Use the original provider plan.\n- Use the shared finalize plan.",
      }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    const ids = output.artifact.semanticAtoms?.map((item) => item.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["atom-decision-old", "atom-decision-new"]));
    const projection = JSON.stringify(output.artifact.semanticAtoms);
    expect(projection).toContain("Use the original provider plan.");
    expect(projection).toContain("Use the shared finalize plan.");
  });

  it("records missing exact identifiers from critical atoms and recent messages", () => {
    const previous = previousArtifactWith([
      atom(
        "atom-entity-a",
        "entity",
        "entity:auth-middleware",
        "Rotate the auth middleware in src/auth/middleware.ts and re-run hook deadbeef1234.",
      ),
    ]);

    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary: structuredSummary({ identifiers: "other/irrelevant/path.ts" }),
      messages: [
        message("message:1", "user", "Please use src/auth/middleware.ts and hook https://example.com/hook."),
        message("message:2", "assistant", "Handled the request."),
      ],
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "strict",
    });

    expect(output.decision.criticalLedger.missingExactIdentifiers).toEqual(
      expect.arrayContaining([
        "missing_exact_identifier:src/auth/middleware.ts",
        "missing_exact_identifier:DEADBEEF1234",
        "missing_exact_identifier:https://example.com/hook",
      ]),
    );
  });

  it("does not run the exact-identifier ledger gate when identifierPolicy is off", () => {
    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary({ identifiers: "other/irrelevant/path.ts" }),
      messages: [
        message("message:1", "user", "Please preserve src/auth/middleware.ts."),
        message("message:2", "assistant", "Handled the request."),
      ],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.criticalLedger.missingExactIdentifiers).toEqual([]);
    expect(output.decision.reasons).not.toContain("missing_exact_identifier:src/auth/middleware.ts");
  });

  it("leaves exact-identifier enforcement to the caller when identifierPolicy is custom", () => {
    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary({ identifiers: "other/irrelevant/path.ts" }),
      messages: [
        message("message:1", "user", "Please preserve src/auth/middleware.ts."),
        message("message:2", "assistant", "Handled the request."),
      ],
      identifiers: ["src/auth/middleware.ts"],
      latestAsk: null,
      identifierPolicy: "custom",
    });

    expect(output.decision.criticalLedger.missingExactIdentifiers).toEqual([]);
    expect(output.decision.reasons).not.toContain("missing_exact_identifier:src/auth/middleware.ts");
  });

  it("integrates damage audit and falls back when goal anchors are missing", () => {
    // T-C1 semantics: the hollowed canonical summary (structure intact,
    // goal language gone) is the canonical goal_token_decay trigger.
    const hollowed = REQUIRED_COMPACTION_SECTIONS.map((section) => `${section}\nNone.`).join("\n\n");
    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary: hollowed,
      messages: STANDARD_MESSAGES,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(output.decision.damage.schema).toBe("compaction-damage/v1");
    expect(output.decision.damage.mode).toBe("shadow");
    expect(output.decision.damage.verdict).toBe("suspect");
    expect(output.decision.damage.damages.some((item) => item.type === "goal_token_decay")).toBe(true);
    expect(output.decision.wouldRetry).toBe(true);
    expect(output.decision.wouldFallback).toBe(true);
    expect(output.decision.wouldPreserveTurns).toBe(true);
  });

  it("keeps the caller summary unchanged and never invokes a model, provider, or stream", () => {
    const summary = "## Decisions\n- keep this exact string\n";
    const model = vi.fn();
    const provider = vi.fn();
    const streamFn = vi.fn();

    const output = buildValidatedCompactionOutput({
      source: "llm",
      summary,
      messages: STANDARD_MESSAGES,
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    expect(summary).toBe("## Decisions\n- keep this exact string\n");
    expect(output.artifact).toBeDefined();
    expect(model).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("applies the same audit semantics for provider and LLM sources", () => {
    const previous = previousArtifactWith([
      atom("atom-goal-a", "goal", "goal:ship-pipeline", "Ship the validated compaction pipeline."),
      atom("atom-decision-a", "decision", "decision:shared-finalize", "Use one shared finalize helper."),
    ]);

    const common = {
      summary: structuredSummary({
        goal: "Ship the validated compaction pipeline.",
        decisions: "- Use one shared finalize helper.",
      }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
      identifiers: [],
      latestAsk: null as string | null,
      identifierPolicy: "off" as const,
    };

    const providerOutput = buildValidatedCompactionOutput({ ...common, source: "provider" });
    const llmOutput = buildValidatedCompactionOutput({ ...common, source: "llm" });

    expect(providerOutput.artifact).toEqual(llmOutput.artifact);
    expect({ ...providerOutput.decision, source: "ignored" }).toEqual({
      ...llmOutput.decision,
      source: "ignored",
    });
    expect(providerOutput.decision.source).toBe("provider");
    expect(llmOutput.decision.source).toBe("llm");
  });

  it("never leaves a critical atom verified without evidence (P1 rule)", () => {
    const output = buildValidatedCompactionOutput({
      source: "provider",
      summary: structuredSummary(),
      messages: [],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "off",
    });

    const criticalAtoms = (output.artifact.semanticAtoms ?? []).filter(
      (item) => item.severity === "critical",
    );
    expect(criticalAtoms.length).toBeGreaterThan(0);
    for (const item of criticalAtoms) {
      if (item.status === "verified") {
        expect(item.evidenceRefs.length).toBeGreaterThan(0);
      }
    }
    expect(output.artifact.quality.warnings).toContain("critical_atom_missing_evidence");
  });
});

describe("extractCandidateSemanticAtoms", () => {
  it("maps supported summary headings and reuses previous ledger ids for stable identity", () => {
    const previous = previousArtifactWith([
      atom("atom-goal-a", "goal", "goal:stable-goal", "Implement the validated compaction pipeline."),
    ]);
    const candidates = extractCandidateSemanticAtoms({
      summary: structuredSummary({ goal: "Implement the validated compaction pipeline." }),
      messages: STANDARD_MESSAGES,
      previousArtifact: previous,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((item) => item.id === "atom-goal-a")).toBe(true);
    expect(candidates.some((item) => item.type === "goal")).toBe(true);
    expect(candidates.some((item) => item.type === "decision")).toBe(true);
    expect(candidates.some((item) => item.type === "constraint")).toBe(true);
    expect(candidates.some((item) => item.type === "next_action")).toBe(true);
    expect(candidates.some((item) => item.type === "latest_user_ask")).toBe(true);
  });
});

describe("finalizeSafeguardCompaction (safeguard wiring)", () => {
  it("returns artifact and validatedPipeline for every safeguard exit source", () => {
    for (const source of ["provider", "llm", "boundary"] as const) {
      const finalized = compactionSafeguardTesting.finalizeSafeguardCompaction({
        source,
        summary: structuredSummary(),
        messages: STANDARD_MESSAGES,
        previousSummary: "Previous summary.",
        previousArtifact: previousArtifactWith([
          atom("atom-goal-a", "goal", "goal:ship-pipeline", "Ship the validated compaction pipeline."),
        ]),
        readFiles: ["src/auth/middleware.ts"],
        modifiedFiles: ["src/auth/middleware.ts"],
        identifiers: ["src/auth/middleware.ts"],
        latestAsk: "Implement the validated compaction pipeline.",
        identifierPolicy: "strict",
      });

      expect(finalized.artifact.schemaVersion).toBe(1);
      expect(finalized.validatedPipeline.schema).toBe(COMPACTION_VALIDATED_PIPELINE_SCHEMA);
      expect(finalized.validatedPipeline.mode).toBe("shadow");
      expect(finalized.validatedPipeline.source).toBe(source);
    }
  });

  it("records the configured P6 promotion stage on the validated decision", () => {
    const finalized = compactionSafeguardTesting.finalizeSafeguardCompaction({
      source: "llm",
      summary: structuredSummary(),
      messages: STANDARD_MESSAGES,
      readFiles: [],
      modifiedFiles: [],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "strict",
      promotionStage: "would-retry",
    });
    expect(finalized.validatedPipeline.mode).toBe("would-retry");

    const shadow = compactionSafeguardTesting.finalizeSafeguardCompaction({
      source: "llm",
      summary: structuredSummary(),
      messages: STANDARD_MESSAGES,
      readFiles: [],
      modifiedFiles: [],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "strict",
    });
    expect(shadow.validatedPipeline.mode).toBe("shadow");
  });

  it("produces round-trippable details without changing the summary body", () => {
    const summary = structuredSummary();
    const finalized = compactionSafeguardTesting.finalizeSafeguardCompaction({
      source: "llm",
      summary,
      messages: STANDARD_MESSAGES,
      readFiles: [],
      modifiedFiles: [],
      identifiers: [],
      latestAsk: null,
      identifierPolicy: "strict",
    });
    const details = {
      readFiles: ["src/auth/middleware.ts"],
      modifiedFiles: [],
      ...finalized,
    };

    expect(summary).toBe(structuredSummary());
    expect(() => JSON.stringify(details)).not.toThrow();
    expect(JSON.parse(JSON.stringify(details))).toEqual(details);
    expect(details).toMatchObject({
      artifact: { schemaVersion: 1 },
      validatedPipeline: { schema: COMPACTION_VALIDATED_PIPELINE_SCHEMA, mode: "shadow" },
    });
  });
});
