// DeepSeek API client for runtime-memory real-LLM evaluation.
// Uses undici (already a devDependency at 8.1.0). OpenAI-compatible API.
// CI-safe: callers run only when explicitly opted in with
// RUNTIME_MEMORY_REAL_LLM=1 and DEEPSEEK_API_KEY.

import { createHash } from "node:crypto";
import { request } from "undici";

const DEFAULT_MODEL = process.env.RUNTIME_MEMORY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
// Reasoning models (deepseek-v4-flash, deepseek-reasoner/R1) emit their chain
// of thought in `reasoning_content` and the final answer in `content`. They
// also require a much larger max_tokens budget because the reasoning process
// consumes tokens before the final answer is produced. With the default 256
// budget, reasoning gets cut off (finish_reason="length") and `content` stays
// empty, producing J=0.0%.
const REASONING_DEFAULT_MAX_TOKENS = 4096;

function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes("reasoner") ||
    lower.includes("r1") ||
    lower.includes("v4-flash") ||
    lower.includes("v3-reasoner") ||
    lower.includes("step-5")
  );
}

export type LlmResponse = {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  attempts: number;
  model?: string;
  responseId?: string;
};

export type LlmCallOptions = {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
  evidenceRole?: "frozen-judge";
};

export function hasDeepSeekKey(): boolean {
  return process.env.RUNTIME_MEMORY_REAL_LLM === "1" && Boolean(
    process.env.RUNTIME_MEMORY_LLM_API_KEY
      ? process.env.RUNTIME_MEMORY_LLM_BASE_URL
      : process.env.DEEPSEEK_API_KEY,
  );
}

export function getRuntimeMemoryLlmConfig(): { endpoint: string; model: string } {
  if (process.env.RUNTIME_MEMORY_LLM_API_KEY && !process.env.RUNTIME_MEMORY_LLM_BASE_URL) {
    throw new Error("RUNTIME_MEMORY_LLM_API_KEY requires an explicit RUNTIME_MEMORY_LLM_BASE_URL");
  }
  const base = new URL(process.env.RUNTIME_MEMORY_LLM_BASE_URL || "https://api.deepseek.com/v1");
  if (base.username || base.password || base.search || base.hash
    || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("Runtime memory LLM base URL must be HTTPS (or loopback HTTP), without credentials, query or fragment");
  }
  base.pathname = base.pathname.replace(/\/$/, "") + "/chat/completions";
  return { endpoint: base.href, model: process.env.RUNTIME_MEMORY_LLM_MODEL || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL };
}

export type RuntimeMemoryLlmReceipt = {
  completedAt: string;
  endpoint: string;
  requestedModel: string;
  returnedModel: string | null;
  responseId: string | null;
  requestSha256: string;
  responseSha256: string;
  status: 200;
  attempts: number;
  usage: LlmResponse["usage"];
  judgeEvidence?: { temperature: number; maxTokens: number; content: string };
};
const receipts: RuntimeMemoryLlmReceipt[] = [];
export function getRuntimeMemoryLlmReceipts(): RuntimeMemoryLlmReceipt[] {
  return structuredClone(receipts);
}


export async function callDeepSeek(
  system: string,
  user: string,
  options: LlmCallOptions = {},
): Promise<LlmResponse> {
  const apiKey = process.env.RUNTIME_MEMORY_LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Runtime memory LLM API key not set");
  }
  const config = getRuntimeMemoryLlmConfig();
  const model = options.model ?? config.model;
  // Reasoning models can take 60-120s per call due to the chain-of-thought step.
  const timeoutMs = options.timeoutMs ??
    (isReasoningModel(model) ? 120_000 : DEFAULT_TIMEOUT_MS);
  const temperature = options.temperature ?? 0;
  // Reasoning models need a much larger budget so the reasoning process can
  // complete and still leave room for the final answer in `content`.
  const defaultMaxTokens = isReasoningModel(model)
    ? REASONING_DEFAULT_MAX_TOKENS
    : 256;
  const requestedMaxTokens = options.maxTokens ?? defaultMaxTokens;
  // For reasoning models, enforce a floor: even yes/no judge calls need enough
  // budget for the chain-of-thought to complete before the final answer.
  const maxTokens = isReasoningModel(model)
    ? Math.max(requestedMaxTokens, 2048)
    : requestedMaxTokens;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestBody = JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature, max_tokens: maxTokens, stream: false,
      });
      const res = await request(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: requestBody,
        signal: controller.signal,
        // Bound each phase so a stalled socket cannot leave the promise
        // unsettled forever. If the peer stops mid-body, undici can otherwise
        // hang with no CPU, no traffic and no timeout firing. These are
        // per-request options and still route through the global dispatcher, so
        // MockAgent-based tests keep working. Observed live: judge-06 hung 40+
        // minutes at conv-47 with only the AbortController set.
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      // 429 is a rate limit, not a bad request: wait for the server Retry-After
      // when it supplies one (bounded), otherwise back off exponentially. Without
      // this a single rate-limited question was written off as a failed result
      // instead of being retried.
      if (res.statusCode === 429 && attempt < MAX_RETRIES) {
        await res.body.dump();
        clearTimeout(timer);
        lastError = new Error("Runtime memory LLM API 429");
        await delay(rateLimitDelayMs(parseRetryAfter(res.headers?.["retry-after"]), attempt));
        continue;
      }
      if (res.statusCode >= 500 && attempt < MAX_RETRIES) {
        await res.body.dump();
        clearTimeout(timer);
        lastError = new Error(`Runtime memory LLM server error ${res.statusCode}`);
        await delay(500 * attempt);
        continue;
      }
      if (res.statusCode !== 200) {
        await res.body.dump();
        throw new Error(`Runtime memory LLM API ${res.statusCode}`);
      }
      const data = (await res.body.json()) as {
        id?: string;
        model?: string;
        choices: Array<{
          message: { content: string; reasoning_content?: string };
          finish_reason?: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      if (!data.choices || data.choices.length === 0) {
        throw new Error("DeepSeek returned no choices");
      }
      clearTimeout(timer);
      const msg = data.choices[0].message;
      const content = msg?.content;
      if (typeof content !== "string" || content.trim().length === 0 || data.choices[0].finish_reason === "length") {
        throw new Error("Runtime memory LLM returned no complete final answer (reasoning/truncation is not answer evidence)");
      }
      if (!data.usage || ![data.usage.prompt_tokens, data.usage.completion_tokens, data.usage.total_tokens]
        .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
        throw new Error("Runtime memory LLM returned no valid usage accounting");
      }
      receipts.push({
        completedAt: new Date().toISOString(), endpoint: config.endpoint, requestedModel: model,
        returnedModel: data.model ?? null, responseId: data.id ?? null,
        requestSha256: createHash("sha256").update(requestBody).digest("hex"),
        responseSha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
        status: 200, attempts: attempt, usage: { ...data.usage },
        ...(options.evidenceRole === "frozen-judge" ? { judgeEvidence: { temperature, maxTokens, content } } : {}),
      });
      return {
        content,
        usage: data.usage,
        attempts: attempt,
        model: data.model,
        responseId: data.id,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.message.includes(apiKey)) err.message = err.message.split(apiKey).join("[REDACTED]");
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await delay(500 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("DeepSeek call failed after retries");
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    // A 429 that is not retried inline still has to be retried, never scored as an
    // answered question.
    if (/API 429/.test(err.message)) return true;
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|UND_ERR/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

/** Upper bound on a single rate-limit wait, so a hostile Retry-After cannot stall a run. */
export const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;

/** Seconds or an HTTP-date, per RFC 9110. Returns null when the header is absent or unusable. */
export function parseRetryAfter(raw: unknown, now = Date.now()): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - now) : null;
}

/** Retry-After wins when present; otherwise exponential backoff. Always bounded. */
export function rateLimitDelayMs(retryAfterMs: number | null, attempt: number): number {
  const backoff = retryAfterMs ?? 1000 * 2 ** (attempt - 1);
  return Math.min(Math.max(backoff, 0), MAX_RATE_LIMIT_BACKOFF_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Multi-judge majority vote for anti-hallucination verification.
// Runs `votes` independent calls at temperature=0.3 to get slight variation,
// then returns the first response plus how many of the other runs agreed.
export async function callDeepSeekMajorityVote(
  system: string,
  user: string,
  votes: number,
  options: Omit<LlmCallOptions, "temperature"> = {},
): Promise<{ responses: LlmResponse[]; agreements: number; firstContent: string }> {
  const responses = await Promise.all(
    Array.from({ length: votes }, () =>
      callDeepSeek(system, user, { ...options, temperature: 0.3 }),
    ),
  );
  const firstContent = responses[0].content;
  const agreements = responses.filter((r) => r.content === firstContent).length;
  return { responses, agreements, firstContent };
}

// Token probe helper: checks whether a target token appears in the response,
// and whether negative tokens (should NOT appear) are absent.
export type TokenProbeResult = {
  tokenPresent: boolean;
  negativeClean: boolean;
  responseContent: string;
};

export function checkTokenProbe(
  responseContent: string,
  targetToken: string,
  negativeTokens: readonly string[],
): TokenProbeResult {
  return {
    tokenPresent: responseContent.includes(targetToken),
    negativeClean: negativeTokens.every((t) => !responseContent.includes(t)),
    responseContent,
  };
}
