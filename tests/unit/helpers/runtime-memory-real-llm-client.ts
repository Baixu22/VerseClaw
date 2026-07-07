// DeepSeek API client for runtime-memory real-LLM evaluation.
// Uses undici (already a devDependency at 8.1.0). OpenAI-compatible API.
// CI-safe: callers run only when explicitly opted in with
// RUNTIME_MEMORY_REAL_LLM=1 and DEEPSEEK_API_KEY.

import { request } from "undici";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
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
    lower.includes("v3-reasoner")
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
};

export type LlmCallOptions = {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
};

export function hasDeepSeekKey(): boolean {
  return process.env.RUNTIME_MEMORY_REAL_LLM === "1" &&
    typeof process.env.DEEPSEEK_API_KEY === "string" &&
    process.env.DEEPSEEK_API_KEY.length > 0;
}

export async function callDeepSeek(
  system: string,
  user: string,
  options: LlmCallOptions = {},
): Promise<LlmResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not set");
  }
  const model = options.model ?? DEFAULT_MODEL;
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
      const res = await request(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.statusCode >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`DeepSeek server error ${res.statusCode}`);
        await delay(500 * attempt);
        continue;
      }
      if (res.statusCode !== 200) {
        const bodyText = await res.body.text();
        throw new Error(`DeepSeek API ${res.statusCode}: ${bodyText}`);
      }
      const data = (await res.body.json()) as {
        choices: Array<{
          message: { content: string; reasoning_content?: string };
          finish_reason?: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      if (!data.choices || data.choices.length === 0) {
        throw new Error("DeepSeek returned no choices");
      }
      const msg = data.choices[0].message;
      // For reasoning models, prefer `content` (the final answer produced
      // after reasoning completes). Fall back to `reasoning_content` only
      // when `content` is empty (e.g. reasoning was truncated by max_tokens).
      const content = msg.content || msg.reasoning_content || "";
      return {
        content,
        usage: data.usage,
        attempts: attempt,
      };
    } catch (err) {
      clearTimeout(timer);
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
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|UND_ERR/i.test(err.message)) {
      return true;
    }
  }
  return false;
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
