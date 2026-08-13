import { describe, expect, it } from 'vitest';
import { resolveDeepSeekV4ThinkingProfile } from '../../openclaw_runtime/extensions/deepseek/thinking';

const levelIds = (modelId: string) =>
  resolveDeepSeekV4ThinkingProfile(modelId)?.levels.map((level) => level.id) ?? [];

describe('DeepSeek per-model effort vocabulary', () => {
  it('exposes disabled|low|high|max for deepseek-v4-flash', () => {
    expect(levelIds('deepseek-v4-flash')).toEqual(['off', 'low', 'high', 'max']);
    expect(resolveDeepSeekV4ThinkingProfile('deepseek-v4-flash')?.defaultLevel).toBe('high');
  });

  it('exposes disabled|high|max for deepseek-v4-pro', () => {
    expect(levelIds('deepseek-v4-pro')).toEqual(['off', 'high', 'max']);
    expect(resolveDeepSeekV4ThinkingProfile('deepseek-v4-pro')?.defaultLevel).toBe('high');
  });

  it('returns undefined for non-V4 models', () => {
    expect(resolveDeepSeekV4ThinkingProfile('deepseek-chat')).toBeUndefined();
    expect(resolveDeepSeekV4ThinkingProfile('deepseek-reasoner')).toBeUndefined();
  });
});
