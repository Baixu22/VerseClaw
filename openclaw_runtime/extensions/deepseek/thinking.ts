// Deepseek plugin module implements thinking behavior.
import type { ProviderThinkingProfile } from "openclaw/plugin-sdk/plugin-entry";

const DEEPSEEK_V4_MODEL_IDS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

type ThinkingLevelId = NonNullable<ProviderThinkingProfile["levels"]>[number]["id"];

function buildThinkingProfile(levelIds: ThinkingLevelId[]): ProviderThinkingProfile {
  return {
    levels: levelIds.map((id) => ({ id })),
    defaultLevel: "high",
  };
}

// Per-model effort vocabulary aligned with DeepSeek-Reasonix
// (internal/config/provider_presets.go):
//   deepseek-v4-flash: disabled|low|high|max   (default high)
//   deepseek-v4-pro:   disabled|high|max       (default high)
// The platform expresses "disabled" as the "off" level id.
const DEEPSEEK_V4_FLASH_PROFILE = buildThinkingProfile(["off", "low", "high", "max"]);
const DEEPSEEK_V4_PRO_PROFILE = buildThinkingProfile(["off", "high", "max"]);

export function resolveDeepSeekV4ThinkingProfile(
  modelId: string,
): ProviderThinkingProfile | undefined {
  switch (modelId.trim().toLowerCase()) {
    case "deepseek-v4-flash":
      return DEEPSEEK_V4_FLASH_PROFILE;
    case "deepseek-v4-pro":
      return DEEPSEEK_V4_PRO_PROFILE;
    default:
      return DEEPSEEK_V4_MODEL_IDS.has(modelId.trim().toLowerCase())
        ? DEEPSEEK_V4_FLASH_PROFILE
        : undefined;
  }
}
