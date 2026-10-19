/**
 * In-memory segment summary tree used by TF-0424 shadow evaluation.
 *
 * It deliberately has no persistence adapter. Source transcripts and existing
 * owners remain authoritative; this ledger is a disposable projection.
 */
import { createHash } from "node:crypto";
import type { ArchiveHandle } from "../../../../shared/types/context-item.js";

export type SummaryTier = "T0" | "T1" | "T2";

export type SegmentSummaryLayer = {
  text: string;
  estimatedTokens: number;
};

export type SegmentSummaryRecord = {
  id: string;
  digest: string;
  parentDigests: string[];
  tiers: {
    T0: SegmentSummaryLayer;
    T1: SegmentSummaryLayer & { keyFacts: string[] };
    T2?: SegmentSummaryLayer;
  };
  archiveHandle?: ArchiveHandle;
  heat: number;
  createdAtTurn: number;
  lastAccessedTurn: number;
  reuseCount: number;
};

export type SegmentSummarizer = (params: {
  tier: "T1" | "T2";
  text: string;
}) => { summary: string; keyFacts: string[] };

export type SegmentAssemblyItem = {
  id: string;
  digest: string;
  tier: SummaryTier;
  text: string;
  estimatedTokens: number;
  archiveHandle?: ArchiveHandle;
  parentDigests: string[];
};

const DEFAULT_MAX_SEGMENTS = 128;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function normalizeMaxSegments(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : DEFAULT_MAX_SEGMENTS;
}

function normalizeTerms(terms: readonly string[] | undefined): string[] {
  return [...new Set((terms ?? []).map((term) => term.trim().toLowerCase()).filter(Boolean))];
}

function relevanceScore(text: string, terms: readonly string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

/** Deterministic summarizer used by the shadow fixture; no model call. */
export const deterministicSegmentSummarizer: SegmentSummarizer = ({ tier, text }) => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const keyFacts = lines.filter((line) => (
    /^(?:decision|next action|error|constraint|blocker)\s*[:=-]/iu.test(line)
  )).slice(0, 8);
  if (tier === "T2") {
    const summary = lines.slice(0, 6).map((line) => line.slice(0, 220)).join("\n");
    return { summary: summary || "(empty segment)", keyFacts };
  }
  const summary = [
    lines[0]?.slice(0, 240),
    lines.at(-1)?.slice(0, 240),
  ].filter(Boolean).join("\n") || "(empty segment)";
  return { summary, keyFacts };
};

export class SegmentSummaryLedger {
  private readonly segments = new Map<string, SegmentSummaryRecord>();
  private readonly byDigest = new Map<string, string>();
  private readonly maxSegments: number;
  private readonly summarize: SegmentSummarizer;

  constructor(options: {
    maxSegments?: number;
    summarize?: SegmentSummarizer;
  } = {}) {
    this.maxSegments = normalizeMaxSegments(options.maxSegments);
    this.summarize = options.summarize ?? deterministicSegmentSummarizer;
  }

  ingestSegment(params: {
    id: string;
    sourceText: string;
    currentTurn: number;
    archiveHandle?: ArchiveHandle;
  }): { record: SegmentSummaryRecord; reused: boolean } {
    const digest = digestText(params.sourceText);
    const existingId = this.byDigest.get(digest);
    const existing = existingId ? this.segments.get(existingId) : undefined;
    if (existing) {
      existing.heat += 1;
      existing.reuseCount += 1;
      existing.lastAccessedTurn = params.currentTurn;
      return { record: existing, reused: true };
    }

    const summary = this.summarize({ tier: "T1", text: params.sourceText });
    const record: SegmentSummaryRecord = {
      id: params.id,
      digest,
      parentDigests: [],
      tiers: {
        T0: { text: params.sourceText, estimatedTokens: estimateTokens(params.sourceText) },
        T1: {
          text: summary.summary,
          keyFacts: summary.keyFacts,
          estimatedTokens: estimateTokens(summary.summary),
        },
      },
      ...(params.archiveHandle ? { archiveHandle: params.archiveHandle } : {}),
      heat: 1,
      createdAtTurn: params.currentTurn,
      lastAccessedTurn: params.currentTurn,
      reuseCount: 0,
    };
    this.segments.set(record.id, record);
    this.byDigest.set(digest, record.id);
    this.evictIfNeeded();
    return { record, reused: false };
  }

  rollupSegments(params: {
    id: string;
    segmentIds: readonly string[];
    currentTurn: number;
  }): { record: SegmentSummaryRecord; reused: boolean } {
    const children = params.segmentIds
      .map((id) => this.segments.get(id))
      .filter((segment): segment is SegmentSummaryRecord => Boolean(segment));
    if (children.length !== params.segmentIds.length || children.length === 0) {
      throw new Error("rollupSegments requires every source segment to exist");
    }
    const parentDigests = children.map((segment) => segment.digest).sort();
    const digest = digestText(parentDigests.join("\n"));
    const existingId = this.byDigest.get(digest);
    const existing = existingId ? this.segments.get(existingId) : undefined;
    if (existing) {
      existing.heat += 1;
      existing.reuseCount += 1;
      existing.lastAccessedTurn = params.currentTurn;
      return { record: existing, reused: true };
    }
    const source = children.map((segment) => segment.tiers.T1.text).join("\n");
    const summary = this.summarize({ tier: "T2", text: source });
    const t2Tokens = estimateTokens(summary.summary);
    const record: SegmentSummaryRecord = {
      id: params.id,
      digest,
      parentDigests,
      tiers: {
        T0: { text: source, estimatedTokens: estimateTokens(source) },
        T1: {
          text: summary.summary,
          keyFacts: summary.keyFacts,
          estimatedTokens: t2Tokens,
        },
        T2: { text: summary.summary, estimatedTokens: t2Tokens },
      },
      heat: 1,
      createdAtTurn: params.currentTurn,
      lastAccessedTurn: params.currentTurn,
      reuseCount: 0,
    };
    this.segments.set(record.id, record);
    this.byDigest.set(digest, record.id);
    this.evictIfNeeded();
    return { record, reused: false };
  }

  invalidate(segmentId: string): boolean {
    const segment = this.segments.get(segmentId);
    if (!segment) return false;
    this.segments.delete(segmentId);
    if (this.byDigest.get(segment.digest) === segmentId) {
      this.byDigest.delete(segment.digest);
    }
    return true;
  }

  get(segmentId: string): SegmentSummaryRecord | undefined {
    return this.segments.get(segmentId);
  }

  get size(): number {
    return this.segments.size;
  }

  assemble(params: {
    tokenBudget: number;
    targetTerms?: readonly string[];
    currentTurn: number;
  }): SegmentAssemblyItem[] {
    const budget = Math.max(0, Math.floor(params.tokenBudget));
    const terms = normalizeTerms(params.targetTerms);
    const ranked = [...this.segments.values()]
      .map((segment) => {
        const score = relevanceScore(
          `${segment.tiers.T1.text}\n${segment.tiers.T1.keyFacts.join("\n")}`,
          terms,
        );
        const age = Math.max(0, params.currentTurn - segment.createdAtTurn);
        return { segment, score, age };
      })
      .sort((left, right) => (
        right.score - left.score ||
        left.age - right.age ||
        right.segment.heat - left.segment.heat ||
        left.segment.id.localeCompare(right.segment.id)
      ));

    const items: SegmentAssemblyItem[] = [];
    let remaining = budget;
    for (const { segment, age } of ranked) {
      const t2 = segment.tiers.T2;
      const t1 = segment.tiers.T1;
      const t0 = segment.tiers.T0;
      const choices: Array<{ tier: SummaryTier; layer: SegmentSummaryLayer }> = t2
        ? [{ tier: "T2", layer: t2 }, { tier: "T1", layer: t1 }]
        : age <= 2
          ? [{ tier: "T0", layer: t0 }, { tier: "T1", layer: t1 }]
          : [{ tier: "T1", layer: t1 }, ...(t0.estimatedTokens <= 2_000 ? [{ tier: "T0" as const, layer: t0 }] : [])];
      const selected = choices.find((choice) => choice.layer.estimatedTokens <= remaining);
      if (!selected) continue;
      remaining -= selected.layer.estimatedTokens;
      segment.lastAccessedTurn = params.currentTurn;
      segment.heat += 1;
      items.push({
        id: segment.id,
        digest: segment.digest,
        tier: selected.tier,
        text: selected.layer.text,
        estimatedTokens: selected.layer.estimatedTokens,
        ...(segment.archiveHandle ? { archiveHandle: segment.archiveHandle } : {}),
        parentDigests: [...segment.parentDigests],
      });
    }
    return items;
  }

  private evictIfNeeded(): void {
    while (this.segments.size > this.maxSegments) {
      const coldest = [...this.segments.values()]
        .sort((left, right) => (
          left.heat - right.heat ||
          left.lastAccessedTurn - right.lastAccessedTurn ||
          left.id.localeCompare(right.id)
        ))[0];
      if (!coldest) return;
      this.invalidate(coldest.id);
    }
  }
}
