// Self-ask decomposition result disk cache.
//
// Stage 5.7 (2026-07-04): self-ask uses DeepSeek temp=0 but the API still
// produces ±1-2 word variance across runs. This variance propagates to the
// generator (different reasoningHints → different answers) and causes
// ±2-3pp Overall J variance due to judge cache misses.
//
// Cache key: hash(question + decomposeVersion + answererVersion).
// Stores: { hopAnswers: string[], subQuestions: string[] }.
//
// Usage:
//   const cache = new SelfAskCache(cachePath);
//   const cached = cache.get(question);
//   if (cached) return cached.hopAnswers;
//   const result = await runSequentialSelfAsk(...);
//   cache.set(question, result.hopAnswers, result.subQuestions);
//
// Env:
//   DISABLE_SELFASK_CACHE=1  → bypass cache (always call LLM)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

type SelfAskCacheShape = {
  version: string;
  decomposeVersion: string;
  answererVersion: string;
  entries: Record<
    string,
    { hopAnswers: string[]; subQuestions: string[] }
  >;
};

const CACHE_VERSION = "1.0-self-ask-cache";

// Bump these when decomposeSequentialQuestion or the sub-question answerer
// prompt changes — old cache entries will be invalidated.
const DECOMPOSE_VERSION = "1.0";
const ANSWERER_VERSION = "1.0-stage5.2d-cached-facts-context";

function hashKey(
  question: string,
  decomposeVersion: string,
  answererVersion: string,
): string {
  return createHash("sha256")
    .update(`${decomposeVersion}\u0000${answererVersion}\u0000${question}`)
    .digest("hex");
}

export type CachedSelfAskResult = {
  hopAnswers: string[];
  subQuestions: string[];
};

export class SelfAskCache {
  private cache: SelfAskCacheShape;
  private dirty = false;
  private readonly disabled: boolean;
  private hits = 0;
  private total = 0;

  constructor(private readonly cachePath: string) {
    this.disabled = process.env.DISABLE_SELFASK_CACHE === "1";
    this.cache = this.disabled
      ? {
          version: CACHE_VERSION,
          decomposeVersion: DECOMPOSE_VERSION,
          answererVersion: ANSWERER_VERSION,
          entries: {},
        }
      : this.load();
  }

  private load(): SelfAskCacheShape {
    if (!existsSync(this.cachePath)) {
      return {
        version: CACHE_VERSION,
        decomposeVersion: DECOMPOSE_VERSION,
        answererVersion: ANSWERER_VERSION,
        entries: {},
      };
    }
    try {
      const raw = readFileSync(this.cachePath, "utf-8");
      const parsed = JSON.parse(raw) as SelfAskCacheShape;
      if (
        parsed.version !== CACHE_VERSION ||
        parsed.decomposeVersion !== DECOMPOSE_VERSION ||
        parsed.answererVersion !== ANSWERER_VERSION
      ) {
        // Version mismatch: start fresh
        return {
          version: CACHE_VERSION,
          decomposeVersion: DECOMPOSE_VERSION,
          answererVersion: ANSWERER_VERSION,
          entries: {},
        };
      }
      return parsed;
    } catch {
      return {
        version: CACHE_VERSION,
        decomposeVersion: DECOMPOSE_VERSION,
        answererVersion: ANSWERER_VERSION,
        entries: {},
      };
    }
  }

  get(question: string): CachedSelfAskResult | undefined {
    this.total += 1;
    if (this.disabled) return undefined;
    const key = hashKey(
      question,
      this.cache.decomposeVersion,
      this.cache.answererVersion,
    );
    const entry = this.cache.entries[key];
    if (entry !== undefined) {
      this.hits += 1;
      return entry;
    }
    return undefined;
  }

  set(
    question: string,
    hopAnswers: string[],
    subQuestions: string[],
  ): void {
    if (this.disabled) return;
    const key = hashKey(
      question,
      this.cache.decomposeVersion,
      this.cache.answererVersion,
    );
    this.cache.entries[key] = { hopAnswers, subQuestions };
    this.dirty = true;
  }

  flush(): void {
    if (this.disabled || !this.dirty) return;
    const dir = dirname(this.cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(this.cache));
    this.dirty = false;
  }

  get size(): number {
    return Object.keys(this.cache.entries).length;
  }

  get stats(): { hits: number; total: number; hitRate: number } {
    return {
      hits: this.hits,
      total: this.total,
      hitRate: this.total > 0 ? this.hits / this.total : 0,
    };
  }
}
