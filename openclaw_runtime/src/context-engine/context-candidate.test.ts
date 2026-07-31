import { afterEach, describe, expect, it } from "vitest";
import {
  collectContextCandidate,
  createContextCandidate,
  finalizeContextCandidates,
  getContextCandidateCollection,
  recordContextCandidateSkip,
  resetContextCandidateCollectionsForTests,
} from "./context-candidate.js";
import {
  beginTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
  summarizeTurnInjection,
} from "./turn-injection-budget.js";

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
      target: "system_prompt",
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
