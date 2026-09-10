// Episodic Memory — Track A of the dual-track memory architecture (P0).
//
// Preserves raw conversation sentences as ground truth, indexed at sentence
// granularity. This is the "ground-truth preserving" track inspired by
// MemMachine (arXiv:2604.04853 §4.4-4.6): extracted facts lose ~53% of the
// original information during the LLM summarization step; the episodic track
// keeps the original text so semantic retrieval can match phrasings that
// never made it into a structured fact.
//
// Pipeline:
//   ingest(turn) → sentence split → embed + BM25 index
//   search(query) → top-K vector + top-K BM25 → RRF fuse → contextualize
//
// Physical isolation: this module owns its own corpus, embeddings, and BM25
// state. It never touches the semantic track's HybridSearchIndex, fact store,
// or entity graph. The two tracks only meet in the final prompt assembly.

import type { RuntimeEmbeddingProvider } from "../../../openclaw_runtime/src/runtime-core/memory-embedding-provider.ts";

// === Types ===

export type EpisodicSentence = {
  sentence_id: string;
  turn_id: string;
  session_id: string;
  speaker: string;
  text: string;
  turn_text: string;
  timestamp: number;
  turn_index: number;
  sentence_index: number;
};

export type EpisodicCluster = {
  /** Anchor sentence that matched the query. */
  anchor: EpisodicSentence;
  /** Sentences in contextualization order (anchor in middle). */
  sentences: EpisodicSentence[];
  /** Max RRF score among sentences in the cluster (for ordering clusters). */
  score: number;
};

export type EpisodicHit = {
  sentence: EpisodicSentence;
  rrfScore: number;
  vectorRank: number | null;
  bm25Rank: number | null;
  vectorScore: number;
  bm25Score: number;
};

export type IngestTurn = {
  turn_id: string;
  session_id: string;
  speaker: string;
  text: string;
  timestamp: number;
  turn_index: number;
};

// === Configurable parameters ===

/** Forward/backward context window for cluster expansion. */
export const CONTEXT_WINDOW = 2;
/** Drop fragments shorter than this many characters (punctuation, "yeah", etc.). */
const MIN_SENTENCE_LEN = 5;
/** Hard ceiling on cluster size in characters (~500 tokens at ~4 chars/token). */
const MAX_CLUSTER_CHARS = 2000;
/** RRF k parameter. Lower amplifies top-rank differences. */
const EPI_RRF_K = 60;

// === Sentence splitting ===

/**
 * Split text into sentences using punctuation boundaries. Handles both
 * CJK (。！？) and Latin (.!?) terminators. Filters fragments shorter than
 * MIN_SENTENCE_LEN to drop conversational noise ("ok", "yeah", "hmm").
 *
 * Lookbehind regex requires Node ≥10; we target Node 22+.
 */
export function splitSentences(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const raw = text
    .split(/(?<=[。！？.!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LEN);
  return raw;
}

// === EpisodicMemory class ===

type IndexedSentence = {
  sentence: EpisodicSentence;
  words: string[];
  wordTf: Map<string, number>;
  docLen: number;
  embedding?: Float32Array;
};

/**
 * Episodic memory index over a corpus of raw conversation sentences.
 *
 * Build once with `ingestTurns()` (which calls `embedBatch` once for efficiency),
 * then query many times with `search()`. The index is per-conversation:
 * callers should create one EpisodicMemory instance per conversation to keep
 * retrieval scoped (mirrors the semantic track's per-conversation index).
 */
export class EpisodicMemory {
  private readonly sentences: IndexedSentence[] = [];
  private readonly sentencesById: Map<string, IndexedSentence> = new Map();
  private readonly byTurnId: Map<string, IndexedSentence[]> = new Map();
  private readonly sessionIds: Set<string> = new Set();
  private N = 0;
  private avgdl = 0;
  private readonly df: Map<string, number> = new Map();
  private hasEmbeddings = false;

  /**
   * Ingest a batch of turns. Embeds all sentences in one batch call to minimize
   * API round-trips. Idempotent: re-ingesting the same turn_id replaces prior
   * sentences for that turn.
   */
  async ingestTurns(
    turns: readonly IngestTurn[],
    embeddingProvider: RuntimeEmbeddingProvider,
  ): Promise<void> {
    // Collect new sentences from all turns
    const newSentences: EpisodicSentence[] = [];
    for (const turn of turns) {
      if (!turn.text || turn.text.trim().length === 0) continue;
      const fragments = splitSentences(turn.text);
      for (let i = 0; i < fragments.length; i++) {
        const id = `${turn.turn_id}_s${i}`;
        // Skip if already ingested (idempotent)
        if (this.sentencesById.has(id)) continue;
        newSentences.push({
          sentence_id: id,
          turn_id: turn.turn_id,
          session_id: turn.session_id,
          speaker: turn.speaker,
          text: fragments[i],
          turn_text: turn.text,
          timestamp: turn.timestamp,
          turn_index: turn.turn_index,
          sentence_index: i,
        });
      }
    }

    if (newSentences.length === 0) return;

    // Batch embed all new sentences
    const texts = newSentences.map((s) => s.text);
    const embeddings = await embeddingProvider.embedBatch(texts);

    // Index each sentence
    for (let i = 0; i < newSentences.length; i++) {
      const sentence = newSentences[i];
      const emb = embeddings[i];
      const text = sentence.text;
      const words = tokenizeWords(text);
      const wordTf = new Map<string, number>();
      for (const w of words) wordTf.set(w, (wordTf.get(w) ?? 0) + 1);

      const indexed: IndexedSentence = {
        sentence,
        words,
        wordTf,
        docLen: words.length,
      };
      if (emb && emb.length > 0) {
        indexed.embedding = new Float32Array(emb);
        this.hasEmbeddings = true;
      }

      this.sentences.push(indexed);
      this.sentencesById.set(sentence.sentence_id, indexed);

      const turnList = this.byTurnId.get(sentence.turn_id) ?? [];
      turnList.push(indexed);
      this.byTurnId.set(sentence.turn_id, turnList);

      this.sessionIds.add(sentence.session_id);
    }

    // Recompute corpus stats
    this.N = this.sentences.length;
    const totalLen = this.sentences.reduce((s, d) => s + d.docLen, 0);
    this.avgdl = this.N > 0 ? totalLen / this.N : 0;

    // Recompute document frequencies
    this.df.clear();
    for (const d of this.sentences) {
      for (const term of d.wordTf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }

  /**
   * Hybrid search: BM25 + Vector (embedding) over the sentence corpus.
   * Returns top-K hits ranked by RRF fusion.
   *
   * Falls back to BM25-only when no embeddings are available.
   *
   * P2-4: Optional time filtering. When `options.maxTimestamp` is set, only
   * sentences with `timestamp <= maxTimestamp` are considered. This is the
   * "time as an independent retrieval path" mechanism: temporal queries
   * restrict the candidate pool to facts/sentences that existed at or before
   * the queried time point, preventing future information from leaking in.
   */
  async search(
    query: string,
    queryEmbedding: Float32Array | null,
    topK = 15,
    options?: {
      /** Inclusive lower bound on sentence.timestamp. */
      minTimestamp?: number;
      /** Inclusive upper bound on sentence.timestamp. */
      maxTimestamp?: number;
    },
  ): Promise<EpisodicHit[]> {
    if (topK <= 0 || this.sentences.length === 0 || query.trim().length === 0) {
      return [];
    }

    // P2-4: Time filter — restrict candidate pool before ranking.
    const hasTimeFilter =
      options !== undefined &&
      (options.minTimestamp !== undefined || options.maxTimestamp !== undefined);
    const candidatePool = hasTimeFilter
      ? this.sentences.filter((d) => {
          if (
            options!.minTimestamp !== undefined &&
            d.sentence.timestamp < options!.minTimestamp
          ) {
            return false;
          }
          if (
            options!.maxTimestamp !== undefined &&
            d.sentence.timestamp > options!.maxTimestamp
          ) {
            return false;
          }
          return true;
        })
      : this.sentences;

    if (candidatePool.length === 0) return [];

    const bm25Ranked = this.rankBM25(query, candidatePool);
    const vectorRanked =
      queryEmbedding !== null && this.hasEmbeddings
        ? this.rankVector(queryEmbedding, candidatePool)
        : [];

    const bm25RankById = new Map<string, number>();
    bm25Ranked.forEach((e, i) => bm25RankById.set(e.id, i + 1));
    const vectorRankById = new Map<string, number>();
    vectorRanked.forEach((e, i) => vectorRankById.set(e.id, i + 1));

    const bm25ScoreById = new Map<string, number>();
    for (const e of bm25Ranked) bm25ScoreById.set(e.id, e.score);
    const vectorScoreById = new Map<string, number>();
    for (const e of vectorRanked) vectorScoreById.set(e.id, e.score);

    const allIds = new Set<string>([
      ...bm25RankById.keys(),
      ...vectorRankById.keys(),
    ]);

    const hits: EpisodicHit[] = [];
    for (const id of allIds) {
      const indexed = this.sentencesById.get(id);
      if (!indexed) continue;
      const bm25Rank = bm25RankById.get(id) ?? null;
      const vectorRank = vectorRankById.get(id) ?? null;

      let rrf = 0;
      if (bm25Rank !== null) rrf += 1 / (EPI_RRF_K + bm25Rank);
      if (vectorRank !== null) rrf += 1 / (EPI_RRF_K + vectorRank);

      hits.push({
        sentence: indexed.sentence,
        rrfScore: rrf,
        vectorRank,
        bm25Rank,
        vectorScore: vectorScoreById.get(id) ?? 0,
        bm25Score: bm25ScoreById.get(id) ?? 0,
      });
    }

    hits.sort((a, b) => b.rrfScore - a.rrfScore);
    return hits.slice(0, topK);
  }

  /**
   * Contextualize hits: for each anchor sentence, expand ±CONTEXT_WINDOW
   * sentences within the same turn to form an episode cluster.
   *
   * Clusters are deduplicated by sentence_id (an anchor hit and a context
   * sentence from another hit's expansion are merged into one cluster).
   * If a cluster exceeds MAX_CLUSTER_CHARS, it is truncated to anchor ±1.
   *
   * Returns clusters sorted by anchor score (desc), then by turn_index (asc).
   */
  contextualize(hits: readonly EpisodicHit[]): EpisodicCluster[] {
    if (hits.length === 0) return [];

    const seenSentenceIds = new Set<string>();
    const clusters: EpisodicCluster[] = [];

    // Sort hits by score desc so the highest-scoring anchor claims its
    // context window first; later hits whose context would overlap become
    // no-ops.
    const sorted = [...hits].sort((a, b) => b.rrfScore - a.rrfScore);

    for (const hit of sorted) {
      const anchor = hit.sentence;
      if (seenSentenceIds.has(anchor.sentence_id)) continue;

      const turnSentences = this.byTurnId.get(anchor.turn_id) ?? [];
      const anchorIdx = turnSentences.findIndex(
        (s) => s.sentence.sentence_id === anchor.sentence_id,
      );
      if (anchorIdx === -1) {
        // Defensive: anchor not found in its turn (shouldn't happen)
        clusters.push({
          anchor,
          sentences: [anchor],
          score: hit.rrfScore,
        });
        seenSentenceIds.add(anchor.sentence_id);
        continue;
      }

      const start = Math.max(0, anchorIdx - CONTEXT_WINDOW);
      const end = Math.min(turnSentences.length - 1, anchorIdx + CONTEXT_WINDOW);

      const clusterSentences: EpisodicSentence[] = [];
      let totalChars = 0;
      for (let i = start; i <= end; i++) {
        const s = turnSentences[i].sentence;
        if (seenSentenceIds.has(s.sentence_id)) continue;
        if (totalChars + s.text.length > MAX_CLUSTER_CHARS) {
          // Exceeded budget: keep only anchor ±1
          if (i === anchorIdx - 1 || i === anchorIdx || i === anchorIdx + 1) {
            clusterSentences.push(s);
            seenSentenceIds.add(s.sentence_id);
            totalChars += s.text.length;
          }
          continue;
        }
        clusterSentences.push(s);
        seenSentenceIds.add(s.sentence_id);
        totalChars += s.text.length;
      }

      // Ensure anchor is in the cluster (it may have been skipped if it was
      // already claimed by an earlier cluster — that means this hit is a dup).
      if (!clusterSentences.some((s) => s.sentence_id === anchor.sentence_id)) {
        continue;
      }

      clusters.push({
        anchor,
        sentences: clusterSentences,
        score: hit.rrfScore,
      });
    }

    return clusters;
  }

  /** Number of sentences indexed. */
  get size(): number {
    return this.sentences.length;
  }

  /** Whether embeddings have been attached. */
  get hasEmbeddingData(): boolean {
    return this.hasEmbeddings;
  }

  // === Private ranking methods ===

  private rankBM25(
    queryText: string,
    pool: readonly IndexedSentence[] = this.sentences,
  ): { id: string; score: number }[] {
    const queryTokens = tokenizeWords(queryText);
    if (queryTokens.length === 0) return [];

    const ranked: { id: string; score: number }[] = [];
    const k1 = 1.5;
    const b = 0.75;
    for (const doc of pool) {
      let score = 0;
      for (const term of new Set(queryTokens)) {
        const dfTerm = this.df.get(term) ?? 0;
        if (dfTerm === 0) continue;
        const tfTerm = doc.wordTf.get(term) ?? 0;
        if (tfTerm === 0) continue;
        const idf = Math.log(((this.N - dfTerm + 0.5) / (dfTerm + 0.5)) + 1);
        const denom =
          tfTerm + k1 * (1 - b + b * (doc.docLen / Math.max(this.avgdl, 1)));
        score += (idf * (tfTerm * (k1 + 1))) / Math.max(denom, 1e-9);
      }
      if (score > 0) {
        ranked.push({ id: doc.sentence.sentence_id, score });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  private rankVector(
    queryEmbedding: Float32Array,
    pool: readonly IndexedSentence[] = this.sentences,
  ): { id: string; score: number }[] {
    const ranked: { id: string; score: number }[] = [];
    for (const doc of pool) {
      if (!doc.embedding) continue;
      const sim = cosineSim(queryEmbedding, doc.embedding);
      if (sim > 0) ranked.push({ id: doc.sentence.sentence_id, score: sim });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }
}

// === Shared utilities ===

/**
 * Tokenize text into lowercase word tokens. Mirrors the semantic track's
 * tokenizer so the two tracks share the same notion of "word".
 */
function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length > 0);
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// === Prompt formatting ===

/**
 * Format episodic clusters into a prompt block, ordered by turn_index (chronological).
 *
 * Each cluster is rendered as:
 *   [Session {sid} · Turn {turn_idx} · {speaker}]
 *   {sentence text joined with " "}
 *
 * The block header indicates these are raw conversation snippets.
 */
export function formatEpisodicBlock(clusters: EpisodicCluster[]): string {
  if (clusters.length === 0) return "";

  // Flatten clusters, sort chronologically by turn_index for prompt coherence
  const allSentences: EpisodicSentence[] = [];
  const seen = new Set<string>();
  for (const cluster of clusters) {
    for (const s of cluster.sentences) {
      if (!seen.has(s.sentence_id)) {
        seen.add(s.sentence_id);
        allSentences.push(s);
      }
    }
  }
  allSentences.sort((a, b) => {
    if (a.turn_index !== b.turn_index) return a.turn_index - b.turn_index;
    return a.sentence_index - b.sentence_index;
  });

  // Group by turn for readable formatting
  const byTurn = new Map<string, EpisodicSentence[]>();
  for (const s of allSentences) {
    const list = byTurn.get(s.turn_id) ?? [];
    list.push(s);
    byTurn.set(s.turn_id, list);
  }

  const lines: string[] = [];
  for (const [, sentences] of byTurn) {
    const first = sentences[0];
    // P2-1: Include ISO date in the header so the LLM can ground temporal
    // answers (e.g. "five years ago") to absolute dates visible in context.
    // Previously the header only showed Session/Turn/speaker, so the LLM
    // could see the snippet but not when it was said.
    const dateStr = new Date(first.timestamp).toISOString().slice(0, 10);
    lines.push(
      `[${dateStr} · Session ${first.session_id} · Turn ${first.turn_index} · ${first.speaker}]`,
    );
    lines.push(sentences.map((s) => s.text).join(" "));
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Build the full dual-track prompt: episodic memory first, semantic facts second.
 *
 * Episodic memory is placed first because it is the ground-truth source and
 * carries richer context; semantic facts act as a complementary structured
 * summary. This mirrors the MemMachine contextualized retrieval pattern.
 */
export function buildDualTrackPrompt(
  question: string,
  episodicContext: string,
  semanticFacts: ReadonlyArray<{
    subject: string;
    predicate: string;
    objectSummary: string;
  }>,
  profileContext?: string[],
): { system: string; user: string } {
  const factLines = semanticFacts
    .slice(0, 10)
    .map((f, i) => `[${i + 1}] ${f.subject} ${f.predicate}: ${f.objectSummary}`)
    .join("\n");

  const system =
    "You are a helpful assistant answering questions about conversations between two people. " +
    "You are given two types of memory:\n" +
    "1. EPISODIC MEMORY — raw conversation snippets (verbatim from the original dialogue).\n" +
    "2. SEMANTIC MEMORY — structured facts extracted from the conversation.\n\n" +
    "Prefer EPISODIC MEMORY when the question asks about specific phrasing, " +
    "timing, or details that may have been lost during fact extraction. " +
    "Use SEMANTIC MEMORY for consolidated attributes like job titles, " +
    "preferences, or stable properties.\n" +
    "If the memory contains relevant information, synthesize a concise, factual answer. " +
    "Only say 'I don't know' if the memory contains absolutely no relevant information. " +
    "Answer in a direct, factual style. Prefer specific details over general statements.";

  let user = "";
  if (profileContext && profileContext.length > 0) {
    user += `${profileContext.join("\n")}\n\n`;
  }

  user +=
    episodicContext.length > 0
      ? `[EPISODIC MEMORY — raw conversation snippets, chronological order]\n${episodicContext}\n\n`
      : "";

  user +=
    factLines.length > 0
      ? `[SEMANTIC MEMORY — extracted structured facts]\n${factLines}\n\n`
      : "";

  user += `Question: ${question}\n\nAnswer:`;

  return { system, user };
}
