// Judge result disk cache for test resumability.
//
// When tests fail midway (network error, OOM, etc.), re-running should skip
// already-judged questions. Cache key: hash(question + groundTruth + predictedAnswer + promptVersion).
//
// Usage:
//   const cache = new JudgeResultCache(cachePath);
//   const cached = cache.get(question, groundTruth, predictedAnswer);
//   if (cached !== undefined) return cached;
//   const score = await judgeAnswer(...);
//   cache.set(question, groundTruth, predictedAnswer, score);
//
// Env:
//   DISABLE_JUDGE_CACHE=1  → bypass cache (always call LLM judge)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

type JudgeCacheShape = {
  version: string;
  promptVersion: string;
  judgeModel: string;
  entries: Record<string, number>; // hash → 0 | 1
};

const CACHE_VERSION = "1.0-judge-result-cache";

function hashKey(
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
  promptVersion: string,
  judgeModel: string,
): string {
  return createHash("sha256")
    .update(`${promptVersion}\u0000${judgeModel}\u0000${question}\u0000${groundTruth}\u0000${predictedAnswer}`)
    .digest("hex");
}

export class JudgeResultCache {
  private cache: JudgeCacheShape;
  private dirty = false;
  private readonly disabled: boolean;

  constructor(
    private readonly cachePath: string,
    promptVersion: string,
    judgeModel: string,
  ) {
    this.disabled = process.env.DISABLE_JUDGE_CACHE === "1";
    this.cache = this.disabled
      ? { version: CACHE_VERSION, promptVersion, judgeModel, entries: {} }
      : this.load(promptVersion, judgeModel);
  }

  private load(promptVersion: string, judgeModel: string): JudgeCacheShape {
    if (!existsSync(this.cachePath)) {
      return { version: CACHE_VERSION, promptVersion, judgeModel, entries: {} };
    }
    try {
      const raw = readFileSync(this.cachePath, "utf-8");
      const parsed = JSON.parse(raw) as JudgeCacheShape;
      if (
        parsed.version !== CACHE_VERSION ||
        parsed.promptVersion !== promptVersion ||
        parsed.judgeModel !== judgeModel
      ) {
        // Version mismatch: start fresh (prompt change invalidates cached verdicts).
        return { version: CACHE_VERSION, promptVersion, judgeModel, entries: {} };
      }
      return parsed;
    } catch {
      return { version: CACHE_VERSION, promptVersion, judgeModel, entries: {} };
    }
  }

  get(
    question: string,
    groundTruth: string | number,
    predictedAnswer: string,
  ): number | undefined {
    if (this.disabled) return undefined;
    const key = hashKey(
      question,
      groundTruth,
      predictedAnswer,
      this.cache.promptVersion,
      this.cache.judgeModel,
    );
    return this.cache.entries[key];
  }

  set(
    question: string,
    groundTruth: string | number,
    predictedAnswer: string,
    score: number,
  ): void {
    if (this.disabled) return;
    const key = hashKey(
      question,
      groundTruth,
      predictedAnswer,
      this.cache.promptVersion,
      this.cache.judgeModel,
    );
    this.cache.entries[key] = score;
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

  get hitRate(): { hits: number; total: number } {
    // Track via separate counters in future. For now, return size as proxy.
    return { hits: 0, total: 0 };
  }
}
