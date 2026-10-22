import { afterEach, describe, expect, it } from "vitest";
import {
  collectContextCandidate,
  contextMessageReplacementText,
  applyContextMessageReplacement,
  createContextCandidate,
  finalizeContextCandidates,
  getContextCandidateCollection,
  projectContextCandidates,
  recordContextCandidateSkip,
  resetContextCandidateCollectionsForTests,
} from "./context-candidate.js";
import {
  beginTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
  summarizeTurnInjection,
} from "./turn-injection-budget.js";
import type { AgentMessage } from "../agents/runtime/index.js";

afterEach(() => {
  resetContextCandidateCollectionsForTests();
  resetTurnInjectionBudgetsForTests();
});

function candidate(params: {
  objectId: string;
  sourceId: string;
  channel: Parameters<typeof createContextCandidate>[0]["channel"];
  text: string;
  target?: Parameters<typeof createContextCandidate>[0]["target"];
}) {
  return createContextCandidate({
    authorityObjectId: params.objectId,
    authorityVersion: "v1",
    sourceId: params.sourceId,
    channel: params.channel,
    target: params.target ?? "message",
    text: params.text,
  });
}

describe("ContextCandidate/v1", () => {
  it("exempts exact historical copies once, but charges rewritten or duplicated messages", () => {
    const history: AgentMessage[] = [{ role: "user", content: "old history", timestamp: 1 }];
    expect(contextMessageReplacementText(history, structuredClone(history))).toBe("");
    expect(contextMessageReplacementText(history, [])).toBe("");
    expect(contextMessageReplacementText(history, [...history, ...history])).toBe(
      JSON.stringify(history),
    );
    const rewritten: AgentMessage[] = [{ role: "user", content: "new summary", timestamp: 1 }];
    expect(contextMessageReplacementText(history, rewritten)).toBe(JSON.stringify(rewritten));
  });

  it.each([false, true])(
    "accepts structured replacements atomically after higher precedence (exhausted=%s)",
    (exhausted) => {
      const turnId = "replacement-budget";
      const original: AgentMessage[] = [{ role: "user", content: "history", timestamp: 1 }];
      const replacement: AgentMessage[] = [{ role: "user", content: "summary", timestamp: 2 }];
      const current: AgentMessage = { role: "user", content: "current prompt", timestamp: 3 };
      const text = contextMessageReplacementText(original, replacement);
      const ledger = beginTurnInjectionBudget({ turnId, total: text.length + 10 });
      collectContextCandidate(
        turnId,
        createContextCandidate({
          authorityObjectId: "engine:messages",
          authorityVersion: "1",
          sourceId: "cvk-message-replacement",
          channel: "cvk_addition",
          target: "message_replacement",
          text,
          messageReplacement: { original, replacement },
        }),
      );
      collectContextCandidate(
        turnId,
        candidate({
          objectId: "compass",
          sourceId: "compass",
          channel: "knowledge",
          target: "system_prompt",
          text: "K".repeat(exhausted ? 11 : 10),
        }),
      );
      const projected = projectContextCandidates({
        turnId,
        ledger,
        messages: [...original, current],
      });
      expect(
        applyContextMessageReplacement(projected.messages, projected.projection.messageReplacement),
      ).toEqual([...(exhausted ? original : replacement), current]);
      const row = projected.projection.lineage.find(
        (item) => item.target === "message_replacement",
      )!;
      expect(row.reason).toBe(exhausted ? "budget-drop" : "applied");
      expect(row.charsApplied).toBe(exhausted ? 0 : text.length);
      expect(ledger.budget.used).toBe(exhausted ? 11 : text.length + 10);
      const plan = projected.projection.messageReplacement;
      expect(applyContextMessageReplacement([...original, current, current], plan)).toEqual([
        ...(exhausted ? original : replacement),
        current,
        current,
      ]);
    },
  );

  it("does not charge a replacement after the original history was repaired", () => {
    const original: AgentMessage[] = [{ role: "user", content: "orphan", timestamp: 1 }];
    const replacement: AgentMessage[] = [{ role: "user", content: "summary", timestamp: 2 }];
    const turnId = "repaired-history";
    const ledger = beginTurnInjectionBudget({ turnId, total: 1000 });
    collectContextCandidate(
      turnId,
      createContextCandidate({
        authorityObjectId: "engine",
        authorityVersion: "1",
        sourceId: "cvk-message-replacement",
        channel: "cvk_addition",
        target: "message_replacement",
        text: contextMessageReplacementText(original, replacement),
        messageReplacement: { original, replacement },
      }),
    );
    const projected = projectContextCandidates({ turnId, ledger, messages: [] });
    expect(projected.messages).toEqual([]);
    expect(projected.projection.lineage[0]).toMatchObject({
      reason: "stale-history",
      charsApplied: 0,
    });
    expect(ledger.budget.used).toBe(0);
  });

  it("uses authority identity for dedup and projection identity for candidate lineage", () => {
    const knowledge = candidate({
      objectId: "block-1",
      sourceId: "context-block:compass:knowledge",
      channel: "knowledge",
      text: "same authority text",
    });
    const vtoken = candidate({
      objectId: "block-1",
      sourceId: "vtoken-assembly",
      channel: "vtoken",
      target: "message",
      text: "same authority text",
    });
    expect(knowledge.schema).toBe("ContextCandidate/v1");
    expect(knowledge.authority.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(knowledge.dedupKey).toBe(vtoken.dedupKey);
    expect(knowledge.candidateId).not.toBe(vtoken.candidateId);
    expect(
      createContextCandidate({
        authorityObjectId: "block-1",
        authorityVersion: "v1",
        sourceId: "context-block:compass:knowledge",
        channel: "knowledge",
        target: "message",
        text: "same authority text",
      }),
    ).toEqual(knowledge);
  });

  it("sorts every source by declared precedence independent of collection order", () => {
    const turnId = "candidate-order";
    for (const [channel, text] of [
      ["memory_pilot", "memory"],
      ["vtoken", "vtoken"],
      ["cvk_addition", "cvk"],
      ["tool_registry", "tools"],
      ["working_memory", "working"],
      ["knowledge", "knowledge"],
    ] as const) {
      collectContextCandidate(
        turnId,
        candidate({
          objectId: `${channel}-object`,
          sourceId: `${channel}-source`,
          channel,
          text,
        }),
      );
    }
    const projection = finalizeContextCandidates({
      turnId,
      ledger: beginTurnInjectionBudget({ turnId, total: 1_000 }),
    });
    expect(
      projection.messages.map((message) => ("content" in message ? message.content : undefined)),
    ).toEqual(["knowledge", "working", "tools", "cvk", "vtoken", "memory"]);
    expect(projection.lineage.map((entry) => entry.channel)).toEqual([
      "knowledge",
      "working_memory",
      "tool_registry",
      "cvk_addition",
      "vtoken",
      "memory_pilot",
    ]);
  });

  it("deduplicates only the same authority identity, revision, and target", () => {
    const turnId = "candidate-target-dedup";
    const base = {
      objectId: "shared-target-block",
      version: "v1",
      sourceId: "shared-source",
      channel: "knowledge" as const,
      text: "same text",
    };
    collectContextCandidate(turnId, candidate({ ...base, target: "message" }));
    collectContextCandidate(turnId, candidate({ ...base, target: "system_prompt" }));
    collectContextCandidate(turnId, candidate({ ...base, target: "message" }));
    const ledger = beginTurnInjectionBudget({ turnId, total: 100 });
    const projection = finalizeContextCandidates({ turnId, ledger, messages: [] });
    expect(projection.lineage.filter((entry) => entry.reason === "applied")).toHaveLength(2);
    expect(projection.lineage.filter((entry) => entry.reason === "duplicate")).toHaveLength(1);
    expect(getContextCandidateCollection(turnId)?.diagnostics).toMatchObject({
      collected: 3,
      unique: 2,
      duplicates: 1,
    });
  });

  it("drops duplicate authority objects before charging the one turn ledger", () => {
    const turnId = "candidate-dedup";
    collectContextCandidate(
      turnId,
      candidate({
        objectId: "shared-block",
        sourceId: "vtoken-assembly",
        channel: "vtoken",
        text: "shared",
      }),
    );
    collectContextCandidate(
      turnId,
      candidate({
        objectId: "shared-block",
        sourceId: "context-block:compass:knowledge",
        channel: "knowledge",
        text: "shared",
      }),
    );
    const ledger = beginTurnInjectionBudget({ turnId, total: 100 });
    const projection = finalizeContextCandidates({ turnId, ledger });
    expect(
      projection.messages.map((message) => ("content" in message ? message.content : undefined)),
    ).toEqual(["shared"]);
    expect(summarizeTurnInjection(ledger).byChannel.knowledge?.applied).toBe(6);
    expect(summarizeTurnInjection(ledger).byChannel.vtoken).toBeUndefined();
    expect(projection.lineage.find((entry) => entry.channel === "vtoken")).toMatchObject({
      disposition: "duplicate",
      reason: "duplicate",
      charsApplied: 0,
    });
    expect(getContextCandidateCollection(turnId)?.diagnostics).toMatchObject({
      collected: 2,
      unique: 1,
      duplicates: 1,
    });
  });

  it("records truncate, drop, empty, flag-off, and kill-switch decisions explicitly", () => {
    const turnId = "candidate-lineage";
    collectContextCandidate(
      turnId,
      candidate({
        objectId: "knowledge",
        sourceId: "knowledge",
        channel: "knowledge",
        text: "12345",
      }),
    );
    collectContextCandidate(
      turnId,
      candidate({
        objectId: "working",
        sourceId: "working",
        channel: "working_memory",
        text: "67890",
      }),
    );
    collectContextCandidate(
      turnId,
      candidate({
        objectId: "tools",
        sourceId: "tools",
        channel: "tool_registry",
        text: "tool",
      }),
    );
    recordContextCandidateSkip(turnId, {
      sourceId: "cvk",
      channel: "cvk_addition",
      target: "system_prompt",
      reason: "empty",
    });
    recordContextCandidateSkip(turnId, {
      sourceId: "vtoken",
      channel: "vtoken",
      target: "system_prompt",
      reason: "flag-off",
    });
    recordContextCandidateSkip(turnId, {
      sourceId: "memory",
      channel: "memory_pilot",
      target: "system_prompt",
      reason: "kill-switch",
    });
    const projection = finalizeContextCandidates({
      turnId,
      ledger: beginTurnInjectionBudget({ turnId, total: 7 }),
    });
    const bySource = Object.fromEntries(projection.lineage.map((entry) => [entry.sourceId, entry]));
    expect(bySource.knowledge).toMatchObject({ reason: "applied", charsApplied: 5 });
    expect(bySource.working).toMatchObject({ reason: "budget-truncate", charsApplied: 2 });
    expect(bySource.tools).toMatchObject({ reason: "budget-drop", charsApplied: 0 });
    expect(bySource.cvk).toMatchObject({ reason: "empty", disposition: "skip" });
    expect(bySource.vtoken).toMatchObject({ reason: "flag-off", disposition: "skip" });
    expect(bySource.memory).toMatchObject({ reason: "kill-switch", disposition: "skip" });
  });
});
