import { memo, type ComponentType, type CSSProperties } from 'react';
import { Sparkle } from 'lucide-react';
/* Deep component imports, never the `@lobehub/icons` barrel: the barrel also
 * pulls every brand's Avatar/Combine variants, which route through the
 * `@lobehub/ui` theme layer. The Color/Mono components are plain SVG. */
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono';
import AzureColor from '@lobehub/icons/es/Azure/components/Color';
import BaichuanColor from '@lobehub/icons/es/Baichuan/components/Color';
import BedrockColor from '@lobehub/icons/es/Bedrock/components/Color';
import ChatGLMColor from '@lobehub/icons/es/ChatGLM/components/Color';
import ClaudeColor from '@lobehub/icons/es/Claude/components/Color';
import CohereColor from '@lobehub/icons/es/Cohere/components/Color';
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color';
import DoubaoColor from '@lobehub/icons/es/Doubao/components/Color';
import GemmaColor from '@lobehub/icons/es/Gemma/components/Color';
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color';
import GoogleColor from '@lobehub/icons/es/Google/components/Color';
import GrokMono from '@lobehub/icons/es/Grok/components/Mono';
import GroqMono from '@lobehub/icons/es/Groq/components/Mono';
import HunyuanColor from '@lobehub/icons/es/Hunyuan/components/Color';
import KimiColor from '@lobehub/icons/es/Kimi/components/Color';
import MetaColor from '@lobehub/icons/es/Meta/components/Color';
import MicrosoftColor from '@lobehub/icons/es/Microsoft/components/Color';
import MinimaxColor from '@lobehub/icons/es/Minimax/components/Color';
import MistralColor from '@lobehub/icons/es/Mistral/components/Color';
import NvidiaColor from '@lobehub/icons/es/Nvidia/components/Color';
import OllamaMono from '@lobehub/icons/es/Ollama/components/Mono';
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono';
import OpenRouterColor from '@lobehub/icons/es/OpenRouter/components/Color';
import PerplexityColor from '@lobehub/icons/es/Perplexity/components/Color';
import QwenColor from '@lobehub/icons/es/Qwen/components/Color';
import SiliconCloudColor from '@lobehub/icons/es/SiliconCloud/components/Color';
import SparkColor from '@lobehub/icons/es/Spark/components/Color';
import StepfunMono from '@lobehub/icons/es/Stepfun/components/Mono';
import VolcengineColor from '@lobehub/icons/es/Volcengine/components/Color';
import WenxinColor from '@lobehub/icons/es/Wenxin/components/Color';
import XAIMono from '@lobehub/icons/es/XAI/components/Mono';
import YiColor from '@lobehub/icons/es/Yi/components/Color';
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color';
import { cn } from '@/lib/utils';
import { resolveModelBrand, type ModelBrandId } from '@/lib/model-brand';

type BrandIcon = ComponentType<{ size?: number | string; className?: string; style?: CSSProperties }>;

/* `mono` marks that ship without a colour variant (Grok, OpenAI, xAI…).
 * They draw in currentColor, so they follow the theme like the text beside them. */
const BRAND_ICONS: Record<ModelBrandId, { Icon: BrandIcon; mono?: boolean }> = {
  claude: { Icon: ClaudeColor },
  anthropic: { Icon: AnthropicMono, mono: true },
  openai: { Icon: OpenAIMono, mono: true },
  grok: { Icon: GrokMono, mono: true },
  xai: { Icon: XAIMono, mono: true },
  deepseek: { Icon: DeepSeekColor },
  gemini: { Icon: GeminiColor },
  gemma: { Icon: GemmaColor },
  google: { Icon: GoogleColor },
  qwen: { Icon: QwenColor },
  kimi: { Icon: KimiColor },
  chatglm: { Icon: ChatGLMColor },
  zhipu: { Icon: ZhipuColor },
  doubao: { Icon: DoubaoColor },
  volcengine: { Icon: VolcengineColor },
  minimax: { Icon: MinimaxColor },
  mistral: { Icon: MistralColor },
  meta: { Icon: MetaColor },
  hunyuan: { Icon: HunyuanColor },
  yi: { Icon: YiColor },
  baichuan: { Icon: BaichuanColor },
  wenxin: { Icon: WenxinColor },
  spark: { Icon: SparkColor },
  stepfun: { Icon: StepfunMono, mono: true },
  cohere: { Icon: CohereColor },
  perplexity: { Icon: PerplexityColor },
  microsoft: { Icon: MicrosoftColor },
  nvidia: { Icon: NvidiaColor },
  openrouter: { Icon: OpenRouterColor },
  ollama: { Icon: OllamaMono, mono: true },
  siliconcloud: { Icon: SiliconCloudColor },
  groq: { Icon: GroqMono, mono: true },
  azure: { Icon: AzureColor },
  bedrock: { Icon: BedrockColor },
};

export type ModelBrandIconProps = {
  modelRef: string | null | undefined;
  size?: number;
  className?: string;
};

/**
 * The model's brand mark (LobeHub Icons) for a provider/model ref, with a
 * neutral sparkle for families it does not recognise. Decorative: the model
 * name always sits next to it, so it is hidden from assistive tech.
 */
export const ModelBrandIcon = memo(function ModelBrandIcon({ modelRef, size = 16, className }: ModelBrandIconProps) {
  const brand = resolveModelBrand(modelRef);
  const entry = brand ? BRAND_ICONS[brand] : null;
  return (
    <span
      className={cn('codex-model-brand', entry?.mono && 'codex-model-brand--mono', !entry && 'codex-model-brand--unknown', className)}
      style={{ width: size, height: size }}
      data-brand={brand ?? 'unknown'}
      aria-hidden="true"
    >
      {entry ? <entry.Icon size={size} /> : <Sparkle style={{ width: size * 0.75, height: size * 0.75 }} strokeWidth={1.8} />}
    </span>
  );
});
