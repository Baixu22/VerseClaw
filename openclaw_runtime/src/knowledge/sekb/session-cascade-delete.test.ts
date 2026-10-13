/**
 * A session is addressable by more than one identifier: SEKB rows are stamped
 * with the transcript session id (`options.sessionId` at tool time, an opaque
 * uuid), while the host "delete conversation" cascade historically passed only
 * the canonical session key. Matching a single identifier silently left the
 * other set of rows behind, so session knowledge survived deletion and could be
 * recalled into later contexts.
 */
import { describe, expect, it } from "vitest";
import {
  collectSessionCascadeTargets,
  type SessionCascadeStores,
} from "./session-cascade-delete.js";

const SESSION_KEY = "agent:main:main";
const TRANSCRIPT_ID = "9f3a1c44-1111-4222-8333-444455556666";

function fixtureStores(): SessionCascadeStores {
  return {
    listPrinciples: () => [
      {
        principle_id: "p1",
        metadata: { confirmProvenance: { sessionId: TRANSCRIPT_ID } },
        source_trajectories: ["t1"],
      },
    ],
    listTrajectories: () => [
      { trajectory_id: "t1", metadata: { sessionId: TRANSCRIPT_ID } },
    ],
    listMemoryCards: () => [
      {
        id: "c1",
        scope: "session",
        scopeKey: TRANSCRIPT_ID,
        content: "session scoped memory",
        retentionLabels: [],
      },
    ],
    listDcsExperienceJournalIds: () => [],
    deletePrinciple: () => undefined,
    deleteTrajectory: () => undefined,
    deleteMemoryCard: () => undefined,
  } as unknown as SessionCascadeStores;
}

function kinds(targets: ReturnType<typeof collectSessionCascadeTargets>): string[] {
  return targets.map((target) => `${target.kind}:${target.id}`).sort();
}

describe("session cascade delete identifiers", () => {
  it("matches SEKB rows stamped with the transcript session id (primary id)", () => {
    expect(kinds(collectSessionCascadeTargets(TRANSCRIPT_ID, fixtureStores()))).toEqual([
      "memory_card:c1",
      "sekb_principle:p1",
      "sekb_trajectory:t1",
    ]);
  });

  it("matches them when only the canonical session key is supplied as an alias", () => {
    const targets = collectSessionCascadeTargets(SESSION_KEY, fixtureStores(), {
      aliasSessionIds: [TRANSCRIPT_ID],
    });
    expect(kinds(targets)).toEqual([
      "memory_card:c1",
      "sekb_principle:p1",
      "sekb_trajectory:t1",
    ]);
  });

  it("collects nothing when the supplied identifier matches no record (the old failure)", () => {
    // Key-only lookup against uuid-stamped rows: this is what silently leaked
    // session knowledge before the alias was passed.
    expect(collectSessionCascadeTargets(SESSION_KEY, fixtureStores())).toEqual([]);
  });

  it("still matches rows stamped with the canonical key (legacy rows)", () => {
    const stores = {
      ...fixtureStores(),
      listMemoryCards: () => [
        {
          id: "legacy",
          scope: "session",
          scopeKey: SESSION_KEY,
          content: "legacy card",
          retentionLabels: [`session:${SESSION_KEY}`],
        },
      ],
    } as unknown as SessionCascadeStores;
    const targets = collectSessionCascadeTargets(TRANSCRIPT_ID, stores, {
      aliasSessionIds: [SESSION_KEY],
    });
    expect(kinds(targets)).toContain("memory_card:legacy");
  });
});