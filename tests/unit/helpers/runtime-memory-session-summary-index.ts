import type { RuntimeEmbeddingProvider } from "../../../openclaw_runtime/src/runtime-core/memory-embedding-provider";

export type SessionSummaryTurn = {
  conversationId: string;
  sessionId: string;
  sessionDate: number;
  speaker: string;
  text: string;
  turnIndex: number;
};

export type SessionSummaryRecord = {
  conversationId: string;
  sessionId: string;
  sessionDate: number;
  summary: string;
  embedding: Float32Array;
  rawText: string;
};

export type SessionSummaryHit = Omit<SessionSummaryRecord, "embedding"> & {
  score: number;
};

export const SESSION_SUMMARY_SYSTEM_PROMPT =
  "You are summarizing a conversation session for a memory system. Produce a 3-5 sentence summary covering:\n" +
  "1. The session date (if mentioned)\n" +
  "2. Key entities mentioned (people, places, organizations)\n" +
  "3. Important events, decisions, or facts shared\n\n" +
  "Keep it factual. No speculation.";

export function buildSessionSummaryUserPrompt(
  sessionDate: number,
  sessionText: string,
): string {
  return `Session date: ${new Date(sessionDate).toISOString().slice(0, 10)}
Conversation:
${sessionText}`;
}

export class SessionSummaryIndex {
  private readonly summaries: SessionSummaryRecord[] = [];

  async buildFromTurns(
    conversationId: string,
    turns: readonly SessionSummaryTurn[],
    embeddingProvider: RuntimeEmbeddingProvider,
    callLLM: (
      system: string,
      user: string,
      options?: { temperature?: number; maxTokens?: number },
    ) => Promise<{ content: string }>,
  ): Promise<void> {
    const bySession = new Map<string, SessionSummaryTurn[]>();
    for (const turn of turns) {
      if (turn.conversationId !== conversationId) continue;
      const sessionTurns = bySession.get(turn.sessionId) ?? [];
      sessionTurns.push(turn);
      bySession.set(turn.sessionId, sessionTurns);
    }

    for (const [sessionId, sessionTurns] of bySession) {
      sessionTurns.sort((a, b) => a.turnIndex - b.turnIndex);
      const sessionDate = sessionTurns[0]?.sessionDate ?? Date.UTC(2023, 0, 1);
      const rawText = formatSessionRawText(sessionTurns);
      const response = await callLLM(
        SESSION_SUMMARY_SYSTEM_PROMPT,
        buildSessionSummaryUserPrompt(sessionDate, rawText),
        { temperature: 0, maxTokens: 240 },
      );
      const [embedding] = await embeddingProvider.embedBatch([response.content.trim()]);
      this.summaries.push({
        conversationId,
        sessionId,
        sessionDate,
        summary: response.content.trim(),
        embedding: new Float32Array(embedding),
        rawText,
      });
    }
  }

  addSummary(record: SessionSummaryRecord): void {
    this.summaries.push(record);
  }

  async search(
    query: string,
    queryEmbedding: Float32Array,
    topK: number,
  ): Promise<SessionSummaryHit[]> {
    if (topK <= 0 || query.trim().length === 0) return [];
    return this.summaries
      .map((record) => ({
        conversationId: record.conversationId,
        sessionId: record.sessionId,
        sessionDate: record.sessionDate,
        summary: record.summary,
        rawText: record.rawText,
        score: cosineSimilarity(queryEmbedding, record.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number {
    return this.summaries.length;
  }

  get records(): readonly SessionSummaryRecord[] {
    return this.summaries;
  }
}

export function formatSessionRawText(turns: readonly SessionSummaryTurn[]): string {
  return turns
    .map((turn) => {
      const date = new Date(turn.sessionDate).toISOString().slice(0, 10);
      return `[said on ${date}] ${turn.speaker}: ${turn.text}`;
    })
    .join("\n");
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
