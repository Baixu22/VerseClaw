// @vitest-environment node
/**
 * TF-0644 / A4: discard attribution rows are join-ready, payload-free, and
 * written only when something was actually dropped.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ContextCandidateLineage } from "../../openclaw_runtime/src/context-engine/context-candidate";
import {
  DISCARD_ATTRIBUTION_ENV,
  DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN,
  DISCARD_ATTRIBUTION_SCHEMA,
  DISCARD_CLASSES,
  appendDiscardAttributionRecords,
  buildCandidateDiscardRecords,
  buildCompactionDiscardRecord,
  buildDiscardAttributionRecord,
  buildHistoryLimitDiscardRecord,
  isDiscardAttributionEnabled,
  readDiscardAttribution,
} from "../../openclaw_runtime/src/context-engine/discard-attribution";

const AT = "2026-11-02T00:00:00.000Z";
const IDENTITY = {
  sessionKey: "agent:main:main",
  sessionId: "sess-1",
  turnId: "turn-1",
  attemptIndex: 2,
  modelCallIndex: 3,
};

const tmpDirs: string[] = [];
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "discard-attribution-"));
  tmpDirs.push(dir);
  return path.join(dir, "notice", "context-discards.jsonl");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function lineage(overrides: Partial<ContextCandidateLineage>): ContextCandidateLineage {
  return {
    candidateId: "context-candidate:x",
    dedupKey: "dedup:x",
    sourceId: "memory-inject-pilot",
    channel: "memory_pilot",
    target: "system_prompt",
    disposition: "drop",
    charsRequested: 100,
    charsApplied: 0,
    reason: "budget-drop",
    ...overrides,
  };
}

describe("DiscardAttribution/v1 shape", () => {
  it.each(DISCARD_CLASSES)("builds a join-ready row for the %s class", (discardClass) => {
    const row = buildDiscardAttributionRecord({
      discardClass,
      reason: `${discardClass}-reason`,
      unitRef: `unit:${discardClass}`,
      identity: IDENTITY,
      charsRequested: 120,
      charsApplied: 20,
      at: AT,
    });
    expect(row.schema).toBe(DISCARD_ATTRIBUTION_SCHEMA);
    expect(row.discardClass).toBe(discardClass);
    expect(row.charsDropped).toBe(100);
    expect(row.turnId).toBe("turn-1");
    expect(row.attemptIndex).toBe(2);
    expect(row.modelCallIndex).toBe(3);
    expect(row.sessionKey).toBe("agent:main:main");
    expect(row.sessionId).toBe("sess-1");
    expect(row.at).toBe(AT);
  });
});

describe("candidate lineage -> rows", () => {
  it("maps each losing disposition and ignores applied or pending candidates", () => {
    const rows = buildCandidateDiscardRecords({
      lineage: [
        lineage({ candidateId: "c-drop", disposition: "drop", reason: "budget-drop" }),
        lineage({
          candidateId: "c-truncate",
          disposition: "truncate",
          reason: "budget-truncate",
          charsApplied: 40,
        }),
        lineage({ candidateId: "c-skip", disposition: "skip", reason: "flag-off" }),
        lineage({ candidateId: "c-dup", disposition: "duplicate", reason: "duplicate" }),
        lineage({
          candidateId: "c-applied",
          disposition: "applied",
          reason: "applied",
          charsApplied: 100,
        }),
        lineage({ candidateId: "c-pending", disposition: "pending", reason: "collected" }),
      ],
      identity: IDENTITY,
      at: AT,
    });
    expect(rows.map((row) => [row.unitRef, row.discardClass, row.reason])).toEqual([
      ["c-drop", "budget-drop", "budget-drop"],
      ["c-truncate", "budget-drop", "budget-truncate"],
      ["c-skip", "skipChannels", "flag-off"],
      ["c-dup", "skipChannels", "duplicate"],
    ]);
    expect(rows[1]?.charsRequested).toBe(100);
    expect(rows[1]?.charsApplied).toBe(40);
    expect(rows[1]?.charsDropped).toBe(60);
  });

  it("writes zero rows for a turn that dropped nothing", () => {
    const rows = buildCandidateDiscardRecords({
      lineage: [lineage({ disposition: "applied", reason: "applied", charsApplied: 100 })],
      identity: IDENTITY,
      at: AT,
    });
    expect(rows).toEqual([]);
  });

  it("caps the rows per turn", () => {
    const many = Array.from({ length: DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN + 10 }, (_, index) =>
      lineage({ candidateId: `c-${index}` }),
    );
    const rows = buildCandidateDiscardRecords({ lineage: many, identity: IDENTITY, at: AT });
    expect(rows).toHaveLength(DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN);
  });

  it("does not mutate the lineage it reads", () => {
    const input = [lineage({}), lineage({ candidateId: "c-2", disposition: "skip", reason: "empty" })];
    const before = JSON.parse(JSON.stringify(input)) as unknown;
    buildCandidateDiscardRecords({ lineage: input, identity: IDENTITY, at: AT });
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });
});

describe("history limit and compaction", () => {
  it("records the history cut with its limit and no row when nothing was cut", () => {
    const cut = buildHistoryLimitDiscardRecord({
      identity: IDENTITY,
      limit: 40,
      messagesBefore: 90,
      messagesAfter: 60,
      at: AT,
    });
    expect(cut).toMatchObject({
      discardClass: "limitHistoryTurns",
      reason: "history-limit",
      limit: 40,
      counts: { messages: 30 },
      turnId: "turn-1",
    });
    expect(
      buildHistoryLimitDiscardRecord({
        identity: IDENTITY,
        limit: 40,
        messagesBefore: 10,
        messagesAfter: 10,
        at: AT,
      }),
    ).toBeNull();
  });

  it("records the compaction boundary and nothing when no chunk was dropped", () => {
    const row = buildCompactionDiscardRecord({
      identity: {},
      droppedChunks: 3,
      droppedMessages: 27,
      droppedTokens: 4200,
      budgetTokens: 6000,
      keptTokens: 1800,
      firstKeptEntryId: "entry-42",
      at: AT,
    });
    expect(row).toMatchObject({
      discardClass: "compaction",
      counts: { chunks: 3, messages: 27, tokens: 4200 },
      compactionBoundary: {
        droppedChunks: 3,
        droppedMessages: 27,
        droppedTokens: 4200,
        budgetTokens: 6000,
        keptTokens: 1800,
        firstKeptEntryId: "entry-42",
      },
    });
    expect(
      buildCompactionDiscardRecord({
        identity: {},
        droppedChunks: 0,
        droppedMessages: 0,
        droppedTokens: 0,
        at: AT,
      }),
    ).toBeNull();
  });
});

describe("sink", () => {
  it("round-trips joinable rows and stays payload-free", () => {
    const pathname = tempFile();
    const payload = "SECRET-MESSAGE-BODY sk-live-abcdef0123456789 Bearer token-123456789";
    const rows = buildCandidateDiscardRecords({
      lineage: [
        lineage({ candidateId: "context-candidate:sha256:abc", disposition: "drop" }),
        lineage({ candidateId: "context-candidate:sha256:def", disposition: "skip", reason: "flag-off" }),
      ],
      identity: IDENTITY,
      at: AT,
    });
    expect(appendDiscardAttributionRecords({ records: rows, pathname, env: {} })).toBe(2);

    const raw = fs.readFileSync(pathname, "utf8");
    expect(raw).not.toContain(payload);
    expect(raw).not.toContain("SECRET-MESSAGE-BODY");
    for (const pattern of [/sk-[A-Za-z0-9-]{10,}/, /Bearer\s+\S+/, /api[_-]?key/i, /password/i]) {
      expect(pattern.test(raw)).toBe(false);
    }

    const read = readDiscardAttribution({ pathname });
    expect(read).toHaveLength(2);
    expect(read.every((row) => row.schema === DISCARD_ATTRIBUTION_SCHEMA)).toBe(true);
    expect(read[0]).toMatchObject({
      turnId: "turn-1",
      attemptIndex: 2,
      modelCallIndex: 3,
      discardClass: "budget-drop",
    });
    // Join key: every row carries the same turn identity triple.
    expect(new Set(read.map((row) => `${row.turnId}/${row.attemptIndex}/${row.modelCallIndex}`))).toEqual(
      new Set(["turn-1/2/3"]),
    );
    // No string field is long enough to smuggle a message body.
    for (const row of read) {
      for (const value of Object.values(row)) {
        if (typeof value === "string") expect(value.length).toBeLessThan(200);
      }
    }
  });

  it("redacts credential-shaped reason text before it reaches the file", () => {
    const pathname = tempFile();
    const rows = [
      buildDiscardAttributionRecord({
        discardClass: "skipChannels",
        reason: "flag-off Bearer leakedtoken123456 sk-live-abcdef012345 sk-ant-secretvalue",
        unitRef: "unit:sk-ant-secretvalue",
        identity: IDENTITY,
        at: AT,
      }),
    ];
    expect(appendDiscardAttributionRecords({ records: rows, pathname, env: {} })).toBe(1);
    const raw = fs.readFileSync(pathname, "utf8");
    for (const secret of ["leakedtoken123456", "sk-live-abcdef012345", "sk-ant-secretvalue"]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("[redacted]");
  });
  it("is off when the env switch says off and writes nothing", () => {
    const pathname = tempFile();
    const rows = buildCandidateDiscardRecords({ lineage: [lineage({})], identity: IDENTITY, at: AT });
    expect(isDiscardAttributionEnabled({ [DISCARD_ATTRIBUTION_ENV]: "0" })).toBe(false);
    expect(
      appendDiscardAttributionRecords({
        records: rows,
        pathname,
        env: { [DISCARD_ATTRIBUTION_ENV]: "0" } as NodeJS.ProcessEnv,
      }),
    ).toBe(0);
    expect(fs.existsSync(pathname)).toBe(false);
  });

  it("stays off under a test runner unless explicitly enabled", () => {
    expect(isDiscardAttributionEnabled({ VITEST: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isDiscardAttributionEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isDiscardAttributionEnabled({
        VITEST: "true",
        [DISCARD_ATTRIBUTION_ENV]: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(isDiscardAttributionEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
  it("never throws when the sink cannot be created", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "discard-attribution-bad-"));
    tmpDirs.push(dir);
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const rows = buildCandidateDiscardRecords({ lineage: [lineage({})], identity: IDENTITY, at: AT });
    expect(
      appendDiscardAttributionRecords({
        records: rows,
        pathname: path.join(blocker, "nested", "context-discards.jsonl"),
        env: {},
      }),
    ).toBe(0);
  });
});