import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DcsCorpusValidationError,
  estimateTokensFromChars,
  loadCorpus,
  validateCorpus,
} from "./dcs-corpus-schema.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const minimalFixture = path.join(fixturesDir, "dcs-corpus-minimal.json");

const validMinimal = {
  version: 1 as const,
  kind: "synthetic-agent" as const,
  source: "test/minimal",
  entries: [
    {
      sessionId: "sess-1",
      kind: "synthetic-agent" as const,
      source: "test/minimal",
      pass: true,
      turns: [
        {
          index: 0,
          role: "user" as const,
          chars: 40,
          tokenEstimate: 10,
        },
        {
          index: 1,
          role: "assistant" as const,
          chars: 80,
          tokenEstimate: 20,
          toolCalls: [{ name: "context_impact", argsChars: 12, resultChars: 200 }],
        },
      ],
    },
  ],
};

describe("dcs-corpus-schema", () => {
  it("validateCorpus accepts a legal document", () => {
    const doc = validateCorpus(validMinimal);
    expect(doc.version).toBe(1);
    expect(doc.kind).toBe("synthetic-agent");
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]?.sessionId).toBe("sess-1");
    expect(doc.entries[0]?.turns[1]?.toolCalls?.[0]?.name).toBe("context_impact");
  });

  it("loadCorpus accepts the checked-in minimal fixture", () => {
    const doc = loadCorpus(minimalFixture);
    expect(doc.kind).toBe("synthetic-agent");
    expect(doc.entries.length).toBeGreaterThanOrEqual(1);
    expect(doc.entries[0]?.pass).toBe(true);
    expect(doc.entries[0]?.turns.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid kind", () => {
    expect(() =>
      validateCorpus({
        ...validMinimal,
        kind: "not-a-kind",
      }),
    ).toThrow(DcsCorpusValidationError);
  });

  it("rejects missing required fields", () => {
    expect(() => validateCorpus({ version: 1, kind: "recorded" })).toThrow(/source|entries/);
    expect(() =>
      validateCorpus({
        version: 1,
        kind: "recorded",
        source: "x",
        entries: [{ kind: "recorded", source: "x", pass: true, turns: [] }],
      }),
    ).toThrow(DcsCorpusValidationError);
  });

  it("rejects empty entries and empty turns", () => {
    expect(() =>
      validateCorpus({ version: 1, kind: "recorded", source: "x", entries: [] }),
    ).toThrow(/entries/);
    expect(() =>
      validateCorpus({
        version: 1,
        kind: "recorded",
        source: "x",
        entries: [
          {
            sessionId: "s",
            kind: "recorded",
            source: "x",
            pass: false,
            turns: [],
          },
        ],
      }),
    ).toThrow(/turns/);
  });

  it("rejects synthetic-agent document that claims live entries", () => {
    expect(() =>
      validateCorpus({
        version: 1,
        kind: "synthetic-agent",
        source: "x",
        entries: [
          {
            sessionId: "s",
            kind: "live",
            source: "x",
            pass: true,
            turns: [{ index: 0, role: "user", chars: 1, tokenEstimate: 1 }],
          },
        ],
      }),
    ).toThrow(/live/);
  });

  it("loadCorpus fails on empty file and missing fields", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dcs-corpus-"));
    try {
      const emptyPath = path.join(dir, "empty.json");
      writeFileSync(emptyPath, "", "utf8");
      expect(() => loadCorpus(emptyPath)).toThrow(/empty file/);

      const badPath = path.join(dir, "bad.json");
      writeFileSync(badPath, JSON.stringify({ version: 1, kind: "recorded" }), "utf8");
      expect(() => loadCorpus(badPath)).toThrow(DcsCorpusValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("estimateTokensFromChars is coarse and non-negative", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
  });
});