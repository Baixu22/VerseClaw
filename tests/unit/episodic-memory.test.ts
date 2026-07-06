// @vitest-environment node
// Unit tests for the EpisodicMemory module (P0 dual-track memory, Track A).
//
// These tests use a deterministic mock embedding provider (no network calls)
// so they run in CI without SILICONFLOW_API_KEY. The mock maps each word to
// a unique dimension so lexical overlap drives similarity — sufficient for
// verifying data flow, contextualization, and prompt formatting.

import { describe, it, expect } from "vitest";
import {
  EpisodicMemory,
  splitSentences,
  formatEpisodicBlock,
  buildDualTrackPrompt,
  CONTEXT_WINDOW,
  type IngestTurn,
} from "./helpers/episodic-memory";
import type { RuntimeEmbeddingProvider } from "../../openclaw_runtime/src/runtime-core/memory-embedding-provider";

// === Mock embedding provider ===
// Maps each unique word to a unique dimension. Sentences sharing words will
// have higher cosine similarity — enough to verify ranking + contextualization
// behavior without external API calls.

class MockEmbeddingProvider implements RuntimeEmbeddingProvider {
  readonly id = "mock-word-hash";
  readonly dimension = 256;
  private wordIndex = new Map<string, number>();

  private vectorize(text: string): number[] {
    const vec = new Array(256).fill(0);
    const words = text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
    for (const w of words) {
      let idx = this.wordIndex.get(w);
      if (idx === undefined) {
        idx = this.wordIndex.size % 256;
        this.wordIndex.set(w, idx);
      }
      vec[idx] = 1;
    }
    // Normalize to unit length for cosine similarity
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }
}

// === Fixtures ===

const TURNS: IngestTurn[] = [
  {
    turn_id: "t0",
    session_id: "s1",
    speaker: "user",
    text:
      "Alice started working at the hospital in March 2023. She loves her job. The pay is good.",
    timestamp: 1680000000000,
    turn_index: 0,
  },
  {
    turn_id: "t1",
    session_id: "s1",
    speaker: "assistant",
    text:
      "That's great! When did Alice get promoted? She mentioned a new role last month.",
    timestamp: 1680000001000,
    turn_index: 1,
  },
  {
    turn_id: "t2",
    session_id: "s2",
    speaker: "user",
    text:
      "Alice was promoted to Senior Engineer last Tuesday. Her salary increased a lot. She is happy about it.",
    timestamp: 1680100000000,
    turn_index: 2,
  },
];

describe("EpisodicMemory", () => {
  describe("splitSentences", () => {
    it("splits on punctuation boundaries", () => {
      const result = splitSentences("Hello world. How are you? I am fine!");
      expect(result).toEqual(["Hello world.", "How are you?", "I am fine!"]);
    });

    it("handles CJK punctuation", () => {
      const result = splitSentences("你好世界。今天天气不错！");
      expect(result).toEqual(["你好世界。", "今天天气不错！"]);
    });

    it("filters fragments shorter than 5 chars", () => {
      const result = splitSentences("Hi. Ok. This is a real sentence.");
      // "Hi." (3), "Ok." (3) filtered out
      expect(result).toEqual(["This is a real sentence."]);
    });

    it("returns empty array for empty/whitespace input", () => {
      expect(splitSentences("")).toEqual([]);
      expect(splitSentences("   ")).toEqual([]);
    });

    it("handles input without trailing punctuation", () => {
      const result = splitSentences("First sentence. No ending punctuation here");
      expect(result).toEqual(["First sentence.", "No ending punctuation here"]);
    });
  });

  describe("ingestTurns", () => {
    it("stores all sentences with complete field metadata", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      expect(mem.size).toBe(9); // 3 + 3 + 3 sentences (all pass the 5-char filter)
      expect(mem.hasEmbeddingData).toBe(true);

      // Verify first sentence has complete metadata
      const hits = await mem.search(
        "Alice started working at hospital",
        new Float32Array(256),
        1,
      );
      expect(hits.length).toBeGreaterThan(0);
      const s = hits[0].sentence;
      expect(s.turn_id).toMatch(/^t[0-2]$/);
      expect(s.session_id).toMatch(/^s[12]$/);
      expect(s.speaker).toMatch(/^(user|assistant)$/);
      expect(s.text.length).toBeGreaterThan(5);
      expect(s.turn_text).toContain(s.text);
      expect(s.timestamp).toBeGreaterThan(0);
      expect(s.turn_index).toBeGreaterThanOrEqual(0);
      expect(s.sentence_index).toBeGreaterThanOrEqual(0);
      expect(s.sentence_id).toMatch(/^t[0-2]_s[0-9]+$/);
    });

    it("is idempotent — re-ingesting the same turn_id does not duplicate", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);
      const firstSize = mem.size;

      await mem.ingestTurns(TURNS, provider);
      expect(mem.size).toBe(firstSize);
    });

    it("skips empty/whitespace turns", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(
        [
          { ...TURNS[0], turn_id: "empty", text: "   " },
          { ...TURNS[0], turn_id: "blank", text: "" },
        ],
        provider,
      );
      expect(mem.size).toBe(0);
    });
  });

  describe("search", () => {
    it("returns top-K hits ranked by RRF fusion", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // Query embedding shares words with sentences containing Alice
      const queryEmb = await provider.embedQuery("Alice promotion Senior Engineer");
      const hits = await mem.search(
        "Alice promotion Senior Engineer",
        new Float32Array(queryEmb),
        3,
      );

      expect(hits.length).toBeLessThanOrEqual(3);
      expect(hits.length).toBeGreaterThan(0);
      // Top hit should mention Alice
      expect(hits[0].sentence.text.toLowerCase()).toContain("alice");
      // Scores should be sorted descending
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i - 1].rrfScore).toBeGreaterThanOrEqual(hits[i].rrfScore);
      }
    });

    it("returns empty for empty/whitespace query", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);
      const emb = await provider.embedQuery("");
      const hits = await mem.search("", new Float32Array(emb), 5);
      expect(hits).toEqual([]);
    });

    it("falls back to BM25-only when queryEmbedding is null", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      const hits = await mem.search("Alice hospital March", null, 2);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].vectorRank).toBeNull();
      expect(hits[0].bm25Rank).not.toBeNull();
    });

    it("P2-4: filters by maxTimestamp when provided", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // TURNS[0].timestamp = 1680000000000 (2023-03-28)
      // TURNS[2].timestamp = 1680100000000 (2023-03-29)
      // Use TURNS[0].timestamp as maxTimestamp → only TURNS[0] sentences
      const queryEmb = await provider.embedQuery("Alice hospital March");
      const hits = await mem.search(
        "Alice hospital March",
        new Float32Array(queryEmb),
        10,
        { maxTimestamp: TURNS[0].timestamp },
      );
      expect(hits.length).toBeGreaterThan(0);
      // All hits must be from t0 (turn_id = "t0")
      for (const hit of hits) {
        expect(hit.sentence.turn_id).toBe("t0");
      }
    });

    it("P2-4: filters by minTimestamp when provided", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // Use TURNS[2].timestamp as minTimestamp → only TURNS[2] sentences
      const queryEmb = await provider.embedQuery("Alice promoted Senior Engineer");
      const hits = await mem.search(
        "Alice promoted Senior Engineer",
        new Float32Array(queryEmb),
        10,
        { minTimestamp: TURNS[2].timestamp },
      );
      expect(hits.length).toBeGreaterThan(0);
      // All hits must be from t2 (turn_id = "t2")
      for (const hit of hits) {
        expect(hit.sentence.turn_id).toBe("t2");
      }
    });

    it("P2-4: returns empty when time filter excludes all sentences", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // maxTimestamp before all sentences → no hits
      const queryEmb = await provider.embedQuery("Alice");
      const hits = await mem.search(
        "Alice",
        new Float32Array(queryEmb),
        10,
        { maxTimestamp: TURNS[0].timestamp - 1 },
      );
      expect(hits).toEqual([]);
    });
  });

  describe("contextualize", () => {
    it("expands ±CONTEXT_WINDOW sentences within the same turn", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // Anchor on middle sentence of turn t2 (3 sentences)
      const queryEmb = await provider.embedQuery("Alice promoted Senior Engineer");
      const hits = await mem.search(
        "Alice promoted Senior Engineer",
        new Float32Array(queryEmb),
        1,
      );
      expect(hits.length).toBeGreaterThan(0);

      const clusters = mem.contextualize(hits);
      expect(clusters.length).toBe(1);
      const cluster = clusters[0];
      // Should include sentences before and after the anchor in the same turn
      expect(cluster.sentences.length).toBeGreaterThanOrEqual(1);
      // If turn has 3 sentences and anchor is middle, cluster should be all 3
      // (assuming no MAX_CLUSTER_CHARS truncation)
      expect(cluster.sentences.length).toBeLessThanOrEqual(2 * CONTEXT_WINDOW + 1);
    });

    it("deduplicates overlapping clusters by anchor score", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      // Two hits in the same turn should produce one merged cluster
      const queryEmb = await provider.embedQuery("Alice promoted Senior Engineer salary");
      const hits = await mem.search(
        "Alice promoted Senior Engineer salary",
        new Float32Array(queryEmb),
        5,
      );
      const clusters = mem.contextualize(hits);

      // Verify no sentence_id appears in more than one cluster
      const seenIds = new Set<string>();
      for (const cluster of clusters) {
        for (const s of cluster.sentences) {
          expect(seenIds.has(s.sentence_id)).toBe(false);
          seenIds.add(s.sentence_id);
        }
      }
    });

    it("returns empty for empty hits", () => {
      const mem = new EpisodicMemory();
      const clusters = mem.contextualize([]);
      expect(clusters).toEqual([]);
    });

    it("truncates cluster when exceeding MAX_CLUSTER_CHARS", async () => {
      // Build a turn with many long sentences
      const longTurns: IngestTurn[] = [
        {
          turn_id: "long0",
          session_id: "s1",
          speaker: "user",
          text: Array.from(
            { length: 20 },
            (_, i) =>
              `Sentence number ${i} is a very long sentence with many words to exceed the budget. ` +
              `It contains substantial detail about topic ${i} to ensure lexical diversity.`,
          ).join(" "),
          timestamp: 1680000000000,
          turn_index: 0,
        },
      ];
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(longTurns, provider);

      const queryEmb = await provider.embedQuery("topic 10 lexical diversity");
      const hits = await mem.search(
        "topic 10 lexical diversity",
        new Float32Array(queryEmb),
        1,
      );
      expect(hits.length).toBeGreaterThan(0);

      const clusters = mem.contextualize(hits);
      expect(clusters.length).toBe(1);
      // Total chars should be within budget
      const totalChars = clusters[0].sentences.reduce((s, x) => s + x.text.length, 0);
      // Allow slight overshoot for the anchor's own sentence
      expect(totalChars).toBeLessThan(3000);
    });
  });

  describe("formatEpisodicBlock", () => {
    it("formats clusters chronologically with session/turn/speaker headers", async () => {
      const mem = new EpisodicMemory();
      const provider = new MockEmbeddingProvider();
      await mem.ingestTurns(TURNS, provider);

      const queryEmb = await provider.embedQuery("Alice hospital");
      const hits = await mem.search(
        "Alice hospital",
        new Float32Array(queryEmb),
        3,
      );
      const clusters = mem.contextualize(hits);
      const block = formatEpisodicBlock(clusters);

      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain("Session");
      expect(block).toContain("Turn");
      expect(block).toMatch(/(user|assistant)/);
      // P2-1: header should now include ISO date prefix
      expect(block).toMatch(/\d{4}-\d{2}-\d{2}/);

      // Verify chronological ordering: turns appear in ascending order
      const turnMatches = [...block.matchAll(/Turn (\d+)/g)];
      const turnNums = turnMatches.map((m) => parseInt(m[1], 10));
      for (let i = 1; i < turnNums.length; i++) {
        expect(turnNums[i]).toBeGreaterThanOrEqual(turnNums[i - 1]);
      }
    });

    it("returns empty string for empty clusters", () => {
      expect(formatEpisodicBlock([])).toBe("");
    });
  });

  describe("buildDualTrackPrompt", () => {
    it("places episodic block before semantic block", () => {
      const { system, user } = buildDualTrackPrompt(
        "When did Alice start her job?",
        "[Session s1 · Turn 0 · user]\nAlice started working at the hospital in March 2023.",
        [
          {
            subject: "Alice",
            predicate: "started_job",
            objectSummary: "March 2023",
          },
        ],
      );

      expect(system).toContain("EPISODIC MEMORY");
      expect(system).toContain("SEMANTIC MEMORY");
      expect(user).toContain("[EPISODIC MEMORY");
      expect(user).toContain("[SEMANTIC MEMORY");
      // Episodic should appear before semantic in the prompt
      const epiIdx = user.indexOf("[EPISODIC MEMORY");
      const semIdx = user.indexOf("[SEMANTIC MEMORY");
      expect(epiIdx).toBeLessThan(semIdx);
      expect(epiIdx).toBeGreaterThanOrEqual(0);
    });

    it("includes question and answer marker", () => {
      const { user } = buildDualTrackPrompt(
        "What is Alice's role?",
        "raw snippet",
        [{ subject: "Alice", predicate: "role", objectSummary: "Engineer" }],
      );
      expect(user).toContain("Question: What is Alice's role?");
      expect(user).toContain("Answer:");
    });

    it("prepends profile context when provided", () => {
      const { user } = buildDualTrackPrompt(
        "question?",
        "snippet",
        [{ subject: "s", predicate: "p", objectSummary: "o" }],
        ["User profile: Alice is an engineer"],
      );
      expect(user.startsWith("User profile: Alice is an engineer")).toBe(true);
    });

    it("handles empty episodic block gracefully", () => {
      const { user } = buildDualTrackPrompt("q?", "", [
        { subject: "s", predicate: "p", objectSummary: "o" },
      ]);
      expect(user).not.toContain("[EPISODIC MEMORY");
      expect(user).toContain("[SEMANTIC MEMORY");
    });
  });
});
