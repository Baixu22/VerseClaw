import { describe, expect, it } from "vitest";
import {
  EVIDENCE_INSUFFICIENT_SIGNAL,
  EscalationBudget,
  runEscalationLadder,
  summarizeEscalationStats,
} from "./helpers/runtime-memory-escalation-ladder";

describe("runtime memory escalation ladder", () => {
  it("escalates from fragments to sessions when evidence is insufficient", async () => {
    const budget = new EscalationBudget(10, 0.4);
    const result = await runEscalationLadder({
      budget,
      fragmentContext: "fragment",
      sessionContext: async () => "whole session",
      fullConversationContext: async () => "whole conversation",
      generate: async (_context, level) =>
        level === 0 ? `${EVIDENCE_INSUFFICIENT_SIGNAL} maybe Alice` : "Alice",
    });

    expect(result.escalationLevel).toBe(1);
    expect(result.answer).toBe("Alice");
    expect(result.attempts).toHaveLength(2);
  });

  it("reports escalation stats", () => {
    const budget = new EscalationBudget(10, 0.4);
    const fullConversationBudget = new EscalationBudget(10, 0.2);
    const stats = summarizeEscalationStats(
      [
        { escalationLevel: 0 },
        { escalationLevel: 1 },
        { escalationLevel: 2 },
      ],
      budget,
      fullConversationBudget,
    );
    expect(stats.escalationRate).toBeCloseTo(2 / 3);
    expect(stats.fullConversationRate).toBeCloseTo(1 / 3);
    expect(stats.maxFullConversationEscalations).toBe(2);
  });

  it("uses a separate full-conversation budget", async () => {
    const budget = new EscalationBudget(10, 0.4);
    const fullConversationBudget = new EscalationBudget(10, 0);
    const result = await runEscalationLadder({
      budget,
      fullConversationBudget,
      fragmentContext: "fragment",
      sessionContext: async () => "whole session",
      fullConversationContext: async () => "whole conversation",
      generate: async (_context, level) =>
        level < 2 ? `${EVIDENCE_INSUFFICIENT_SIGNAL} maybe Alice` : "Alice",
    });

    expect(result.escalationLevel).toBe(1);
    expect(budget.usedEscalations).toBe(1);
    expect(fullConversationBudget.capped).toBe(1);
  });
});
