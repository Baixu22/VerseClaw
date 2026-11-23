import { splitModelRef } from '@/lib/model-options';

/**
 * Brand families the composer can draw a logo for. The id is a stable key into
 * the icon registry in `ModelBrandIcon.tsx`; it is never shown to the user.
 */
export type ModelBrandId =
  | 'claude' | 'anthropic' | 'openai' | 'grok' | 'xai' | 'deepseek' | 'gemini' | 'gemma' | 'google'
  | 'qwen' | 'kimi' | 'chatglm' | 'zhipu' | 'doubao' | 'volcengine' | 'minimax' | 'mistral' | 'meta'
  | 'hunyuan' | 'yi' | 'baichuan' | 'wenxin' | 'spark' | 'stepfun' | 'cohere' | 'perplexity'
  | 'microsoft' | 'nvidia' | 'openrouter' | 'ollama' | 'siliconcloud' | 'groq' | 'azure' | 'bedrock';

type Rule = { brand: ModelBrandId; pattern: RegExp };

/* Model-id rules run first: an OpenRouter or SiliconFlow account serving
 * `x-ai/grok-4` should show Grok, not the router. Order matters where names
 * overlap (gemma before gemini's provider, glm before zhipu). */
const MODEL_RULES: Rule[] = [
  { brand: 'claude', pattern: /claude|opus|sonnet|haiku|fable/ },
  { brand: 'grok', pattern: /grok/ },
  { brand: 'deepseek', pattern: /deepseek/ },
  { brand: 'gemma', pattern: /gemma/ },
  { brand: 'gemini', pattern: /gemini|palm|bard/ },
  { brand: 'openai', pattern: /(^|[/_-])(gpt|chatgpt|o[134](-mini|-pro)?|codex|davinci|dall-e|whisper|gpt-oss)([._:/-]|$)|^gpt|openai/ },
  { brand: 'qwen', pattern: /qwen|qwq|qvq|tongyi/ },
  { brand: 'kimi', pattern: /kimi|moonshot/ },
  { brand: 'chatglm', pattern: /glm|chatglm|codegeex/ },
  { brand: 'doubao', pattern: /doubao|seed-?\d|skylark/ },
  { brand: 'minimax', pattern: /minimax|abab/ },
  { brand: 'mistral', pattern: /mistral|mixtral|codestral|devstral|magistral|pixtral|ministral/ },
  { brand: 'meta', pattern: /llama/ },
  { brand: 'hunyuan', pattern: /hunyuan/ },
  { brand: 'yi', pattern: /(^|[/_-])yi[-_]/ },
  { brand: 'baichuan', pattern: /baichuan/ },
  { brand: 'wenxin', pattern: /ernie|wenxin/ },
  { brand: 'spark', pattern: /spark/ },
  { brand: 'stepfun', pattern: /(^|[/_-])step[-_]?\d/ },
  { brand: 'cohere', pattern: /command-?r|cohere|(^|[/_-])aya[-_]/ },
  { brand: 'perplexity', pattern: /sonar|perplexity|pplx/ },
  { brand: 'microsoft', pattern: /(^|[/_-])phi[-_]?\d|wizardlm/ },
  { brand: 'nvidia', pattern: /nemotron|nvidia/ },
];

/* Provider fallbacks for model ids that name no family (custom fine-tunes,
 * aliases like `default`). Keys are runtime provider keys, prefix-matched so
 * `ollama-1a2b3c4d` and `minimax-portal` still resolve. */
const PROVIDER_RULES: Rule[] = [
  { brand: 'anthropic', pattern: /^anthropic|^claude/ },
  { brand: 'openai', pattern: /^openai/ },
  { brand: 'xai', pattern: /^x-?ai|^grok/ },
  { brand: 'deepseek', pattern: /^deepseek/ },
  { brand: 'google', pattern: /^google|^gemini|^vertex/ },
  { brand: 'qwen', pattern: /^qwen|^dashscope|^alibaba|^bailian/ },
  { brand: 'kimi', pattern: /^moonshot|^kimi/ },
  { brand: 'zhipu', pattern: /^zhipu|^bigmodel|^glm/ },
  { brand: 'volcengine', pattern: /^volc|^ark|^byteplus|^doubao/ },
  { brand: 'minimax', pattern: /^minimax/ },
  { brand: 'mistral', pattern: /^mistral/ },
  { brand: 'openrouter', pattern: /^openrouter/ },
  { brand: 'ollama', pattern: /^ollama/ },
  { brand: 'siliconcloud', pattern: /^silicon/ },
  { brand: 'groq', pattern: /^groq/ },
  { brand: 'azure', pattern: /^azure/ },
  { brand: 'bedrock', pattern: /^bedrock|^aws/ },
  { brand: 'perplexity', pattern: /^perplexity/ },
  { brand: 'cohere', pattern: /^cohere/ },
  { brand: 'nvidia', pattern: /^nvidia/ },
  { brand: 'hunyuan', pattern: /^hunyuan|^tencent/ },
  { brand: 'baichuan', pattern: /^baichuan/ },
  { brand: 'stepfun', pattern: /^stepfun/ },
];

/** Human-facing provider names; anything unknown is shown as its runtime key. */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  google: 'Google',
  gemini: 'Google',
  qwen: 'Qwen',
  dashscope: 'DashScope',
  moonshot: 'Moonshot',
  kimi: 'Kimi',
  zhipu: 'Zhipu',
  volcengine: 'Volcengine',
  ark: 'Volcengine Ark',
  minimax: 'MiniMax',
  'minimax-portal': 'MiniMax',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  siliconflow: 'SiliconFlow',
  groq: 'Groq',
  azure: 'Azure',
  bedrock: 'Bedrock',
  custom: 'Custom',
};

export function resolveModelBrand(modelRef: string | null | undefined): ModelBrandId | null {
  const value = (modelRef || '').trim().toLowerCase();
  if (!value) return null;
  const parsed = splitModelRef(value);
  const modelId = parsed?.modelId ?? value;
  for (const rule of MODEL_RULES) if (rule.pattern.test(modelId)) return rule.brand;
  const providerKey = parsed?.providerKey ?? '';
  for (const rule of PROVIDER_RULES) if (rule.pattern.test(providerKey)) return rule.brand;
  return null;
}

export type ModelDisplayParts = {
  /** The model's own name — the last path segment of the model id. */
  name: string;
  /** Where it runs: the provider, plus the vendor namespace a router adds. */
  source: string | null;
};

/**
 * Splits a model ref into a short name and its source so neither has to be
 * truncated: `openrouter/x-ai/grok-4-fast` → `grok-4-fast` · `OpenRouter · x-ai`.
 */
export function describeModelRef(modelRef: string | null | undefined): ModelDisplayParts {
  const value = (modelRef || '').trim();
  const parsed = splitModelRef(value);
  if (!parsed) return { name: value || 'Model', source: null };
  const segments = parsed.modelId.split('/').filter(Boolean);
  const name = segments.pop() || parsed.modelId;
  const providerBase = parsed.providerKey.replace(/-[0-9a-f]{8}$/i, '');
  const provider = PROVIDER_NAMES[parsed.providerKey] ?? PROVIDER_NAMES[providerBase] ?? providerBase;
  const namespace = segments.join('/');
  return { name, source: namespace ? `${provider} · ${namespace}` : provider };
}
