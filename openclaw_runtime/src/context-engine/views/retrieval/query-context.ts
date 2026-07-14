// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/retrieval/query-context.ts (verbatim).
import { categoriesFromLexiconMatches, matchDomainLexicon, type DomainLexiconCategory } from "./domain-lexicon.js";

export type DetectedQueryLanguage = "en" | "zh" | "mixed";

export type QueryTermSource =
  | "raw"
  | "identifier"
  | "path"
  | "segmenter"
  | "lexicon";

export interface WeightedQueryTerm {
  term: string;
  weight: number;
  source: QueryTermSource;
  category?: DomainLexiconCategory;
}

export interface QueryContext {
  rawQuery: string;
  normalizedQuery: string;
  detectedLanguage: DetectedQueryLanguage;
  codeTokens: string[];
  lexicalTerms: WeightedQueryTerm[];
  termCategories: DomainLexiconCategory[];
}

const CJK_RE = /[\u3400-\u9fff]/;
const CJK_SLICE_RE = /[\u3400-\u9fff]+/g;
const CODE_TOKEN_RE = /`([^`]+)`|"([^"]+)"|'([^']+)'|(?:\.?\/)?[\w.-]+\/[\w./-]+\.[A-Za-z0-9]+|\b[A-Z][A-Z0-9_]{2,}\b|\b[A-Za-z_$][A-Za-z0-9_$]*(?:[A-Z][A-Za-z0-9_$]*)+\b/g;
const CJK_STOPWORDS = new Set(["的", "了", "在", "是", "和", "或", "与", "哪个", "哪里", "什么", "怎么", "如何", "请", "给"]);

type SegmenterConstructor = new (locale?: string | string[], options?: { granularity?: "grapheme" | "word" | "sentence" }) => {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

export function buildQueryContext(query: string): QueryContext {
  const normalizedQuery = normalizeQueryText(query);
  const detectedLanguage = detectLanguage(normalizedQuery);
  const codeTokens = extractCodeTokens(normalizedQuery);
  const terms: WeightedQueryTerm[] = [];

  for (const rawPart of normalizedQuery.split(/[^a-z0-9_./:-]+/i)) {
    const part = rawPart.trim();
    if (!part) continue;
    const source: QueryTermSource = isPathLikeToken(part) ? "path" : "raw";
    terms.push({ term: part.toLowerCase(), weight: source === "path" ? 1.2 : 1, source });
    if (isCamelOrPascalIdentifier(part)) {
      for (const piece of splitIdentifierLike(part)) {
        terms.push({ term: piece, weight: 0.9, source: "identifier" });
      }
    }
  }

  for (const token of codeTokens) {
    const source: QueryTermSource = isPathLikeToken(token) ? "path" : "identifier";
    terms.push({ term: token.toLowerCase(), weight: source === "path" ? 1.25 : 1.1, source });
    for (const piece of splitIdentifierLike(token)) {
      terms.push({ term: piece, weight: 0.9, source: "identifier" });
    }
  }

  if (detectedLanguage !== "en") {
    for (const slice of cjkSlices(maskCodeTokens(normalizedQuery))) {
      for (const segment of segmentCjkSlice(slice)) {
        terms.push({ term: segment, weight: 0.62, source: "segmenter" });
      }
    }
  }

  const lexiconMatches = matchDomainLexicon(normalizedQuery);
  for (const match of lexiconMatches) {
    terms.push({ term: match.term, weight: match.weight, source: "lexicon", category: match.category });
  }

  return {
    rawQuery: query,
    normalizedQuery,
    detectedLanguage,
    codeTokens,
    lexicalTerms: mergeWeightedTerms(terms),
    termCategories: categoriesFromLexiconMatches(lexiconMatches)
  };
}

function normalizeQueryText(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[，。！？；：（）【】《》“”‘’、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(query: string): DetectedQueryLanguage {
  const hasCjk = CJK_RE.test(query);
  const hasLatin = /[A-Za-z]/.test(query);
  if (hasCjk && hasLatin) return "mixed";
  if (hasCjk) return "zh";
  return "en";
}

function extractCodeTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const match of query.matchAll(CODE_TOKEN_RE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[0];
    const trimmed = value.trim();
    if (trimmed.length >= 2) tokens.push(trimmed);
  }
  return [...new Set(tokens)];
}

function maskCodeTokens(query: string): string {
  return query.replace(CODE_TOKEN_RE, " ");
}

function cjkSlices(query: string): string[] {
  return [...query.matchAll(CJK_SLICE_RE)].map((match) => match[0]);
}

function segmentCjkSlice(slice: string): string[] {
  const segmenterConstructor = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
  if (segmenterConstructor) {
    const segmenter = new segmenterConstructor("zh", { granularity: "word" });
    const segments: string[] = [];
    for (const item of segmenter.segment(slice)) {
      const segment = item.segment.trim();
      if (item.isWordLike !== false && isUsefulCjkSegment(segment)) segments.push(segment);
    }
    if (segments.length > 0) return [...new Set(segments)];
  }
  return fallbackCjkSegments(slice);
}

function fallbackCjkSegments(slice: string): string[] {
  const segments = new Set<string>();
  for (let i = 0; i < slice.length - 1; i++) {
    const bigram = slice.slice(i, i + 2);
    if (isUsefulCjkSegment(bigram)) segments.add(bigram);
  }
  return [...segments];
}

function isUsefulCjkSegment(segment: string): boolean {
  return segment.length >= 2 && !CJK_STOPWORDS.has(segment);
}

function mergeWeightedTerms(terms: WeightedQueryTerm[]): WeightedQueryTerm[] {
  const byTerm = new Map<string, WeightedQueryTerm>();
  for (const term of terms) {
    const normalized = term.term.trim().toLowerCase();
    if (!normalized) continue;
    const current = byTerm.get(normalized);
    if (!current || termWeightRank(term) > termWeightRank(current)) {
      byTerm.set(normalized, { ...term, term: normalized });
    } else if (term.category && !current.category) {
      byTerm.set(normalized, { ...current, category: term.category });
    }
  }
  return [...byTerm.values()].sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || a.term.localeCompare(b.term));
}

function termWeightRank(term: WeightedQueryTerm): number {
  return term.weight * 10 + (5 - sourceOrder(term.source));
}

function sourceOrder(source: QueryTermSource): number {
  switch (source) {
    case "path":
      return 0;
    case "raw":
      return 1;
    case "identifier":
      return 2;
    case "segmenter":
      return 3;
    case "lexicon":
      return 4;
  }
}

function isPathLikeToken(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value);
}

function isCamelOrPascalIdentifier(value: string): boolean {
  return !/[._/:-]/.test(value) && /(?:[a-z0-9][A-Z]|[A-Z]{2,}[a-z])/.test(value);
}

function splitIdentifierLike(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}
