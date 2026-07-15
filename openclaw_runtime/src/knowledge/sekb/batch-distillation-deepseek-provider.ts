/**
 * Explicit DeepSeek provider for Phase B batch distillation.
 *
 * Only constructed by Host/CLI callers that already passed the SEKB master +
 * batch flags and an explicit suggest request. Never ambient, never persists
 * raw model I/O, and never writes principles.
 */
import type {
  SekbBatchDistillationModelInput,
  SekbBatchDistillationProvider,
  SekbBatchDistillationProviderResponse,
} from "./batch-distillation-assistant.js";

export type CreateDeepSeekSekbBatchProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

/**
 * Returns undefined when no API key is available so callers fall back
 * deterministically without constructing a partial provider.
 */
export function createDeepSeekSekbBatchDistillationProvider(
  options: CreateDeepSeekSekbBatchProviderOptions = {},
): SekbBatchDistillationProvider | undefined {
  const apiKey = (
    options.apiKey
    ?? process.env.DEEPSEEK_API_KEY
    ?? process.env.CLAWX_DEEPSEEK_API_KEY
    ?? ""
  ).trim();
  if (!apiKey) {
    return undefined;
  }

  const baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const model = (options.model ?? process.env.DEEPSEEK_SEKB_BATCH_MODEL ?? process.env.CLAWX_DEEPSEEK_MODEL ?? DEFAULT_MODEL)
    .trim() || DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return undefined;
  }

  return {
    async suggest(input, callOptions): Promise<SekbBatchDistillationProviderResponse> {
      const body = {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You assist SEKB batch distillation. Reply with JSON only.",
              'Schema: {"schema":"sekb-batch-distillation-output.v1","suggestions":[{',
              '"title":string,"condition":string,"action":string,"reason":string,',
              '"source_trajectory_refs":string[],"related_principle_refs":string[],',
              '"conflicts":[{"principle_ref":string,"reason":string}],',
              '"confidence":number,"skipped_reason":string|null}]}',
              "Use only trajectory_ref / principle_ref values from the input.",
              "Do not invent refs. Prefer 1-3 high-quality suggestions.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify(input satisfies SekbBatchDistillationModelInput),
          },
        ],
      };

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: callOptions.signal,
      });

      if (!response.ok) {
        throw new Error(`deepseek_http_${response.status}`);
      }

      const payload = await response.json() as {
        id?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
          total_tokens?: unknown;
        };
      };

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("deepseek_empty_content");
      }

      const inputTokens = asNonNegativeNumber(payload.usage?.prompt_tokens);
      const outputTokens = asNonNegativeNumber(payload.usage?.completion_tokens);
      const traceId = typeof payload.id === "string" && /^[a-z0-9_-]{1,128}$/i.test(payload.id)
        ? payload.id
        : callOptions.traceId;

      return {
        content,
        traceId,
        usage: {
          ...(inputTokens !== null ? { inputTokens } : {}),
          ...(outputTokens !== null ? { outputTokens } : {}),
        },
      };
    },
  };
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
